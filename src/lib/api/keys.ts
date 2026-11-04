import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Clés de l'API externe : `zen_<préfixe 10>_<secret 43>` (256 bits d'aléa). Seule l'empreinte SHA-256 du secret
 * est stockée ; le préfixe, public, sert à retrouver la clé et à l'identifier dans les écrans et le journal.
 */

const KEY_RE = /^zen_([A-Za-z0-9]{10})_([A-Za-z0-9_-]{43})$/;

export const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');

/** Nouvelle clé : la clé complète (à montrer une seule fois), son préfixe et l'empreinte à stocker. */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = randomBytes(10);
    const prefix = Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
    const secret = randomBytes(32).toString('base64url');
    return { key: `zen_${prefix}_${secret}`, prefix, hash: sha256Hex(secret) };
}

/** Découpe une clé reçue ; null si le format est invalide. */
export function parseApiKey(token: string): { prefix: string; secret: string } | null {
    const m = KEY_RE.exec(token.trim());
    return m ? { prefix: m[1], secret: m[2] } : null;
}

/** Comparaison en temps constant du secret reçu avec l'empreinte stockée. */
export function secretMatches(secret: string, storedHash: string): boolean {
    const a = Buffer.from(sha256Hex(secret), 'hex');
    const b = Buffer.from(storedHash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
}
