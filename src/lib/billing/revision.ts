import { calculateIndexValue } from '@/lib/calculations';
import type { Index, IndexValue, RevisionRule, ServiceInitialIndexValue } from '@/lib/types';

/**
 * Révision des prix des prestations (calcul pur).
 *
 * - **Source unique** : la règle de révision de la prestation (`revisionRuleId`) et ses valeurs de base (I0, avec
 *   leur mois). Sans règle : prix ferme. Les révisions portées par les sites ou les contrats ne sont pas appliquées.
 * - **Dates de révision** : tous les `revisionMonths` mois (12 par défaut) à partir de la date anniversaire
 *   (`revisionAnchor` « MM-JJ », sinon le jour du début du contrat). Le prix d'un jour est celui de la dernière
 *   révision à cette date ; une échéance qui chevauche une révision est coupée en deux. Avant la première date de
 *   révision qui suit le début du contrat : prix de base (sauf `revisionFromStart` : révisé dès le début).
 * - **Indices datés** : à une date de révision D, l'indice courant d'un indice est la moyenne des `nbMonths` mois
 *   consécutifs qui finissent `lagMonths` mois avant le mois de D (1 par défaut : « dernier mois avant la
 *   révision »). Un mois manquant bloque (aucun coefficient supposé). Le résultat ne dépend donc que de la date de
 *   révision : il est reproductible.
 * - **Coefficient** : FIXE = 1 ; MONO_MOIS et PONDERE_SIMPLE = Σ coeff × In / I0 ; PONDERE_A_B = a + b × Σ ;
 *   arrondi à `decimals` décimales (4 par défaut).
 */

export type RevisionIndexDetail = {
    code: string;
    /** Mois de l'indice courant (AAAA-MM), moyenne de leurs valeurs. */
    periods: string[];
    value: number;
    base: number;
    basePeriod: string;
};

export type RevisionSnapshot = {
    /** Date de révision (AAAA-MM-JJ). */
    date: string;
    coefficient: number;
    rule: string;
    indices: RevisionIndexDetail[];
};

export type RevisionConfig = {
    rule: RevisionRule;
    base: ServiceInitialIndexValue[];
    months: number;
    /** Premier jour de la série de révisions (date anniversaire dans l'année du début du contrat). */
    anchor: string;
    /** Début du contrat : avant la première révision qui le suit, prix de base (sauf `fromStart`). */
    start: string;
    fromStart: boolean;
};

const pad = (n: number) => String(n).padStart(2, '0');
const monthOf = (day: string) => day.slice(0, 7);
/** Mois (AAAA-MM) décalé de n mois. */
export function addMonthsToPeriod(period: string, n: number): string {
    const [y, m] = period.split('-').map(Number);
    const total = y * 12 + (m - 1) + n;
    return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}
