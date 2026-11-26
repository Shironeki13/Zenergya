import { couverture, type PointLivraison } from '@/lib/energie/fournitures';
import { rappelEnergie, type PointSuivi } from '@/lib/energie/rappels';
import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { etapeEnCours, libelleEtape, type Commande } from '@/lib/commandes';
import type { LigneHeures } from '@/lib/notifications/balises';
import type { SaisieHeures } from '@/lib/heures';
import { notifierSansBloquer, type DemandeNotification } from '@/services/notifications-admin';
import { derivesP1, etatPrecedent, memoriserEtat } from '@/services/derives-p1-admin';
import { nouveauxEnDerive } from '@/lib/energie/derives';

/**
 * Notifications des commandes d'achat et des heures : qui valide, qui est prévenu de la décision. Jamais bloquant :
 * une notification qui échoue ne fait pas échouer la soumission, la validation ou le refus.
 */

const SANS_CONTRAT = { id: '', numero: '', client: '' };
const email = async (userId?: string | null): Promise<string[]> => {
    if (!userId) return [];
    const u = await adminDb.collection('users').doc(String(userId)).get();
    const e = u.exists ? String(u.get('email') ?? '').trim() : '';
    return e ? [e] : [];
};
/** Adresses des utilisateurs dont le rôle a le droit « Achats ». */
async function acheteurs(): Promise<string[]> {
    const roles = (await adminDb.collection('roles').where('isAcheteur', '==', true).get()).docs.map(r => r.id);
    const out: string[] = [];
    for (let i = 0; i < roles.length; i += 30) for (const u of (await adminDb.collection('users').where('roleId', 'in', roles.slice(i, i + 30)).get()).docs) out.push(String(u.get('email') ?? ''));
    return out.filter(Boolean);
}

/**
 * Après la soumission ou une décision : prévient le valideur de l'étape en cours, ou le demandeur de la décision
 * finale (validée) ou du refus. Une commande autovalidée ou importée ne prévient personne.
 */
export async function notifierCommande(c: Commande, apres: 'soumission' | 'decision'): Promise<void> {
    try {
        const base = { id: c.id, numero: c.number ?? c.id, objet: c.title, fournisseur: c.supplierName, montantHT: c.totalHT, demandeur: c.requesterName };
        const libelle = `Commande ${base.numero}`;
        const demandeur = c.requesterEmail ? [c.requesterEmail] : await email(c.requesterId);
        const derniere = [...c.etapes].reverse().find(e => e.decision);
        const tour = c.submittedAt ?? '';
        if (c.status === 'a_valider') {
            const etape = etapeEnCours(c);
            if (!etape) return;
            const valideur = etape.role === 'achats' ? await acheteurs() : await email(etape.approverId);
            await notifierSansBloquer({
                evenement: 'commande_a_valider', cle: `commandes/${c.id}/etape/${c.etapes.indexOf(etape)}/${tour}`, libelle, annuaire: { valideur, demandeur },
                contexte: { contrat: SANS_CONTRAT, commande: { ...base, etape: libelleEtape(etape.role), valideur: etape.role === 'achats' ? 'Achats' : etape.approverName ?? '' } },
            });
        } else if (apres === 'decision' && c.status === 'validee' && !c.autoValidee) {
            await notifierSansBloquer({ evenement: 'commande_validee', cle: `commandes/${c.id}/validee/${tour}`, libelle, annuaire: { demandeur }, contexte: { contrat: SANS_CONTRAT, commande: { ...base, decidePar: derniere?.decideParNom ?? '', ...(derniere?.commentaire && { motif: derniere.commentaire }) } } });
        } else if (apres === 'decision' && c.status === 'refusee' && derniere?.decision === 'refusee') {
            await notifierSansBloquer({
                evenement: 'commande_refusee', cle: `commandes/${c.id}/refusee/${derniere.decideLe ?? tour}`, libelle, annuaire: { demandeur },
                contexte: { contrat: SANS_CONTRAT, commande: { ...base, decidePar: derniere.decideParNom ?? '', motif: derniere.commentaire ?? '' } },
            });
        }
    } catch (e) { console.error(`Notification de la commande ${c.id} impossible :`, e instanceof Error ? e.message : e); }
}

