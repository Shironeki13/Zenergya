'use server';

import { requireUser } from '@/lib/auth/server';
import { gardePerimetre } from '@/lib/auth/perimetre-server';
import type { SeuilsDerive } from '@/lib/energie/derives';
import { derivesP1, enregistrerSeuils, type DerivesP1 } from '@/services/derives-p1-admin';

/** Dérives P1 : administrateurs, modules Facturation ou Achats ; sites du périmètre. Seuils : administrateurs. */
type Result<T> = { success: true; data: T } | { success: false; error: string };
const run = async <T,>(f: (u: Awaited<ReturnType<typeof requireUser>>) => Promise<T>): Promise<Result<T>> => {
    try { return { success: true, data: JSON.parse(JSON.stringify(await f(await requireUser()))) as T }; }
    catch (e) { return { success: false, error: e instanceof Error ? e.message : 'Opération impossible.' }; }
};

export const derivesP1Action = async (): Promise<Result<DerivesP1>> => run(async u => {
    if (!u.isAdmin && !u.profile.modules?.some(m => m === 'billing' || m === 'purchases')) throw new Error('Réservé aux modules Facturation et Achats.');
    return derivesP1(await gardePerimetre(u).ids('sites'));
});

export const seuilsDerivesAction = async (s: Partial<SeuilsDerive>): Promise<Result<SeuilsDerive>> => run(async u => {
    if (!u.isAdmin) throw new Error('Seuls les administrateurs règlent les seuils.');
    return enregistrerSeuils(s ?? {}, u.email);
});
