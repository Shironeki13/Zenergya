import { roundCents, sumCents } from '@/lib/money';
import { segment } from '@/lib/analytique';
import { computeLines, isPriced } from '@/lib/quotes/pricing';
import type { ComponentKind, Quote, QuoteMode } from '@/lib/quotes/types';

/**
 * Affaire de travaux (logique pure) : un code par devis accepté, P5 comme P6 ; les devis complémentaires se rattachent
 * à la même affaire. L'affaire porte le **prévu** (prix de vente et déboursé par nature de ses devis) ; l'engagé, le
 * réel et le facturé viendront des commandes, des heures et des factures portant son code analytique.
 */

export const NATURES: readonly ComponentKind[] = ['FOURNITURE', 'MAIN_OEUVRE', 'SOUS_TRAITANCE', 'DIVERS'];
export const LIBELLE_NATURE: Record<ComponentKind, string> = { FOURNITURE: 'Fournitures', MAIN_OEUVRE: "Main-d'œuvre", SOUS_TRAITANCE: 'Sous-traitance', DIVERS: 'Divers' };

export type CoutParNature = Record<ComponentKind, number>;
export type BudgetDevis = {
    /** Prix de vente HT. */
    vente: number;
    /** Déboursé total et par nature. */
    cout: number;
    parNature: CoutParNature;
    /** Heures de main-d'œuvre prévues. */
    heures: number;
    marge: number;
    tauxMarge: number | null;
};

const zero = (): CoutParNature => ({ FOURNITURE: 0, MAIN_OEUVRE: 0, SOUS_TRAITANCE: 0, DIVERS: 0 });

/** Budget d'un devis : vente, déboursé par nature (les ouvrages sont ventilés par nature de leurs composants), heures. */
export function budgetDevis(quote: Pick<Quote, 'lines' | 'pricing'>): BudgetDevis {
    const parts: Record<ComponentKind, number[]> = { FOURNITURE: [], MAIN_OEUVRE: [], SOUS_TRAITANCE: [], DIVERS: [] };
    let heures = 0;
    const lignes = computeLines(quote.lines, quote.pricing).filter(l => isPriced(l) && !l.optional);
    for (const l of lignes) {
        if (l.kind === 'OUVRAGE') {
            for (const c of l.components ?? []) {
                const unitaire = c.unitCost ?? (c.kind === 'MAIN_OEUVRE' ? quote.pricing.laborCost : null);
                if (unitaire !== null && unitaire !== undefined) parts[c.kind].push(roundCents(l.quantity * c.quantity * unitaire));
                if (c.kind === 'MAIN_OEUVRE') heures += l.quantity * c.quantity;
            }
        } else {
            parts[l.kind as ComponentKind].push(l.totalCost);
            if (l.kind === 'MAIN_OEUVRE') heures += l.quantity;
        }
    }
    const parNature = Object.fromEntries(NATURES.map(n => [n, sumCents(parts[n])])) as CoutParNature;
    const vente = sumCents(lignes.map(l => l.totalHT));
    const cout = sumCents(NATURES.map(n => parNature[n]));
    const marge = roundCents(vente - cout);
    return { vente, cout, parNature, heures: Math.round(heures * 100) / 100, marge, tauxMarge: vente > 0 ? Math.round((marge / vente) * 10000) / 10000 : null };
}

/** Devis d'une affaire : ce qui en est gardé (le devis accepté est figé). */
export type DevisAffaire = BudgetDevis & { quoteId: string; number: string; version: number; title: string; mode: QuoteMode; acceptedAt?: string; rattacheLe: string };

/** Budget d'une affaire : somme de ses devis. */
export function budgetAffaire(devis: BudgetDevis[]): BudgetDevis {
    const parNature = zero();
    for (const d of devis) for (const n of NATURES) parNature[n] = roundCents(parNature[n] + (d.parNature?.[n] ?? 0));
    const vente = sumCents(devis.map(d => d.vente)), cout = sumCents(devis.map(d => d.cout));
    const marge = roundCents(vente - cout);
    return { vente, cout, parNature, heures: Math.round(devis.reduce((h, d) => h + d.heures, 0) * 100) / 100, marge, tauxMarge: vente > 0 ? Math.round((marge / vente) * 10000) / 10000 : null };
}

/** Segment analytique d'une affaire : « ZEN-AFF2026-0007 » → « AFF20260007 » (le code de la société est déjà en tête du code). */
export function segmentAffaire(codeAffaire: string): string {
    const i = codeAffaire.toUpperCase().indexOf('AFF');
    return segment(i >= 0 ? codeAffaire.slice(i) : codeAffaire);
}

/** Code analytique généré d'une affaire : code du client + affaire (« ZEN-LYO-LN-CLI00012-AFF20260007 »). */
export const codeAnalytiqueAffaire = (codeClient: string, codeAffaire: string) => `${codeClient}-${segmentAffaire(codeAffaire)}`;

export type FacturationAffaire = 'situations' | 'direct';
export const LIBELLE_FACTURATION: Record<FacturationAffaire, string> = { situations: 'Par situations', direct: 'Directe (acompte, solde, totalité)' };
