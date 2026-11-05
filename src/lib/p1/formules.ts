import { PERIODICITES_REVISION, UNITES_PRIX, type ElementPanier, type Energie, type PeriodiciteRevision, type TermeRevision } from '@/lib/p1/parametrage';

/**
 * Formules de révision du prix P1, comme le moteur P1 (moteur/revision.py, RG-24 à RG-44).
 *
 * - Une formule appartient au contrat, pour un usage (chauffage, ECS) et un périmètre (tout le contrat, des
 *   énergies, des sites : le plus précis l'emporte). Ses versions sont datées (avenants).
 * - **Prix de base K0 : celui du site** (décision du moteur du 27/10/2026), jamais celui de la formule.
 * - Forme **A** (RG-25) : coefficient = Σ aᵢ × Iᵢ / Iᵢ₀ (p0 compte pour son poids, ratio 1 ; poids sommant à 100 %).
 *   Forme **B** (RG-26) : coefficient = Σ cᵢ × Iᵢ / Σ cᵢ × Iᵢ₀ (p0 identique au numérateur et au dénominateur).
 * - Un terme suit un indice, un **panier** (somme d'indices et de valeurs fixes pondérés) ou, pour la molécule en
 *   régime fixe, le prix négocié.
 * - **Valeur d'un indice pour un mois** (RG-38) : la dernière publiée jusqu'à ce mois ; reportée d'un mois antérieur,
 *   elle rend le prix provisoire (alerte au-delà du seuil de report) ; aucune : non calculable (RG-40).
 * - **Contrôle à M0** (RG-41) : le coefficient vaut 1 au mois M0, sauf valeurs de base contractuelles (signalé).
 * - **Périodicité** (RG-44) : prix mensuel, ou un prix par exercice (moyenne au prorata des jours, pondérée par les
 *   DJU, ou prix du mois de clôture).
 */

export type FormuleVersion = {
    forme: 'A' | 'B';
    mode: 'standard' | 'derogatoire';
    baseEnergetique: 'PCS' | 'PCI';
    unitePrix: typeof UNITES_PRIX[number];
    /** Mois de base M0 (AAAA-MM) ; null : à dire dans `m0Manquante`. */
    dateM0: string | null;
    m0Manquante: string | null;
    regimeKmol: 'variable' | 'fixe';
    prixMoleculeNegocie: number | null;
    /** Prix non révisable (RG-42) : le prix de base s'applique tel quel. */
    prixFixe: boolean;
    periodicite: PeriodiciteRevision;
    termes: TermeRevision[];
};

export type PerimetreFormule = { type: 'contrat' } | { type: 'energies'; energies: Energie[] } | { type: 'sites'; siteIds: string[] };

export const TERMES_GAZ = ['p0', 'Kmol', 'TVD', 'Accise', 'CEE', 'CPB', 'Infra'];

const n = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));

// --- Termes en texte (imports) ---

/**
 * « p0=0,15 ; Kmol=0,60*PEGMA@25,30 ; CEE=0,05*(1*C2E_CL+0,8*C2E_PR+0,5*#2,1)@4,5! ; ~CPB=0,1*CPB@3 »
 * code=coefficient[*INDICE | *(panier)][@valeur de base M0][!] ; « ! » : base contractuelle ; « ~ » : terme inactif ;
 * panier : coefficient*INDICE ou coefficient*#valeur fixe, séparés par « + ».
 */
export function parseTermes(text: string): TermeRevision[] | string {
    const out: TermeRevision[] = [];
    for (const raw of text.split(';').map(p => p.trim()).filter(Boolean)) {
        const m = /^(~?)([A-Za-z][\w]*)\s*=\s*([\d.,\s]+)(?:\*\s*(\([^)]*\)|[A-Za-z][\w.-]*))?\s*(?:@\s*([\d.,\s]+))?\s*(!?)$/.exec(raw);
        if (!m) return `terme « ${raw} » illisible : code=coefficient*INDICE@base (voir la notice).`;
        let serie: string | null = null;
        let panier: ElementPanier[] | null = null;
        if (m[4]?.startsWith('(')) {
            panier = [];
            for (const el of m[4].slice(1, -1).split('+').map(e => e.trim()).filter(Boolean)) {
                const e = /^([\d.,\s]+)\*\s*(#([\d.,\s]+)|[A-Za-z][\w.-]*)$/.exec(el);
                if (!e) return `élément de panier « ${el} » illisible : coefficient*INDICE ou coefficient*#valeur.`;
                panier.push({ coefficient: n(e[1]), serie: e[3] ? null : e[2], valeurFixe: e[3] ? n(e[3]) : null });
            }
        } else if (m[4]) serie = m[4];
        out.push({
            code: m[2], coefficient: n(m[3]), serie, valeurBaseM0: m[5] ? n(m[5]) : null, baseContractuelle: m[6] === '!',
            unite: 'EUR/MWh', actif: m[1] !== '~', panier,
        });
    }
    return out.length ? out : 'aucun terme.';
}

