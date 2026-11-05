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
import { AUCUN, type Dimension, type LigneEmise, type Rattachements } from '@/lib/pilotage/filtres';
import type { InvoiceLineItem } from '@/lib/types';

/** Vues de pilotage : suivi de la facturation et alertes des compteurs (calculées au serveur). */

const addDays = (day: string, k: number) => new Date(Date.parse(day) + k * 86_400_000).toISOString().slice(0, 10);

export type Option = { id: string; label: string; parent?: string };

export type SuiviFacturation = {
    today: string;
    horizon: string;
    echeances: EcheanceSuivi[];
    /** Commentaires de suivi des contrats listés (historique complet). */
    commentaires: CommentaireSuivi[];
    /** Contrats dont l'échéancier ne se calcule pas (périodicité, terme, dates…). */
    contratsEnErreur: { contractId: string; contractNumber: string; clientName: string; erreurs: string[]; dims: Rattachements }[];
    /** Valeurs des filtres (agence : parent = société ; secteur : parent = agence ; site : parent = client). */
    options: Record<Dimension, Option[]>;
    /** Lignes des factures et avoirs émis depuis le 1er janvier de l'année précédente. */
    emis: LigneEmise[];
};

const nomUtilisateur = (u: FirebaseFirestore.DocumentData | undefined) =>
    u ? [u.firstName, u.name].filter(Boolean).join(' ') || String(u.email ?? '') : '';

/** Échéances de tous les contrats actifs, du dernier facturé jusqu'à l'horizon (jours), et factures émises. */
export async function suiviFacturation(horizonJours = 60): Promise<SuiviFacturation> {
    const today = toDay(new Date())!;
    const horizon = addDays(today, horizonJours);
    const [snap, clientsSnap, companies, agencies, sectors, users, activities] = await Promise.all([
        adminDb.collection('contracts').where('status', '==', 'Actif').get(),
        adminDb.collection('clients').get(),
        adminDb.collection('companies').get(),
        adminDb.collection('agencies').get(),
        adminDb.collection('sectors').get(),
        adminDb.collection('users').get(),
        adminDb.collection('activities').get(),
    ]);
    const clients = new Map(clientsSnap.docs.map(d => [d.id, d.data()]));
    /** Rattachements d'un contrat : société émettrice (sinon du client), agence et secteur du client, responsable. */
    const dimsContrat = (c: FirebaseFirestore.DocumentData): Rattachements => {
        const cl = clients.get(String(c.clientId ?? ''));
        return {
            company: c.companyId || cl?.companyId || null, agency: cl?.agencyId || null, sector: cl?.sectorId || null,
            manager: c.billingManagerId || null, client: c.clientId || null,
        };
    };

    const echeances: EcheanceSuivi[] = [];
    const contratsEnErreur: SuiviFacturation['contratsEnErreur'] = [];
    for (const c of snap.docs) {
        const contract = await getContract(c.id);
        if (!contract) continue;
        const dims = dimsContrat(c.data());
        const head = { contractId: contract.id, contractNumber: contract.contractNumber ?? contract.id, clientId: contract.clientId ?? contract.clientName, clientName: contract.clientName };
        try {
            const [input, invoices] = await Promise.all([loadBillingInput(contract), getInvoicesByContract(contract.id)]);
            const suivi = suiviContrat({ id: head.contractId, contractNumber: head.contractNumber, clientId: head.clientId, clientName: head.clientName, dims }, input, invoices, today, horizon);
            if (suivi.erreurs.length) contratsEnErreur.push({ ...head, erreurs: suivi.erreurs, dims });
            echeances.push(...suivi.echeances);
        } catch (e) {
            contratsEnErreur.push({ ...head, erreurs: [(e as Error).message], dims });
        }
    }
    echeances.sort((a, b) => a.billableOn.localeCompare(b.billableOn) || a.clientName.localeCompare(b.clientName));
    const listes = new Set(snap.docs.map(d => d.id));
    const commentaires = (await lireCommentaires()).filter(c => listes.has(c.contractId));
    const emis = await lignesEmises(`${Number(today.slice(0, 4)) - 1}-01-01`, today, dimsContrat, clients);

    // Valeurs des filtres : référentiels, et clients et sites présents dans les échéances ou les factures.
    const tri = (o: Option[]) => o.sort((a, b) => a.label.localeCompare(b.label, 'fr'));
    const clientsVus = new Map<string, string>();
    const sitesVus = new Map<string, Option>();
    for (const e of echeances) { clientsVus.set(e.clientId, e.clientName); sitesVus.set(e.siteId, { id: e.siteId, label: e.site, parent: e.clientId }); }
    for (const c of contratsEnErreur) clientsVus.set(c.dims.client ?? c.clientName, c.clientName);
    const sitesFactures = [...new Set(emis.map(l => l.site).filter((x): x is string => !!x && !sitesVus.has(x)))];
    const sitesDocs = sitesFactures.length ? await adminDb.getAll(...sitesFactures.map(id => adminDb.collection('sites').doc(id))) : [];
    for (const d of sitesDocs) if (d.exists) sitesVus.set(d.id, { id: d.id, label: String(d.get('name') ?? d.id), parent: d.get('clientId') ?? undefined });
    for (const l of emis) if (l.client && !clientsVus.has(l.client)) clientsVus.set(l.client, String(clients.get(l.client)?.name ?? l.client));
    const options: Record<Dimension, Option[]> = {
        company: tri(companies.docs.map(d => ({ id: d.id, label: String(d.get('name') ?? d.get('code') ?? d.id) }))),
        agency: tri(agencies.docs.map(d => ({ id: d.id, label: String(d.get('name') ?? d.id), parent: d.get('companyId') ?? undefined }))),
        sector: tri(sectors.docs.map(d => ({ id: d.id, label: String(d.get('name') ?? d.id), parent: d.get('agencyId') ?? undefined }))),
        manager: [...tri(users.docs.map(d => ({ id: d.id, label: nomUtilisateur(d.data()) }))), { id: AUCUN, label: 'Sans responsable' }],
        activity: tri(activities.docs.map(d => ({ id: d.id, label: [d.get('code'), d.get('label')].filter(Boolean).join(' — ') }))),
        client: tri([...clientsVus].map(([id, label]) => ({ id, label }))),
        site: tri([...sitesVus.values()]),
    };
    return { today, horizon, echeances, commentaires, contratsEnErreur, options, emis };
}

