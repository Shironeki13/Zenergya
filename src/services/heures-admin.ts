import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import type { SessionUser } from '@/lib/auth/server';
import type { CibleCommande } from '@/lib/commandes';
import { cleCible, cleDoublon, controleHeures, coutHeures, lireImportHeures, tauxHoraire, type LigneImportHeures, type SaisieHeures } from '@/lib/heures';
import { todayInParis } from '@/lib/services/site-amounts';
import { analytiqueCible, nomDe } from '@/services/commandes-admin';

/**
 * Heures de main-d'œuvre : saisie par le technicien (ou, pour lui, par son responsable ou un administrateur), import
 * depuis un autre outil. Chaque saisie est affectée à une affaire ou à un contrat et une activité ; son code analytique
 * et son coût horaire sont figés à la saisie.
 */

const heures = () => adminDb.collection('heures');
const now = () => new Date().toISOString();

type Fiche = { id: string; name: string; email: string; managerId?: string | null; hourlyCost?: number | null };
async function fiche(id: string): Promise<Fiche> {
    const d = await adminDb.collection('users').doc(id).get();
    if (!d.exists) throw new Error('Utilisateur introuvable.');
    return { id: d.id, name: nomDe(d.data() as never), email: String(d.get('email') ?? ''), managerId: d.get('managerId'), hourlyCost: d.get('hourlyCost') };
}

/** Qui saisit pour qui : soi-même ; son équipe directe (N+1) ; un administrateur pour tous. */
function droitSur(technicien: Pick<Fiche, 'id' | 'managerId' | 'name'>, user: SessionUser): string | null {
    if (technicien.id === user.profile.id || user.isAdmin || technicien.managerId === user.profile.id) return null;
    return `Heures de ${technicien.name} : réservées à l'intéressé, à son responsable (N+1) ou à un administrateur.`;
}

/** Société de l'affectation (son coût horaire par défaut) et, pour une affaire, son état. */
async function societeCible(cible: CibleCommande): Promise<string> {
    if (cible.type === 'affaire') {
        const p = await adminDb.collection('projects').doc(String(cible.projectId)).get();
        if (!p.exists) throw new Error('Affaire introuvable.');
        return String(p.get('companyId'));
    }
    const k = await adminDb.collection('contracts').doc(String(cible.contractId)).get();
    if (!k.exists) throw new Error('Contrat introuvable.');
    if (k.get('companyId')) return String(k.get('companyId'));
    const c = await adminDb.collection('clients').doc(String(k.get('clientId'))).get();
    if (!c.get('companyId')) throw new Error('Société du contrat introuvable.');
    return String(c.get('companyId'));
}

async function valorisation(technicien: Fiche, cible: CibleCommande) {
    if (!cible || (cible.type === 'affaire' ? !cible.projectId : !cible.contractId || !cible.activityCode)) throw new Error('Affectation obligatoire : une affaire, ou un contrat et une activité.');
    const [{ analytique, libelle }, companyId] = await Promise.all([analytiqueCible(cible), societeCible(cible)]);
    const societe = await adminDb.collection('companies').doc(companyId).get();
    const rate = tauxHoraire(technicien.hourlyCost, societe.get('quoteLaborCost'));
    if (rate === null) throw new Error(`Coût horaire non renseigné : sur la fiche de ${technicien.name} (Utilisateurs) ou sur la société ${societe.get('name') ?? ''} (Paramétrage › coût horaire MO interne).`);
    const propre = cible.type === 'affaire' ? { type: cible.type, projectId: cible.projectId } : { type: cible.type, contractId: cible.contractId, activityCode: cible.activityCode, ...(cible.serviceId && { serviceId: cible.serviceId }) };
    return { analytique, cible: { ...propre, libelle } as CibleCommande, companyId, rate };
}

/** Total déjà saisi par un technicien sur une journée (hors la saisie en cours de modification). */
async function dejaSaisi(userId: string, date: string, sauf?: string): Promise<number> {
    const s = await heures().where('userId', '==', userId).where('date', '==', date).get();
    return s.docs.filter(d => d.id !== sauf).reduce((t, d) => t + Number(d.get('hours') ?? 0), 0);
}

async function affaireOuverte(cible: CibleCommande): Promise<void> {
    if (cible.type !== 'affaire') return;
    const p = await adminDb.collection('projects').doc(cible.projectId).get();
    if (p.get('status') === 'cloture') throw new Error(`Affaire ${p.get('code')} clôturée : ses heures ne se modifient plus.`);
}

export type HeuresInput = { id?: string; userId?: string; date: string; hours: number; cible: CibleCommande; comment?: string };

