import { IndexFetcher } from './types';
import { cnrPegFetcher } from './fetchers/cnr-peg';
import { createInseeFetcher } from './fetchers/insee';
import { ceeoC2emarketFetcher, ceepC2emarketFetcher } from './fetchers/cee-c2emarket';
import { ceeoEmmyFetcher, ceepEmmyFetcher } from './fetchers/cee-emmy';

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
    // CEE Indices — C2EMARKET (https://c2emarket.com/evolution-du-prix-des-cee)
    ceeoC2emarketFetcher,   // CEE Classique  (colonne 1)
    ceepC2emarketFetcher,   // CEE Précarité  (colonne 2)
    // CEE Indices — EMMY (https://www.emmy.fr/public/donnees-mensuelles)
    ceeoEmmyFetcher,        // CEE Classique  (precarite=false)
    ceepEmmyFetcher,        // CEE Précarité  (precarite=true)
];

export function getFetcherByCode(code: string): IndexFetcher | undefined {
    return indexFetchers.find(f => f.code === code);
}
