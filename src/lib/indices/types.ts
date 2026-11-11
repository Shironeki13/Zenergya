export interface IndexFetchResult {
    period: string; // YYYY-MM
    value: number;
    source: string;
}

export interface IndexFetcher {
    code: string;
    fetch: () => Promise<IndexFetchResult[]>;
    /** Indice statistique (INSEE, par défaut) ou prix de marché (PEG, CEE) : règle le contrôle des variations. */
    famille?: 'statistique' | 'marche';
    /** Série arrêtée (ancienne base) : gardée pour l'historique, sans alerte de retard. */
    arretee?: boolean;
}
