import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { hasScope, type ApiScope } from '@/lib/api/scopes';
import { sha256Hex } from '@/lib/api/keys';
import {
    ApiError, authenticate, consumeRate, idempotentReplay, logApiCall, saveIdempotent, type ApiCaller,
} from '@/services/api-admin';

/**
 * Enveloppe commune des routes de l'API externe : authentification par clé, droit requis, limite de débit,
 * idempotence des écritures (en-tête Idempotency-Key), erreurs normalisées, journal de chaque appel.
 */

const MAX_BODY_BYTES = 2 * 1024 * 1024;

export type ApiResult = { status?: number; body: unknown; items?: number };

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
    return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export async function handleApi(
    req: NextRequest,
    scope: ApiScope,
    run: (caller: ApiCaller, body: unknown) => Promise<ApiResult>,
): Promise<NextResponse> {
    const started = Date.now();
    let caller: ApiCaller | undefined;
    let status = 500;
    let error: string | undefined;
    let items: number | undefined;
    const rateHeaders: Record<string, string> = {};
    try {
        caller = await authenticate(req.headers.get('authorization'));
        if (!hasScope(caller.scopes, scope)) throw new ApiError(403, 'forbidden', `Droit « ${scope} » non accordé à cette clé.`);
        const rate = await consumeRate(caller);
        rateHeaders['X-RateLimit-Limit'] = String(rate.limit);
        rateHeaders['X-RateLimit-Remaining'] = String(rate.remaining);

        let body: unknown;
        let raw = '';
        if (req.method === 'POST') {
            const length = Number(req.headers.get('content-length') ?? 0);
            if (length > MAX_BODY_BYTES) throw new ApiError(413, 'payload_too_large', 'Corps de requête trop volumineux (2 Mo au plus).');
            raw = await req.text();
            if (raw.length > MAX_BODY_BYTES) throw new ApiError(413, 'payload_too_large', 'Corps de requête trop volumineux (2 Mo au plus).');
            try { body = JSON.parse(raw); } catch { throw new ApiError(400, 'invalid_json', 'Corps JSON invalide.'); }
        }

        const idemKey = req.method === 'POST' ? req.headers.get('idempotency-key')?.trim() : undefined;
        if (idemKey && idemKey.length > 200) throw new ApiError(400, 'invalid_idempotency_key', 'Idempotency-Key : 200 caractères au plus.');
        const requestHash = idemKey ? sha256Hex(`${req.method} ${req.nextUrl.pathname}\n${raw}`) : '';
        if (idemKey) {
            const replay = await idempotentReplay(caller, idemKey, requestHash);
            if (replay) {
                status = replay.status;
                return json(replay.status, replay.body, { ...rateHeaders, 'Idempotent-Replayed': 'true' });
            }
        }

        const result = await run(caller, body);
        status = result.status ?? 200;
        items = result.items;
        if (idemKey) await saveIdempotent(caller, idemKey, requestHash, status, result.body);
        return json(status, result.body, rateHeaders);
    } catch (e) {
        if (e instanceof ApiError) {
            status = e.status;
            error = e.code;
            return json(e.status, { error: { code: e.code, message: e.message, ...(e.details !== undefined && { details: e.details }) } }, {
                ...rateHeaders, ...(e.retryAfter && { 'Retry-After': String(e.retryAfter) }),
            });
        }
        console.error('API externe :', e);
        status = 500;
        error = 'internal_error';
        return json(500, { error: { code: 'internal_error', message: 'Erreur interne.' } });
    } finally {
        await logApiCall({
            ...(caller && { keyId: caller.keyId, keyName: caller.name, prefix: caller.prefix }),
            method: req.method, path: req.nextUrl.pathname + (req.nextUrl.search || ''), status,
            durationMs: Date.now() - started, at: new Date().toISOString(), ...(error && { error }), ...(items !== undefined && { items }),
        });
    }
}

export function notFound(message = 'Ressource inconnue.') {
    return json(404, { error: { code: 'not_found', message } });
}