const addMonthsDay = (day: string, n: number) => {
    const [y, m, d] = day.split('-').map(Number);
    const target = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`;
};

/** « MM-JJ » (ou « JJ/MM ») lu ; null si invalide. */
export function parseAnchor(text: string | undefined | null): string | null {
    const t = String(text ?? '').trim();
    let m = /^(\d{1,2})-(\d{1,2})$/.exec(t);
    let month: number, day: number;
    if (m) [month, day] = [Number(m[1]), Number(m[2])];
    else if ((m = /^(\d{1,2})\/(\d{1,2})$/.exec(t))) [day, month] = [Number(m[1]), Number(m[2])];
    else return null;
    if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(2001, month, 0)).getUTCDate()) return null;
    return `${pad(month)}-${pad(day)}`;
}

/** Configuration de révision d'une prestation ; null si prix ferme (pas de règle). */
export function revisionConfig(
    service: { revisionRuleId?: string; initialIndexValues?: ServiceInitialIndexValue[]; revisionMonths?: number; revisionAnchor?: string; revisionFromStart?: boolean },
    contractStart: string, rules: RevisionRule[],
): RevisionConfig | { error: string } | null {
    if (!service.revisionRuleId) return null;
    const rule = rules.find(r => r.id === service.revisionRuleId);
    if (!rule) return { error: 'règle de révision introuvable (paramétrage)' };
    const months = service.revisionMonths ?? 12;
    if (![1, 3, 6, 12].includes(months)) return { error: `révision tous les ${months} mois : 1, 3, 6 ou 12 attendu` };
    const anchorMd = service.revisionAnchor ? parseAnchor(service.revisionAnchor) : contractStart.slice(5);
    if (!anchorMd) return { error: `date anniversaire de révision « ${service.revisionAnchor} » invalide (MM-JJ)` };
    return {
        rule, base: service.initialIndexValues ?? [], months, anchor: `${contractStart.slice(0, 4)}-${anchorMd}`,
        start: contractStart, fromStart: !!service.revisionFromStart,
    };
}

/** Date de la révision en vigueur un jour donné (la dernière de la série à cette date). */
export function revisionDateAt(config: Pick<RevisionConfig, 'months' | 'anchor'>, day: string): string {
    let k = Math.floor(((Date.parse(day) - Date.parse(config.anchor)) / 86_400_000) / (config.months * 31)) - 1;
    while (addMonthsDay(config.anchor, (k + 1) * config.months) <= day) k++;
    while (addMonthsDay(config.anchor, k * config.months) > day) k--;
    return addMonthsDay(config.anchor, k * config.months);
}

/** Révision en vigueur un jour donné ; null : prix de base (avant la première révision qui suit le début du contrat). */
export function revisionInForce(config: Pick<RevisionConfig, 'months' | 'anchor' | 'start' | 'fromStart'>, day: string): string | null {
    const d = revisionDateAt(config, day);
    return d <= config.start && !config.fromStart ? null : d;
}

/** Dates de révision strictement comprises dans ]début, fin]. */
export function revisionDatesWithin(config: Pick<RevisionConfig, 'months' | 'anchor'>, start: string, end: string): string[] {
    const out: string[] = [];
    let d = revisionDateAt(config, start);
    for (let i = 0; i < 400; i++) {
        d = addMonthsDay(d, config.months);
        if (d > end) break;
        if (d > start) out.push(d);
    }
    return out;
}

/** Valeur d'un indice pour un mois : stockée, sinon calculée (indice calculé). */
function indexValueAt(index: Index | undefined, indexId: string, period: string, indices: Index[], values: IndexValue[]): number | null {
    const stored = values.find(v => v.indexId === indexId && v.period === period);
    if (stored) return stored.value;
    if (index?.type === 'calculated' && index.formula) return calculateIndexValue(index.formula, period, indices, values, index.decimals ?? 4);
    return null;
}

/** Coefficient de révision à une date ; erreur explicite si une donnée manque. */
export function revisionAt(config: RevisionConfig, date: string, indices: Index[], values: IndexValue[]): RevisionSnapshot | { error: string } {
    const { rule } = config;
    const decimals = rule.decimals ?? 4;
    if (rule.type === 'FIXE') return { date, coefficient: 1, rule: rule.code, indices: [] };
    const lag = rule.lagMonths ?? 1;
    const nb = Math.max(1, rule.nbMonths || 1);
    const last = addMonthsToPeriod(monthOf(date), -lag);
    const periods = Array.from({ length: nb }, (_, i) => addMonthsToPeriod(last, i - nb + 1));
    const details: RevisionIndexDetail[] = [];
    let weighted = 0;
    for (const ri of rule.indices) {
        const index = indices.find(i => i.id === ri.indexId);
        const code = index?.code ?? ri.indexId;
        const base = config.base.find(b => b.indexId === ri.indexId);
        if (!base || !(base.value > 0)) return { error: `valeur de base (I0) de l'indice ${code} non renseignée sur la prestation` };
        const monthly = periods.map(p => indexValueAt(index, ri.indexId, p, indices, values));
        const missing = periods.filter((_, i) => monthly[i] === null);
        if (missing.length) return { error: `indice ${code} sans valeur pour ${missing.join(', ')} (révision du ${date.split('-').reverse().join('/')})` };
        const value = (monthly as number[]).reduce((a, b) => a + b, 0) / nb;
        details.push({ code, periods, value: Math.round(value * 1e6) / 1e6, base: base.value, basePeriod: base.period });
        weighted += ri.coefficient * (value / base.value);
    }
    if (details.length === 0) return { error: `règle ${rule.code} sans indice` };
    const raw = rule.type === 'PONDERE_A_B' ? (rule.paramA ?? 0) + (rule.paramB ?? 1) * weighted : weighted;
    const factor = 10 ** decimals;
    return { date, coefficient: Math.round(raw * factor) / factor, rule: rule.code, indices: details };
}

/** Texte court du coefficient pour la facture. */
export function revisionText(r: RevisionSnapshot): string {
    const coef = r.coefficient.toLocaleString('fr-FR', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
    const idx = r.indices.map(i => `${i.code} ${i.periods.length > 1 ? `moy. ${i.periods[0]}→${i.periods[i.periods.length - 1]}` : i.periods[0]} : `
        + `${i.value.toLocaleString('fr-FR')} / base ${i.basePeriod} : ${i.base.toLocaleString('fr-FR')}`).join(' ; ');
    return `révision ${r.rule} du ${r.date.split('-').reverse().join('/')} ×${coef}${idx ? ` (${idx})` : ''}`;
}
