import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { API_SCOPES, type ApiScope } from '@/lib/api/scopes';
import { generateApiKey, parseApiKey, secretMatches, sha256Hex } from '@/lib/api/keys';

/**
 * API externe, côté serveur : clés (collection `apiKeys`), limite de débit (`apiUsage`), idempotence
 * (`apiIdempotency`) et journal (`apiLogs`). Collections réservées au serveur (ni lecture ni écriture navigateur).
 */

export class ApiError extends Error {
    constructor(public status: number, public code: string, message: string, public details?: unknown, public retryAfter?: number) {
        super(message);
        this.name = 'ApiError';
    }
}

export type ApiKeyRecord = {
    id: string;
    name: string;
    prefix: string;
    scopes: ApiScope[];
    rateLimitPerMinute: number;
    active: boolean;
    expiresAt?: string;
    createdAt: string;
    createdBy?: string;
    revokedAt?: string;
    revokedBy?: string;
    lastUsedAt?: string;
};

export const DEFAULT_RATE_LIMIT = 120;
const keys = () => adminDb.collection('apiKeys');

/** Crée une clé : la clé complète n'est rendue qu'ici, une seule fois (seule son empreinte est stockée). */
export async function createApiKey(
    input: { name: string; scopes: string[]; expiresAt?: string; rateLimitPerMinute?: number }, by?: string,
): Promise<{ record: ApiKeyRecord; key: string }> {
    const name = input.name.trim();
    if (!name) throw new Error('Nom de la clé requis (système qui l\'utilisera).');
    const scopes = [...new Set(input.scopes)].filter((s): s is ApiScope => (API_SCOPES as string[]).includes(s));
    if (scopes.length === 0) throw new Error('Au moins un droit est requis.');
    if (input.expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(input.expiresAt)) throw new Error("Date d'expiration invalide.");
    const rate = Math.round(input.rateLimitPerMinute ?? DEFAULT_RATE_LIMIT);
    if (!(rate >= 1 && rate <= 1000)) throw new Error('Limite de débit : entre 1 et 1000 appels par minute.');
    const { key, prefix, hash } = generateApiKey();
    const ref = keys().doc();
    const record: Omit<ApiKeyRecord, 'id'> = {
        name, prefix, scopes, rateLimitPerMinute: rate, active: true,
        ...(input.expiresAt && { expiresAt: input.expiresAt }),
        createdAt: new Date().toISOString(), ...(by && { createdBy: by }),
    };
    await ref.set({ ...record, hash });
    return { record: { id: ref.id, ...record }, key };
}

export async function listApiKeys(): Promise<ApiKeyRecord[]> {
    const snap = await keys().get();
    return snap.docs
        .map(d => { const { hash: _h, ...rest } = d.data(); return { id: d.id, ...rest } as ApiKeyRecord; })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function revokeApiKey(id: string, by?: string): Promise<void> {
    await keys().doc(id).update({ active: false, revokedAt: new Date().toISOString(), ...(by && { revokedBy: by }) });
}

export type ApiCaller = { keyId: string; name: string; prefix: string; scopes: ApiScope[]; rateLimitPerMinute: number };

/** Authentifie l'en-tête `Authorization: Bearer <clé>`. */
export async function authenticate(authorization: string | null): Promise<ApiCaller> {
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw new ApiError(401, 'unauthorized', 'Clé d\'API manquante (en-tête Authorization: Bearer <clé>).');
    const parsed = parseApiKey(token);
    if (!parsed) throw new ApiError(401, 'unauthorized', 'Clé d\'API invalide.');
    const snap = await keys().where('prefix', '==', parsed.prefix).limit(1).get();
    const doc = snap.docs[0];
    // Même réponse dans tous les cas d'échec : rien n'indique si le préfixe existe.
    if (!doc || !secretMatches(parsed.secret, String(doc.get('hash') ?? ''))) throw new ApiError(401, 'unauthorized', 'Clé d\'API invalide.');
    const data = doc.data() as Omit<ApiKeyRecord, 'id'>;
    if (!data.active) throw new ApiError(401, 'unauthorized', 'Clé d\'API révoquée.');
    if (data.expiresAt && data.expiresAt < new Date().toISOString().slice(0, 10)) throw new ApiError(401, 'unauthorized', 'Clé d\'API expirée.');
    // Dernière utilisation, au plus une écriture toutes les 5 minutes.
    const now = new Date();
    if (!data.lastUsedAt || now.getTime() - new Date(data.lastUsedAt).getTime() > 5 * 60_000) {
        doc.ref.update({ lastUsedAt: now.toISOString() }).catch(() => undefined);
    }
    return { keyId: doc.id, name: data.name, prefix: data.prefix, scopes: data.scopes, rateLimitPerMinute: data.rateLimitPerMinute || DEFAULT_RATE_LIMIT };
}

/** Limite de débit par clé, fenêtre fixe d'une minute (partagée entre les instances du serveur). */
export async function consumeRate(caller: ApiCaller): Promise<{ limit: number; remaining: number }> {
    const ref = adminDb.collection('apiUsage').doc(caller.keyId);
    const limit = caller.rateLimitPerMinute;
    return adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const now = Date.now();
        const windowStart = snap.exists ? Number(snap.get('windowStart')) : 0;
        const fresh = now - windowStart >= 60_000;
        const count = fresh ? 0 : Number(snap.get('count') ?? 0);
        if (count >= limit) {
            throw new ApiError(429, 'rate_limited', `Limite de ${limit} appels par minute atteinte.`, undefined, Math.ceil((windowStart + 60_000 - now) / 1000));
        }
        tx.set(ref, { windowStart: fresh ? now : windowStart, count: count + 1 });
        return { limit, remaining: limit - count - 1 };
    });
}

