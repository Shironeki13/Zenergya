export interface IndexFetchResult {
    period: string; // YYYY-MM
    value: number;
    source: string;
}

export interface IndexFetcher {
    code: string;
    fetch: () => Promise<IndexFetchResult[]>;
}
