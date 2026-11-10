import 'server-only';
import { randomUUID } from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import type { SessionUser } from '@/lib/auth/server';
import {
    NATURES_ACHAT, SEUILS_DEFAUT, SUITE, annulable, controleSeuils, decider, etapesPour, factureHT, modifiable, totalCommande, totalLigne,
    type CibleCommande, type Commande, type FactureFournisseur, type LigneCommande, type SeuilsValidation,
} from '@/lib/commandes';
import type { AnalytiqueLigne } from '@/lib/analytique';
import type { Project } from '@/lib/projects/types';
import { analytiqueContrat, analytiqueDeLigne, analytiqueLigneAffaire } from '@/services/analytique-admin';

/**
 * Commandes d'achat et fournisseurs, au serveur (seul à écrire `commandes` et `fournisseurs`) : brouillon, soumission
 * (numéro, analytique figée sur chaque ligne, étapes de validation selon les seuils de la société et la hiérarchie du
 * demandeur), décisions, passage au fournisseur, réception, factures fournisseurs, annulation.
 */

const commandes = () => adminDb.collection('commandes');
const fournisseurs = () => adminDb.collection('fournisseurs');
const now = () => new Date().toISOString();
/** Prénom et nom, sans doublon quand le nom saisi contient déjà le prénom. */
const nomDe = (u: { firstName?: string; name?: string; email?: string }) =>
    (u.firstName && u.name?.toLowerCase().startsWith(u.firstName.toLowerCase()) ? u.name : [u.firstName, u.name].filter(Boolean).join(' ')) || u.email || '';

// --- Fournisseurs ---

export type Fournisseur = { id: string; code: string; name: string; siret?: string; email?: string; phone?: string; address?: string; active: boolean; createdAt: string };

