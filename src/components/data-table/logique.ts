/**
 * Logique pure du tableau commun (testable sans navigateur) : recherche (mots, accents et casse ignorés), filtres à
 * choix multiples avec effectifs, tri (texte « à la française » avec les nombres dans l'ordre, nombres, dates ; vides
 * en dernier).
 */

export type TriTable = { id: string; sens: 'asc' | 'desc' };
export type ValeurTri = string | number | Date | null | undefined;

export type ColonneTri<T> = { id: string; /** Valeur de tri ; absente : colonne non triable. */ tri?: (row: T) => ValeurTri };

export type OptionFiltre = { value: string; label: string };

export type FiltreTable<T> = {
    id: string;
    label: string;
    /** Valeur(s) de la ligne pour ce filtre (null : non renseigné). */
    valeur: (row: T) => string | string[] | null | undefined;
    /** Options fixes ; absentes : déduites des lignes (libellé = valeur, ou `libelle`). */
    options?: OptionFiltre[];
    libelle?: (valeur: string) => string;
};

export const NON_RENSEIGNE = '__vide__';

export const normaliser = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const valeursDe = <T>(f: FiltreTable<T>, row: T): string[] => {
    const v = f.valeur(row);
    const liste = Array.isArray(v) ? v : [v];
    const propres = liste.filter((x): x is string => x !== null && x !== undefined && x !== '');
    return propres.length ? propres : [NON_RENSEIGNE];
};

function comparer(a: ValeurTri, b: ValeurTri): number {
    const vide = (x: ValeurTri) => x === null || x === undefined || x === '' || (x instanceof Date && Number.isNaN(x.getTime()));
    if (vide(a) && vide(b)) return 0;
    if (vide(a)) return 1;
    if (vide(b)) return -1;
    if (a instanceof Date || b instanceof Date) return new Date(a as Date).getTime() - new Date(b as Date).getTime();
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), 'fr', { numeric: true, sensitivity: 'base' });
}

export function appliquerTable<T>(rows: T[], o: {
    recherche?: (row: T) => (string | null | undefined)[];
    q: string;
    filtres: FiltreTable<T>[];
    valeurs: Record<string, string[]>;
    colonnes: ColonneTri<T>[];
    tri: TriTable | null;
}): { lignes: T[]; effectifs: Record<string, { options: OptionFiltre[]; compte: Record<string, number> }> } {
    const mots = normaliser(o.q).split(/\s+/).filter(Boolean);
    const index = o.recherche && mots.length ? new Map(rows.map(r => [r, normaliser(o.recherche!(r).filter(Boolean).join(' '))])) : null;
    const passeRecherche = (r: T) => !index || mots.every(m => index.get(r)!.includes(m));
    const passeFiltre = (r: T, f: FiltreTable<T>) => {
        const choisis = o.valeurs[f.id] ?? [];
        return !choisis.length || valeursDe(f, r).some(v => choisis.includes(v));
    };

    // Effectifs de chaque filtre : lignes qui passent la recherche et les autres filtres (choix « à facettes »).
    const effectifs: Record<string, { options: OptionFiltre[]; compte: Record<string, number> }> = {};
    for (const f of o.filtres) {
        const compte: Record<string, number> = {};
        const vues = new Set<string>();
        for (const r of rows) {
            const vals = valeursDe(f, r);
            vals.forEach(v => vues.add(v));
            if (!passeRecherche(r) || !o.filtres.every(g => g === f || passeFiltre(r, g))) continue;
            for (const v of vals) compte[v] = (compte[v] ?? 0) + 1;
        }
        const options = f.options ?? [...vues]
            .map(v => ({ value: v, label: v === NON_RENSEIGNE ? 'Non renseigné' : f.libelle ? f.libelle(v) : v }))
            .sort((a, b) => (a.value === NON_RENSEIGNE ? 1 : b.value === NON_RENSEIGNE ? -1 : a.label.localeCompare(b.label, 'fr', { numeric: true })));
        effectifs[f.id] = { options, compte };
    }

    let lignes = rows.filter(r => passeRecherche(r) && o.filtres.every(f => passeFiltre(r, f)));
    const col = o.tri ? o.colonnes.find(c => c.id === o.tri!.id && c.tri) : undefined;
    if (col && o.tri) {
        const sens = o.tri.sens === 'asc' ? 1 : -1;
        const vides = (x: ValeurTri) => x === null || x === undefined || x === '';
        // Les valeurs vides restent en dernier dans les deux sens.
        lignes = [...lignes].sort((a, b) => {
            const va = col.tri!(a), vb = col.tri!(b);
            if (vides(va) !== vides(vb)) return vides(va) ? 1 : -1;
            return sens * comparer(va, vb);
        });
    }
    return { lignes, effectifs };
}
