'use server';

import { requireUser } from '@/lib/auth/server';
import { gardePerimetre } from '@/lib/auth/perimetre-server';
import { creerContratAssistant, type ContratCree } from '@/services/contrat-assistant-admin';
import type { Brouillon } from '@/lib/contracts/assistant';

/** Assistant de création de contrat : écriture au serveur, au nom de l'utilisateur connecté. */
export async function creerContratAction(b: Brouillon): Promise<{ success: true; data: ContratCree } | { success: false; error: string }> {
    try {
        const user = await requireUser();
        // Le contrat se crée pour un client du périmètre : client existant, ou nouveau client rattaché à une société, une agence et un secteur du périmètre.
        const garde = gardePerimetre(user);
        if (b?.client?.mode === 'existant') await garde.exiger('client', b.client.clientId);
        else garde.exigerRattachement(b?.client?.nouveau ?? {}, 'Ce client (société, agence, secteur choisis)');
        return { success: true, data: await creerContratAssistant(b, user) };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : 'Création impossible.' };
    }
}
