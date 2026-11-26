import 'server-only';
import type { GardePerimetre } from '@/lib/auth/perimetre-server';
import { controleDemande, natureAvoir, refusAnnulation, texteMotif, type FactureAAnnuler, type NatureAvoir } from '@/lib/billing/avoirs';
import { creditNoteAmounts } from '@/lib/credit-notes';
import type { Invoice } from '@/lib/types';
import { archiveDocumentSafely } from './document-archive';
import { createCreditNote, getInvoice } from './firestore-admin';

/**
 * Émission d'avoirs : un avoir par facture, chacun annulant entièrement sa facture. Les factures sont traitées une à
 * une : l'échec de l'une (déjà annulée entre-temps, hors périmètre…) n'empêche pas les autres et figure au compte
 * rendu.
 */

export type ResultatAvoir = {
    factureId: string; facture: string; client: string; contractId?: string;
    avoirId?: string; avoir?: string; nature?: NatureAvoir; total?: number; erreur?: string;
};

export async function emettreAvoirs(ids: string[], motif: string, commentaire: string | undefined, garde: GardePerimetre): Promise<ResultatAvoir[]> {
    const uniques = [...new Set(ids.map(String).filter(Boolean))];
    const anomalies = controleDemande(uniques.map(id => ({ id, invoiceNumber: 'x', status: 'due' })), motif, commentaire);
    if (anomalies.length) throw new Error(anomalies.join(' '));
    const reason = texteMotif(motif, commentaire);
    const resultats: ResultatAvoir[] = [];
    for (const id of uniques) {
        const r: ResultatAvoir = { factureId: id, facture: id, client: '' };
        try {
            await garde.exiger('facture', id);
            const f = await getInvoice(id);
            if (!f) throw new Error('facture introuvable');
            Object.assign(r, { facture: f.invoiceNumber || id, client: f.clientName, contractId: f.contractId });
            const refus = refusAnnulation(f as FactureAAnnuler);
            if (refus) throw new Error(refus);
            const nature = natureAvoir(f as FactureAAnnuler);
            const cree = await createCreditNote([id], ([lue]: Invoice[]) => {
                // Relue dans la transaction : annulée ou rejet levé entre-temps, rien n'est écrit.
                const refusTx = refusAnnulation(lue as FactureAAnnuler);
                if (refusTx) throw new Error(refusTx);
                if (natureAvoir(lue as FactureAAnnuler) !== nature) throw new Error('l\'état de transmission de la facture a changé : rechargez la page');
                const m = creditNoteAmounts([lue]);
                return {
                    originalInvoiceIds: [lue.id], contractId: lue.contractId, clientId: lue.clientId, clientName: lue.clientName,
                    date: new Date().toISOString(), status: 'finalized' as const, lineItems: m.lineItems, subtotal: m.subtotal, tax: m.tax, total: m.total,
                    reason, motif, nature, ...(m.vatBreakdown.length > 0 && { vatBreakdown: m.vatBreakdown }),
                };
            }, { interne: nature === 'interne' });
            await archiveDocumentSafely('creditNote', cree.id);
            Object.assign(r, { avoirId: cree.id, avoir: cree.creditNoteNumber, nature, total: -Math.abs(Number(f.total) || 0) });
        } catch (e) {
            r.erreur = e instanceof Error ? e.message : 'émission impossible';
        }
        resultats.push(r);
    }
    return resultats;
}
