'use server';

import { requireUser } from '@/lib/auth/server';
import { gardePerimetre } from '@/lib/auth/perimetre-server';
import { creerContratAssistant, type ContratCree } from '@/services/contrat-assistant-admin';
import type { Brouillon } from '@/lib/contracts/assistant';
import { exigerAcceptable, marquerAcceptee } from '@/services/propositions-admin';

/** Assistant de création de contrat : écriture au serveur, au nom de l'utilisateur connecté. */
/** `propositionId` : création depuis une proposition (contrathèque, administrateurs), qui est alors acceptée. */
export async function creerContratAction(b: Brouillon, propositionId?: string): Promise<{ success: true; data: ContratCree } | { success: false; error: string }> {
    try {
        const user = await requireUser();
        // Le contrat se crée pour un client du périmètre : client existant, ou nouveau client rattaché à une société, une agence et un secteur du périmètre.
        const garde = gardePerimetre(user);
        if (b?.client?.mode === 'existant') await garde.exiger('client', b.client.clientId);
        else garde.exigerRattachement(b?.client?.nouveau ?? {}, 'Ce client (société, agence, secteur choisis)');
        const proposition = propositionId ? await exigerAcceptable(String(propositionId), user) : null;
        // Le document lu reste celui de la proposition (déjà enregistré).
        const cree = await creerContratAssistant(proposition?.document ? { ...b, document: b.document ?? proposition.document } : b, user);
        if (proposition) await marquerAcceptee(proposition.id, cree, user);
        return { success: true, data: cree };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : 'Création impossible.' };
    }
}
