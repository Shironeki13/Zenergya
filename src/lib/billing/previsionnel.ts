/**
 * Prévisionnel de facturation : ce qui deviendra facturable mois par mois, d'après les échéanciers des contrats.
 *
 * - Une échéance est rangée dans le mois où elle devient facturable (terme : début de période si à échoir, lendemain
 *   de la fin si échu). Ce qui est déjà facturable et non facturé est compté à part, en « retard ».
 * - Forfait : montant de l'échéance, multiplié par le dernier coefficient de révision facturé pour la prestation
 *   (les révisions à venir ne sont pas devinées : voir la simulation de révision).
 * - P1 au compteur, au DJU ou en acompte : estimé à partir du montant annuel de la prestation quand il est renseigné,
 *   sinon signalé « non estimé » (la consommation n'est pas connue d'avance). Leur retard n'est pas chiffré.
 * Module sans dépendance serveur.
 */
import { billedUntil, billingItems, echeancesOf, lineItemKeys, type BilledInvoice, type BillingInput } from './contract-billing';

export type NatureMontant = 'forfait' | 'estime';
export type LignePrevision = {
    /** Mois où l'échéance devient facturable (AAAA-MM), ou « retard ». */
    mois: string;
    contractId: string; activite: string; montant: number; nature: NatureMontant;
};
export type PrevisionContrat = { lignes: LignePrevision[]; nonEstimees: number; erreurs: string[] };

const day = (v: unknown) => String(v ?? '').slice(0, 10);

/** Mois suivants (AAAA-MM), à partir du mois de `aujourdhui`. */
export function moisSuivants(aujourdhui: string, n: number): string[] {
    const [a, m] = aujourdhui.split('-').map(Number);
    return Array.from({ length: n }, (_, i) => { const t = a * 12 + (m - 1) + i; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; });
}
export function finDeMois(mois: string): string {
    const [a, m] = mois.split('-').map(Number);
    return `${mois}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** Dernier coefficient de révision facturé par prestation (clé d'élément → coefficient). */
export function derniersCoefficients(invoices: BilledInvoice[]): Map<string, number> {
    const vus = new Map<string, { date: string; coefficient: number }>();
    for (const inv of invoices) {
        if (inv.status === 'cancelled' || inv.status === 'proforma' || inv.cancelledByCreditNoteId) continue;
        for (const l of inv.lineItems ?? []) {
            if (!l.revision) continue;
            for (const k of lineItemKeys(l)) { const v = vus.get(k); if (!v || v.date <= l.revision.date) vus.set(k, { date: l.revision.date, coefficient: l.revision.coefficient }); }
        }
    }
    return new Map([...vus].map(([k, v]) => [k, v.coefficient]));
}

/** Prévision d'un contrat sur les `mois` donnés (le premier est le mois en cours). */
export function previsionContrat(contractId: string, input: BillingInput, invoices: BilledInvoice[], aujourdhui: string, mois: string[]): PrevisionContrat {
    const { items, errors } = billingItems(input);
    if (errors.length) return { lignes: [], nonEstimees: 0, erreurs: errors };
    const debut = day(input.contract.startDate);
    const billed = billedUntil(items, invoices);
    const coefs = derniersCoefficients(invoices);
    const fin = finDeMois(mois[mois.length - 1]);
    const cumul = new Map<string, LignePrevision>();
    let nonEstimees = 0;
    for (const item of items) {
        const variable = !!(item.p1Releve || item.p1Dju || item.p1Acompte);
        for (const e of echeancesOf(item, debut, billed.get(item.key) ?? null, fin)) {
            const base = variable ? (item.annual > 0 ? e.amount : null) : e.amount;
            if (base === null) { nonEstimees++; continue; }
            if (base === 0) continue;
            const m = e.billableOn < `${mois[0]}-01` ? 'retard' : e.billableOn.slice(0, 7);
            // P1 variable déjà exigible : non chiffré ici (hors saison, il ne donne lieu à aucune facture) ; le montant
            // réel est dans la file « À facturer aujourd'hui ».
            if (variable && m === 'retard') continue;
            const nature: NatureMontant = variable ? 'estime' : 'forfait';
            const cle = `${m}|${item.activity.code}|${nature}`;
            const montant = base * (variable ? 1 : coefs.get(item.key) ?? 1);
            const c = cumul.get(cle);
            if (c) c.montant += montant; else cumul.set(cle, { mois: m, contractId, activite: item.activity.code, montant, nature });
        }
    }
    void aujourdhui;
    return { lignes: [...cumul.values()].map(l => ({ ...l, montant: Math.round(l.montant * 100) / 100 })), nonEstimees, erreurs: [] };
}

export type LigneAgregee = { mois: string; agence: string; activite: string; montant: number; estime: number };

/** Tableau croisé : une ligne par valeur de l'axe (agence ou activité), une colonne par mois, totaux. */
export function croiser(lignes: LigneAgregee[], axe: 'agence' | 'activite', mois: string[]): { lignes: { cle: string; parMois: number[]; retard: number; total: number; estime: number }[]; totaux: number[]; retard: number; total: number; estime: number } {
    const par = new Map<string, { parMois: number[]; retard: number; estime: number }>();
    for (const l of lignes) {
        const k = l[axe] || '—';
        const r = par.get(k) ?? { parMois: mois.map(() => 0), retard: 0, estime: 0 };
        const i = mois.indexOf(l.mois);
        if (l.mois === 'retard') r.retard += l.montant; else if (i >= 0) { r.parMois[i] += l.montant; r.estime += l.estime; } else continue;
        par.set(k, r);
    }
    const arr = (n: number) => Math.round(n * 100) / 100;
    const out = [...par].map(([cle, r]) => ({ cle, parMois: r.parMois.map(arr), retard: arr(r.retard), total: arr(r.parMois.reduce((a, b) => a + b, 0)), estime: arr(r.estime) }))
        .sort((a, b) => b.total + b.retard - (a.total + a.retard) || a.cle.localeCompare(b.cle, 'fr'));
    return {
        lignes: out, totaux: mois.map((_, i) => arr(out.reduce((a, r) => a + r.parMois[i], 0))),
        retard: arr(out.reduce((a, r) => a + r.retard, 0)), total: arr(out.reduce((a, r) => a + r.total, 0)), estime: arr(out.reduce((a, r) => a + r.estime, 0)),
    };
}
