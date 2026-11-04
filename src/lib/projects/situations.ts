import { roundCents, sumCents } from '@/lib/money';
import { computeLines, isPriced } from '@/lib/quotes/pricing';
import type { Quote } from '@/lib/quotes/types';
import type { InvoiceLineItem, VatBreakdown } from '@/lib/types';
import type { Progress, Project, ProjectLine, SituationSnapshot } from '@/lib/projects/types';

/**
 * Situations de travaux (sans dépendance).
 *
 * Avancement CUMULÉ par ligne. Cumul d'une ligne = montant HT × % ; montant de la situation = cumul −
 * cumul de la situation précédente facturée. TVA par différence des cumuls, taux par taux : à 100 %,
 * la somme des situations égale exactement les totaux du devis.
 *
 * Retenue de garantie : % du TTC de la situation, déduite du net à payer (la base HT et la TVA de la
 * facture restent entières).
 */

/** Lignes du marché à partir du devis accepté (lignes chiffrées, options exclues). */
export function marketLines(quote: Pick<Quote, 'lines' | 'pricing'>): ProjectLine[] {
    let section: string | undefined;
    const lines: ProjectLine[] = [];
    for (const l of computeLines(quote.lines, quote.pricing)) {
        if (l.kind === 'TITRE') { section = l.label; continue; }
        if (!isPriced(l) || l.optional) continue;
        lines.push({
            id: l.id,
            label: l.discountPct ? `${l.label} (remise ${l.discountPct.toLocaleString('fr-FR')} %)` : l.label,
            ...(l.unit && { unit: l.unit }),
            quantity: l.quantity,
            unitPrice: l.unitPrice ?? 0,
            totalHT: l.totalHT,
            vatRate: l.vatRate,
            ...(section && { section }),
        });
    }
    return lines;
}

const pctOf = (progress: Progress | undefined, id: string) => progress?.[id] ?? 0;
const lineCumul = (line: ProjectLine, pct: number) => (pct >= 100 ? line.totalHT : roundCents(line.totalHT * pct / 100));

function cumulativeByRate(lines: ProjectLine[], progress: Progress): { rate: number; base: number; amount: number }[] {
    const rates = [...new Set(lines.map(l => l.vatRate))].sort((a, b) => b - a);
    return rates.map(rate => {
        const base = sumCents(lines.filter(l => l.vatRate === rate).map(l => lineCumul(l, pctOf(progress, l.id))));
        return { rate, base, amount: roundCents(base * rate / 100) };
    });
}

export type ComputedSituationLine = ProjectLine & {
    previousPct: number;
    pct: number;
    previousCumul: number;
    cumul: number;
    amount: number;   // montant HT de la situation
};

export type ComputedSituation = {
    lines: ComputedSituationLine[];
    vatBreakdown: VatBreakdown;
    subtotal: number;
    tax: number;
    total: number;
    retention: { pct: number; amount: number };
    netToPay: number;
    cumulative: { rate: number; base: number; amount: number }[];
    cumulativeHT: number;
    progressPct: number;   // avancement global en % du HT du marché
};

/**
 * Calcule une situation. `previous` : état après la dernière situation facturée (absent pour la première).
 */
export function computeSituation(
    project: Pick<Project, 'lines' | 'totalHT' | 'retentionPct' | 'retentionBond'>,
    progress: Progress,
    previous?: Pick<SituationSnapshot, 'progress' | 'cumulative'>,
): ComputedSituation {
    const lines = project.lines.map(l => {
        const previousPct = pctOf(previous?.progress, l.id);
        const pct = pctOf(progress, l.id);
        const previousCumul = lineCumul(l, previousPct);
        const cumul = lineCumul(l, pct);
        return { ...l, previousPct, pct, previousCumul, cumul, amount: roundCents(cumul - previousCumul) };
    });
    const cumulative = cumulativeByRate(project.lines, progress);
    const vatBreakdown: VatBreakdown = cumulative.map(c => {
        const prev = previous?.cumulative.find(p => p.rate === c.rate);
        return { rate: c.rate, base: roundCents(c.base - (prev?.base ?? 0)), amount: roundCents(c.amount - (prev?.amount ?? 0)) };
    }).filter(v => v.base !== 0 || v.amount !== 0);
    const subtotal = sumCents(vatBreakdown.map(v => v.base));
    const tax = sumCents(vatBreakdown.map(v => v.amount));
    const total = sumCents([subtotal, tax]);
    const pct = project.retentionBond ? 0 : project.retentionPct;
    const retentionAmount = roundCents(total * pct / 100);
    const cumulativeHT = sumCents(cumulative.map(c => c.base));
    return {
        lines, vatBreakdown, subtotal, tax, total,
        retention: { pct, amount: retentionAmount },
        netToPay: roundCents(total - retentionAmount),
        cumulative,
        cumulativeHT,
        progressPct: project.totalHT > 0 ? Math.round((cumulativeHT / project.totalHT) * 10000) / 100 : 0,
    };
}

/** Anomalies d'une situation (vide : facturable). */
export function situationIssues(project: Pick<Project, 'lines'>, progress: Progress, previous?: Pick<SituationSnapshot, 'progress'>): string[] {
    const issues: string[] = [];
    let moves = false;
    for (const l of project.lines) {
        const pct = pctOf(progress, l.id);
        const prev = pctOf(previous?.progress, l.id);
        if (!(pct >= 0 && pct <= 100)) issues.push(`${l.label} : avancement entre 0 et 100 %.`);
        else if (pct < prev) issues.push(`${l.label} : l'avancement cumulé ne peut pas baisser (${prev} % facturés) ; une correction passe par un avoir.`);
        if (pct > prev) moves = true;
    }
    if (!moves) issues.push("Aucune ligne n'avance depuis la situation précédente.");
    return issues;
}

/** Lignes de la facture de situation : une par ligne qui avance, avec l'avancement. */
export function situationInvoiceLines(computed: ComputedSituation, activityCode = 'P6'): InvoiceLineItem[] {
    // Espaces insécables (milliers et avant « € ») : un montant n'est jamais coupé en fin de ligne.
    const eur = (n: number) => `${n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0')}\u00A0€`;
    return computed.lines.filter(l => l.amount !== 0).map(l => ({
        description: `${l.section ? `${l.section} — ` : ''}${l.label} : avancement ${l.pct.toLocaleString('fr-FR')} % `
            + `(cumul ${eur(l.cumul)}, déjà facturé ${eur(l.previousCumul)}, marché ${eur(l.totalHT)})`,
        quantity: 1,
        unitPrice: l.amount,
        total: l.amount,
        vatRate: l.vatRate,
        ...(l.unit && { unit: l.unit }),
        activityCode,
    }));
}

/** Situation précédente facturée : la plus récente parmi les factures non annulées. */
export function latestSnapshot<T extends { status: string; situation?: SituationSnapshot }>(invoices: T[]): SituationSnapshot | undefined {
    return invoices
        .filter(i => i.status !== 'cancelled' && i.status !== 'proforma' && i.situation)
        .map(i => i.situation!)
        .sort((a, b) => b.number - a.number)[0];
}
