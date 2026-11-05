import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { suiviContrat, type EcheanceSuivi } from '@/lib/pilotage/suivi-facturation';
import { alertesCompteur, trierAlertes, type Alerte, type CompteurSuivi, type RelevePilotage } from '@/lib/pilotage/alertes-compteurs';
import { loadBillingInput } from '@/services/contract-billing-admin';
import { getContract, getInvoicesByContract } from '@/services/firestore-admin';
import { P1_DOC_ID, valeurAu, type P1MeterDoc } from '@/lib/p1/stockage';
import { toDay } from '@/lib/services/site-amounts';
import { isMotif, MOTIFS, type CommentaireSuivi, type Motif } from '@/lib/pilotage/tcd';
import type { SessionUser } from '@/lib/auth/server';

/** Vues de pilotage : suivi de la facturation et alertes des compteurs (calculées au serveur). */

const addDays = (day: string, k: number) => new Date(Date.parse(day) + k * 86_400_000).toISOString().slice(0, 10);

export type SuiviFacturation = {
    today: string;
    horizon: string;
    echeances: EcheanceSuivi[];
    /** Commentaires de suivi des contrats listés (historique complet). */
    commentaires: CommentaireSuivi[];
    /** Contrats dont l'échéancier ne se calcule pas (périodicité, terme, dates…). */
    contratsEnErreur: { contractId: string; contractNumber: string; clientName: string; erreurs: string[] }[];
};

/** Échéances de tous les contrats actifs, du dernier facturé jusqu'à l'horizon (jours). */
export async function suiviFacturation(horizonJours = 60): Promise<SuiviFacturation> {
    const today = toDay(new Date())!;
    const horizon = addDays(today, horizonJours);
    const snap = await adminDb.collection('contracts').where('status', '==', 'Actif').get();
    const echeances: EcheanceSuivi[] = [];
    const contratsEnErreur: SuiviFacturation['contratsEnErreur'] = [];
    for (const c of snap.docs) {
        const contract = await getContract(c.id);
        if (!contract) continue;
        const head = { contractId: contract.id, contractNumber: contract.contractNumber ?? contract.id, clientId: contract.clientId ?? contract.clientName, clientName: contract.clientName };
        try {
            const [input, invoices] = await Promise.all([loadBillingInput(contract), getInvoicesByContract(contract.id)]);
            const suivi = suiviContrat({ id: head.contractId, contractNumber: head.contractNumber, clientId: head.clientId, clientName: head.clientName }, input, invoices, today, horizon);
            if (suivi.erreurs.length) contratsEnErreur.push({ ...head, erreurs: suivi.erreurs });
            echeances.push(...suivi.echeances);
        } catch (e) {
            contratsEnErreur.push({ ...head, erreurs: [(e as Error).message] });
        }
    }
    echeances.sort((a, b) => a.billableOn.localeCompare(b.billableOn) || a.clientName.localeCompare(b.clientName));
    const listes = new Set(snap.docs.map(d => d.id));
    const commentaires = (await lireCommentaires()).filter(c => listes.has(c.contractId));
    return { today, horizon, echeances, commentaires, contratsEnErreur };
}

// ── Commentaires de suivi de la facturation (ADV) ────────────────────────────────────────────────────────────────
// Collection `suiviCommentaires`, écrite par le serveur seulement : un commentaire ne se modifie ni ne se supprime
// (historique). Un nouveau commentaire de motif « Résolu » clôt le sujet.

const COMMENTAIRES = 'suiviCommentaires';

const versCommentaire = (id: string, d: FirebaseFirestore.DocumentData): CommentaireSuivi => ({
    id, contractId: String(d.contractId), itemKey: d.itemKey ?? null, cible: String(d.cible ?? ''),
    motif: isMotif(d.motif) ? d.motif : 'note', texte: String(d.texte ?? ''), auteur: String(d.auteur ?? ''), createdAt: String(d.createdAt),
});

