import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { moisSuivants } from '@/lib/billing/previsionnel';
import { dernieresValeurs, simulerContrat, type Hypotheses, type LigneSimulation, type RevisionAVenir } from '@/lib/billing/simulation-revision';
import { toDay } from '@/lib/services/site-amounts';
import { loadBillingInput } from '@/services/contract-billing-admin';
import { getContract, getIndexValues, getIndices, getInvoicesByContract } from '@/services/firestore-admin';

/**
 * Simulation de révision sur les contrats actifs : ce que les forfaits révisables rapporteront sur 12 mois si les
 * indices restent à leur dernière valeur, et s'ils varient du pourcentage saisi (lib/billing/simulation-revision).
 * Rien n'est écrit.
 */

export type IndiceSimule = { id: string; code: string; libelle: string; periode: string; valeur: number; contrats: number };
export type SimulationRevision = {
    aujourdhui: string;
    mois: string[];
    hypotheses: Hypotheses;
    /** Indices utilisés par au moins une prestation révisable, avec leur dernière valeur publiée. */
    indices: IndiceSimule[];
    lignes: (LigneSimulation & { clientId: string; agence: string })[];
    revisions: (RevisionAVenir & { clientId: string; contractNumber: string; clientName: string })[];
    nonSimulables: { contractId: string; contractNumber: string; clientId: string; clientName: string; message: string }[];
};

/** Hypothèses lues : nombres entre −90 et +300 %, indices inconnus ignorés par le calcul. */
export function lireHypotheses(h: unknown): Hypotheses {
    const out: Hypotheses = {};
    for (const [k, v] of Object.entries((h && typeof h === 'object' ? h : {}) as Record<string, unknown>)) {
        const n = Number(v);
        if (Number.isFinite(n) && n !== 0) out[k] = Math.min(300, Math.max(-90, n));
    }
    return out;
}

export async function simulationRevision(h: unknown, nbMois = 12): Promise<SimulationRevision> {
    const hypotheses = lireHypotheses(h);
    const aujourdhui = toDay(new Date())!;
    const mois = moisSuivants(aujourdhui, nbMois);
    const [snap, clientsSnap, agencesSnap, indices, valeurs] = await Promise.all([
        adminDb.collection('contracts').where('status', '==', 'Actif').get(),
        adminDb.collection('clients').get(), adminDb.collection('agencies').get(), getIndices(), getIndexValues(),
    ]);
    const clients = new Map(clientsSnap.docs.map(d => [d.id, d.data()]));
    const agences = new Map(agencesSnap.docs.map(d => [d.id, String(d.get('name') ?? d.id)]));
    const out: SimulationRevision = { aujourdhui, mois, hypotheses, indices: [], lignes: [], revisions: [], nonSimulables: [] };
    const usage = new Map<string, number>();
    for (const c of snap.docs) {
        const contract = await getContract(c.id);
        if (!contract || (contract.siteIds ?? []).length === 0) continue;
        const clientId = String(contract.clientId ?? '');
        const tete = { contractNumber: contract.contractNumber || contract.id, clientId, clientName: contract.clientName || '' };
        try {
            const [input, invoices] = await Promise.all([loadBillingInput(contract), getInvoicesByContract(contract.id)]);
            const s = simulerContrat(contract.id, input, invoices, aujourdhui, mois, hypotheses);
            const agence = agences.get(String(clients.get(clientId)?.agencyId ?? '')) ?? 'Sans agence';
            for (const l of s.lignes) out.lignes.push({ ...l, clientId, agence });
            for (const r of s.revisions) out.revisions.push({ ...r, ...tete });
            for (const m of s.nonSimulables) out.nonSimulables.push({ contractId: contract.id, ...tete, message: m });
            for (const i of s.indices) usage.set(i, (usage.get(i) ?? 0) + 1);
        } catch (e) {
            out.nonSimulables.push({ contractId: contract.id, ...tete, message: (e as Error).message });
        }
    }
    const dernieres = dernieresValeurs(valeurs);
    out.indices = [...usage].map(([id, contrats]) => {
        const i = indices.find(x => x.id === id), d = dernieres.get(id);
        return { id, code: i?.code ?? id, libelle: i?.label ?? '', periode: d?.period ?? '', valeur: d?.value ?? 0, contrats };
    }).sort((a, b) => b.contrats - a.contrats || a.code.localeCompare(b.code));
    out.revisions.sort((a, b) => a.date.localeCompare(b.date) || a.contractNumber.localeCompare(b.contractNumber));
    return out;
}
