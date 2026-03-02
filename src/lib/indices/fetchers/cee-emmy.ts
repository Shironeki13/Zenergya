import https from 'node:https';
import * as cheerio from 'cheerio';
import { IndexFetchResult, IndexFetcher } from '../types';

/**
 * Fetch HTTPS avec vérification de certificat désactivée.
 * Nécessaire car emmy.fr sert une chaîne de certificat incomplète
 * (UNABLE_TO_VERIFY_LEAF_SIGNATURE), rejetée par OpenSSL/Node.js
 * mais acceptée par schannel (Windows) et les navigateurs.
 */
function fetchHtml(url: string, headers: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers, rejectUnauthorized: false }, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                fetchHtml(res.headers.location, headers).then(resolve).catch(reject);
                return;
            }
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                reject(new Error(`EMMY HTTP error: ${res.statusCode}`));
                return;
            }
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
            res.on('error', reject);
        });
        req.on('error', reject);
    });
}

function parseValue(text: string): number | null {
    const cleaned = text.trim().replace(/\s/g, '').replace(',', '.');
    const val = parseFloat(cleaned);
    return isNaN(val) ? null : val;
}

/**
 * Parse la page EMMY pour une année donnée.
 *
 * Structure réelle de la page :
 *   En-tête (th) : vide | Janvier | Février | ... | Décembre
 *   Ligne prix    (td) : "Prix Moyen pondéré(en €/MWh)" | val_jan | ... | val_déc
 *
 * On cherche la ligne "Prix Moyen pondéré de l'indice spot".
 * Les valeurs sont dans les colonnes 1 à 12 (mois Jan→Déc).
 */
function parseEmmyPage(html: string, year: number): IndexFetchResult[] {
    const $ = cheerio.load(html);
    const results: IndexFetchResult[] = [];
    let found = false;

    $('table').each((_, table) => {
        if (found) return false;

        const thCells = $(table).find('tr').first().find('th');
        if (thCells.length < 12) return;
        if (!thCells.eq(1).text().trim().toLowerCase().startsWith('janv')) return;

        $(table).find('tr').each((_, row) => {
            if (found) return false;

            const cells = $(row).find('td');
            if (cells.length < 2) return;

            const label = $(cells[0]).text().trim();
            if (!label.startsWith('Prix Moyen pondéré')) return;
            if (!label.toLowerCase().includes('spot')) return;

            for (let i = 1; i <= 12; i++) {
                const value = parseValue(cells.eq(i).text());
                if (value === null) continue;
                results.push({ period: `${year}-${String(i).padStart(2, '0')}`, value, source: 'EMMY' });
            }
            found = true;
        });
    });

    return results;
}

/**
 * Scrape https://www.emmy.fr/public/donnees-mensuelles?precarite=true|false
 *
 * La page n'affiche qu'une seule année à la fois.
 * Le paramètre selectedYearCotation=YYYY permet de choisir l'année.
 * On récupère les 3 dernières années (année courante + 2 précédentes).
 *
 * precarite=false → CEE Classique
 * precarite=true  → CEE Précarité
 */
export function createEmmyFetcher(code: string, precarite: boolean): IndexFetcher {
    return {
        code,
        fetch: async (): Promise<IndexFetchResult[]> => {
            const currentYear = new Date().getFullYear();
            const years = [currentYear, currentYear - 1, currentYear - 2];
            const allResults: IndexFetchResult[] = [];

            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'fr-FR,fr;q=0.9',
            };

            for (const year of years) {
                const url = `https://www.emmy.fr/public/donnees-mensuelles?precarite=${precarite}&selectedYearCotation=${year}`;
                try {
                    const html = await fetchHtml(url, headers);
                    const yearResults = parseEmmyPage(html, year);
                    console.log(`[EMMY] ${year} (precarite=${precarite}): ${yearResults.length} valeur(s)`);
                    allResults.push(...yearResults);
                } catch (err: any) {
                    console.warn(`[EMMY] Erreur pour ${year} (precarite=${precarite}): ${err.message}`);
                }
            }

            if (allResults.length === 0) {
                throw new Error(`EMMY: Aucune donnée récupérée (precarite=${precarite})`);
            }

            return allResults.sort((a, b) => b.period.localeCompare(a.period));
        }
    };
}

export const ceeoEmmyFetcher = createEmmyFetcher('CEE Classique - EMMY', false);
export const ceepEmmyFetcher = createEmmyFetcher('CEE Precarite - EMMY', true);