const jour = (v: unknown): string | null => {
    if (!v) return null;
    const ms = typeof (v as { toMillis?: () => number }).toMillis === 'function' ? (v as { toMillis: () => number }).toMillis() : new Date(String(v)).getTime();
    return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10);
};

/**
 * Lignes des factures (numérotées, hors proforma ; annulées comprises : elles ont été émises) et des avoirs émis
 * entre deux dates. Activité de la ligne par son code ; site par la ligne, sinon par l'élément facturé.
 */
async function lignesEmises(du: string, au: string, dimsContrat: (c: FirebaseFirestore.DocumentData) => Rattachements, clients: Map<string, FirebaseFirestore.DocumentData>): Promise<LigneEmise[]> {
    const [invoices, credits, contracts, activities, services] = await Promise.all([
        adminDb.collection('invoices').get(), adminDb.collection('creditNotes').get(), adminDb.collection('contracts').get(),
        adminDb.collection('activities').get(), adminDb.collection('services').select('siteId').get(),
    ]);
    const contrats = new Map(contracts.docs.map(d => [d.id, d.data()]));
    const activiteParCode = new Map(activities.docs.map(d => [String(d.get('code') ?? '').toUpperCase(), d.id]));
    const siteDuService = new Map(services.docs.map(d => [d.id, d.get('siteId') ? String(d.get('siteId')) : null]));
    const siteDe = (l: InvoiceLineItem): string | null => {
        if (l.siteId) return l.siteId;
        const k = l.itemKey ?? (l.itemKeys?.length === 1 ? l.itemKeys[0] : undefined);
        if (!k) return null;
        if (k.startsWith('svc:')) return siteDuService.get(k.slice(4)) ?? null;
        return k.split(':')[1] ?? null;
    };
    const out: LigneEmise[] = [];
    const ajouter = (doc: string, avoir: boolean, d: FirebaseFirestore.DocumentData) => {
        const date = jour(d.date);
        if (!date || date < du || date > au) return;
        const contrat = contrats.get(String(d.contractId ?? ''));
        const base: Rattachements = contrat ? dimsContrat(contrat) : { client: d.clientId ?? null, agency: clients.get(String(d.clientId))?.agencyId ?? null, sector: clients.get(String(d.clientId))?.sectorId ?? null };
        base.company = d.companyId || base.company || null;
        base.client = d.clientId || base.client || null;
        const lignes: InvoiceLineItem[] = Array.isArray(d.lineItems) ? d.lineItems : [];
        if (!lignes.length) { out.push({ ...base, doc, avoir, date, ht: Math.abs(Number(d.subtotal) || 0), activity: null, site: null }); return; }
        for (const l of lignes) {
            out.push({ ...base, doc, avoir, date, ht: avoir ? Math.abs(Number(l.total) || 0) : Number(l.total) || 0,
                activity: activiteParCode.get(String(l.activityCode ?? '').toUpperCase()) ?? null, site: siteDe(l) });
        }
    };
    for (const d of invoices.docs) {
        const v = d.data();
        if (!v.invoiceNumber || v.status === 'proforma') continue;
        ajouter(`F:${d.id}`, false, v);
    }
    for (const d of credits.docs) ajouter(`A:${d.id}`, true, d.data());
    return out;
}

/** Affecte (ou retire, userId null) le responsable facturation d'un contrat. */
export async function definirResponsable(contractId: string, userId: string | null, by: string): Promise<void> {
    const ref = adminDb.collection('contracts').doc(String(contractId));
    if (!(await ref.get()).exists) throw new Error('Contrat introuvable.');
    if (userId) {
        const u = await adminDb.collection('users').doc(String(userId)).get();
        if (!u.exists) throw new Error('Utilisateur introuvable.');
    }
    await ref.update({ billingManagerId: userId || null, billingManagerUpdatedAt: new Date().toISOString(), billingManagerUpdatedBy: by });
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