/** Crée ou modifie une saisie. Le coût horaire et l'analytique sont figés à la création ; ils sont recalculés si l'affectation change. */
export async function saveHeures(input: HeuresInput, user: SessionUser): Promise<SaisieHeures> {
    const erreur = controleHeures(input, todayInParis());
    if (erreur) throw new Error(erreur);
    const existante = input.id ? await lire(input.id) : null;
    const technicien = await fiche(existante?.userId ?? input.userId ?? user.profile.id);
    const refus = droitSur(technicien, user);
    if (refus) throw new Error(refus);
    if (existante) await affaireOuverte(existante.cible);
    const total = (await dejaSaisi(technicien.id, input.date, input.id)) + Number(input.hours);
    if (total > 24) throw new Error(`Plus de 24 h le ${input.date.split('-').reverse().join('/')} pour ${technicien.name} (${total.toLocaleString('fr-FR')} h avec cette saisie).`);
    const t = now();
    const hours = Number(input.hours);
    const comment = input.comment?.trim() ?? '';
    if (existante) {
        const memeCible = cleCible(existante.cible) === cleCible(input.cible);
        const v = memeCible ? { analytique: existante.analytique, cible: existante.cible, companyId: existante.companyId, rate: existante.rate } : await valorisation(technicien, input.cible);
        await heures().doc(existante.id).update({ date: input.date, hours, comment, ...v, cost: coutHeures(hours, v.rate), updatedAt: t, updatedBy: user.email });
        return lire(existante.id);
    }
    const v = await valorisation(technicien, input.cible);
    const ref = heures().doc();
    await ref.set({ userId: technicien.id, userName: technicien.name, date: input.date, hours, comment, ...v, cost: coutHeures(hours, v.rate), source: 'saisie', createdAt: t, createdBy: user.email });
    return lire(ref.id);
}

export async function deleteHeures(id: string, user: SessionUser): Promise<void> {
    const s = await lire(id);
    const refus = droitSur(await fiche(s.userId).catch(() => ({ id: s.userId, name: s.userName, managerId: null })), user);
    if (refus) throw new Error(refus);
    await affaireOuverte(s.cible);
    await heures().doc(id).delete();
}

async function lire(id: string): Promise<SaisieHeures> {
    const d = await heures().doc(id).get();
    if (!d.exists) throw new Error('Saisie d\'heures introuvable.');
    return { id: d.id, ...d.data() } as SaisieHeures;
}

/** Saisies d'une période (bornes incluses), les plus récentes d'abord. */
export async function listHeures(filtre: { from?: string; to?: string; userId?: string; projectId?: string } = {}): Promise<SaisieHeures[]> {
    let q: FirebaseFirestore.Query = heures();
    if (filtre.from) q = q.where('date', '>=', filtre.from);
    if (filtre.to) q = q.where('date', '<=', filtre.to);
    return (await q.get()).docs.map(d => ({ id: d.id, ...d.data() }) as SaisieHeures)
        .filter(s => (!filtre.userId || s.userId === filtre.userId) && (!filtre.projectId || (s.cible.type === 'affaire' && s.cible.projectId === filtre.projectId)))
        .sort((a, b) => b.date.localeCompare(a.date) || a.userName.localeCompare(b.userName, 'fr') || a.createdAt.localeCompare(b.createdAt));
}

// --- Import ---

export type LigneRapportHeures = Pick<LigneImportHeures, 'ligne' | 'date' | 'email' | 'hours'> & { affectation: string; technicien: string; cout: number | null; etat: 'a_creer' | 'doublon' | 'erreur'; messages: string[] };
export type RapportImportHeures = { lignes: LigneRapportHeures[]; aCreer: number; doublons: number; erreurs: number; heures: number; cout: number; applique: boolean };

/**
 * Importe des heures saisies ailleurs. Simulation par défaut ; `appliquer` n'écrit que si aucune ligne n'est en erreur.
 * Une ligne déjà présente (même technicien, jour, affectation et durée) est ignorée : le même fichier se réimporte sans doublon.
 */
