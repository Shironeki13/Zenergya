import * as cheerio from 'cheerio';
import { addMonths, format, parse } from 'date-fns';
import { IndexFetchResult, IndexFetcher } from '../types';

export const cnrPegFetcher: IndexFetcher = {
    code: 'PEG',
    fetch: async (): Promise<IndexFetchResult[]> => {
        const url = 'https://www.cnr.fr/espaces/13/indicateurs/88';
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch CNR PEG: ${response.statusText}`);
        }
        const html = await response.text();
        const $ = cheerio.load(html);

        const results: IndexFetchResult[] = [];

        const monthMap: Record<string, string> = {
            'Janvier': '01',
            'Février': '02',
            'Mars': '03',
            'Avril': '04',
            'Mai': '05',
            'Juin': '06',
            'Juillet': '07',
            'Août': '08',
            'Septembre': '09',
            'Octobre': '10',
            'Novembre': '11',
            'Décembre': '12'
        };

        const applyOffset = (year: string, month: string): string => {
            try {
                // Construct Date object: year, month (1-indexed), day 1
                const date = new Date(parseInt(year), parseInt(month) - 1, 1);
                // Add 1 month as requested (M index is for M+1)
                const offsetDate = addMonths(date, 1);
                return format(offsetDate, 'yyyy-MM');
            } catch (e) {
                console.warn(`Could not offset period ${year}-${month}`, e);
                return `${year}-${month}`;
            }
        };

        // 1. Capture the "Dernière valeur"
        const lastValueContainer = $('h4:contains("Dernière valeur")').next();
        const lastValueText = lastValueContainer.text().trim();
        // Regex to match "Janvier 2026 : 32,889" or "2026-01 : 32,889"
        const lastMatch = lastValueText.match(/(\d{4})-(\d{2})\s*:\s*(\d+[.,]\d+)/);
        if (lastMatch) {
            results.push({
                period: applyOffset(lastMatch[1], lastMatch[2]), // Wait, lastMatch[1] is 2026-01
                value: parseFloat(lastMatch[3]?.replace(',', '.') || '0'),
                source: 'CNR'
            });
        }

        // If the regex above failed, try French month name match
        for (const [mName, mCode] of Object.entries(monthMap)) {
            if (lastValueText.includes(mName)) {
                const yearMatch = lastValueText.match(/(\d{4})/);
                const valueMatch = lastValueText.match(/(\d+[.,]\d+)/);
                if (yearMatch && valueMatch) {
                    results.push({
                        period: applyOffset(yearMatch[1], mCode),
                        value: parseFloat(valueMatch[1].replace(',', '.')),
                        source: 'CNR'
                    });
                }
            }
        }

        // 2. Parse the pivot table
        const years: string[] = [];
        $('#indicatorTable thead th').each((i, th) => {
            const yearStr = $(th).text().trim();
            if (yearStr.match(/^\d{4}$/)) {
                years[i] = yearStr;
            }
        });

        $('#indicatorTable tbody tr').each((_, row) => {
            const cells = $(row).find('td');
            const monthName = $(cells[0]).text().trim();
            // Try direct match or capitalized first letter
            let monthCode = monthMap[monthName] || monthMap[monthName.charAt(0).toUpperCase() + monthName.slice(1).toLowerCase()];

            if (monthCode) {
                cells.each((i, cell) => {
                    const year = years[i];
                    if (year) {
                        const valueText = $(cell).find('span').attr('data-value') || $(cell).text().trim();
                        if (valueText && valueText !== '/' && valueText !== '-') {
                            const value = parseFloat(valueText.replace(',', '.'));
                            if (!isNaN(value)) {
                                results.push({
                                    period: applyOffset(year, monthCode),
                                    value,
                                    source: 'CNR'
                                });
                            }
                        }
                    }
                });
            }
        });

        // Deduplicate
        const uniqueResults = Array.from(new Map(results.map(item => [item.period, item])).values());

        // Sort descending
        return uniqueResults.sort((a, b) => b.period.localeCompare(a.period));
    }
};
