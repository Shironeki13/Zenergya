/**
 * Budget d'un contrat : par année civile et par activité, chiffre d'affaires prévu et dépenses prévues par nature
 * (énergie, achats, main-d'œuvre, sous-traitance), comparés au réalisé et à l'atterrissage de l'année.
 *
 * - Budget **initial** (figé par un administrateur) et budget **révisé** (modifiable) ; avant le gel, les deux sont
 *   le même.
 * - **Réalisé** : chiffre d'affaires des factures moins avoirs, au prorata de la période facturée comprise dans
 *   l'année ; dépenses à leur date (commandes engagées, heures validées) ou au prorata de leur période (factures
 *   d'énergie).
 * - **Atterrissage** : chiffre d'affaires réalisé + reste à facturer de l'année (échéancier) ; pour chaque nature de
 *   dépense, le plus grand du budget révisé et du réalisé (comme le coût à terminaison des affaires : un dépassement
 *   est constaté, une économie ne l'est qu'en fin d'année).
 * Module sans dépendance serveur.
 */

export const NATURES_DEPENSE = ['energie', 'achats', 'mainOeuvre', 'sousTraitance'] as const;
export type NatureDepense = typeof NATURES_DEPENSE[number];
export const LIBELLE_NATURE: Record<NatureDepense, string> = { energie: 'Énergie', achats: 'Achats', mainOeuvre: "Main-d'œuvre", sousTraitance: 'Sous-traitance' };

export type Montants = { ca: number } & Record<NatureDepense, number>;
export type LigneBudget = Montants & { activite: string };

export const VIDE: Montants = { ca: 0, energie: 0, achats: 0, mainOeuvre: 0, sousTraitance: 0 };
export const NON_AFFECTE = '—';

const c2 = (n: number) => Math.round(n * 100) / 100;
const euros = (n: number) => `${n > 0 ? '+' : ''}${c2(n).toLocaleString('fr-FR')} €`.replace(/[\u202f\u00a0]/g, ' ');
const depenses = (m: Montants) => NATURES_DEPENSE.reduce((s, n) => s + m[n], 0);

/** Part d'un montant dont la période [debut, fin] tombe dans l'année (au prorata des jours, bornes incluses). */
export function partAnnee(debut: string, fin: string, montant: number, annee: number): number {
    const d = Date.parse(`${debut}T00:00:00Z`), f = Date.parse(`${fin}T00:00:00Z`);
    if (!(f >= d)) return 0;
    const a = Date.parse(`${annee}-01-01T00:00:00Z`), b = Date.parse(`${annee}-12-31T00:00:00Z`);
    const dedans = Math.min(f, b) - Math.max(d, a);
    if (dedans < 0) return 0;
    return (montant * (dedans / 86_400_000 + 1)) / ((f - d) / 86_400_000 + 1);
}

/** Lignes saisies : montants positifs ou nuls, deux décimales, une ligne par activité. Lève une erreur lisible. */
export function normaliserLignes(lignes: unknown, activitesConnues: string[]): LigneBudget[] {
    if (!Array.isArray(lignes)) throw new Error('Budget illisible.');
    const vues = new Set<string>();
    return lignes.map((brut, i) => {
        const l = (brut ?? {}) as Record<string, unknown>;
        const activite = String(l.activite ?? '').trim();
        if (!activitesConnues.includes(activite)) throw new Error(`Ligne ${i + 1} : activité « ${activite} » hors du contrat.`);
        if (vues.has(activite)) throw new Error(`Activité ${activite} saisie deux fois.`);
        vues.add(activite);
        const m = Object.fromEntries((['ca', ...NATURES_DEPENSE] as const).map(k => {
            const v = Number(String(l[k] ?? 0).replace(/\s/g, '').replace(',', '.'));
            if (!Number.isFinite(v) || v < 0) throw new Error(`${activite} : montant invalide (${k}).`);
            return [k, c2(v)];
        })) as Montants;
        return { activite, ...m };
    }).filter(l => l.ca || depenses(l));
}

export type LigneSynthese = {
    activite: string;
    budgetInitial: Montants | null;
    budget: Montants;
    realise: Montants;
    atterrissage: Montants;
    /** Reste à facturer sur l'année (échéancier). */
    resteCA: number;
    marge: { initial: number | null; budget: number; realise: number; atterrissage: number };
    /** Écart de marge atterrissage − budget révisé (négatif : dérive). */
    ecartMarge: number;
    alertes: string[];
};

/** Seuils de dérive : marge à l'atterrissage inférieure au budget de plus de 5 % du CA budgété, ou négative. */
export const SEUIL_DERIVE = 0.05;