export async function importerHeures(table: unknown[][], user: SessionUser, appliquer = false): Promise<RapportImportHeures> {
    const { lignes, erreur } = lireImportHeures(table, todayInParis());
    if (erreur) throw new Error(erreur);
    if (lignes.length > 5000) throw new Error('5 000 lignes au plus par import.');
    const [users, projects, contracts, activities] = await Promise.all(['users', 'projects', 'contracts', 'activities'].map(c => adminDb.collection(c).get()));
    const parEmail = new Map(users.docs.map(d => [String(d.get('email') ?? '').toLowerCase(), { id: d.id, name: nomDe(d.data() as never), email: String(d.get('email') ?? ''), managerId: d.get('managerId'), hourlyCost: d.get('hourlyCost') } as Fiche]));
    const parCode = new Map(projects.docs.map(d => [String(d.get('code') ?? '').toUpperCase(), d]));
    const parNumero = new Map(contracts.docs.map(d => [String(d.get('contractNumber') ?? '').toUpperCase(), d]));
    const codeActivite = new Map(activities.docs.map(d => [d.id, String(d.get('code') ?? '').toUpperCase()]));
    const jours = [...new Set(lignes.map(l => l.date).filter(Boolean))].sort();
    const existantes = jours.length ? await listHeures({ from: jours[0], to: jours[jours.length - 1] }) : [];
    const connues = new Set(existantes.map(cleDoublon));
    const parJour = new Map<string, number>();
    for (const s of existantes) parJour.set(`${s.userId}|${s.date}`, (parJour.get(`${s.userId}|${s.date}`) ?? 0) + s.hours);
    const valos = new Map<string, Promise<Awaited<ReturnType<typeof valorisation>>>>();
    const aEcrire: Omit<SaisieHeures, 'id'>[] = [];
    const rapport: LigneRapportHeures[] = [];
    const t = now();
    for (const l of lignes) {
        const messages = [...l.erreurs];
        const technicien = parEmail.get(l.email);
        if (l.email && !technicien) messages.push(`utilisateur inconnu : ${l.email}`);
        if (technicien) { const refus = droitSur(technicien, user); if (refus) messages.push(refus); }
        let cible: CibleCommande | null = null;
        if (l.affaire) {
            const p = parCode.get(l.affaire.toUpperCase());
            if (!p) messages.push(`affaire inconnue : ${l.affaire}`); else cible = { type: 'affaire', projectId: p.id };
        } else if (l.contrat) {
            const k = parNumero.get(l.contrat.toUpperCase());
            if (!k) messages.push(`contrat inconnu : ${l.contrat}`);
            else if (l.activite && !((k.get('activityIds') as string[] | undefined) ?? []).some(a => codeActivite.get(a) === l.activite.toUpperCase())) messages.push(`activité ${l.activite} absente du contrat ${l.contrat}`);
            else if (l.activite) cible = { type: 'contrat', contractId: k.id, activityCode: l.activite.toUpperCase() };
        }
        let v: Awaited<ReturnType<typeof valorisation>> | null = null;
        if (technicien && cible && !messages.length) {
            const cle = `${technicien.id}|${cleCible(cible)}`;
            if (!valos.has(cle)) valos.set(cle, valorisation(technicien, cible));
            try { v = await valos.get(cle)!; } catch (e) { messages.push(e instanceof Error ? e.message : 'affectation refusée'); }
        }
        let etat: LigneRapportHeures['etat'] = messages.length ? 'erreur' : 'a_creer';
        if (technicien && v && etat === 'a_creer') {
            const saisie = { userId: technicien.id, date: l.date, cible: v.cible, hours: l.hours };
            if (connues.has(cleDoublon(saisie))) { etat = 'doublon'; messages.push('déjà saisie : ignorée'); }
            else {
                const jour = `${technicien.id}|${l.date}`;
                const total = (parJour.get(jour) ?? 0) + l.hours;
                if (total > 24) { etat = 'erreur'; messages.push(`plus de 24 h ce jour-là pour ${technicien.name}`); }
                else {
                    parJour.set(jour, total); connues.add(cleDoublon(saisie));
                    aEcrire.push({ userId: technicien.id, userName: technicien.name, date: l.date, hours: l.hours, comment: l.comment, ...v, cost: coutHeures(l.hours, v.rate), source: 'import', createdAt: t, createdBy: user.email });
                }
            }
        }
        rapport.push({ ligne: l.ligne, date: l.date, email: l.email, hours: l.hours, technicien: technicien?.name ?? '', affectation: v?.cible.libelle ?? (l.affaire || [l.contrat, l.activite].filter(Boolean).join(' — ')), cout: v && Number.isFinite(l.hours) ? coutHeures(l.hours, v.rate) : null, etat, messages });
    }
    const erreurs = rapport.filter(r => r.etat === 'erreur').length;
    const applique = appliquer && erreurs === 0 && aEcrire.length > 0;
    if (appliquer && erreurs > 0) throw new Error(`${erreurs} ligne(s) en erreur : rien n'a été importé. Corrigez le fichier puis relancez.`);
    if (applique) {
        for (let i = 0; i < aEcrire.length; i += 400) {
            const lot = adminDb.batch();
            for (const s of aEcrire.slice(i, i + 400)) lot.set(heures().doc(), s);
            await lot.commit();
        }
    }
    return {
        lignes: rapport, aCreer: aEcrire.length, doublons: rapport.filter(r => r.etat === 'doublon').length, erreurs, applique,
        heures: Math.round(aEcrire.reduce((h, s) => h + s.hours, 0) * 100) / 100, cout: Math.round(aEcrire.reduce((c, s) => c + s.cost, 0) * 100) / 100,
    };
}