const ligneHeures = (s: SaisieHeures): LigneHeures => ({ date: s.date, heures: s.hours, salarie: s.userName, affectation: s.cible?.libelle ?? '' });

/** Heures refusées : un mail par salarié concerné, avec ses saisies et le motif. */
export async function notifierHeuresRefusees(saisies: SaisieHeures[], motif: string, par: string, le: string): Promise<void> {
    try {
        const parSalarie = new Map<string, SaisieHeures[]>();
        for (const s of saisies) parSalarie.set(s.userId, [...(parSalarie.get(s.userId) ?? []), s]);
        for (const [userId, liste] of parSalarie) {
            liste.sort((a, b) => a.date.localeCompare(b.date));
            await notifierSansBloquer({
                evenement: 'heures_refusees', cle: `heures/refus/${userId}/${le}`, libelle: `Heures de ${liste[0].userName}`, annuaire: { demandeur: await email(userId) },
                contexte: { contrat: SANS_CONTRAT, heures: { salarie: liste[0].userName, lignes: liste.map(ligneHeures), decidePar: par, motif } },
            });
        }
    } catch (e) { console.error('Notification des heures refusées impossible :', e instanceof Error ? e.message : e); }
}

/**
 * Récapitulatif quotidien des heures à valider : un mail par responsable, listant les saisies en attente de son
 * équipe, le jour où une saisie nouvelle (ou corrigée) est arrivée depuis le passage précédent. Les saisies de
 * salariés sans responsable vont aux administrateurs.
 */
export async function rappelsHeures(today: string, dernierPassage: string | null): Promise<DemandeNotification[]> {
    const [attente, users] = await Promise.all([adminDb.collection('heures').where('statut', '==', 'a_valider').get(), adminDb.collection('users').get()]);
    if (attente.empty) return [];
    const fiche = new Map(users.docs.map(u => [u.id, { email: String(u.get('email') ?? '').trim(), managerId: (u.get('managerId') as string | undefined) ?? null }]));
    const parValideur = new Map<string, SaisieHeures[]>();
    for (const d of attente.docs) {
        const s = { id: d.id, ...d.data() } as SaisieHeures;
        const chef = fiche.get(s.userId)?.managerId ?? '';
        parValideur.set(chef, [...(parValideur.get(chef) ?? []), s]);
    }
    const jour = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }) : '');
    const rolesAdmin = new Set((await adminDb.collection('roles').where('isAdmin', '==', true).get()).docs.map(r => r.id));
    const admins = users.docs.filter(u => rolesAdmin.has(String(u.get('roleId') ?? ''))).map(u => String(u.get('email') ?? '').trim()).filter(Boolean);
    const demandes: DemandeNotification[] = [];
    for (const [chef, liste] of parValideur) {
        // Du nouveau depuis le dernier passage ? (jamais passé : tout compte)
        const nouveau = dernierPassage === null || liste.some(s => { const j = jour((s as { updatedAt?: string }).updatedAt ?? (s as { createdAt?: string }).createdAt); return !j || j >= dernierPassage; });
        if (!nouveau) continue;
        liste.sort((a, b) => a.userName.localeCompare(b.userName, 'fr') || a.date.localeCompare(b.date));
        const valideur = chef ? [fiche.get(chef)?.email ?? ''].filter(Boolean) : [];
        demandes.push({
            evenement: 'heures_a_valider', cle: `heures/a-valider/${chef || 'sans-responsable'}/${today}`, libelle: chef ? 'Heures à valider' : 'Heures à valider (salariés sans responsable)',
            // Sans responsable, ce sont les administrateurs qui valident : ils sont le valideur attendu.
            annuaire: { valideur: chef ? valideur : admins },
            contexte: { contrat: SANS_CONTRAT, heures: { lignes: liste.map(ligneHeures) }, aujourdhui: today },
        });
    }
    return demandes;
}

