'use server';

import { adminAuth } from '@/lib/firebase-admin';
import { requireAdmin, resolveAppUser, syncClaims } from './server';

/**
 * Réaligne immédiatement les droits Firebase d'un compte après une modification
 * dans la gestion des utilisateurs (création, changement de rôle, suppression).
 * Sans cet appel, les droits seraient de toute façon recalculés à la prochaine connexion.
 */
export async function syncUserAccess(email: string): Promise<void> {
    await requireAdmin();
    if (!email) return;

    let record;
    try {
        record = await adminAuth.getUserByEmail(email);
    } catch {
        return; // Pas encore de compte Firebase pour cet email : rien à faire.
    }

    const user = await resolveAppUser(record.uid, record.email, record.displayName);
    await syncClaims(record.uid, user);
}
