import { roundCents, sumCents } from '@/lib/money';
import type { Invoice, InvoiceLineItem, VatBreakdown } from '@/lib/types';

/**
 * Montants d'un avoir annulant des factures (sans dépendance).
 *
 * Les lignes sont reprises en sens inverse, au centime. Inversion exacte (et non « moins la valeur
 * absolue ») : une ligne négative de la facture — la déduction d'un acompte sur une facture de solde —
 * redevient positive, et l'avoir annule exactement la facture. La TVA par taux des factures multi-taux
 * est reportée en négatif.
 */
export function creditNoteAmounts(invoices: Pick<Invoice, 'invoiceNumber' | 'lineItems' | 'tax' | 'vatBreakdown'>[]): {
    lineItems: InvoiceLineItem[]; subtotal: number; tax: number; total: number; vatBreakdown: VatBreakdown;
} {
    const lineItems: InvoiceLineItem[] = invoices.flatMap(inv =>
        inv.lineItems.map(item => ({
            ...item,
            unitPrice: roundCents(-item.unitPrice),
            total: roundCents(-item.total),
            description: `Avoir sur facture ${inv.invoiceNumber}: ${item.description}`,
        })),
    );
    const byRate = new Map<number, { base: number[]; amount: number[] }>();
    for (const v of invoices.flatMap(inv => inv.vatBreakdown ?? [])) {
        const entry = byRate.get(v.rate) ?? { base: [], amount: [] };
        entry.base.push(-v.base);
        entry.amount.push(-v.amount);
        byRate.set(v.rate, entry);
    }
    const vatBreakdown = [...byRate.entries()].sort(([a], [b]) => b - a)
        .map(([rate, e]) => ({ rate, base: sumCents(e.base), amount: sumCents(e.amount) }));
    const subtotal = sumCents(lineItems.map(item => item.total));
    const tax = roundCents(-sumCents(invoices.map(inv => inv.tax)));
    return { lineItems, subtotal, tax, total: sumCents([subtotal, tax]), vatBreakdown };
}
