/**
 * Filtres du pilotage de la facturation (calcul pur) : société, agence, secteur, responsable facturation, activité,
 * client, site. Plusieurs valeurs d'un même filtre : l'une ou l'autre ; plusieurs filtres : tous à la fois.
 *
 * Rattachements : société émettrice du contrat (sinon celle du client) ; agence et secteur du client ; responsable
 * facturation du contrat ; activité et site de la prestation (ou de la ligne de facture).
 */

export const DIMENSIONS = ['company', 'agency', 'sector', 'manager', 'activity', 'client', 'site'] as const;
export type Dimension = typeof DIMENSIONS[number];

export const LIBELLES_DIMENSION: Record<Dimension, string> = {
    company: 'Société', agency: 'Agence', sector: 'Secteur', manager: 'Responsable facturation', activity: 'Activité', client: 'Client', site: 'Site',
};

/** Valeur de filtre « non renseigné » (ex. contrat sans responsable facturation). */
export const AUCUN = '__aucun__';

export type Filtres = Partial<Record<Dimension, string[]>>;
/** Rattachements d'une échéance, d'une ligne de facture ou d'un contrat (null : non renseigné). */
export type Rattachements = Partial<Record<Dimension, string | null>>;

export const filtresActifs = (f: Filtres) => DIMENSIONS.filter(d => (f[d]?.length ?? 0) > 0);

/**
 * L'élément passe-t-il les filtres ? `ignorer` : dimensions sans objet pour cet élément (ex. activité et site pour
 * un contrat dont l'échéancier ne se calcule pas) — non filtrées.
 */
export function correspond(r: Rattachements, f: Filtres, ignorer: Dimension[] = []): boolean {
    for (const d of filtresActifs(f)) {
        if (ignorer.includes(d)) continue;
        const v = r[d] ?? AUCUN;
        if (!f[d]!.includes(v)) return false;
    }
    return true;
}

// ── Factures émises ──────────────────────────────────────────────────────────────────────────────────────────────

/** Ligne de facture ou d'avoir émis, avec ses rattachements (montant HT positif, y compris pour un avoir). */
export type LigneEmise = Rattachements & {
    /** Document : « F:<id> » (facture) ou « A:<id> » (avoir). */
    doc: string;
    avoir: boolean;
    /** AAAA-MM-JJ */
    date: string;
    ht: number;
};

export type TotauxEmis = { factures: number; montantFactures: number; avoirs: number; montantAvoirs: number; net: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Factures et avoirs émis sur la période [du, au] (dates incluses), aux filtres : un document compte s'il a au moins
 * une ligne retenue ; son montant est celui de ses lignes retenues (tout le document sans filtre d'activité ni de
 * site). Net = factures − avoirs.
 */
export function totauxEmis(lignes: LigneEmise[], f: Filtres, du?: string, au?: string): TotauxEmis {
    const factures = new Set<string>();
    const avoirs = new Set<string>();
    let montantFactures = 0;
    let montantAvoirs = 0;
    for (const l of lignes) {
        if ((du && l.date < du) || (au && l.date > au) || !correspond(l, f)) continue;
        if (l.avoir) { avoirs.add(l.doc); montantAvoirs += l.ht; }
        else { factures.add(l.doc); montantFactures += l.ht; }
    }
    return { factures: factures.size, montantFactures: r2(montantFactures), avoirs: avoirs.size, montantAvoirs: r2(montantAvoirs), net: r2(montantFactures - montantAvoirs) };
}