// --- Idempotence : un envoi répété avec la même clé d'idempotence rend la même réponse ---

const IDEMPOTENCY_TTL_MS = 24 * 3600_000;
const idemRef = (keyId: string, idemKey: string) => adminDb.collection('apiIdempotency').doc(sha256Hex(`${keyId}|${idemKey}`));

export async function idempotentReplay(caller: ApiCaller, idemKey: string, requestHash: string): Promise<{ status: number; body: unknown } | null> {
    const snap = await idemRef(caller.keyId, idemKey).get();
    const expiresAt = snap.get('expiresAt') as Timestamp | undefined;
    if (!snap.exists || !expiresAt || expiresAt.toMillis() < Date.now()) return null;
    if (snap.get('requestHash') !== requestHash) {
        throw new ApiError(422, 'idempotency_conflict', 'Clé d\'idempotence déjà utilisée pour une autre requête.');
    }
    return { status: Number(snap.get('status')), body: JSON.parse(String(snap.get('body'))) };
}

export async function saveIdempotent(caller: ApiCaller, idemKey: string, requestHash: string, status: number, body: unknown): Promise<void> {
    await idemRef(caller.keyId, idemKey).set({
        keyId: caller.keyId, requestHash, status, body: JSON.stringify(body),
        // Horodatage (et non texte) : purgeable par une politique TTL Firestore sur `expiresAt`.
        createdAt: new Date().toISOString(), expiresAt: Timestamp.fromMillis(Date.now() + IDEMPOTENCY_TTL_MS),
    });
}

// --- Journal ---

export type ApiLogEntry = {
    keyId?: string; keyName?: string; prefix?: string; method: string; path: string; status: number;
    durationMs: number; at: string; error?: string; items?: number;
};

/** Conservation du journal : 90 jours (purge par une politique TTL Firestore sur `expireAt`). */
const LOG_RETENTION_MS = 90 * 24 * 3600_000;

export async function logApiCall(entry: ApiLogEntry): Promise<void> {
    try {
        await adminDb.collection('apiLogs').add({ ...entry, expireAt: Timestamp.fromMillis(Date.now() + LOG_RETENTION_MS) });
    } catch (error) {
        console.error('Journal API :', error);
    }
}

export async function recentApiLogs(max = 50): Promise<(ApiLogEntry & { id: string })[]> {
    const snap = await adminDb.collection('apiLogs').orderBy('at', 'desc').limit(max).get();
    return snap.docs.map(d => { const { expireAt: _e, ...entry } = d.data(); return { id: d.id, ...(entry as ApiLogEntry) }; });
}