const num = (x: number) => String(x).replace('.', ',');
export const formatTermes = (termes: TermeRevision[]) => termes.map(t => {
    const ind = t.panier ? `*(${t.panier.map(e => `${num(e.coefficient)}*${e.serie ?? `#${num(e.valeurFixe ?? 0)}`}`).join('+')})` : t.serie ? `*${t.serie}` : '';
    return `${t.actif ? '' : '~'}${t.code}=${num(t.coefficient)}${ind}${t.valeurBaseM0 !== null ? `@${num(t.valeurBaseM0)}` : ''}${t.baseContractuelle ? '!' : ''}`;
}).join(' ; ');

// --- Contrôles d'une version (RG-24 à RG-42) ---

export function validateFormule(v: FormuleVersion, indexCodes: string[]): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!['A', 'B'].includes(v.forme)) errors.push('Forme A (somme de rapports) ou B (rapport des sommes).');
    if (!PERIODICITES_REVISION.includes(v.periodicite)) errors.push(`Périodicité : ${PERIODICITES_REVISION.join(', ')}.`);
    if (!UNITES_PRIX.includes(v.unitePrix)) errors.push(`Unité du prix : ${UNITES_PRIX.join(', ')}.`);
    if (v.dateM0 !== null && !/^\d{4}-\d{2}$/.test(v.dateM0)) errors.push('Mois M0 : AAAA-MM.');
    if (v.dateM0 === null && !v.m0Manquante?.trim()) errors.push('Mois M0 inconnu : dites ce qui manque (il ne se suppose pas).');
    if (v.regimeKmol === 'fixe' && !(v.prixMoleculeNegocie && v.prixMoleculeNegocie > 0)) errors.push('Molécule en régime fixe : prix négocié obligatoire.');
    if (v.prixFixe) return { errors, warnings };
    const actifs = v.termes.filter(t => t.actif);
    if (actifs.length === 0) { warnings.push('Aucun terme actif : la formule documente le marché, aucun prix révisé n\'en sort.'); return { errors, warnings }; }
    const known = new Set(indexCodes.map(c => c.toUpperCase()));
    const codes = actifs.map(t => t.code);
    if (new Set(codes).size !== codes.length) errors.push('Un terme figure deux fois.');
    for (const t of actifs) {
        if (!Number.isFinite(t.coefficient)) errors.push(`Terme ${t.code} : coefficient invalide.`);
        const kmolFixe = t.code === 'Kmol' && v.regimeKmol === 'fixe';
        if (t.code !== 'p0' && !kmolFixe && !t.serie && !t.panier?.length) errors.push(`Terme ${t.code} : indice ou panier obligatoire.`);
        for (const s of [t.serie, ...(t.panier ?? []).map(e => e.serie)].filter((x): x is string => !!x)) {
            if (!known.has(s.toUpperCase())) errors.push(`Terme ${t.code} : indice « ${s} » inconnu (paramétrage des indices).`);
        }
        for (const e of t.panier ?? []) if (e.serie === null && e.valeurFixe === null) errors.push(`Terme ${t.code} : élément de panier sans indice ni valeur.`);
        if (t.code !== 'p0' && v.dateM0 !== null && t.valeurBaseM0 === null) errors.push(`Terme ${t.code} : valeur de base M0 obligatoire.`);
        if (t.valeurBaseM0 !== null && !(t.valeurBaseM0 > 0)) errors.push(`Terme ${t.code} : valeur de base M0 strictement positive.`);
    }
    if (v.forme === 'A') {
        const total = actifs.reduce((s, t) => s + t.coefficient, 0);
        if (Math.abs(total - 1) > 1e-6) errors.push(`Forme A : pondérations sommant à ${+(total * 100).toFixed(4)} % au lieu de 100 %.`);
    } else {
        const p0 = actifs.find(t => t.code === 'p0');
        if (p0 && p0.valeurBaseM0 === null) errors.push('Forme B : p0 a besoin de sa valeur (identique au numérateur et au dénominateur).');
        if (new Set(actifs.map(t => t.unite)).size > 1) errors.push('Forme B : termes dans des unités différentes (RG-29).');
    }
    return { errors, warnings };
}

// --- Indices d'un mois (RG-38, RG-40) ---

