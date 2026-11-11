import 'server-only';
import type { CibleCommande } from '@/lib/commandes';
import { gardePerimetre } from './perimetre-server';
import type { SessionUser } from './server';

/**
 * Périmètre des dépenses (commandes, heures) : leur affectation — une affaire de travaux, ou un contrat — suit le
 * client de l'affaire ou du contrat. Renvoie null quand l'utilisateur voit tout.
 */
export async function ciblesDuPerimetre(user: SessionUser): Promise<((c: CibleCommande) => boolean) | null> {
    const garde = gardePerimetre(user);
    if (garde.tout) return null;
    const [affaires, contrats] = await Promise.all([garde.ids('projects'), garde.ids('contracts')]);
    return c => (c?.type === 'affaire' ? !!affaires?.has(c.projectId) : c?.type === 'contrat' ? !!contrats?.has(c.contractId) : false);
}

export const HORS_PERIMETRE = 'est hors de votre périmètre (société, agence, secteur)';
