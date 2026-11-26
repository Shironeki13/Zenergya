'use server';

import { requireUser } from '@/lib/auth/server';
import { gardePerimetre } from '@/lib/auth/perimetre-server';
import { emettreAvoirs, type ResultatAvoir } from '@/services/avoirs-admin';

/** Émission d'avoirs : utilisateurs du module Facturation (ou administrateurs), dans leur périmètre. */
type Result<T> = { success: true; data: T } | { success: false; error: string };

export async function emettreAvoirsAction(ids: string[], motif: string, commentaire?: string): Promise<Result<ResultatAvoir[]>> {
    try {
        const u = await requireUser();
        if (!u.isAdmin && !u.profile.modules?.includes('billing')) throw new Error('Réservé aux utilisateurs du module Facturation.');
        if (!Array.isArray(ids)) throw new Error('Sélection illisible.');
        return { success: true, data: JSON.parse(JSON.stringify(await emettreAvoirs(ids, String(motif ?? ''), commentaire ? String(commentaire) : undefined, gardePerimetre(u)))) };
    } catch (e) { return { success: false, error: e instanceof Error ? e.message : 'Émission impossible.' }; }
}
