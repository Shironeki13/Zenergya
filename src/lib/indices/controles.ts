/**
 * Contrôles des valeurs d'indices récupérées automatiquement (logique pure) : une valeur n'est enregistrée que si
 * elle est plausible, et un indice dont la dernière valeur date trop est signalé.
 */

export type FamilleIndice = 'statistique' | 'marche';
export type ReglesIndice = {
    /** Variation maximale admise d'une période à la suivante (0,15 = 15 %). */
    variationMax: number;
    /** Mois de tolérance après la date attendue de la prochaine valeur, avant de signaler un retard. */
    toleranceRetardMois: number;
};

/** Indices statistiques (INSEE) : ils bougent peu. Prix de marché (PEG, CEE) : ils peuvent varier fortement. */
export const REGLES: Record<FamilleIndice, ReglesIndice> = {
    statistique: { variationMax: 0.15, toleranceRetardMois: 4 },
    marche: { variationMax: 0.6, toleranceRetardMois: 2 },
};

export type ValeurIndice = { period: string; value: number };
export type Rejet = ValeurIndice & { motif: string };

const mois = (p: string) => Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7)) - 1;
const estPeriode = (p: unknown): p is string => typeof p === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
const pct = (x: number) => `${(x * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;

/**
 * Trie les valeurs reçues : acceptées ou rejetées (avec leur motif). Chaque valeur est comparée à la valeur de la
 * période précédente la plus proche — déjà enregistrée, ou acceptée dans ce même lot.
 */
export function controlerValeurs(recues: ValeurIndice[], enregistrees: ValeurIndice[], regles: ReglesIndice, aujourdhui: string): { acceptees: ValeurIndice[]; rejetees: Rejet[] } {
    const acceptees: ValeurIndice[] = [], rejetees: Rejet[] = [];
    const connues = new Map(enregistrees.filter(v => estPeriode(v.period)).map(v => [v.period, v.value]));
    const vues = new Set<string>();
    for (const v of [...recues].sort((a, b) => String(a.period).localeCompare(String(b.period)))) {
        const refuser = (motif: string) => rejetees.push({ ...v, motif });
        if (!estPeriode(v.period)) { refuser('période illisible (AAAA-MM attendu)'); continue; }
        if (vues.has(v.period)) { refuser('période reçue deux fois'); continue; }
        vues.add(v.period);
        if (typeof v.value !== 'number' || !Number.isFinite(v.value)) { refuser('valeur illisible'); continue; }
        if (v.value <= 0) { refuser('valeur nulle ou négative'); continue; }
        if (v.period > aujourdhui.slice(0, 7)) { refuser('période dans le futur'); continue; }
        // Référence : la dernière période connue avant celle-ci (hors la valeur déjà enregistrée pour cette même période).
        const avant = [...connues.keys()].filter(p => p < v.period).sort().pop();
        const reference = avant ? connues.get(avant)! : undefined;
        if (reference !== undefined && reference > 0) {
            const variation = Math.abs(v.value - reference) / reference;
            if (variation > regles.variationMax) { refuser(`variation de ${pct(variation)} par rapport à ${avant} (${reference}) : au-delà de ${pct(regles.variationMax)}, à vérifier`); continue; }
        }
        acceptees.push(v);
        connues.set(v.period, v.value);
    }
    return { acceptees, rejetees };
}

/** Écart habituel entre deux valeurs (1 : mensuel, 3 : trimestriel…), d'après les dernières périodes ; 1 par défaut. */
export function frequenceMois(periodes: string[]): number {
    const m = [...new Set(periodes.filter(estPeriode))].sort().map(mois).slice(-6);
    const ecarts = m.slice(1).map((x, i) => x - m[i]).sort((a, b) => a - b);
    return ecarts.length ? ecarts[Math.floor(ecarts.length / 2)] : 1;
}

/**
 * Indice en retard ? La prochaine valeur est attendue une période après la dernière ; au-delà de la tolérance, il est
 * signalé. Renvoie le nombre de mois de retard (0 : à jour), ou null si l'indice n'a aucune valeur.
 */
export function retardMois(periodes: string[], regles: ReglesIndice, aujourdhui: string): number | null {
    const valides = periodes.filter(estPeriode).sort();
    if (!valides.length) return null;
    const attendu = mois(valides[valides.length - 1]) + frequenceMois(valides) + regles.toleranceRetardMois;
    return Math.max(0, mois(aujourdhui.slice(0, 7)) - attendu);
}
