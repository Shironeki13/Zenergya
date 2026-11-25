import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { moisSuivants, previsionContrat } from '@/lib/billing/previsionnel';
import { toDay } from '@/lib/services/site-amounts';
import { loadBillingInput } from '@/services/contract-billing-admin';
import { getContract, getInvoicesByContract } from '@/services/firestore-admin';

/**
 * Prévisionnel de facturation : pour chaque contrat actif, ce qui deviendra facturable sur les mois à venir d'après
 * son échéancier (lib/billing/previsionnel). Rien n'est écrit.
 */

export type LignePrevisionnel = { mois: string; contractId: string; clientId: string; agence: string; activite: string; montant: number; estime: number };
export type Previsionnel = {
    aujourdhui: string;
    mois: string[];
    lignes: LignePrevisionnel[];
    contrats: number;
    /** Échéances P1 variables sans montant annuel : non chiffrées. */
    nonEstimees: number;
    contratsEnErreur: { contractId: string; contractNumber: string; clientId: string; clientName: string; erreur: string }[];
};

export async function previsionnelFacturation(nbMois = 12): Promise<Previsionnel> {
    const aujourdhui = toDay(new Date())!;
    const mois = moisSuivants(aujourdhui, Math.min(Math.max(nbMois, 1), 24));
    const [snap, clientsSnap, agencesSnap] = await Promise.all([
        adminDb.collection('contracts').where('status', '==', 'Actif').get(),
        adminDb.collection('clients').get(),
        adminDb.collection('agencies').get(),
    ]);
    const clients = new Map(clientsSnap.docs.map(d => [d.id, d.data()]));
    const agences = new Map(agencesSnap.docs.map(d => [d.id, String(d.get('name') ?? d.id)]));
    const out: Previsionnel = { aujourdhui, mois, lignes: [], contrats: 0, nonEstimees: 0, contratsEnErreur: [] };
    for (const c of snap.docs) {
        const contract = await getContract(c.id);
        if (!contract) continue;
        const clientId = String(contract.clientId ?? '');
        const agence = agences.get(String(clients.get(clientId)?.agencyId ?? '')) ?? 'Sans agence';
        const enErreur = (erreur: string) => out.contratsEnErreur.push({ contractId: contract.id, contractNumber: contract.contractNumber || contract.id, clientId, clientName: contract.clientName || '', erreur });
        if ((contract.siteIds ?? []).length === 0) { enErreur("Aucun site n'est associé à ce contrat."); continue; }
        try {
            const [input, invoices] = await Promise.all([loadBillingInput(contract), getInvoicesByContract(contract.id)]);
            const p = previsionContrat(contract.id, input, invoices, aujourdhui, mois);
            if (p.erreurs.length) { enErreur(p.erreurs.join(' ')); continue; }
            out.contrats++;
            out.nonEstimees += p.nonEstimees;
            for (const l of p.lignes) out.lignes.push({ mois: l.mois, contractId: contract.id, clientId, agence, activite: l.activite, montant: l.montant, estime: l.nature === 'estime' ? l.montant : 0 });
        } catch (e) {
            enErreur((e as Error).message);
        }
    }
    return out;
}
