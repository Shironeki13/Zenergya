import { roundCents, sumCents } from '@/lib/money';
import { inForce, toDay } from '@/lib/services/site-amounts';
import type { InvoiceLineItem, VatBreakdown } from '@/lib/types';

/**
 * Facturation des contrats (calcul pur, partagé par le serveur et l'aperçu de la facturation groupée).
 *
 * - Période : selon l'échéancier du contrat (mensuel, trimestriel, semestriel, annuel), à la suite de la dernière
 *   facture ; une période raccourcie (fin du contrat, prestation qui commence ou finit en cours de période) est
 *   **proratisée au jour près** : montant de la période pleine × jours couverts / jours de la période pleine.
 * - Lignes : par prestation en vigueur pour un site piloté par ses prestations, sinon par montant saisi du site.
 * - TVA : celle de la prestation, sinon celle de l'activité (paramétrage) ; jamais de taux supposé : une TVA
 *   manquante bloque la facture avec la liste des lignes concernées.
 * - Totaux par taux (ventilation de TVA), arrondis au centime ligne par ligne.
 */

// --- Jours (« AAAA-MM-JJ », sans fuseau) ---

const parse = (day: string) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => fmt(parse(day) + n * 86_400_000);
/** Ajoute des mois en restant dans le mois visé (31/01 + 1 mois = 28 ou 29/02). */
export function addMonths(day: string, n: number): string {
    const [y, m, d] = day.split('-').map(Number);
    const target = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    return fmt(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last)));
}
/** Nombre de jours de [début, fin], bornes incluses. */
export const daysIn = (start: string, end: string) => Math.round((parse(end) - parse(start)) / 86_400_000) + 1;
export const frDay = (day: string) => day.split('-').reverse().join('/');

// --- Échéancier ---

const SCHEDULES: { months: number; label: string; match: RegExp }[] = [
    { months: 1, label: 'Mensuel', match: /mensuel/ },
    { months: 3, label: 'Trimestriel', match: /trimestriel/ },
    { months: 6, label: 'Semestriel', match: /semestriel/ },
    { months: 12, label: 'Annuel', match: /annuel/ },
];

/** Périodicité d'un échéancier (nom du paramétrage) ; null si inconnue (pas d'annuel supposé). */
export function scheduleOf(name: string | undefined | null): { months: number; label: string } | null {
    const n = String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const found = SCHEDULES.find(s => s.match.test(n));
    return found ? { months: found.months, label: found.label } : null;
}

export type BillingPeriod = {
    start: string;
    /** Fin facturée (bornée par la fin du contrat). */
    end: string;
    /** Fin de la période pleine (base du prorata). */
    nominalEnd: string;
    months: number;
    label: string;
};

/** Prochaine période à facturer, ou null si le contrat est entièrement facturé. */
export function nextBillingPeriod(contract: { startDate: unknown; endDate: unknown; billingSchedule?: string }, lastPeriodEnd?: string | null): BillingPeriod | null {
    const schedule = scheduleOf(contract.billingSchedule);
    const contractStart = toDay(contract.startDate);
    const contractEnd = toDay(contract.endDate);
    if (!schedule) throw new Error(`Échéancier de facturation du contrat inconnu ou non renseigné (« ${contract.billingSchedule ?? ''} ») : mensuel, trimestriel, semestriel ou annuel.`);
    if (!contractStart || !contractEnd) throw new Error('Dates de début et de fin du contrat obligatoires pour facturer.');
    const start = lastPeriodEnd ? addDays(lastPeriodEnd, 1) : contractStart;
    if (start > contractEnd) return null;
    const nominalEnd = addDays(addMonths(start, schedule.months), -1);
    return { start, end: nominalEnd < contractEnd ? nominalEnd : contractEnd, nominalEnd, months: schedule.months, label: schedule.label };
}

// --- Lignes ---

export type BillingSite = { id: string; name: string; contractId?: string; amounts?: { activityId: string; amount: number }[]; amountsSource?: string };
export type BillingService = {
    id?: string; siteId: string; contractId: string; activityId: string; price?: number | null; startDate?: unknown; endDate?: unknown;
    isActive?: boolean; vatRateId?: string; label?: string;
};
export type BillingActivity = { id: string; code: string; label: string; vatRateId?: string };
export type BillingVatRate = { id: string; code: string; rate: number };

export type BillingInput = {
    contract: { id: string; siteIds: string[]; activityIds: string[]; invoicingType?: 'multi-site' | 'global' };
    sites: BillingSite[];
    services: BillingService[];
    activities: BillingActivity[];
    vatRates: BillingVatRate[];
};

export type BillingResult = { lines: InvoiceLineItem[]; errors: string[] };

/** Jours de la période facturée couverts par [début, fin] (vide = sans borne). */
function coveredDays(period: BillingPeriod, from?: unknown, to?: unknown): number {
    const start = [period.start, toDay(from)].filter(Boolean).sort().pop()!;
    const end = [period.end, toDay(to)].filter(Boolean).sort()[0]!;
    return end < start ? 0 : daysIn(start, end);
}