export function synthese(p: {
    activites: string[];
    budget: LigneBudget[]; initial: LigneBudget[] | null;
    realise: Record<string, Montants>; resteCA: Record<string, number>;
}): { lignes: LigneSynthese[]; total: LigneSynthese } {
    const codes = [...new Set([...p.activites, ...p.budget.map(l => l.activite), ...Object.keys(p.realise), ...Object.keys(p.resteCA)])]
        .filter(a => a !== NON_AFFECTE || Object.values(p.realise[a] ?? VIDE).some(Boolean));
    const de = (lignes: LigneBudget[] | null, a: string): Montants | null => {
        if (!lignes) return null;
        const l = lignes.find(x => x.activite === a);
        return l ? { ca: l.ca, energie: l.energie, achats: l.achats, mainOeuvre: l.mainOeuvre, sousTraitance: l.sousTraitance } : { ...VIDE };
    };
    const ligne = (activite: string, budget: Montants, initial: Montants | null, realise: Montants, reste: number): LigneSynthese => {
        const atterrissage: Montants = { ca: c2(realise.ca + reste), ...Object.fromEntries(NATURES_DEPENSE.map(n => [n, c2(Math.max(budget[n], realise[n]))])) as Record<NatureDepense, number> };
        const marge = {
            initial: initial ? c2(initial.ca - depenses(initial)) : null,
            budget: c2(budget.ca - depenses(budget)), realise: c2(realise.ca - depenses(realise)), atterrissage: c2(atterrissage.ca - depenses(atterrissage)),
        };
        const ecartMarge = c2(marge.atterrissage - marge.budget);
        const alertes = [
            ...NATURES_DEPENSE.filter(n => budget[n] > 0 && realise[n] > budget[n]).map(n => `${LIBELLE_NATURE[n]} : réalisé au-delà du budget (${euros(realise[n] - budget[n])})`),
            ...NATURES_DEPENSE.filter(n => budget[n] === 0 && realise[n] > 0 && (budget.ca > 0 || depenses(budget) > 0)).map(n => `${LIBELLE_NATURE[n]} : dépenses sans budget`),
            ...(budget.ca > 0 && atterrissage.ca < budget.ca * (1 - SEUIL_DERIVE) ? [`Chiffre d'affaires attendu sous le budget (${euros(atterrissage.ca - budget.ca)})`] : []),
            // Marge : seulement là où il y a un budget ou des ventes (le réalisé non affecté n'en a pas).
            ...(marge.atterrissage < 0 && (budget.ca > 0 || atterrissage.ca > 0) ? ['Marge négative à l\'atterrissage'] : budget.ca > 0 && ecartMarge < -SEUIL_DERIVE * budget.ca ? ['Marge en dérive par rapport au budget'] : []),
        ];
        return { activite, budgetInitial: initial, budget, realise, atterrissage, resteCA: c2(reste), marge, ecartMarge, alertes };
    };
    const lignes = codes.map(a => ligne(a, de(p.budget, a)!, de(p.initial, a), { ...VIDE, ...(p.realise[a] ?? {}) }, p.resteCA[a] ?? 0));
    const somme = (f: (l: LigneSynthese) => Montants | null): Montants | null => {
        const ms = lignes.map(f);
        if (ms.some(m => m === null)) return null;
        return Object.fromEntries((['ca', ...NATURES_DEPENSE] as const).map(k => [k, c2(ms.reduce((s, m) => s + m![k], 0))])) as Montants;
    };
    const totalBudget = somme(l => l.budget)!, totalRealise = somme(l => l.realise)!;
    const total = ligne('Total', totalBudget, p.initial ? somme(l => l.budgetInitial) : null, totalRealise, lignes.reduce((s, l) => s + l.resteCA, 0));
    // L'atterrissage total est la somme des activités (le max se prend activité par activité).
    total.atterrissage = somme(l => l.atterrissage)!;
    total.marge.atterrissage = c2(total.atterrissage.ca - depenses(total.atterrissage));
    total.ecartMarge = c2(total.marge.atterrissage - total.marge.budget);
    total.alertes = [];
    return { lignes, total };
}

/** Activité qui porte l'énergie P1 du contrat : P1 (chauffage) d'abord, sinon la première activité P1. */
export function activiteEnergie(activites: { code: string; type?: string }[]): string | null {
    const p1 = activites.filter(a => a.type === 'P1' || /^P1/i.test(a.code)).map(a => a.code).sort();
    return p1.find(c => /^P1C?$/i.test(c)) ?? p1.find(c => !/^P1[EA]/i.test(c) && !c.includes('€')) ?? p1[0] ?? null;
}
