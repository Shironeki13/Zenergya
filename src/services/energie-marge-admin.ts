import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import type { GardePerimetre } from '@/lib/auth/perimetre-server';
import { douzeMois, margeP1, type Achat, type MargeP1, type Vente } from '@/lib/energie/marge';
import { toDay } from '@/lib/services/site-amounts';
import { pdlNorme } from '@/lib/energie/bigquery';
import { BigQueryIndisponible, bigQueryActif, facturesBigQuery } from '@/services/energie-bigquery';

/**
 * Marge P1 par site : lignes P1 facturées au client (factures émises, avoirs de régularisation déduits) face aux
 * factures du fournisseur d'énergie saisies sur le site, sur les douze derniers mois. Rien n'est écrit.
 */

export type MargeSite = { siteId: string; siteNom: string; client: string; contractId: string | null; contractNumber: string; de: string; a: string; marge: MargeP1 };

type Ligne = { siteId?: string; activityCode?: string; total?: number; periodStartDate?: string; periodEndDate?: string; p1Regul?: { mois?: string[] } };
const finDeMois = (m: string) => { const [a, mo] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(a, mo, 0)).getUTCDate()).padStart(2, '0')}`; };

/** Période d'une ligne : la sienne, sinon les mois régularisés. */
function periode(l: Ligne): { debut: string; fin: string } | null {
    const [d, f] = [String(l.periodStartDate ?? '').slice(0, 10), String(l.periodEndDate ?? '').slice(0, 10)];
    if (d && f) return { debut: d, fin: f };
    const mois = l.p1Regul?.mois ?? [];
    return mois.length ? { debut: `${mois[0]}-01`, fin: finDeMois(mois[mois.length - 1]) } : null;
}

export async function codesP1(): Promise<Set<string>> {
    return new Set((await adminDb.collection('activities').where('type', '==', 'P1').get()).docs.map(d => String(d.get('code'))));
}

/** Ventes P1 d'un site : lignes des factures émises du contrat, moins les avoirs qui ne sont pas des annulations. */
export async function ventesP1(siteId: string, contractId: string, p1: Set<string>): Promise<Vente[]> {
    const [factures, avoirs] = await Promise.all([adminDb.collection('invoices').where('contractId', '==', contractId).get(), adminDb.collection('creditNotes').where('contractId', '==', contractId).get()]);
    const ventes: Vente[] = [];
    const ajouter = (lignes: Ligne[], signe: 1 | -1) => {
        for (const l of lignes) {
            if (l.siteId !== siteId || !p1.has(String(l.activityCode ?? '')) || !l.total) continue;
            const p = periode(l);
            // Un avoir vient toujours en déduction, que ses lignes soient écrites en positif ou en négatif.
            if (p) ventes.push({ ...p, montantHT: signe === 1 ? l.total : -Math.abs(l.total) });
        }
    };
    const annulations = new Set<string>();
    for (const d of factures.docs) {
        if (d.get('cancelledByCreditNoteId')) annulations.add(String(d.get('cancelledByCreditNoteId')));
        if (d.get('status') === 'proforma' || d.get('status') === 'cancelled' || d.get('cancelledByCreditNoteId') || !d.get('invoiceNumber')) continue;
        ajouter((d.get('lineItems') ?? []) as Ligne[], 1);
    }
    // Avoir d'annulation : sa facture est déjà écartée. Avoir de régularisation (il n'annule aucune facture) : en déduction.
    for (const d of avoirs.docs) if (!annulations.has(d.id)) ajouter((d.get('lineItems') ?? []) as Ligne[], -1);
    return ventes;
}

const achatDe = (d: FirebaseFirestore.QueryDocumentSnapshot): Achat & { numero: string } => ({ numero: String(d.get('numero') ?? ''), date: String(d.get('date') ?? ''), debut: d.get('debut') ?? null, fin: d.get('fin') ?? null, montantHT: Number(d.get('montantHT') ?? 0), quantite: d.get('quantite') ?? null });

/** Achats d'un site : factures saisies, plus celles des flux des fournisseurs pour ses points de livraison (sans doublon de numéro). */
export async function achatsDuSite(siteId: string, pdls: string[]): Promise<Achat[]> {
    const saisies = (await adminDb.collection('facturesEnergie').where('siteId', '==', siteId).get()).docs.map(achatDe);
    const numeros = new Set(saisies.map(a => a.numero.trim().toUpperCase()));
    const flux = (await facturesBigQuery(pdls).catch(e => { if (e instanceof BigQueryIndisponible) return []; throw e; }))
        .filter(f => !numeros.has(f.numero.trim().toUpperCase())).map(f => ({ date: f.date, debut: f.debut, fin: f.fin, montantHT: f.montantHT, quantite: f.quantite }));
    return [...saisies, ...flux];
}

async function calculer(siteId: string, pdls: string[], p1: Set<string>): Promise<MargeSite> {
    const site = await adminDb.collection('sites').doc(siteId).get();
    if (!site.exists) throw new Error('Site introuvable.');
    const contractId = (site.get('contractId') as string | undefined) ?? null;
    const [achats, contrat] = await Promise.all([achatsDuSite(siteId, pdls), contractId ? adminDb.collection('contracts').doc(contractId).get() : Promise.resolve(null)]);
    const { de, a } = douzeMois(toDay(new Date())!);
    return {
        siteId, siteNom: String(site.get('name') ?? ''), client: String(contrat?.get('clientName') ?? site.get('clientName') ?? ''), contractId, contractNumber: String(contrat?.get('contractNumber') ?? ''), de, a,
        marge: margeP1(contractId ? await ventesP1(siteId, contractId, p1) : [], achats, de, a),
    };
}

export async function margeSite(siteId: string): Promise<MargeSite> {
    const [points, p1] = await Promise.all([adminDb.collection('pointsLivraison').where('siteId', '==', siteId).get(), codesP1()]);
    return calculer(siteId, points.docs.map(d => pdlNorme(String(d.get('pdl') ?? ''))), p1);
}

/**
 * Marge P1 des sites qui ont des achats connus : une facture du fournisseur saisie, ou (flux BigQuery actif) un point
 * de livraison rattaché. La plus faible d'abord.
 */
export async function margesP1(garde: GardePerimetre): Promise<MargeSite[]> {
    const [saisies, points, visibles, p1] = await Promise.all([adminDb.collection('facturesEnergie').get(), adminDb.collection('pointsLivraison').get(), garde.ids('sites'), codesP1()]);
    const pdls = new Map<string, string[]>();
    for (const d of points.docs) { const s = d.get('siteId') as string | undefined; if (s) pdls.set(s, [...(pdls.get(s) ?? []), pdlNorme(String(d.get('pdl') ?? ''))]); }
    const sites = new Set(saisies.docs.map(d => String(d.get('siteId') ?? '')).filter(Boolean));
    if (bigQueryActif()) for (const s of pdls.keys()) sites.add(s);
    const out: MargeSite[] = [];
    for (const s of sites) {
        if (visibles && !visibles.has(s)) continue;
        try { const m = await calculer(s, pdls.get(s) ?? [], p1); if (m.marge.mois.length) out.push(m); } catch { /* site supprimé : ignoré */ }
    }
    return out.sort((x, y) => (x.marge.taux ?? Infinity) - (y.marge.taux ?? Infinity) || x.client.localeCompare(y.client, 'fr'));
}

/** Achats d'énergie d'un site (factures saisies et flux des fournisseurs de ses points de livraison). */
export async function achatsEnergieSite(siteId: string): Promise<Achat[]> {
    const points = await adminDb.collection('pointsLivraison').where('siteId', '==', siteId).get();
    return achatsDuSite(siteId, points.docs.map(d => pdlNorme(String(d.get('pdl') ?? ''))));
}

/** Sites dont la marge P1 est calculable : une facture du fournisseur saisie, ou (flux BigQuery actif) un point rattaché. */
export async function sitesAvecAchats(visibles: Set<string> | null): Promise<{ siteId: string; pdls: string[] }[]> {
    const [saisies, points] = await Promise.all([adminDb.collection('facturesEnergie').get(), adminDb.collection('pointsLivraison').get()]);
    const pdls = new Map<string, string[]>();
    for (const d of points.docs) { const s = d.get('siteId') as string | undefined; if (s) pdls.set(s, [...(pdls.get(s) ?? []), pdlNorme(String(d.get('pdl') ?? ''))]); }
    const sites = new Set(saisies.docs.map(d => String(d.get('siteId') ?? '')).filter(Boolean));
    if (bigQueryActif()) for (const s of pdls.keys()) sites.add(s);
    return [...sites].filter(s => !visibles || visibles.has(s)).map(siteId => ({ siteId, pdls: pdls.get(siteId) ?? [] }));
}
