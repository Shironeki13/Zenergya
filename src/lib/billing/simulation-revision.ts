/**
 * Simulation de révision : effet d'une variation des indices sur ce qui sera facturé dans les mois à venir.
 *
 * - Scénario de référence, « indices constants » : chaque indice garde sa dernière valeur connue pour les mois non
 *   encore publiés.
 * - Scénario simulé : la dernière valeur connue de chaque indice est majorée (ou minorée) du pourcentage saisi, pour
 *   les mois non encore publiés. Les valeurs déjà publiées ne sont jamais modifiées.
 * - Dans les deux cas, le coefficient est calculé par la règle de la prestation (lib/billing/revision), aux dates de
 *   révision de son échéancier ; une révision déjà facturée garde son coefficient.
 * Seuls les forfaits révisables sont simulés (le P1 au compteur, au DJU ou en acompte suit ses propres formules).
 * Module sans dépendance serveur.
 */
import type { Index, IndexValue } from '@/lib/types';
import { addDays, billedUntil, billingItems, daysIn, echeancesOf, lineItemKeys, type BilledInvoice, type BillingInput } from './contract-billing';
import { addMonthsToPeriod, revisionAt, revisionDatesWithin, revisionInForce, type RevisionSnapshot } from './revision';
import { finDeMois } from './previsionnel';

/** Variation simulée par indice, en pourcentage (5 = +5 %). */
export type Hypotheses = Record<string, number>;

/** Dernière valeur publiée de chaque indice. */
export function dernieresValeurs(values: IndexValue[]): Map<string, { period: string; value: number }> {
    const m = new Map<string, { period: string; value: number }>();
    for (const v of values) { const d = m.get(v.indexId); if (!d || d.period < v.period) m.set(v.indexId, { period: v.period, value: v.value }); }
    return m;
}

/** Valeurs prolongées jusqu'à `jusquA` (AAAA-MM) : après la dernière publication, dernière valeur × (1 + hypothèse). */
export function prolonger(values: IndexValue[], jusquA: string, hypotheses: Hypotheses = {}): IndexValue[] {
    const out = [...values];
    for (const [indexId, d] of dernieresValeurs(values)) {
        const valeur = d.value * (1 + (hypotheses[indexId] ?? 0) / 100);
        for (let p = addMonthsToPeriod(d.period, 1); p <= jusquA; p = addMonthsToPeriod(p, 1)) out.push({ id: `sim:${indexId}:${p}`, indexId, period: p, value: valeur });
    }
    return out;
}

export type LigneSimulation = { mois: string; contractId: string; activite: string; base: number; simule: number };
export type RevisionAVenir = {
    contractId: string; cle: string; activite: string; site: string;
    /** Date de la révision (AAAA-MM-JJ). */
    date: string;
    /** Coefficient en vigueur avant cette révision (1 : prix de base). */
    avant: number;
    constant: number; simule: number;
    /** Montant annuel de base de la prestation. */
    annuel: number;
    indices: string[];
};
export type SimulationContrat = { lignes: LigneSimulation[]; revisions: RevisionAVenir[]; nonSimulables: string[]; indices: string[] };

const day = (v: unknown) => String(v ?? '').slice(0, 10);
const cents = (n: number) => Math.round(n * 100) / 100;

/** Simulation d'un contrat sur les `mois` donnés (le premier est le mois en cours). */
export function simulerContrat(contractId: string, input: BillingInput, invoices: BilledInvoice[], aujourdhui: string, mois: string[], hypotheses: Hypotheses): SimulationContrat {
    const { items, errors } = billingItems(input);
    const out: SimulationContrat = { lignes: [], revisions: [], nonSimulables: [], indices: [] };
    if (errors.length) { out.nonSimulables.push(...errors); return out; }
    const debut = day(input.contract.startDate);
    const fin = finDeMois(mois[mois.length - 1]);
    const billed = billedUntil(items, invoices);
    const indices: Index[] = input.indices ?? [];
    const publiees = input.indexValues ?? [];
    const constantes = prolonger(publiees, mois[mois.length - 1]);
    const simulees = prolonger(publiees, mois[mois.length - 1], hypotheses);
    // Révisions déjà facturées : coefficient figé.
    const figees = new Map<string, RevisionSnapshot>();
    for (const inv of invoices) {
        if (inv.status === 'cancelled' || inv.status === 'proforma' || inv.cancelledByCreditNoteId) continue;
        for (const l of inv.lineItems ?? []) if (l.revision) for (const k of lineItemKeys(l)) figees.set(`${k}|${l.revision.date}`, l.revision);
    }
    const cumul = new Map<string, LigneSimulation>();
    const utilises = new Set<string>();
    for (const item of items) {
        const config = item.revision;
        if (!config || item.p1Releve || item.p1Dju || item.p1Acompte || config.rule.type === 'FIXE') continue;
        const coef = (date: string | null, valeurs: IndexValue[]): number | string => {
            if (!date) return 1;
            const r = figees.get(`${item.key}|${date}`) ?? revisionAt(config, date, indices, valeurs);
            return 'error' in r ? r.error : r.coefficient;
        };
        let bloque: string | null = null;
        const vues = new Set<string>();
        for (const e of echeancesOf(item, debut, billed.get(item.key) ?? null, fin)) {
            const bornes = [e.start, ...revisionDatesWithin(config, e.start, e.end)];
            for (let k = 0; k < bornes.length && !bloque; k++) {
                const start = bornes[k], end = k + 1 < bornes.length ? addDays(bornes[k + 1], -1) : e.end;
                const date = revisionInForce(config, start);
                const [c0, c1] = [coef(date, constantes), coef(date, simulees)];
                if (typeof c0 === 'string' || typeof c1 === 'string') { bloque = String(typeof c0 === 'string' ? c0 : c1); break; }
                const exact = item.annual * (item.months / 12) * (daysIn(start, end) / e.nominalDays);
                const m = e.billableOn < `${mois[0]}-01` ? 'retard' : e.billableOn.slice(0, 7);
                const cle = `${m}|${item.activity.code}`;
                const c = cumul.get(cle) ?? { mois: m, contractId, activite: item.activity.code, base: 0, simule: 0 };
                c.base += exact * c0; c.simule += exact * c1;
                cumul.set(cle, c);
                // Révision à venir (pas encore facturée, datée d'aujourd'hui ou plus tard) : une ligne par date.
                if (date && date >= aujourdhui && !figees.has(`${item.key}|${date}`) && !vues.has(date)) {
                    vues.add(date);
                    const avant = coef(revisionInForce(config, addDays(date, -1)), constantes);
                    out.revisions.push({
                        contractId, cle: item.key, activite: item.activity.code, site: item.site.name, date,
                        avant: typeof avant === 'number' ? avant : 1, constant: c0, simule: c1, annuel: item.annual,
                        indices: config.rule.indices.map(i => i.indexId),
                    });
                }
            }
            if (bloque) break;
        }
        if (bloque) { out.nonSimulables.push(`${item.activity.code} sur le site ${item.site.name} : ${bloque}`); continue; }
        for (const i of config.rule.indices) utilises.add(i.indexId);
    }
    out.lignes = [...cumul.values()].map(l => ({ ...l, base: cents(l.base), simule: cents(l.simule) }));
    out.indices = [...utilises];
    return out;
}
