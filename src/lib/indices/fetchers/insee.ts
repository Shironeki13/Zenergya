import * as cheerio from 'cheerio';
import { IndexFetchResult, IndexFetcher } from '../types';

/**
 * INSEE period SDMX (e.g. "2024-01", "2024-Q1", "2024-S1", "2024") to YYYY-MM
 */
function inseePeriodToMonth(period: string): string {
    // Monthly: "2024-06" -> "2024-06"
    if (/^\d{4}-\d{2}$/.test(period)) {
        return period;
    }

    // Quarterly: "2024-Q1" -> "2024-01", "2024-Q2" -> "2024-04"
    const qMatch = period.match(/^(\d{4})-Q([1-4])$/);
    if (qMatch) {
        const year = qMatch[1];
        const q = parseInt(qMatch[2]!);
        const month = String((q - 1) * 3 + 1).padStart(2, '0');
        return `${year}-${month}`;
    }

    // Semestrial: "2024-S1" -> "2024-01", "2024-S2" -> "2024-07"
    const sMatch = period.match(/^(\d{4})-S([1-2])$/);
    if (sMatch) {
        const year = sMatch[1];
        const s = parseInt(sMatch[2]!);
        const month = s === 1 ? '01' : '07';
        return `${year}-${month}`;
    }

    // Annual: "2024" -> "2024-01"
    const yMatch = period.match(/^(\d{4})$/);
    if (yMatch) {
        return `${yMatch[1]}-01`;
    }

    return period;
}

export function createInseeFetcher(code: string, idbank: string): IndexFetcher {
    return {
        code,
        fetch: async (): Promise<IndexFetchResult[]> => {
            const url = `https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/${idbank}?lastNObservations=24&detail=dataonly`;

            const response = await fetch(url, {
                headers: {
                    'Accept': 'application/vnd.sdmx.structurespecificdata+xml;version=2.1'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch INSEE ${code} (${idbank}): ${response.statusText}`);
            }

            const xml = await response.text();
            const $ = cheerio.load(xml, { xmlMode: true });

            const results: IndexFetchResult[] = [];

            // Improved parsing for SDMX XML with namespaces
            const observations = $('Obs, [local-name="Obs"]');
            console.log(`INSEE ${code}: Found ${observations.length} observations`);

            observations.each((_: number, el: any) => {
                // Try multiple ways to get the attributes (with and without namespaces)
                const period = $(el).attr('TIME_PERIOD') || $(el).attr('time_period') || el.attribs?.TIME_PERIOD;
                const valueStr = $(el).attr('OBS_VALUE') || $(el).attr('obs_value') || el.attribs?.OBS_VALUE;

                if (period && valueStr) {
                    const value = parseFloat(valueStr.replace(',', '.'));
                    if (!isNaN(value)) {
                        results.push({
                            period: inseePeriodToMonth(period),
                            value,
                            source: 'INSEE SDMX (bdm.insee.fr)'
                        });
                    }
                }
            });

            // Sort by period descending
            return results.sort((a, b) => b.period.localeCompare(a.period));
        }
    };
}
