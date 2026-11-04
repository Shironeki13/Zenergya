import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { buildQuoteInvoice, type QuoteBillingRequest } from '@/lib/quotes/billing';
import type { Quote } from '@/lib/quotes/types';
import type { Invoice, InvoiceQuoteLink } from '@/lib/types';
import { archiveDocumentSafely } from '@/services/document-archive';
import { assertCompanyCode, computeEInvoicingState, getCompany, prepareSeries, reserveNumber } from '@/services/firestore-admin';

/**
 * Facturation d'un devis accepté (totalité, acompte, solde), côté serveur.
 *
 * Une seule transaction relit le devis et ses factures, construit la facture, attribue le numéro légal
 * (même série que les autres factures) et l'écrit : deux facturations simultanées ne peuvent pas
 * facturer deux fois le même solde. La facture suit ensuite le circuit habituel : PDF archivé,
 * facturation électronique (le bon de commande du devis sert d'engagement juridique Chorus).
 */

const PAYMENT_DELAY_DAYS = 30;

const isoOf = (v: unknown): string => (v instanceof Timestamp ? v.toDate().toISOString() : String(v ?? ''));

export async function invoiceQuote(quoteId: string, request: QuoteBillingRequest, by?: string): Promise<{ invoiceId: string; invoiceNumber: string }> {
    const quoteRef = adminDb.collection('quotes').doc(quoteId);
    const initial = await quoteRef.get();
    if (!initial.exists) throw new Error('Devis introuvable.');
    const q0 = { id: initial.id, ...initial.data() } as Quote;
    if (q0.status !== 'accepte') throw new Error('Seul un devis accepté se facture.');

    const company = await getCompany(q0.companyId);
    if (!company) throw new Error('Société émettrice introuvable.');
    assertCompanyCode(company);
    const issuedAt = new Date();
    const date = issuedAt.toISOString().slice(0, 10);
    const series = await prepareSeries('invoice', company.code, issuedAt);
    const einvoicing = await computeEInvoicingState({
        clientId: q0.clientId, contractId: q0.contractId, company, documentDate: date,
        purchaseOrderNumber: q0.acceptance?.purchaseOrderNumber,
    });
    const invoiceRef = adminDb.collection('invoices').doc();

    const invoiceNumber = await adminDb.runTransaction(async (tx) => {
        // Lectures : devis, factures déjà émises pour ce devis, compteur de numérotation.
        const snap = await tx.get(quoteRef);
        const q = { id: snap.id, ...snap.data() } as Quote;
        if (q.status !== 'accepte') throw new Error('Seul un devis accepté se facture.');
        const previousSnap = await tx.get(adminDb.collection('invoices').where('quoteId', '==', quoteId));
        const previous = previousSnap.docs.map(d => {
            const data = d.data() as Invoice;
            return { ...data, id: d.id, date: isoOf(data.date) };
        });
        const draft = buildQuoteInvoice(q, request, previous);
        const reserved = await reserveNumber(tx, series);

        // Écritures.
        const dueDate = new Date(`${date}T00:00:00Z`);
        dueDate.setUTCDate(dueDate.getUTCDate() + PAYMENT_DELAY_DAYS);
        const link: InvoiceQuoteLink = {
            id: quoteId, number: q.number, version: q.version, billingKind: request.kind,
            ...(request.kind === 'acompte' && { percent: request.percent }),
            ...(q.acceptance?.acceptedAt && { acceptedAt: q.acceptance.acceptedAt }),
            ...(q.acceptance?.purchaseOrderNumber && { purchaseOrderNumber: q.acceptance.purchaseOrderNumber }),
            ...(draft.deposits.length > 0 && { deposits: draft.deposits }),
        };
        reserved.commit();
        tx.set(invoiceRef, {
            contractId: q.contractId ?? '',
            clientId: q.clientId,
            clientName: q.clientName,
            date: new Date(`${date}T00:00:00Z`),
            dueDate,
            status: 'due',
            lineItems: draft.lineItems,
            subtotal: draft.subtotal,
            tax: draft.tax,
            total: draft.total,
            vatBreakdown: draft.vatBreakdown,
            // Taux unique : renseigné aussi comme sur les autres factures (affichages existants).
            ...(draft.vatBreakdown.length === 1 && { taxRate: draft.vatBreakdown[0].rate / 100 }),
            quoteId,
            quote: link,
            companyId: company.id,
            invoiceNumber: reserved.number,
            issuedAt,
            einvoicing,
        });
        // Écrire le devis sérialise deux facturations simultanées du même devis.
        tx.update(quoteRef, { lastInvoicedAt: issuedAt.toISOString(), ...(by && { lastInvoicedBy: by }) });
        return reserved.number;
    });

    await archiveDocumentSafely('invoice', invoiceRef.id);
    return { invoiceId: invoiceRef.id, invoiceNumber };
}
