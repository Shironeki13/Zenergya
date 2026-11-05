import { roundCents, sumCents } from '@/lib/money';
import { toDay } from '@/lib/services/site-amounts';
import type { InvoiceLineItem, VatBreakdown } from '@/lib/types';

/**
 * Facturation des contrats : échéancier calculé à partir des prestations (calcul pur, partagé par le serveur, la
 * facturation groupée et la fiche site).
 *
 * - **Éléments facturables** : chaque prestation active d'un site piloté par ses prestations ; pour un site sans
 *   prestation, chaque montant saisi (site × activité), aux conditions du contrat.
 * - **Périodicité** : celle de la prestation, sinon celle du site, sinon l'échéancier du contrat. Les périodes sont
 *   **calées sur le début du contrat** (toutes les prestations d'un contrat tombent sur les mêmes bornes).
 * - **Terme** : à échoir (facturable dès le début de la période) ou échu (facturable le lendemain de sa fin) ;
 *   celui de la prestation, sinon du site, sinon à échoir (signalé).
 * - **Échéances** : de la fin du dernier facturé jusqu'à la date demandée ; une échéance raccourcie (début ou fin
 *   de prestation ou de contrat en cours de période) est proratisée au jour près sur la période pleine.
 * - **Déjà facturé** : lignes des factures (et proformas) non annulées, par prestation et période ; les factures
 *   antérieures (sans détail par ligne) comptent par site et activité jusqu'à leur fin de période.
 * - **TVA par ligne** : celle de la prestation, sinon celle de l'activité ; jamais supposée (facture bloquée).
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
const maxDay = (...days: (string | null | undefined)[]) => days.filter(Boolean).sort().pop() as string;
const minDay = (...days: (string | null | undefined)[]) => days.filter(Boolean).sort()[0] as string;
const normText = (s: unknown) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

// --- Périodicité et terme ---

const SCHEDULES: { months: number; label: string; match: RegExp }[] = [
    { months: 1, label: 'Mensuel', match: /mensuel/ },
    { months: 3, label: 'Trimestriel', match: /trimestriel/ },
    { months: 6, label: 'Semestriel', match: /semestriel/ },
    { months: 12, label: 'Annuel', match: /annuel/ },
];

/** Périodicité d'un échéancier (nom du paramétrage) ; null si inconnue (pas d'annuel supposé). */
export function scheduleOf(name: string | undefined | null): { months: number; label: string } | null {
    const found = SCHEDULES.find(s => s.match.test(normText(name)));
    return found ? { months: found.months, label: found.label } : null;
}

export type Terme = 'echoir' | 'echu';
/** Terme d'après son nom (« À échoir », « Terme échu »…) ; null si illisible. */
export function termeOf(name: string | undefined | null): Terme | null {
    const n = normText(name);
    if (/echoir|avance/.test(n)) return 'echoir';
    if (/echu/.test(n)) return 'echu';
    return null;
}
export const TERME_LABEL: Record<Terme, string> = { echoir: 'à échoir', echu: 'à terme échu' };

// --- Données ---

export type BillingContract = {
    id: string; siteIds: string[]; activityIds: string[]; invoicingType?: 'multi-site' | 'global';
    startDate: unknown; endDate: unknown; billingSchedule?: string;
};
export type BillingSite = {
    id: string; name: string; contractId?: string; amounts?: { activityId: string; amount: number }[]; amountsSource?: string;
    billingSchedule?: string; termId?: string;
};
export type BillingService = {
    id?: string; siteId: string; contractId: string; activityId: string; price?: number | null; startDate?: unknown; endDate?: unknown;
    isActive?: boolean; vatRateId?: string; label?: string; scheduleId?: string; billingTermId?: string;
};
export type BillingActivity = { id: string; code: string; label: string; vatRateId?: string };
export type BillingVatRate = { id: string; code: string; rate: number };
export type NamedRef = { id: string; name: string };

export type BillingInput = {
    contract: BillingContract;
    sites: BillingSite[];
    services: BillingService[];
    activities: BillingActivity[];
    vatRates: BillingVatRate[];
    schedules: NamedRef[];
    terms: NamedRef[];
};

/** Élément facturable : une prestation, ou un montant saisi d'un site sans prestation. */
export type BillingItem = {
    key: string;
    serviceId?: string;
    site: BillingSite;
    activity: BillingActivity;
    label?: string;
    annual: number;
    from: string;
    to: string;
    months: number;
    scheduleLabel: string;
    terme: Terme;
    vatRateId?: string;
};

export type Echeance = {
    item: BillingItem;
    /** Période facturée (raccourcie le cas échéant). */
    start: string;
    end: string;
    /** Période pleine de l'échéancier (base du prorata). */
    nominalStart: string;
    nominalEnd: string;
    days: number;
    nominalDays: number;
    /** Date à partir de laquelle l'échéance peut être facturée (terme). */
    billableOn: string;
    amount: number;
};

