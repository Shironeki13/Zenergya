import { roundCents, sumCents } from '@/lib/money';
import { computeLines, isPriced } from '@/lib/quotes/pricing';
import type { Quote } from '@/lib/quotes/types';
import type { Invoice, InvoiceLineItem, VatBreakdown } from '@/lib/types';

/**
 * Facturation d'un devis accepté (sans dépendance) :
 *
 * - totalité : une facture reprenant le détail du devis ;
 * - acompte  : un pourcentage du devis, ventilé sur chacun de ses taux de TVA ;
 * - solde    : le détail du devis, moins les acomptes déjà facturés (taux par taux).
 *
 * La TVA du solde est calculée par différence (TVA du devis − TVA des acomptes), taux par taux :
 * la somme des factures d'un devis égale exactement ses totaux, sans écart d'arrondi.
 */

export type QuoteBillingRequest = { kind: 'acompte'; percent: number } | { kind: 'solde' } | { kind: 'totale' };

/** Factures d'un devis prises en compte : émises et non annulées. */
export const countedInvoices = (invoices: Pick<Invoice, 'status'>[]) =>
    invoices.filter(i => i.status !== 'cancelled' && i.status !== 'proforma');

export type QuoteBillingSummary = {
    depositPercent: number;     // cumul des acomptes en %
    invoicedHT: number;
    invoicedTTC: number;
    remainingHT: number;
    remainingTTC: number;
    hasDeposits: boolean;
    complete: boolean;          // solde ou totalité facturé
};

type QuoteInvoice = Pick<Invoice, 'id' | 'invoiceNumber' | 'date' | 'status' | 'subtotal' | 'tax' | 'total' | 'vatBreakdown' | 'quote'>;

export function billingSummary(quote: Pick<Quote, 'totals'>, invoices: QuoteInvoice[]): QuoteBillingSummary {
    const counted = countedInvoices(invoices) as QuoteInvoice[];
    const deposits = counted.filter(i => i.quote?.billingKind === 'acompte');
    const invoicedHT = sumCents(counted.map(i => i.subtotal));
    const invoicedTTC = sumCents(counted.map(i => i.total));
    return {
        depositPercent: Math.round(deposits.reduce((s, i) => s + (i.quote?.percent ?? 0), 0) * 100) / 100,
        invoicedHT,
        invoicedTTC,
        remainingHT: roundCents(quote.totals.totalHT - invoicedHT),
        remainingTTC: roundCents(quote.totals.totalTTC - invoicedTTC),
        hasDeposits: deposits.length > 0,
        complete: counted.some(i => i.quote?.billingKind === 'solde' || i.quote?.billingKind === 'totale'),
    };
}

/** Demandes possibles selon ce qui est déjà facturé. */
export function allowedBillingKinds(summary: QuoteBillingSummary): QuoteBillingRequest['kind'][] {
    if (summary.complete) return [];
    return summary.hasDeposits ? ['acompte', 'solde'] : ['totale', 'acompte'];
}

export type QuoteInvoiceDraft = {
    lineItems: InvoiceLineItem[];
    vatBreakdown: VatBreakdown;
    subtotal: number;
    tax: number;
    total: number;
    deposits: { invoiceId: string; invoiceNumber: string; date: string; subtotal: number; tax: number }[];
};

const fmtPct = (n: number) => `${n.toLocaleString('fr-FR')} %`;
const frDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
};

function quoteLines(quote: Pick<Quote, 'lines' | 'pricing' | 'mode'>): InvoiceLineItem[] {
    return computeLines(quote.lines, quote.pricing)
        .filter(l => isPriced(l) && !l.optional)
        .map(l => ({
            description: l.discountPct ? `${l.label} (remise ${fmtPct(l.discountPct)})` : l.label,
            quantity: l.quantity,
            unitPrice: l.unitPrice ?? 0,
            total: l.totalHT,
            vatRate: l.vatRate,
            ...(l.unit && { unit: l.unit }),
            activityCode: quote.mode,
        }));
}

