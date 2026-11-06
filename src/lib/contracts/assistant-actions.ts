'use server';

import { requireUser } from '@/lib/auth/server';
import { creerContratAssistant, type ContratCree } from '@/services/contrat-assistant-admin';
import type { Brouillon } from '@/lib/contracts/assistant';

/** Assistant de création de contrat : écriture au serveur, au nom de l'utilisateur connecté. */
export async function creerContratAction(b: Brouillon): Promise<{ success: true; data: ContratCree } | { success: false; error: string }> {
    try {
        const user = await requireUser();
        return { success: true, data: await creerContratAssistant(b, user) };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : 'Création impossible.' };
    }
}