export type SerieValues = Map<string, { period: string; value: number }[]>;
export type IndexValueAt = { value: number; period: string; reportMois: number } | null;

/** Dernière valeur publiée jusqu'au mois demandé (report signalé), ou null. */
export function serieAt(series: SerieValues, code: string, mois: string): IndexValueAt {
    const list = series.get(code.toUpperCase()) ?? [];
    let best: { period: string; value: number } | null = null;
    for (const v of list) if (v.period <= mois && (!best || v.period > best.period)) best = v;
    if (!best) return null;
    const [y, m] = mois.split('-').map(Number);
    const [by, bm] = best.period.split('-').map(Number);
    return { value: best.value, period: best.period, reportMois: (y - by) * 12 + (m - bm) };
}

export type LigneCoefficient = { terme: string; ponderation: number; indice: string | null; valeurMois: number | null; valeurBase: number | null; ratio: number | null; periode: string | null };
export type CoefficientResult = { coefficient: number; provisoire: boolean; alertes: string[]; lignes: LigneCoefficient[] } | { causes: string[]; lignes: LigneCoefficient[] };

function valeurTerme(t: TermeRevision, v: FormuleVersion, series: SerieValues, mois: string) {
    if (t.code === 'Kmol' && v.regimeKmol === 'fixe') return { value: v.prixMoleculeNegocie!, period: null, report: 0, causes: [] as string[], indice: 'prix négocié' };
    const els: ElementPanier[] = t.panier?.length ? t.panier : t.serie ? [{ serie: t.serie, valeurFixe: null, coefficient: 1 }] : [];
    if (els.length === 0) return { value: null, period: null, report: 0, causes: [`terme ${t.code} sans indice`], indice: null };
    let total = 0;
    let report = 0;
    const periods: string[] = [];
    const causes: string[] = [];
    for (const e of els) {
        if (e.serie === null) { total += e.coefficient * (e.valeurFixe ?? 0); continue; }
        const at = serieAt(series, e.serie, mois);
        if (!at) { causes.push(`aucune valeur de l'indice ${e.serie} jusqu'à ${mois}`); continue; }
        total += e.coefficient * at.value;
        report = Math.max(report, at.reportMois);
        periods.push(at.period);
    }
    const period = periods.length ? periods.sort()[0] : null;
    const indice = t.panier?.length ? `Σ(${t.panier.map(e => e.serie ?? 'fixe').join(' + ')})` : t.serie;
    return causes.length ? { value: null, period, report, causes, indice } : { value: total, period, report, causes, indice };
}

/** Coefficient de révision d'un mois (AAAA-MM) et détail par terme. */
export function coefficientRevision(v: FormuleVersion, mois: string, series: SerieValues, seuilReport = 3): CoefficientResult {
    const lignes: LigneCoefficient[] = [];
    const actifs = v.termes.filter(t => t.actif);
    if (actifs.length === 0) return { causes: ['formule sans terme actif'], lignes };
    const causes: string[] = [];
    const alertes: string[] = [];
    let provisoire = false;
    const vals = actifs.map(t => {
        if (t.code === 'p0') return { t, value: t.valeurBaseM0 ?? null, period: null as string | null, report: 0, indice: null as string | null };
        const r = valeurTerme(t, v, series, mois);
        causes.push(...r.causes);
        if (r.report > 0) {
            provisoire = true;
            if (r.report > seuilReport) alertes.push(`indice du terme ${t.code} reporté de ${r.report} mois : prix provisoire`);
        }
        return { t, value: r.value, period: r.period, report: r.report, indice: r.indice };
    });
    let coefficient: number;
    if (v.forme === 'A') {
        coefficient = 0;
        for (const x of vals) {
            const fixe = x.t.code === 'p0';
            const ratio = fixe ? 1 : x.value !== null && x.t.valeurBaseM0 ? x.value / x.t.valeurBaseM0 : null;
            if (!fixe && !x.t.valeurBaseM0) causes.push(`valeur de base M0 absente pour le terme ${x.t.code}`);
            lignes.push({ terme: x.t.code, ponderation: x.t.coefficient, indice: x.indice, valeurMois: x.t.code === 'p0' ? null : x.value, valeurBase: x.t.valeurBaseM0, ratio, periode: x.period });
            if (ratio !== null) coefficient += x.t.coefficient * ratio;
        }
    } else {
        let num = 0, den = 0;
        for (const x of vals) {
            if (x.t.valeurBaseM0 === null) { causes.push(`terme ${x.t.code} sans valeur de base M0 au dénominateur`); continue; }
            const value = x.t.code === 'p0' ? x.t.valeurBaseM0 : x.value;
            lignes.push({ terme: x.t.code, ponderation: x.t.coefficient, indice: x.indice, valeurMois: value, valeurBase: x.t.valeurBaseM0, ratio: value !== null ? value / x.t.valeurBaseM0 : null, periode: x.period });
            if (value === null) continue;
            num += x.t.coefficient * value;
            den += x.t.coefficient * x.t.valeurBaseM0;
        }
        if (!causes.length && den === 0) causes.push('dénominateur nul');
        coefficient = den ? num / den : NaN;
    }
    if (causes.length) return { causes: [...new Set(causes)], lignes };
    return { coefficient, provisoire, alertes, lignes };
}

