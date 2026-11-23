import { arrondirCoefficient, coefficientRevision, type FormuleVersion, type SerieValues } from '@/lib/p1/formules';
import type { PeriodeReference } from '@/lib/p1/parametrage';

/**
 * Prix annuel d'une formule P1 (périodicité annuelle, RG-44) pour un site facturé « MTI au DJU ».
 *
 * En cours d'exercice, chaque mois est facturé au C/C0 du mois (le prix de l'exercice n'est connu qu'à sa fin).
 * L'exercice clos, le P1 dû est recalculé au **C/C0 de l'exercice** : moyenne des C/C0 mensuels pondérée par les DJU
 * facturés (annuel_dju) ou par les jours facturés (annuel_temps), ou C/C0 du dernier mois de l'exercice
 * (annuel_cloture). Chaque partie facturée garde sa base, ses DJU contractuels et ses DJU : seul le coefficient change.
 * L'écart avec ce qui a été facturé se régularise (facture ou avoir).
 */

export type Exercice = { libelle: string; debut: string; fin: string };

const mois2 = (n: number) => String(n).padStart(2, '0');

/** Exercice (mois de début et de fin, AAAA-MM) qui contient un mois : année civile, ou saison de chauffe (juillet → juin). */
export function exerciceDe(mois: string, periode: PeriodeReference): Exercice {
    const y = Number(mois.slice(0, 4)), m = Number(mois.slice(5, 7));
    if (periode === 'annee_civile') return { libelle: String(y), debut: `${y}-01`, fin: `${y}-12` };
    const debut = m >= 7 ? y : y - 1;
    return { libelle: `${debut}-${debut + 1}`, debut: `${debut}-07`, fin: `${debut + 1}-06` };
}

/** Partie facturée au DJU (un mois d'une ligne de facture). */
export type PartieFacturee = { mois: string; debut: string; fin: string; dju: number; base: number; djuReference: number; montant: number };

export type PrixAnnuel = {
    exercice: string;
    periodicite: 'annuel_dju' | 'annuel_temps' | 'annuel_cloture';
    /** C/C0 de l'exercice, arrondi comme la formule. */
    coefficient: number;
    dju: number;
    /** P1 dû au prix de l'exercice, et facturé au prix du mois. */
    du: number;
    facture: number;
    mois: { mois: string; dju: number; coefficient: number; facture: number; du: number }[];
};

const cents = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const jours = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
export const LIBELLE_PERIODICITE: Record<PrixAnnuel['periodicite'], string> = {
    annuel_dju: 'moyenne des mois pondérée par les DJU', annuel_temps: 'moyenne des mois pondérée par les jours', annuel_cloture: 'mois de clôture de l\'exercice',
};

export function prixAnnuel(p: { exercice: Exercice; version: FormuleVersion; series: SerieValues; parties: PartieFacturee[] }): PrixAnnuel | string {
    const { version, exercice } = p;
    const periodicite = version.periodicite;
    if (periodicite === 'mensuel') return 'la formule est à prix mensuel';
    const parties = p.parties.filter(x => x.mois >= exercice.debut && x.mois <= exercice.fin).sort((a, b) => a.debut.localeCompare(b.debut));
    if (parties.length === 0) return `aucune facture au DJU sur l'exercice ${exercice.libelle}`;
    const brut = { ...version, arrondiCoefficient: null };
    const mensuels = new Map<string, number>();
    const causes: string[] = [];
    for (const m of new Set([...parties.map(x => x.mois), ...(periodicite === 'annuel_cloture' ? [exercice.fin] : [])])) {
        const c = version.prixFixe ? { coefficient: 1 } : coefficientRevision(brut, m, p.series);
        if ('causes' in c) causes.push(...c.causes.map(x => `${m.slice(5)}/${m.slice(0, 4)} : ${x}`));
        else mensuels.set(m, c.coefficient);
    }
    if (causes.length) return [...new Set(causes)].join(' ; ');
    let coefficient: number;
    if (periodicite === 'annuel_cloture') coefficient = mensuels.get(exercice.fin)!;
    else {
        const poids = (x: PartieFacturee) => (periodicite === 'annuel_dju' ? x.dju : jours(x.debut, x.fin));
        const total = parties.reduce((s, x) => s + poids(x), 0);
        if (!(total > 0)) return `aucun DJU facturé sur l'exercice ${exercice.libelle}`;
        coefficient = parties.reduce((s, x) => s + mensuels.get(x.mois)! * poids(x), 0) / total;
    }
    coefficient = arrondirCoefficient(coefficient, version.arrondiCoefficient);
    const mois = new Map<string, PrixAnnuel['mois'][number]>();
    for (const x of parties) {
        if (!(x.djuReference > 0)) return 'DJU de référence (contractuels) absents d\'une ligne facturée';
        const m = mois.get(x.mois) ?? { mois: x.mois, dju: 0, coefficient: mensuels.get(x.mois)!, facture: 0, du: 0 };
        m.dju = Math.round((m.dju + x.dju) * 100) / 100;
        m.facture = cents(m.facture + x.montant);
        m.du = cents(m.du + cents(((x.base * coefficient) / x.djuReference) * x.dju));
        mois.set(x.mois, m);
    }
    const liste = [...mois.values()].sort((a, b) => a.mois.localeCompare(b.mois));
    return {
        exercice: exercice.libelle, periodicite, coefficient, dju: Math.round(liste.reduce((s, m) => s + m.dju, 0) * 100) / 100,
        du: cents(liste.reduce((s, m) => s + m.du, 0)), facture: cents(liste.reduce((s, m) => s + m.facture, 0)), mois: liste,
    };
}
