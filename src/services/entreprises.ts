import 'server-only';
import { buildSearchQuery, mapSearchResponse, type EntrepriseSearchParams, type EntrepriseSearchResponse } from '@/lib/entreprises';

/**
 * Appel à l'API Recherche d'entreprises (État, sans clé), côté serveur :
 * délai maximal, un nouvel essai en cas de limite de débit (429), cache court en mémoire.
 */

const BASE_URL = process.env.RECHERCHE_ENTREPRISES_URL || 'https://recherche-entreprises.api.gouv.fr';
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 300;

export class EntreprisesApiError extends Error {
    constructor(message: string, public status: number) {
        super(message);
    }
}

const cache = new Map<string, { at: number; value: EntrepriseSearchResponse }>();

function fromCache(key: string): EntrepriseSearchResponse | undefined {
    const hit = cache.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > CACHE_TTL_MS) {
        cache.delete(key);
        return undefined;
    }
    return hit.value;
}

function toCache(key: string, value: EntrepriseSearchResponse) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: Date.now(), value });
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function call(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        return await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal, cache: 'no-store' });
    } catch (error) {
        const timeout = (error as Error).name === 'AbortError';
        throw new EntreprisesApiError(timeout ? "Le répertoire des entreprises ne répond pas (délai dépassé)." : "Répertoire des entreprises injoignable.", 504);
    } finally {
        clearTimeout(timer);
    }
}

export async function searchEntreprises(params: EntrepriseSearchParams): Promise<EntrepriseSearchResponse> {
    const query = buildSearchQuery(params);
    const key = query.toString();
    const cached = fromCache(key);
    if (cached) return cached;

    const url = `${BASE_URL}/search?${key}`;
    let response = await call(url);
    if (response.status === 429) {
        // Limite de débit de l'API : un seul nouvel essai, après le délai demandé (plafonné).
        const retryAfter = Number(response.headers.get('retry-after'));
        await pause(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500, 3000));
        response = await call(url);
    }
    if (response.status === 429) {
        throw new EntreprisesApiError('Trop de recherches en peu de temps : réessayez dans quelques secondes.', 429);
    }
    if (!response.ok) {
        throw new EntreprisesApiError(`Répertoire des entreprises indisponible (erreur ${response.status}).`, 502);
    }
    const value = mapSearchResponse(await response.json(), params.q);
    toCache(key, value);
    return value;
}
