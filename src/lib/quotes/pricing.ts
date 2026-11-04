import { roundCents, sumCents } from '@/lib/money';
import { PRICED_KINDS, type QuoteLine, type QuoteLineComponent, type QuotePricing, type QuoteTotals } from '@/lib/quotes/types';

/**
 * Calculs d'un devis : sans dépendance (écran, serveur, tests).
 *
 * Prix unitaire de vente :
 *   main-d'œuvre                  taux horaire du devis
 *   fourniture, sous-traitance…   déboursé unitaire × coefficient (de la ligne, sinon du devis)
 *   ouvrage                       somme, par unité d'ouvrage, des prix de ses composants (chacun selon sa
 *                                 nature ; le coefficient de la ligne s'applique à ses fournitures)
 *   prix imposé                   remplace le calcul
 * Montant de ligne = quantité × prix unitaire × (1 − remise), arrondi au centime.
 * TVA calculée par taux, sur la somme des lignes de ce taux.
 */

export type ComputedLine = QuoteLine & {
    unitPrice: number | null;    // null : non calculable (paramètre manquant)
    totalHT: number;
    totalCost: number;
    /** Titres et sous-totaux : somme des lignes qu'ils regroupent. */
    groupHT?: number;
};

export const isPriced = (line: Pick<QuoteLine, 'kind'>) => PRICED_KINDS.includes(line.kind);

const componentCost = (c: QuoteLineComponent, pricing: QuotePricing): number | null =>
    c.unitCost !== undefined && c.unitCost !== null ? c.unitCost : c.kind === 'MAIN_OEUVRE' ? pricing.laborCost : null;

function componentPrice(c: QuoteLineComponent, coefficient: number | null | undefined, pricing: QuotePricing): number | null {
    if (c.kind === 'MAIN_OEUVRE') return pricing.laborRate;
    const cost = componentCost(c, pricing);
    if (cost === null || coefficient === null || coefficient === undefined) return null;
    return cost * coefficient;
}

/** Somme par unité d'ouvrage ; null si un composant n'est pas chiffrable ou si l'ouvrage est vide. */
function sumComponents(components: QuoteLineComponent[] | undefined, value: (c: QuoteLineComponent) => number | null): number | null {
    if (!components?.length) return null;
    let total = 0;
    for (const c of components) {
        const v = value(c);
        if (v === null) return null;
        total += c.quantity * v;
    }
    return roundCents(total);
}

/** Heures de main-d'œuvre d'une ligne (ouvrage : celles de ses composants). */
export function laborHoursOf(line: QuoteLine): number {
    if (line.kind === 'MAIN_OEUVRE') return line.quantity;
    if (line.kind === 'OUVRAGE') return line.quantity * (line.components ?? []).filter(c => c.kind === 'MAIN_OEUVRE').reduce((h, c) => h + c.quantity, 0);
    return 0;
}

/** Coût unitaire retenu (main-d'œuvre : coût horaire du devis si la ligne n'en donne pas). */
export function unitCostOf(line: QuoteLine, pricing: QuotePricing): number | null {
    if (line.kind === 'OUVRAGE') return sumComponents(line.components, c => componentCost(c, pricing));
    if (line.unitCost !== undefined && line.unitCost !== null) return line.unitCost;
    if (line.kind === 'MAIN_OEUVRE') return pricing.laborCost;
    return null;
}

/** Prix unitaire de vente HT, avant remise ; null si un paramètre manque. */
export function unitPriceOf(line: QuoteLine, pricing: QuotePricing): number | null {
    if (!isPriced(line)) return null;
    if (line.unitPriceOverride !== undefined && line.unitPriceOverride !== null) return line.unitPriceOverride;
    if (line.kind === 'MAIN_OEUVRE') return pricing.laborRate;
    const coefficient = line.coefficient ?? pricing.coefficient;
    if (line.kind === 'OUVRAGE') return sumComponents(line.components, c => componentPrice(c, coefficient, pricing));
    const cost = unitCostOf(line, pricing);
    if (cost === null || coefficient === null || coefficient === undefined) return null;
    return roundCents(cost * coefficient);
}

export function computeLines(lines: QuoteLine[], pricing: QuotePricing): ComputedLine[] {
    const computed: ComputedLine[] = lines.map(line => {
        const unitPrice = unitPriceOf(line, pricing);
        const discount = Math.min(Math.max(line.discountPct ?? 0, 0), 100);
        const totalHT = isPriced(line) && unitPrice !== null ? roundCents(line.quantity * unitPrice * (1 - discount / 100)) : 0;
        const cost = isPriced(line) ? unitCostOf(line, pricing) : null;
        const totalCost = cost !== null ? roundCents(line.quantity * cost) : 0;
        return { ...line, unitPrice, totalHT, totalCost };
    });

    // Titres : lignes qui suivent, jusqu'au prochain titre de même niveau ou plus haut.
    // Sous-totaux : lignes depuis le titre ou le sous-total précédent. Options exclues.
    computed.forEach((line, i) => {
        if (line.kind === 'TITRE') {
            const group: number[] = [];
            for (let j = i + 1; j < computed.length; j++) {
                const next = computed[j];
                if (next.kind === 'TITRE' && (next.level ?? 0) <= (line.level ?? 0)) break;
                if (isPriced(next) && !next.optional) group.push(next.totalHT);
            }
            line.groupHT = sumCents(group);
        } else if (line.kind === 'SOUS_TOTAL') {
            const group: number[] = [];
            for (let j = i - 1; j >= 0; j--) {
                const prev = computed[j];
                if (prev.kind === 'TITRE' || prev.kind === 'SOUS_TOTAL') break;
                if (isPriced(prev) && !prev.optional) group.push(prev.totalHT);
            }
            line.groupHT = sumCents(group);
        }
    });
    return computed;
}