export async function listFournisseurs(): Promise<Fournisseur[]> {
    return (await fournisseurs().get()).docs.map(d => ({ id: d.id, ...d.data() }) as Fournisseur).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export async function saveFournisseur(input: { id?: string; name: string; siret?: string; email?: string; phone?: string; address?: string; active?: boolean }, by: string): Promise<Fournisseur> {
    const name = input.name?.trim();
    if (!name) throw new Error('Nom du fournisseur obligatoire.');
    const siret = (input.siret ?? '').replace(/\s/g, '');
    if (siret && !/^\d{14}$/.test(siret)) throw new Error('SIRET : 14 chiffres.');
    const champs = { name, ...(siret && { siret }), email: input.email?.trim() ?? '', phone: input.phone?.trim() ?? '', address: input.address?.trim() ?? '', active: input.active !== false };
    const existants = await listFournisseurs();
    const doublon = existants.find(f => f.id !== input.id && (f.name.toLowerCase() === name.toLowerCase() || (siret && f.siret === siret)));
    if (doublon) throw new Error(`Fournisseur déjà enregistré : ${doublon.code} — ${doublon.name}.`);
    if (input.id) {
        await fournisseurs().doc(input.id).update({ ...champs, updatedAt: now(), updatedBy: by });
        return { ...(existants.find(f => f.id === input.id)!), ...champs };
    }
    const sequences = adminDb.collection('config').doc('sequences');
    const ref = fournisseurs().doc();
    return adminDb.runTransaction(async tx => {
        const seq = await tx.get(sequences);
        const next = (seq.exists ? seq.get('fournisseur') || 0 : 0) + 1;
        const f = { code: `FRN-${String(next).padStart(5, '0')}`, ...champs, createdAt: now(), createdBy: by };
        tx.set(sequences, { fournisseur: next }, { merge: true });
        tx.set(ref, f);
        return { id: ref.id, ...f };
    });
}

// --- Seuils de validation (par société) ---

export async function seuilsDe(companyId: string): Promise<SeuilsValidation> {
    const c = await adminDb.collection('companies').doc(companyId).get();
    return { ...SEUILS_DEFAUT, ...(c.get('purchaseThresholds') as Partial<SeuilsValidation> | undefined) };
}

export async function setSeuils(companyId: string, seuils: SeuilsValidation): Promise<void> {
    const erreur = controleSeuils(seuils);
    if (erreur) throw new Error(erreur);
    const ref = adminDb.collection('companies').doc(companyId);
    if (!(await ref.get()).exists) throw new Error('Société introuvable.');
    await ref.update({ purchaseThresholds: { auto: seuils.auto, n2: seuils.n2, achats: seuils.achats } });
}

// --- Commandes ---

export type CommandeInput = {
    companyId: string; supplierId: string; title: string; date: string; deliveryDate?: string; notes?: string;
    lines: { id?: string; label: string; quantity: number; unitPrice: number; nature: LigneCommande['nature']; cible: CibleCommande }[];
};

async function lire(id: string): Promise<Commande> {
    const d = await commandes().doc(id).get();
    if (!d.exists) throw new Error('Commande introuvable.');
    return { id: d.id, ...d.data() } as Commande;
}

async function contenu(input: CommandeInput): Promise<Pick<Commande, 'companyId' | 'supplierId' | 'supplierName' | 'title' | 'date' | 'deliveryDate' | 'notes' | 'lines' | 'totalHT'>> {
    if (!input.title?.trim()) throw new Error('Objet de la commande obligatoire.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('Date de la commande invalide.');
    const [societe, f] = await Promise.all([adminDb.collection('companies').doc(String(input.companyId)).get(), fournisseurs().doc(String(input.supplierId)).get()]);
    if (!societe.exists) throw new Error('Société introuvable.');
    if (!f.exists) throw new Error('Fournisseur introuvable.');
    if (f.get('active') === false) throw new Error('Fournisseur inactif.');
    if (!input.lines?.length) throw new Error('Au moins une ligne.');
    const lines: LigneCommande[] = input.lines.map((l, i) => {
        const n = i + 1;
        if (!l.label?.trim()) throw new Error(`Ligne ${n} : désignation obligatoire.`);
        if (!(Number(l.quantity) > 0)) throw new Error(`Ligne ${n} : quantité positive.`);
        if (!(Number(l.unitPrice) >= 0)) throw new Error(`Ligne ${n} : prix unitaire invalide.`);
        if (!NATURES_ACHAT.includes(l.nature)) throw new Error(`Ligne ${n} : nature (fournitures, sous-traitance, divers).`);
        if (!l.cible || (l.cible.type === 'affaire' ? !l.cible.projectId : !l.cible.contractId)) throw new Error(`Ligne ${n} : affectation analytique obligatoire (affaire ou contrat).`);
        const base = { id: l.id || randomUUID().slice(0, 8), label: l.label.trim(), quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), nature: l.nature, cible: l.cible };
        return { ...base, total: totalLigne(base) };
    });
    return {
        companyId: societe.id, supplierId: f.id, supplierName: String(f.get('name')), title: input.title.trim(), date: input.date,
        ...(input.deliveryDate && { deliveryDate: input.deliveryDate }), ...(input.notes?.trim() && { notes: input.notes.trim() }),
        lines, totalHT: totalCommande(lines),
    };
}

/** Crée ou modifie un brouillon (ou une commande refusée, qui redevient brouillon). Seul son demandeur la modifie. */
export async function saveCommande(input: CommandeInput & { id?: string }, user: SessionUser): Promise<Commande> {
    const c = await contenu(input);
    const t = now();
    if (input.id) {
        const existante = await lire(input.id);
        if (!modifiable(existante.status)) throw new Error('Cette commande n\'est plus modifiable (annulez-la et refaites-la).');
        if (existante.requesterId !== user.profile.id && !user.isAdmin) throw new Error('Seul le demandeur modifie sa commande.');
        await commandes().doc(input.id).update({ ...c, status: 'brouillon', etapes: [], updatedAt: t });
        return lire(input.id);
    }
    const ref = commandes().doc();
    await ref.set({ ...c, status: 'brouillon', etapes: [], requesterId: user.profile.id, requesterName: nomDe(user.profile), requesterEmail: user.email, createdAt: t, updatedAt: t });
    return lire(ref.id);
}

/** Analytique d'une ligne, figée à la soumission : celle de l'affaire, ou de la prestation du contrat. */
async function analytiqueCible(cible: CibleCommande): Promise<{ analytique: AnalytiqueLigne; libelle: string }> {
    if (cible.type === 'affaire') {
        const d = await adminDb.collection('projects').doc(cible.projectId).get();
        if (!d.exists) throw new Error('Affaire introuvable.');
        const p = { id: d.id, ...d.data() } as Project;
        if (p.status === 'cloture') throw new Error(`Affaire ${p.code} clôturée.`);
        const a = await analytiqueLigneAffaire(p);
        if (!a) throw new Error(`Affaire ${p.code} sans code analytique (code d'agence ou de secteur manquant).`);
        return { analytique: a, libelle: `${p.code} — ${p.title}` };
    }
    const contrat = await analytiqueContrat(cible.contractId);
    const a = analytiqueDeLigne(contrat, { serviceId: cible.serviceId, activityCode: cible.activityCode ?? '' });
    if (!a) throw new Error(`Contrat sans code analytique : ${contrat.contrat.manque.join(', ')} à renseigner.`);
    const k = await adminDb.collection('contracts').doc(cible.contractId).get();
    return { analytique: a, libelle: `${k.get('contractNumber') ?? ''}${cible.activityCode ? ` — ${cible.activityCode}` : ''}` };
}

/**
 * Soumet un brouillon : numéro, analytique figée sur chaque ligne, étapes de validation. Sous le seuil
 * d'autovalidation, la commande est validée d'emblée.
 */
export async function soumettreCommande(id: string, user: SessionUser): Promise<Commande> {
    const c0 = await lire(id);
    if (c0.status !== 'brouillon') throw new Error('Seul un brouillon se soumet.');
    if (c0.requesterId !== user.profile.id && !user.isAdmin) throw new Error('Seul le demandeur soumet sa commande.');
    const [seuils, societe, users] = await Promise.all([seuilsDe(c0.companyId), adminDb.collection('companies').doc(c0.companyId).get(), adminDb.collection('users').get()]);
    const code = String(societe.get('code') ?? '').trim();
    if (!code) throw new Error('Code de la société manquant (numérotation des commandes).');
    const hierarchie = users.docs.map(d => ({ id: d.id, name: nomDe(d.data()), managerId: d.get('managerId') as string | null | undefined }));
    const demandeur = hierarchie.find(u => u.id === c0.requesterId) ?? { id: c0.requesterId, name: c0.requesterName };
    const etapes = etapesPour(c0.totalHT, seuils, demandeur, hierarchie);
    if (typeof etapes === 'string') throw new Error(etapes);
    const lines = await Promise.all(c0.lines.map(async l => {
        const { analytique, libelle } = await analytiqueCible(l.cible);
        return { ...l, cible: { ...l.cible, libelle }, analytique };
    }));
    const year = Number(c0.date.slice(0, 4));
    const counter = `commande_${code}_${year}`;
    const sequences = adminDb.collection('config').doc('sequences');
    const t = now();
    await adminDb.runTransaction(async tx => {
        const [snap, seq] = await Promise.all([tx.get(commandes().doc(id)), tx.get(sequences)]);
        if (snap.get('status') !== 'brouillon') throw new Error('Commande déjà soumise.');
        const numero = snap.get('number') as string | undefined;
        const next = (seq.exists ? seq.get(counter) || 0 : 0) + 1;
        if (!numero) tx.set(sequences, { [counter]: next }, { merge: true });
        tx.update(commandes().doc(id), {
            number: numero ?? `${code}-CMD${year}-${String(next).padStart(4, '0')}`, lines, etapes, seuils, submittedAt: t, updatedAt: t,
            ...(etapes.length === 0 ? { status: 'validee', autoValidee: true, validatedAt: t } : { status: 'a_valider', autoValidee: false }),
        });
    });
    return lire(id);
}

/** Valide ou refuse l'étape en cours (N+1, N+2, achats ; administrateur en secours ; jamais sa propre commande). */
export async function deciderCommande(id: string, decision: 'validee' | 'refusee', commentaire: string, user: SessionUser): Promise<Commande> {
    const t = now();
    await adminDb.runTransaction(async tx => {
        const snap = await tx.get(commandes().doc(id));
        if (!snap.exists) throw new Error('Commande introuvable.');
        const c = { id: snap.id, ...snap.data() } as Commande;
        const r = decider(c, { id: user.profile.id, name: nomDe(user.profile), isAdmin: user.isAdmin, isAcheteur: user.isAcheteur }, decision, commentaire ?? '', t);
        if (typeof r === 'string') throw new Error(r);
        tx.update(commandes().doc(id), { etapes: r.etapes, status: r.status, updatedAt: t, ...(r.status === 'validee' && { validatedAt: t }) });
    });
    return lire(id);
}

/** Étape suivante après validation : passée au fournisseur, puis reçue. */
export async function avancerCommande(id: string, user: SessionUser): Promise<Commande> {
    const c = await lire(id);
    const suite = SUITE[c.status];
    if (!suite) throw new Error('Aucune étape suivante pour cette commande.');
    if (c.requesterId !== user.profile.id && !user.isAdmin && !user.isAcheteur) throw new Error('Réservé au demandeur, aux achats ou à un administrateur.');
    const t = now();
    await commandes().doc(id).update({ status: suite, updatedAt: t, ...(suite === 'passee' ? { passedAt: t } : { receivedAt: t }) });
    return lire(id);
}

/** Facture du fournisseur sur une commande validée : son montant HT fait le réel. `solder` clôt la commande. */
export async function ajouterFactureFournisseur(id: string, input: { numero: string; date: string; montantHT: number; solder?: boolean }, user: SessionUser): Promise<Commande> {
    if (!input.numero?.trim()) throw new Error('Numéro de la facture fournisseur obligatoire.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('Date de la facture invalide.');
    if (!Number.isFinite(Number(input.montantHT)) || Number(input.montantHT) === 0) throw new Error('Montant HT de la facture obligatoire.');
    const t = now();
    await adminDb.runTransaction(async tx => {
        const snap = await tx.get(commandes().doc(id));
        if (!snap.exists) throw new Error('Commande introuvable.');
        const c = { id: snap.id, ...snap.data() } as Commande;
        if (!['validee', 'passee', 'recue'].includes(c.status)) throw new Error('Facture fournisseur : sur une commande validée, passée ou reçue.');
        if ((c.factures ?? []).some(f => f.numero.toLowerCase() === input.numero.trim().toLowerCase())) throw new Error(`Facture ${input.numero.trim()} déjà saisie sur cette commande.`);
        const f: FactureFournisseur = { id: randomUUID().slice(0, 8), numero: input.numero.trim(), date: input.date, montantHT: Math.round(Number(input.montantHT) * 100) / 100, saisiPar: user.email, saisiLe: t };
        tx.update(commandes().doc(id), { factures: [...(c.factures ?? []), f], updatedAt: t, ...(input.solder && { status: 'soldee' }) });
    });
    return lire(id);
}

/** Annule une commande (motif obligatoire) : elle ne compte plus dans l'engagé. */
export async function annulerCommande(id: string, motif: string, user: SessionUser): Promise<Commande> {
    if (!motif?.trim()) throw new Error('Motif de l\'annulation obligatoire.');
    const c = await lire(id);
    if (!annulable(c.status)) throw new Error('Cette commande ne s\'annule plus.');
    if (c.requesterId !== user.profile.id && !user.isAdmin && !user.isAcheteur) throw new Error('Réservé au demandeur, aux achats ou à un administrateur.');
    if (factureHT(c) !== 0) throw new Error('Des factures fournisseurs sont saisies sur cette commande : elle ne s\'annule plus.');
    const t = now();
    await commandes().doc(id).update({ status: 'annulee', cancelReason: motif.trim(), cancelledAt: t, updatedAt: t });
    return lire(id);
}

export async function getCommande(id: string): Promise<Commande> { return lire(id); }

export async function listCommandes(): Promise<Commande[]> {
    return (await commandes().get()).docs.map(d => ({ id: d.id, ...d.data() }) as Commande).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}
