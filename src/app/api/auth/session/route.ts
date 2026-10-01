import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { resolveAppUser, linkAuthUid, syncClaims } from '@/lib/auth/server';
import { SESSION_COOKIE, SESSION_MAX_AGE_MS } from '@/lib/auth/constants';

export const runtime = 'nodejs';

/**
 * Ouvre (ou renouvelle) la session serveur à partir d'un ID token Firebase.
 * Refuse les comptes qui ne sont pas dans la liste des utilisateurs autorisés.
 */
export async function POST(req: NextRequest) {
    let idToken: unknown;
    try {
        ({ idToken } = await req.json());
    } catch {
        return NextResponse.json({ error: 'invalid-request' }, { status: 400 });
    }
    if (typeof idToken !== 'string' || !idToken) {
        return NextResponse.json({ error: 'invalid-request' }, { status: 400 });
    }

    let decoded;
    try {
        decoded = await adminAuth.verifyIdToken(idToken, true);
    } catch {
        return NextResponse.json({ error: 'invalid-token' }, { status: 401 });
    }

    try {
        const user = await resolveAppUser(decoded.uid, decoded.email, decoded.name);
        if (!user) {
            await syncClaims(decoded.uid, null);
            const res = NextResponse.json({ error: 'not-authorized' }, { status: 403 });
            res.cookies.delete(SESSION_COOKIE);
            return res;
        }

        await linkAuthUid(user);
        const claimsUpdated = await syncClaims(decoded.uid, user);

        const sessionCookie = await adminAuth.createSessionCookie(idToken, { expiresIn: SESSION_MAX_AGE_MS });
        const res = NextResponse.json({ user: user.profile, isAdmin: user.isAdmin, claimsUpdated });
        res.cookies.set(SESSION_COOKIE, sessionCookie, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: SESSION_MAX_AGE_MS / 1000,
        });
        return res;
    } catch (error) {
        console.error('Session API error:', error);
        return NextResponse.json({ error: 'server-error' }, { status: 500 });
    }
}

/** Ferme la session serveur. */
export async function DELETE() {
    const res = NextResponse.json({ success: true });
    res.cookies.delete(SESSION_COOKIE);
    return res;
}