export function contractInvoiceLines(input: BillingInput, period: BillingPeriod): BillingResult {
    const { contract } = input;
    const errors: string[] = [];
    const fullDays = daysIn(period.start, period.nominalEnd);
    const activity = new Map(input.activities.map(a => [a.id, a]));
    const vat = new Map(input.vatRates.map(v => [v.id, v]));
    const periodText = `Période du ${frDay(period.start)} au ${frDay(period.end)}`;
    type Raw = { site: BillingSite; activity: BillingActivity; annual: number; days: number; vatRateId?: string; label?: string };
    const raws: Raw[] = [];

    for (const site of input.sites.filter(s => contract.siteIds.includes(s.id))) {
        const own = input.services.filter(s => s.siteId === site.id && s.contractId === contract.id && s.isActive !== false);
        if (site.amountsSource === 'services' || own.length > 0) {
            for (const s of own) {
                const a = activity.get(s.activityId);
                if (!a || !contract.activityIds.includes(a.id)) continue;
                const days = coveredDays(period, s.startDate, s.endDate);
                if (days > 0 && Number(s.price)) raws.push({ site, activity: a, annual: Number(s.price), days, vatRateId: s.vatRateId || a.vatRateId, label: s.label });
            }
        } else {
            for (const amount of site.amounts ?? []) {
                const a = activity.get(amount.activityId);
                if (!a || !contract.activityIds.includes(a.id) || !amount.amount) continue;
                raws.push({ site, activity: a, annual: amount.amount, days: daysIn(period.start, period.end), vatRateId: a.vatRateId });
            }
        }
    }

    const lines: InvoiceLineItem[] = [];
    const prorata = (days: number) => (days < fullDays ? ` — prorata ${days}/${fullDays} j` : '');
    const amountOf = (r: Raw) => roundCents(r.annual * (period.months / 12) * (r.days / fullDays));
    const rateOf = (r: Raw) => {
        const v = r.vatRateId ? vat.get(r.vatRateId) : undefined;
        if (!v) errors.push(`TVA non renseignée : ${r.activity.code} sur le site ${r.site.name} (à définir sur la prestation ou sur l'activité, dans le paramétrage).`);
        return v?.rate;
    };

    if (contract.invoicingType === 'global') {
        const groups = new Map<string, { activity: BillingActivity; rate: number; total: number[]; days: number }>();
        for (const r of raws) {
            const rate = rateOf(r);
            if (rate === undefined) continue;
            const key = `${r.activity.id}|${rate}`;
            if (!groups.has(key)) groups.set(key, { activity: r.activity, rate, total: [], days: 0 });
            const g = groups.get(key)!;
            g.total.push(amountOf(r));
            g.days = Math.max(g.days, r.days);
        }
        for (const g of groups.values()) {
            const total = sumCents(g.total);
            lines.push({
                description: `Prestation : ${g.activity.label} (${period.label}) — ${periodText}${prorata(g.days)}`,
                quantity: 1, unitPrice: total, total, activityCode: g.activity.code, vatRate: g.rate,
            });
        }
    } else {
        for (const r of raws) {
            const rate = rateOf(r);
            if (rate === undefined) continue;
            const total = amountOf(r);
            lines.push({
                description: `Prestation : ${r.activity.label}${r.label ? ` — ${r.label}` : ''} (${period.label}) — Site : ${r.site.name} — ${periodText}${prorata(r.days)}`,
                quantity: 1, unitPrice: total, total, siteId: r.site.id, activityCode: r.activity.code, vatRate: rate,
            });
        }
    }
    return { lines: lines.filter(l => l.total !== 0), errors: [...new Set(errors)] };
}

// --- Totaux par taux ---

export function vatTotals(lines: InvoiceLineItem[]): { subtotal: number; tax: number; total: number; vatBreakdown: VatBreakdown; taxRate?: number } {
    const byRate = new Map<number, number[]>();
    for (const l of lines) {
        const rate = l.vatRate ?? 0;
        if (!byRate.has(rate)) byRate.set(rate, []);
        byRate.get(rate)!.push(l.total);
    }
    const vatBreakdown: VatBreakdown = [...byRate.entries()].sort(([a], [b]) => b - a).map(([rate, totals]) => {
        const base = sumCents(totals);
        return { rate, base, amount: roundCents(base * rate / 100) };
    });
    const subtotal = sumCents(vatBreakdown.map(v => v.base));
    const tax = sumCents(vatBreakdown.map(v => v.amount));
    return { subtotal, tax, total: sumCents([subtotal, tax]), vatBreakdown, ...(vatBreakdown.length === 1 && { taxRate: vatBreakdown[0].rate / 100 }) };
}

// --- Échéance de paiement ---

export type PaymentTermLike = { code?: string; deadline?: string; days?: number | null; endOfMonth?: boolean | null };

/** Délai d'une condition de paiement : champs structurés, sinon lus dans le libellé (« 45 jours fin de mois »). */
export function paymentTermRule(term: PaymentTermLike): { days: number; endOfMonth: boolean } | null {
    if (typeof term.days === 'number' && term.days >= 0) return { days: term.days, endOfMonth: !!term.endOfMonth };
    const text = `${term.deadline ?? ''} ${term.code ?? ''}`.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (/reception|comptant|immediat/.test(text)) return { days: 0, endOfMonth: false };
    const m = /(\d+)\s*(j|jours?)\b/.exec(text);
    return m ? { days: Number(m[1]), endOfMonth: /fin de mois|fdm/.test(text) } : null;
}

/** Délai légal par défaut (sans condition convenue) : 30 jours après la date de facture. */
export const DEFAULT_PAYMENT_DAYS = 30;

/**
 * Date d'échéance : date de facture + délai ; « fin de mois » : fin du mois atteint après le délai.
 * Sans condition de paiement : 30 jours. Une condition illisible bloque (pas d'échéance supposée).
 */
export function dueDateFor(invoiceDay: string, term?: PaymentTermLike | null): string {
    if (!term) return addDays(invoiceDay, DEFAULT_PAYMENT_DAYS);
    const rule = paymentTermRule(term);
    if (!rule) throw new Error(`Condition de paiement « ${term.code ?? term.deadline ?? ''} » illisible : renseignez son délai en jours (paramétrage).`);
    const due = addDays(invoiceDay, rule.days);
    if (!rule.endOfMonth) return due;
    const [y, m] = due.split('-').map(Number);
    return fmt(Date.UTC(y, m, 0));
}