export function computeQuoteTotals(lines: QuoteLine[], pricing: QuotePricing): QuoteTotals {
    const computed = computeLines(lines, pricing);
    const counted = computed.filter(l => isPriced(l) && !l.optional);
    const totalHT = sumCents(counted.map(l => l.totalHT));
    const totalCost = sumCents(counted.map(l => l.totalCost));

    const byRate = new Map<number, number[]>();
    for (const l of counted) byRate.set(l.vatRate, [...(byRate.get(l.vatRate) ?? []), l.totalHT]);
    const vat = [...byRate.entries()]
        .sort(([a], [b]) => b - a)
        .map(([rate, amounts]) => {
            const base = sumCents(amounts);
            return { rate, base, amount: roundCents(base * rate / 100) };
        });
    const totalVAT = sumCents(vat.map(v => v.amount));
    const margin = roundCents(totalHT - totalCost);

    return {
        totalHT,
        vat,
        totalVAT,
        totalTTC: sumCents([totalHT, totalVAT]),
        totalCost,
        margin,
        marginRate: totalHT > 0 ? Math.round((margin / totalHT) * 10000) / 10000 : null,
        effectiveCoefficient: totalCost > 0 ? Math.round((totalHT / totalCost) * 10000) / 10000 : null,
        laborHours: Math.round(counted.reduce((h, l) => h + laborHoursOf(l), 0) * 100) / 100,
        optionsHT: sumCents(computed.filter(l => isPriced(l) && l.optional).map(l => l.totalHT)),
    };
}

/** Anomalies empêchant d'envoyer le devis (le brouillon reste enregistrable). */
export function quoteIssues(lines: QuoteLine[], pricing: QuotePricing): string[] {
    const issues: string[] = [];
    const priced = lines.filter(isPriced);
    if (priced.filter(l => !l.optional).length === 0) issues.push('Aucune ligne chiffrée.');
    lines.forEach((l, i) => {
        const n = `Ligne ${i + 1}`;
        if (!l.label.trim() && l.kind !== 'SOUS_TOTAL') issues.push(`${n} : libellé vide.`);
        if (!isPriced(l)) return;
        if (!(l.quantity > 0)) issues.push(`${n} : quantité nulle ou négative.`);
        if (l.kind === 'OUVRAGE' && !l.components?.length && (l.unitPriceOverride === undefined || l.unitPriceOverride === null)) {
            issues.push(`${n} : ouvrage sans composant.`);
        } else if (unitPriceOf(l, pricing) === null) {
            issues.push(l.kind === 'MAIN_OEUVRE' || (l.kind === 'OUVRAGE' && pricing.laborRate === null && l.components?.some(c => c.kind === 'MAIN_OEUVRE'))
                ? `${n} : taux horaire de main-d'œuvre non renseigné.`
                : `${n} : prix non calculable (déboursé ou coefficient manquant).`);
        }
        if (l.components?.some(c => !(c.quantity > 0) || (c.unitCost ?? 0) < 0)) issues.push(`${n} : composant à quantité nulle ou montant négatif.`);
        if ((l.unitPriceOverride ?? 0) < 0 || (l.unitCost ?? 0) < 0) issues.push(`${n} : montant négatif.`);
    });
    return issues;
}

/** Paramètres de prix d'un nouveau devis : fiche client, sinon société. */
export function resolvePricing(
    client: { quoteCoefficient?: number | null; quoteLaborRate?: number | null } | null | undefined,
    company: { quoteCoefficient?: number | null; quoteLaborRate?: number | null; quoteLaborCost?: number | null; quoteDefaultVatRate?: number | null } | null | undefined,
): QuotePricing {
    const sources: QuotePricing['sources'] = {};
    const pick = (key: 'coefficient' | 'laborRate', fromClient?: number | null, fromCompany?: number | null) => {
        if (fromClient) { sources[key] = 'client'; return fromClient; }
        if (fromCompany) { sources[key] = 'company'; return fromCompany; }
        return null;
    };
    const coefficient = pick('coefficient', client?.quoteCoefficient, company?.quoteCoefficient);
    const laborRate = pick('laborRate', client?.quoteLaborRate, company?.quoteLaborRate);
    const laborCost = company?.quoteLaborCost || null;
    if (laborCost) sources.laborCost = 'company';
    return { coefficient, laborRate, laborCost, defaultVatRate: company?.quoteDefaultVatRate ?? 20, sources };
}

/** Numéro de devis : {CODE}-DEV{AAAA}-{NNNN}, série par société et par année. */
export function quoteNumber(companyCode: string, year: number, sequence: number): string {
    return `${companyCode}-DEV${year}-${String(sequence).padStart(4, '0')}`;
}

export function quoteCounterKey(companyCode: string, year: number): string {
    return `quote_${companyCode}_${year}`;
}

/** Date de fin de validité (YYYY-MM-DD). */
export function addDays(date: string, days: number): string {
    const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/** Identifiant de ligne (stable dans le devis, sans dépendance). */
export function newLineId(): string {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