/** Facture déjà émise (ou proforma) : ce qu'il faut pour savoir ce qui est facturé. */
export type BilledInvoice = {
    status?: string;
    cancelledByCreditNoteId?: string;
    periodEndDate?: unknown;
    lineItems?: Partial<Pick<InvoiceLineItem, 'itemKey' | 'itemKeys' | 'periodEndDate' | 'siteId' | 'activityCode'>>[];
};

// --- Éléments facturables ---

export function billingItems(input: BillingInput): { items: BillingItem[]; errors: string[]; warnings: string[] } {
    const { contract } = input;
    const errors: string[] = [];
    const warnings: string[] = [];
    const contractStart = toDay(contract.startDate);
    const contractEnd = toDay(contract.endDate);
    if (!contractStart || !contractEnd) return { items: [], errors: ['Dates de début et de fin du contrat obligatoires pour facturer.'], warnings };
    const activity = new Map(input.activities.map(a => [a.id, a]));
    const scheduleName = new Map(input.schedules.map(s => [s.id, s.name]));
    const termName = new Map(input.terms.map(t => [t.id, t.name]));
    const items: BillingItem[] = [];

    const periodicity = (where: string, ...names: (string | undefined)[]) => {
        const name = names.find(n => n);
        const s = scheduleOf(name);
        if (!s) errors.push(`${where} : périodicité de facturation ${name ? `« ${name} » inconnue` : 'non renseignée (prestation, site ou contrat)'}.`);
        return s;
    };
    const termeFor = (where: string, ...ids: (string | undefined)[]): Terme => {
        const id = ids.find(i => i);
        const t = id ? termeOf(termName.get(id)) : null;
        if (id && !t) errors.push(`${where} : terme « ${termName.get(id) ?? id} » illisible (à échoir ou échu).`);
        if (!id) warnings.push(`${where} : terme non renseigné, facturé à échoir.`);
        return t ?? 'echoir';
    };

    for (const site of input.sites.filter(s => contract.siteIds.includes(s.id))) {
        const own = input.services.filter(s => s.siteId === site.id && s.contractId === contract.id && s.isActive !== false);
        if (site.amountsSource === 'services' || own.length > 0) {
            for (const s of own) {
                const a = activity.get(s.activityId);
                if (!a || !contract.activityIds.includes(a.id) || !Number(s.price)) continue;
                const where = `${a.code} sur le site ${site.name}`;
                const sched = periodicity(where, scheduleName.get(s.scheduleId ?? ''), site.billingSchedule, contract.billingSchedule);
                if (!sched) continue;
                items.push({
                    key: `svc:${s.id}`, serviceId: s.id, site, activity: a, label: s.label, annual: Number(s.price),
                    from: maxDay(contractStart, toDay(s.startDate)), to: minDay(contractEnd, toDay(s.endDate)),
                    months: sched.months, scheduleLabel: sched.label, terme: termeFor(where, s.billingTermId, site.termId),
                    vatRateId: s.vatRateId || a.vatRateId,
                });
            }
        } else {
            for (const amount of site.amounts ?? []) {
                const a = activity.get(amount.activityId);
                if (!a || !contract.activityIds.includes(a.id) || !amount.amount) continue;
                const where = `${a.code} sur le site ${site.name}`;
                const sched = periodicity(where, site.billingSchedule, contract.billingSchedule);
                if (!sched) continue;
                items.push({
                    key: `site:${site.id}:${a.id}`, site, activity: a, annual: amount.amount, from: contractStart, to: contractEnd,
                    months: sched.months, scheduleLabel: sched.label, terme: termeFor(where, site.termId), vatRateId: a.vatRateId,
                });
            }
        }
    }
    return { items, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

// --- Déjà facturé ---

/** Dernier jour facturé de chaque élément (null : rien de facturé). */
export function billedUntil(items: BillingItem[], invoices: BilledInvoice[]): Map<string, string | null> {
    const result = new Map<string, string | null>(items.map(i => [i.key, null]));
    const bump = (key: string, day: string | null) => {
        if (day && result.has(key) && (!result.get(key) || day > result.get(key)!)) result.set(key, day);
    };
    for (const inv of invoices) {
        if (inv.status === 'cancelled' || inv.cancelledByCreditNoteId) continue;
        const invoiceEnd = toDay(inv.periodEndDate);
        for (const line of inv.lineItems ?? []) {
            const keys = lineItemKeys(line);
            if (keys.length) { for (const key of keys) bump(key, toDay(line.periodEndDate)); continue; }
            // Facture antérieure à l'échéancier : par site et activité (ou activité seule en facturation globale).
            for (const item of items) {
                if (line.activityCode === item.activity.code && (!line.siteId || line.siteId === item.site.id)) bump(item.key, invoiceEnd);
            }
        }
    }
    return result;
}

// --- Échéancier ---

/** Période pleine (calée sur le début du contrat) qui contient un jour. */
export function nominalPeriod(contractStart: string, months: number, day: string): { start: string; end: string } {
    let k = Math.max(0, Math.floor(((parse(day) - parse(contractStart)) / 86_400_000) / (months * 31)) - 1);
    while (addMonths(contractStart, (k + 1) * months) <= day) k++;
    const start = addMonths(contractStart, k * months);
    return { start, end: addDays(addMonths(contractStart, (k + 1) * months), -1) };
}

/** Échéances d'un élément, du lendemain du dernier facturé jusqu'à `until` (date de facturation possible). */
export function echeancesOf(item: BillingItem, contractStart: string, last: string | null, until: string, max = 400): Echeance[] {
    const out: Echeance[] = [];
    let cursor = last ? maxDay(addDays(last, 1), item.from) : item.from;
    while (cursor <= item.to && out.length < max) {
        const nominal = nominalPeriod(contractStart, item.months, cursor);
        const end = minDay(nominal.end, item.to);
        const billableOn = item.terme === 'echoir' ? cursor : addDays(end, 1);
        if (billableOn > until) break;
        const days = daysIn(cursor, end);
        const nominalDays = daysIn(nominal.start, nominal.end);
        out.push({
            item, start: cursor, end, nominalStart: nominal.start, nominalEnd: nominal.end, days, nominalDays, billableOn,
            amount: roundCents(item.annual * (item.months / 12) * (days / nominalDays)),
        });
        cursor = addDays(end, 1);
    }
    return out;
}

export type DueResult = { echeances: Echeance[]; lines: InvoiceLineItem[]; errors: string[]; warnings: string[] };

/** Échéances facturables d'un contrat à la date `until`, et lignes de facture correspondantes. */
export function dueInvoiceLines(input: BillingInput, invoices: BilledInvoice[], until: string): DueResult {
    const { items, errors, warnings } = billingItems(input);
    const contractStart = toDay(input.contract.startDate)!;
    if (errors.length) return { echeances: [], lines: [], errors, warnings };
    const billed = billedUntil(items, invoices);
    const echeances = items.flatMap(item => echeancesOf(item, contractStart, billed.get(item.key) ?? null, until))
        .filter(e => e.amount !== 0)
        .sort((a, b) => a.start.localeCompare(b.start) || a.item.site.name.localeCompare(b.item.site.name) || a.item.activity.code.localeCompare(b.item.activity.code));

    const vat = new Map(input.vatRates.map(v => [v.id, v]));
    const lineErrors: string[] = [];
    const rateOf = (e: Echeance) => {
        const v = e.item.vatRateId ? vat.get(e.item.vatRateId) : undefined;
        if (!v) lineErrors.push(`TVA non renseignée : ${e.item.activity.code} sur le site ${e.item.site.name} (à définir sur la prestation ou sur l'activité, dans le paramétrage).`);
        return v?.rate;
    };
    const prorata = (e: { days: number; nominalDays: number }) => (e.days < e.nominalDays ? ` — prorata ${e.days}/${e.nominalDays} j` : '');
    const period = (e: Echeance) => `du ${frDay(e.start)} au ${frDay(e.end)}`;
    const lines: InvoiceLineItem[] = [];

    if (input.contract.invoicingType === 'global') {
        // Une ligne par activité, taux et période ; le détail par élément reste dans `items` (suivi du facturé).
        const groups = new Map<string, { e: Echeance; rate: number; amounts: number[]; keys: string[] }>();
        for (const e of echeances) {
            const rate = rateOf(e);
            if (rate === undefined) continue;
            const key = `${e.item.activity.id}|${rate}|${e.start}|${e.end}`;
            if (!groups.has(key)) groups.set(key, { e, rate, amounts: [], keys: [] });
            groups.get(key)!.amounts.push(e.amount);
            groups.get(key)!.keys.push(e.item.key);
        }
        for (const g of groups.values()) {
            const total = sumCents(g.amounts);
            lines.push({
                description: `${g.e.item.activity.label} (${g.e.item.scheduleLabel}, ${TERME_LABEL[g.e.item.terme]}) — ${period(g.e)}${prorata(g.e)}`,
                quantity: 1, unitPrice: total, total, activityCode: g.e.item.activity.code, vatRate: g.rate,
                periodStartDate: g.e.start, periodEndDate: g.e.end, itemKeys: g.keys,
            });
        }
    } else {
        for (const e of echeances) {
            const rate = rateOf(e);
            if (rate === undefined) continue;
            lines.push({
                description: `${e.item.activity.label}${e.item.label ? ` — ${e.item.label}` : ''} (${e.item.scheduleLabel}, ${TERME_LABEL[e.item.terme]}) — Site : ${e.item.site.name} — ${period(e)}${prorata(e)}`,
                quantity: 1, unitPrice: e.amount, total: e.amount, siteId: e.item.site.id, activityCode: e.item.activity.code, vatRate: rate,
                itemKey: e.item.key, ...(e.item.serviceId && { serviceId: e.item.serviceId }), periodStartDate: e.start, periodEndDate: e.end,
            });
        }
    }
    return { echeances, lines, errors: [...new Set(lineErrors)], warnings };
}

/** Lignes facturées par un élément (y compris en facturation globale, via `itemKeys`). */
export function lineItemKeys(line: Pick<InvoiceLineItem, 'itemKey' | 'itemKeys'>): string[] {
    return line.itemKey ? [line.itemKey] : line.itemKeys ?? [];
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
    const text = normText(`${term.deadline ?? ''} ${term.code ?? ''}`);
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
