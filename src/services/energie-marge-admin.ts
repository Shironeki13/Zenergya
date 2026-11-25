import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import type { GardePerimetre } from '@/lib/auth/perimetre-server';
import { douzeMois, margeP1, type Achat, type MargeP1, type Vente } from '@/lib/energie/marge';
import { toDay } from '@/lib/services/site-amounts';

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

async function codesP1(): Promise<Set<string>> {
    return new Set((await adminDb.collection('activities').where('type', '==', 'P1').get()).docs.map(d => String(d.get('code'))));
}

/** Ventes P1 d'un site : lignes des factures émises du contrat, moins les avoirs qui ne sont pas des annulations. */
async function ventesP1(siteId: string, contractId: string, p1: Set<string>): Promise<Vente[]> {
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

const achatDe = (d: FirebaseFirestore.QueryDocumentSnapshot): Achat => ({ date: String(d.get('date') ?? ''), debut: d.get('debut') ?? null, fin: d.get('fin') ?? null, montantHT: Number(d.get('montantHT') ?? 0), quantite: d.get('quantite') ?? null });

export async function margeSite(siteId: string): Promise<MargeSite> {
    const site = await adminDb.collection('sites').doc(siteId).get();
    if (!site.exists) throw new Error('Site introuvable.');
    const contractId = (site.get('contractId') as string | undefined) ?? null;
    const [achats, contrat, p1] = await Promise.all([
        adminDb.collection('facturesEnergie').where('siteId', '==', siteId).get(),
        contractId ? adminDb.collection('contracts').doc(contractId).get() : Promise.resolve(null), codesP1(),
    ]);
    const { de, a } = douzeMois(toDay(new Date())!);
    return {
        siteId, siteNom: String(site.get('name') ?? ''), client: String(contrat?.get('clientName') ?? site.get('clientName') ?? ''), contractId, contractNumber: String(contrat?.get('contractNumber') ?? ''), de, a,
        marge: margeP1(contractId ? await ventesP1(siteId, contractId, p1) : [], achats.docs.map(achatDe), de, a),
    };
}

/** Marge P1 de tous les sites qui ont au moins une facture du fournisseur saisie, la plus faible d'abord. */
export async function margesP1(garde: GardePerimetre): Promise<MargeSite[]> {
    const [snap, visibles] = await Promise.all([adminDb.collection('facturesEnergie').get(), garde.ids('sites')]);
    const sites = [...new Set(snap.docs.map(d => String(d.get('siteId') ?? '')).filter(Boolean))].filter(s => !visibles || visibles.has(s));
    const out: MargeSite[] = [];
    for (const s of sites) { try { out.push(await margeSite(s)); } catch { /* site supprimé : ignoré */ } }
    return out.sort((x, y) => (x.marge.taux ?? Infinity) - (y.marge.taux ?? Infinity) || x.client.localeCompare(y.client, 'fr'));
}