/**
 * Récapitulatif des fournitures d'énergie à renouveler (contrats d'énergie) : un mail aux acheteurs et aux
 * administrateurs le jour où un point de livraison franchit un seuil, listant tous les points à renouveler.
 */
export async function rappelsEnergie(today: string, dernierPassage: string | null): Promise<DemandeNotification[]> {
    const snap = await adminDb.collection('pointsLivraison').get();
    if (snap.empty) return [];
    const suivis: PointSuivi[] = [];
    let sansContrat = 0;
    for (const d of snap.docs) {
        const p = d.data() as Partial<PointLivraison>;
        const periodes = (p.periodes ?? []).map(x => ({ ...x, debut: x.debut ?? null, fin: x.fin ?? null }));
        const c = couverture({ periodes, finClient: p.finClient }, today);
        if (c.statut === 'sans_couverture') sansContrat++;
        if (c.statut !== 'a_renouveler' || !c.finCouverture || c.jours === null) continue;
        suivis.push({ statut: c.statut, pdl: String(p.pdl ?? ''), client: String(p.client ?? ''), site: String(p.site ?? ''), fournisseur: c.courante?.fournisseur ?? '', numeroContrat: c.courante?.numeroContrat ?? '', fin: c.finCouverture, jours: c.jours });
    }
    const lignes = rappelEnergie(suivis, today, dernierPassage);
    if (!lignes) return [];
    const [roles, users] = await Promise.all([adminDb.collection('roles').where('isAcheteur', '==', true).get(), adminDb.collection('users').get()]);
    const idsRoles = new Set(roles.docs.map(r => r.id));
    const acheteurs = users.docs.filter(u => idsRoles.has(String(u.get('roleId') ?? ''))).map(u => String(u.get('email') ?? '').trim()).filter(Boolean);
    return [{
        evenement: 'energie_a_renouveler', cle: `energie/a-renouveler/${today}`, libelle: "Fournitures d'énergie à renouveler", annuaire: { acheteurs },
        contexte: { contrat: SANS_CONTRAT, energie: { lignes, ...(sansContrat && { sansContrat }) }, aujourdhui: today },
    }];
}

/**
 * Récapitulatif des sites en dérive de marge P1 : un mail aux acheteurs et aux administrateurs le jour où un site
 * entre en dérive (absent du passage précédent), listant tous les sites en dérive. L'état est mémorisé à chaque passage.
 */
export async function rappelsDerivesP1(today: string): Promise<DemandeNotification[]> {
    const [d, precedents] = await Promise.all([derivesP1(null, today), etatPrecedent()]);
    const enDerive = d.sites.filter(s => s.analyse.gravite);
    await memoriserEtat(enDerive.map(s => s.siteId), today);
    const nouveaux = new Set(nouveauxEnDerive(enDerive.map(s => s.siteId), precedents));
    if (!nouveaux.size) return [];
    const [roles, users] = await Promise.all([adminDb.collection('roles').where('isAcheteur', '==', true).get(), adminDb.collection('users').get()]);
    const idsRoles = new Set(roles.docs.map(r => r.id));
    const acheteurs = users.docs.filter(u => idsRoles.has(String(u.get('roleId') ?? ''))).map(u => String(u.get('email') ?? '').trim()).filter(Boolean);
    return [{
        evenement: 'derive_p1', cle: `energie/derive-p1/${today}`, libelle: 'Sites en dérive de marge P1', annuaire: { acheteurs },
        contexte: {
            contrat: SANS_CONTRAT, aujourdhui: today,
            derives: { lignes: enDerive.map(s => ({ client: s.client, site: s.siteNom, taux: s.analyse.taux, tauxN1: s.analyse.tauxN1, tauxBudget: s.analyse.tauxBudget, gravite: s.analyse.gravite!, cause: s.analyse.cause, nouveau: nouveaux.has(s.siteId) })) },
        },
    }];
}
