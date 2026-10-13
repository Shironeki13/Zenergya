import 'server-only';
import { cookies } from 'next/headers';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import type { User } from '@/lib/types';
import { SESSION_COOKIE } from './constants';

/** Utilisateur authentifié ET autorisé à utiliser l'application. */
export type SessionUser = {
    uid: string;
    email: string;
    isAdmin: boolean;
    /** Fiche de la collection `users` (ou profil synthétique pour un admin d'amorçage). */
    profile: User;
};

export class AuthError extends Error {
    constructor(public status: 401 | 403, message: string) {
        super(message);
        this.name = 'AuthError';
    }
}

const ALL_MODULES = ['contracts', 'billing', 'settings'];

/**
 * Emails toujours administrateurs, même sans fiche dans `users`.
 * Sert à amorcer l'application (premier admin) ou en secours.
 */
function bootstrapAdminEmails(): Set<string> {
    return new Set(
        (process.env.ADMIN_EMAILS || '')
            .split(',')
            .map(e => e.trim().toLowerCase())
            .filter(Boolean)
    );
}

async function findUserDocByEmail(email: string) {
    const users = adminDb.collection('users');
    let snap = await users.where('email', '==', email).limit(1).get();
    if (snap.empty && email !== email.toLowerCase()) {
        snap = await users.where('email', '==', email.toLowerCase()).limit(1).get();
    }
    return snap.empty ? null : snap.docs[0];
}

/**
 * Détermine si un compte Firebase Auth a le droit d'utiliser l'application :
 * il doit avoir une fiche dans `users` (créée par un admin) ou figurer dans ADMIN_EMAILS.
 * Retourne null si l'accès est refusé.
 */
export async function resolveAppUser(uid: string, email: string | undefined, displayName?: string): Promise<SessionUser | null> {
    if (!email) return null;

    const isBootstrapAdmin = bootstrapAdminEmails().has(email.toLowerCase());
    const userDoc = await findUserDocByEmail(email);

    if (!userDoc) {
        if (!isBootstrapAdmin) return null;
        return {
            uid,
            email,
            isAdmin: true,
            profile: {
                id: uid,
                name: displayName || email,
                email,
                roleId: 'bootstrap-admin',
                roleName: 'Administrateur',
                modules: ALL_MODULES,
                scope: { companyIds: ['*'], agencyIds: ['*'], sectorIds: ['*'] },
            },
        };
    }

    const data = userDoc.data();

    // Une fiche déjà rattachée à un autre compte Firebase ne peut pas être reprise
    // (empêche quelqu'un de créer un compte avec l'email d'un collaborateur).
    if (data.authUid && data.authUid !== uid) return null;

    let isAdmin = isBootstrapAdmin;
    let roleName: string | undefined;
    if (data.roleId) {
        const roleSnap = await adminDb.collection('roles').doc(data.roleId).get();
        if (roleSnap.exists) {
            roleName = roleSnap.get('name');
            isAdmin = isAdmin || roleSnap.get('isAdmin') === true;
        }
    }

    return {
        uid,
        email,
        isAdmin,
        profile: {
            id: userDoc.id,
            name: data.name || displayName || email,
            firstName: data.firstName,
            email: data.email,
            roleId: data.roleId,
            roleName: roleName ?? data.roleName,
            modules: data.modules || [],
            scope: data.scope || { companyIds: [], agencyIds: [], sectorIds: [] },
        },
    };
}

/** Rattache la fiche `users` au compte Firebase lors de la première connexion. */
export async function linkAuthUid(user: SessionUser): Promise<void> {
    if (user.profile.roleId === 'bootstrap-admin') return;
    const ref = adminDb.collection('users').doc(user.profile.id);
    const snap = await ref.get();
    if (snap.exists && !snap.get('authUid')) {
        await ref.update({ authUid: user.uid });
    }
}

/**
 * Aligne les custom claims Firebase (lus par les règles Firestore / Storage) sur les droits applicatifs.
 * `zen` = utilisateur autorisé, `admin` = administrateur. Retourne true si les claims ont changé.
 */
export async function syncClaims(uid: string, user: SessionUser | null): Promise<boolean> {
    const record = await adminAuth.getUser(uid);
    const current = record.customClaims || {};
    const zen = user !== null;
    const admin = user?.isAdmin === true;

    if (current.zen === zen && (current.admin === true) === admin) return false;

    const { zen: _z, admin: _a, ...others } = current;
    await adminAuth.setCustomUserClaims(uid, zen ? { ...others, zen: true, admin } : others);
    if (!zen) {
        // Coupe aussi les jetons déjà émis.
        await adminAuth.revokeRefreshTokens(uid);
    }
    return true;
}

/** Lit et vérifie le cookie de session de la requête en cours. */
export async function getSessionUser(): Promise<SessionUser | null> {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE)?.value;
    if (!sessionCookie) return null;

    try {
        const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
        // Les droits sont relus à chaque fois : un utilisateur retiré perd l'accès immédiatement.
        return await resolveAppUser(decoded.uid, decoded.email, decoded.name);
    } catch {
        return null;
    }
}

export async function requireUser(): Promise<SessionUser> {
    const user = await getSessionUser();
    if (!user) throw new AuthError(401, 'Authentification requise.');
    return user;
}

export async function requireAdmin(): Promise<SessionUser> {
    const user = await requireUser();
    if (!user.isAdmin) throw new AuthError(403, 'Droits administrateur requis.');
    return user;
}