async function lireCommentaires(contractId?: string): Promise<CommentaireSuivi[]> {
    const q = contractId ? adminDb.collection(COMMENTAIRES).where('contractId', '==', contractId) : adminDb.collection(COMMENTAIRES);
    const snap = await q.get();
    return snap.docs.map(d => versCommentaire(d.id, d.data())).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

/** Historique des commentaires d'un contrat (et de ses prestations), du plus récent au plus ancien. */
export const historiqueCommentaires = (contractId: string) => lireCommentaires(contractId);

export type NouveauCommentaire = { contractId: string; itemKey?: string | null; motif: Motif; texte: string };

/** Ajoute un commentaire sur un contrat ou l'une de ses prestations (clé de l'échéancier). */
export async function ajouterCommentaire(input: NouveauCommentaire, user: SessionUser): Promise<CommentaireSuivi> {
    const texte = String(input.texte ?? '').trim();
    if (!texte) throw new Error('Le commentaire est vide.');
    if (texte.length > 2000) throw new Error('Commentaire trop long (2 000 caractères au plus).');
    if (!isMotif(input.motif)) throw new Error(`Motif inconnu (${Object.keys(MOTIFS).join(', ')}).`);
    const contract = await getContract(String(input.contractId ?? ''));
    if (!contract) throw new Error('Contrat introuvable.');
    const itemKey = input.itemKey ? String(input.itemKey) : null;
    let cible = contract.contractNumber ?? contract.id;
    if (itemKey) {
        // La prestation doit appartenir au contrat.
        const svc = /^svc:([^/|]{1,128})$/.exec(itemKey);
        const site = /^site:([^/|:]{1,128}):([^/|:]{1,128})$/.exec(itemKey);
        if (svc) {
            const s = await adminDb.collection('services').doc(svc[1]).get();
            if (!s.exists || s.get('contractId') !== contract.id) throw new Error("Cette prestation n'appartient pas au contrat.");
            const siteName = s.get('siteId') ? (await adminDb.collection('sites').doc(String(s.get('siteId'))).get()).get('name') : null;
            cible = [siteName, s.get('label') ?? s.get('activityId')].filter(Boolean).join(' — ');
        } else if (site) {
            if (!(contract.siteIds ?? []).includes(site[1])) throw new Error("Ce site n'appartient pas au contrat.");
            const [sd, ad] = await Promise.all([adminDb.collection('sites').doc(site[1]).get(), adminDb.collection('activities').doc(site[2]).get()]);
            cible = [sd.get('name'), ad.get('code') ?? site[2]].filter(Boolean).join(' — ');
        } else throw new Error('Prestation inconnue.');
    }
    const auteur = [user.profile?.firstName, user.profile?.name].filter(Boolean).join(' ') || user.email;
    const doc = { contractId: contract.id, itemKey, cible, motif: input.motif, texte, auteur, auteurUid: user.uid, createdAt: new Date().toISOString() };
    const ref = await adminDb.collection(COMMENTAIRES).add(doc);
    return versCommentaire(ref.id, doc);
}

/** Alertes de tous les compteurs. */
export async function alertesCompteurs(): Promise<{ today: string; alertes: Alerte[]; compteurs: number }> {
    const today = toDay(new Date())!;
    const [meters, sites, readings, p1, services] = await Promise.all([
        adminDb.collection('meters').get(),
        adminDb.collection('sites').get(),
        adminDb.collection('meterReadings').get(),
        adminDb.collection('p1Parametrage').where('kind', '==', 'meter').get(),
        adminDb.collection('services').where('p1Mode', '==', 'releve').get(),
    ]);
    const siteById = new Map(sites.docs.map(d => [d.id, d.data()]));
    const usageOf = new Map(p1.docs.map(d => [d.id, valeurAu<string>((d.data() as P1MeterDoc).params, 'usage', today)]));
    // Compteurs des ECS au relevé : celui de la prestation, sinon ceux d'usage ECS du site.
    const releveMeters = new Set(services.docs.filter(d => d.get('isActive') !== false && d.get('meterId')).map(d => String(d.get('meterId'))));
    const releveSites = new Set(services.docs.filter(d => d.get('isActive') !== false && !d.get('meterId')).map(d => String(d.get('siteId'))));
    const byMeter = new Map<string, RelevePilotage[]>();
    for (const r of readings.docs) {
        const id = String(r.get('meterId'));
        if (!byMeter.has(id)) byMeter.set(id, []);
        byMeter.get(id)!.push({ id: r.id, date: toDay(r.get('date'))!, value: Number(r.get('value')), type: r.get('type') ?? undefined });
    }
    const alertes: Alerte[] = [];
    for (const m of meters.docs) {
        const site = siteById.get(String(m.get('siteId')));
        const usage = usageOf.get(P1_DOC_ID.meter(m.id)) ?? null;
        const compteur: CompteurSuivi = {
            id: m.id, code: String(m.get('code') ?? m.id), name: String(m.get('name') ?? ''), siteId: String(m.get('siteId') ?? ''),
            site: String(site?.name ?? m.get('siteName') ?? '—'), client: String(site?.clientName ?? m.get('clientName') ?? '—'),
            unit: m.get('unit') ?? undefined, status: m.get('status') ?? undefined, usage,
            ecsAuReleve: releveMeters.has(m.id) || (releveSites.has(String(m.get('siteId'))) && usage === 'ecs'),
        };
        alertes.push(...alertesCompteur(compteur, byMeter.get(m.id) ?? [], today));
    }
    return { today, alertes: trierAlertes(alertes), compteurs: meters.size };
}
