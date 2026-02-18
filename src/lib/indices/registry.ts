import { IndexFetcher } from './types';
import { cnrPegFetcher } from './fetchers/cnr-peg';

export const indexFetchers: IndexFetcher[] = [
    cnrPegFetcher,
    // Add more fetchers here (e.g., EEX, INSEE)
];

export function getFetcherByCode(code: string): IndexFetcher | undefined {
    return indexFetchers.find(f => f.code === code);
}
