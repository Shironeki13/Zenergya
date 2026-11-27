export interface IndexFetchResult {
    period: string; // YYYY-MM
    value: number;
    source: string;
    /** Date (AAAA-MM-JJ) à laquelle la source a publié ou mis à jour cette valeur, si elle la donne. */
    publishedAt?: string;
    /** Valeur provisoire (susceptible d'être révisée par la source). */
    provisoire?: boolean;
}

export interface IndexFetcher {
    code: string;
    fetch: () => Promise<IndexFetchResult[]>;
    /** Indice statistique (INSEE, par défaut) ou prix de marché (PEG, CEE) : règle le contrôle des variations. */
    famille?: 'statistique' | 'marche';
    /** Série arrêtée (ancienne base) : gardée pour l'historique, sans alerte de retard. */
    arretee?: boolean;
}
