import { IndexFetchResult, IndexFetcher } from '../types';

export const inseeTestFetcher: IndexFetcher = {
    code: 'INSEE_TEST',
    fetch: async (): Promise<IndexFetchResult[]> => {
        const idbank = '001565183'; // ICHT-TS
        const url = `https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/${idbank}?lastNObservations=1&detail=dataonly`;

        console.log(`INSEE_TEST: Fetching ${url}`);
        const response = await fetch(url, {
            headers: {
                'Accept': 'application/vnd.sdmx.structurespecificdata+xml;version=2.1'
            }
        });

        if (!response.ok) {
            throw new Error(`INSEE_TEST: HTTP ${response.status} ${response.statusText}`);
        }

        const xml = await response.text();
        console.log(`INSEE_TEST: Received XML of length ${xml.length}`);

        return [{
            period: '2024-01',
            value: 123.45,
            source: 'INSEE_TEST'
        }];
    }
};