/** RG-41 : le coefficient vaut 1 au mois M0 (sauf base contractuelle : signalé, non bloquant). */
export function controleM0(v: FormuleVersion, series: SerieValues): { error?: string; warning?: string } {
    if (v.prixFixe || !v.dateM0) return {};
    const r = coefficientRevision(v, v.dateM0, series, Infinity);
    if ('causes' in r || Math.abs(r.coefficient - 1) <= 1e-4) return {};
    const contractuelles = v.termes.filter(t => t.actif && t.baseContractuelle).map(t => t.code);
    const msg = `coefficient de ${r.coefficient.toFixed(6)} au mois M0 (${v.dateM0})`;
    return contractuelles.length
        ? { warning: `${msg} : valeurs de base contractuelles (${contractuelles.join(', ')}), conforme au marché` }
        : { error: `${msg} au lieu de 1 : formule ou valeurs de base erronées` };
}

export type PrixMois = { prix: number; coefficient: number; provisoire: boolean; alertes: string[]; lignes: LigneCoefficient[] } | { causes: string[] };

/** RG-24 / RG-42 : prix révisé d'un mois = prix de base du site × coefficient. */
export function prixRevise(v: FormuleVersion, prixBase: number | null, mois: string, series: SerieValues, seuilReport = 3): PrixMois {
    if (prixBase === null || !(prixBase > 0)) return { causes: ['prix de base du site non renseigné'] };
    if (v.prixFixe) return { prix: prixBase, coefficient: 1, provisoire: false, alertes: [], lignes: [] };
    if (v.dateM0 === null) return { causes: [`valeurs de base à M0 non renseignées — ${v.m0Manquante ?? ''}`.trim()] };
    const c = coefficientRevision(v, mois, series, seuilReport);
    if ('causes' in c) return { causes: c.causes };
    const prix = prixBase * c.coefficient;
    if (!(prix > 0)) return { causes: ['prix révisé négatif ou nul'] };
    return { prix, coefficient: c.coefficient, provisoire: c.provisoire, alertes: c.alertes, lignes: c.lignes };
}

/**
 * RG-44 : prix de chaque mois d'un exercice selon la périodicité. Révision annuelle : un seul prix pour l'exercice,
 * moyenne des prix mensuels pondérée par les jours (annuel_temps) ou les DJU (annuel_dju, moyenne simple si les
 * DJU sont nuls), ou prix du dernier mois (annuel_cloture).
 */
export function prixExercice(prixMensuels: Record<string, PrixMois>, mois: string[], periodicite: PeriodiciteRevision, dju: Record<string, number> = {}): Record<string, PrixMois> {
    if (periodicite === 'mensuel') return Object.fromEntries(mois.map(m => [m, prixMensuels[m] ?? { causes: ['prix du mois non calculé'] }]));
    const causes = mois.flatMap(m => { const p = prixMensuels[m]; return !p ? ['prix du mois non calculé'] : 'causes' in p ? p.causes : []; });
    if (causes.length) return Object.fromEntries(mois.map(m => [m, { causes: [...new Set(causes)] }]));
    const ok = (m: string) => prixMensuels[m] as Extract<PrixMois, { prix: number }>;
    let prix: number;
    if (periodicite === 'annuel_cloture') prix = ok(mois[mois.length - 1]).prix;
    else {
        const poids = Object.fromEntries(mois.map(m => [m, periodicite === 'annuel_dju' ? dju[m] ?? 0 : new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate()]));
        const den = mois.reduce((s, m) => s + poids[m], 0);
        prix = den > 0 ? mois.reduce((s, m) => s + ok(m).prix * poids[m], 0) / den : mois.reduce((s, m) => s + ok(m).prix, 0) / mois.length;
    }
    const provisoire = mois.some(m => ok(m).provisoire);
    return Object.fromEntries(mois.map(m => [m, { ...ok(m), prix, coefficient: prix / (ok(m).prix / ok(m).coefficient), provisoire }]));
}
