import * as cheerio from 'cheerio';
import { IndexFetchResult, IndexFetcher } from '../types';

const FRENCH_MONTHS: Record<string, string> = {
    'janvier': '01', 'février': '02', 'mars': '03', 'avril': '04',
    'mai': '05', 'juin': '06', 'juillet': '07', 'août': '08',
    'septembre': '09', 'octobre': '10', 'novembre': '11', 'décembre': '12',
};

function parseFrenchPeriod(text: string): string | null {
    const lower = text.trim().toLowerCase();
    const match = lower.match(/^([a-zàâäéèêëîïôùûüœç]+)\s+(\d{4})$/);
    if (!match) return null;
    const month = FRENCH_MONTHS[match[1]];
    if (!month) return null;
    return `${match[2]}-${month}`;
}

function parseValue(text: string): number | null {
    const cleaned = text.trim().replace(/\s/g, '').replace(',', '.');
    const val = parseFloat(cleaned);
    return isNaN(val) ? null : val;
}

/**
 * Scrape https://c2emarket.com/evolution-du-prix-des-cee
 *
 * La page contient plusieurs tableaux avec la structure :
 *   Mois | CEE Classique (€/MWhc) | CEE Précarité (€/MWhc)
 *
 * colIndex=1 → CEE Classique
 * colIndex=2 → CEE Précarité
 *
 * Le code doit correspondre exactement au code de l'indice dans Firestore.
 */
export function createC2emarketFetcher(code: string, colIndex: 1 | 2): IndexFetcher {
    return {
        code,
        fetch: async (): Promise<IndexFetchResult[]> => {
            const url = 'https://c2emarket.com/evolution-du-prix-des-cee';
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'fr-FR,fr;q=0.9',
                }
            });

            if (!response.ok) {
                throw new Error(`C2EMARKET fetch failed: ${response.status} ${response.statusText}`);
            }

            const html = await response.text();
            const $ = cheerio.load(html);

            const results: IndexFetchResult[] = [];

            // Parcourt TOUS les tableaux de la page (tables 2 et 3 dans Google Sheets = index 1 et 2)
            $('table').each((tableIdx, table) => {
                $(table).find('tr').each((_, row) => {
                    const cells = $(row).find('td');
                    if (cells.length <= colIndex) return;

                    const period = parseFrenchPeriod($(cells[0]).text());
                    if (!period) return;

                    const value = parseValue($(cells[colIndex]).text());
                    if (value === null) return;

                    results.push({ period, value, source: 'C2EMARKET' });
                });
            });

            // Dédoublonnage : en cas de même période dans plusieurs tableaux, on garde la première
            const seen = new Set<string>();
            const unique = results.filter(r => {
                if (seen.has(r.period)) return false;
                seen.add(r.period);
                return true;
            });

            return unique.sort((a, b) => b.period.localeCompare(a.period));
        }
    };
}

// Codes à vérifier et ajuster pour correspondre aux codes des indices dans Firestore
export const ceeoC2emarketFetcher = createC2emarketFetcher('CEE Classique - C2EMARKET', 1);
export const ceepC2emarketFetcher = createC2emarketFetcher('CEE Precarite - C2EMARKET', 2)
