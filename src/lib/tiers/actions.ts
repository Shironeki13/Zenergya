'use server';

import { requireUser } from '@/lib/auth/server';
import type { Tiers } from '@/lib/billing/adressage';
import { gardePerimetre } from '@/lib/auth/perimetre-server';
import { annuaireTiers, enregistrerTiers, listerTiers, supprimerTiers, type LigneAnnuaire, type SaisieTiers } from '@/services/tiers-admin';

/** Tiers d'adressage des factures (syndics, payeurs) : un annuaire commun à tous les utilisateurs connectés. */

type Result<T> = { success: true; data: T } | { success: false; error: string };
const run = async <T,>(f: (u: Awaited<ReturnType<typeof requireUser>>) => Promise<T>): Promise<Result<T>> => {
    try { return { success: true, data: JSON.parse(JSON.stringify(await f(await requireUser()))) as T }; }
    catch (e) { return { success: false, error: e instanceof Error ? e.message : 'Opération impossible.' }; }
};

export const listerTiersAction = async (): Promise<Result<Tiers[]>> => run(() => listerTiers());
export const enregistrerTiersAction = async (id: string | null, saisie: SaisieTiers): Promise<Result<Tiers>> => run(u => enregistrerTiers(id, saisie, u.email));
export const supprimerTiersAction = async (id: string): Promise<Result<null>> => run(async () => { await supprimerTiers(id); return null; });
/** Annuaire avec, pour chaque tiers, les clients du périmètre de l'utilisateur qui le citent. */
export const annuaireTiersAction = async (): Promise<Result<LigneAnnuaire[]>> => run(async u => annuaireTiers(await gardePerimetre(u).clients()));
