import { IndexFetcher } from './types';
import { cnrPegFetcher } from './fetchers/cnr-peg';
import { createInseeFetcher } from './fetchers/insee';

export const indexFetchers: IndexFetcher[] = [
    cnrPegFetcher,
    // INSEE Indices
    createInseeFetcher('ICHT-TS', '001565183'),
    createInseeFetcher('IC0-018Q', '001766924'),
    createInseeFetcher('BT40_2010', '001710973'),
    createInseeFetcher('BT41_2010', '001710974'),
    createInseeFetcher('EBI_2010', '001652128'),
    createInseeFetcher('EBI_2015', '010534840'),
    createInseeFetcher('EBI_2021', '010764357'),
    createInseeFetcher('TCH_2004', '000867353'),
    createInseeFetcher('TCH_2015', '001763861'),
];

export function getFetcherByCode(code: string): IndexFetcher | undefined {
    return indexFetchers.find(f => f.code === code);
}
