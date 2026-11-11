'use server';

import { requireUser } from '@/lib/auth/server';
import { dernieresSyncs, type RapportSync } from '@/services/index-sync';

/** Journal de la synchronisation automatique des indices (derniers passages), pour l'écran des indices. */
export async function dernieresSyncsAction(n = 5): Promise<{ success: true; data: RapportSync[] } | { success: false; error: string }> {
    try {
        await requireUser();
        return { success: true, data: JSON.parse(JSON.stringify(await dernieresSyncs(Math.min(Math.max(n, 1), 30)))) };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : 'Journal indisponible.' };
    }
}