function totalsOf(vat: VatBreakdown) {
    const subtotal = sumCents(vat.map(v => v.base));
    const tax = sumCents(vat.map(v => v.amount));
    return { subtotal, tax, total: sumCents([subtotal, tax]) };
}

/**
 * Lignes et montants de la facture demandée. `previous` : factures déjà émises pour ce devis.
 * Lève une erreur explicite si la demande n'est pas possible.
 */
export function buildQuoteInvoice(
    quote: Pick<Quote, 'number' | 'version' | 'lines' | 'pricing' | 'mode' | 'totals' | 'status'>,
    request: QuoteBillingRequest,
    previous: QuoteInvoice[],
): QuoteInvoiceDraft {
    if (quote.status !== 'accepte') throw new Error('Seul un devis accepté se facture.');
    const summary = billingSummary(quote, previous);
    if (!allowedBillingKinds(summary).includes(request.kind)) {
        throw new Error(summary.complete
            ? 'Ce devis est déjà entièrement facturé.'
            : request.kind === 'totale' ? 'Des acomptes ont déjà été facturés : facturez le solde.'
                : 'Aucun acompte facturé : facturez la totalité.');
    }
    const ref = `devis ${quote.number}${quote.version > 1 ? ` V${quote.version}` : ''}`;

    if (request.kind === 'acompte') {
        const p = request.percent;
        if (!(p > 0 && p < 100)) throw new Error("Pourcentage d'acompte : entre 0 et 100 %.");
        if (summary.depositPercent + p >= 100) {
            throw new Error(`Acomptes cumulés : ${fmtPct(summary.depositPercent + p)}. Il doit rester un solde à facturer.`);
        }
        const vatBreakdown: VatBreakdown = quote.totals.vat.map(v => {
            const base = roundCents(v.base * p / 100);
            return { rate: v.rate, base, amount: roundCents(base * v.rate / 100) };
        });
        const several = vatBreakdown.length > 1;
        const lineItems: InvoiceLineItem[] = vatBreakdown.map(v => ({
            description: `Acompte de ${fmtPct(p)} sur ${ref}${several ? ` — travaux soumis à TVA ${fmtPct(v.rate)}` : ''}`,
            quantity: 1, unitPrice: v.base, total: v.base, vatRate: v.rate, activityCode: quote.mode,
        }));
        return { lineItems, vatBreakdown, ...totalsOf(vatBreakdown), deposits: [] };
    }

    const lines = quoteLines(quote);
    if (request.kind === 'totale') {
        const vatBreakdown = quote.totals.vat.map(v => ({ ...v }));
        return { lineItems: lines, vatBreakdown, ...totalsOf(vatBreakdown), deposits: [] };
    }

    // Solde : détail du devis, moins chaque acompte, taux par taux ; TVA par différence.
    const deposits = (countedInvoices(previous) as QuoteInvoice[]).filter(i => i.quote?.billingKind === 'acompte');
    const deductions: InvoiceLineItem[] = deposits.flatMap(d => (d.vatBreakdown ?? []).map(v => ({
        description: `Déduction de l'acompte facture ${d.invoiceNumber ?? d.id} du ${frDate(d.date)}${(d.vatBreakdown?.length ?? 0) > 1 ? ` (TVA ${fmtPct(v.rate)})` : ''}`,
        quantity: 1, unitPrice: -v.base, total: -v.base, vatRate: v.rate, activityCode: quote.mode,
    })));
    const vatBreakdown: VatBreakdown = quote.totals.vat.map(v => {
        const paid = deposits.flatMap(d => (d.vatBreakdown ?? []).filter(x => x.rate === v.rate));
        return {
            rate: v.rate,
            base: roundCents(v.base - sumCents(paid.map(x => x.base))),
            amount: roundCents(v.amount - sumCents(paid.map(x => x.amount))),
        };
    });
    return {
        lineItems: [...lines, ...deductions],
        vatBreakdown,
        ...totalsOf(vatBreakdown),
        deposits: deposits.map(d => ({ invoiceId: d.id, invoiceNumber: d.invoiceNumber ?? d.id, date: d.date, subtotal: d.subtotal, tax: d.tax })),
    };
}
