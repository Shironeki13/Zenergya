'use server';

import { requireUser } from '@/lib/auth/server';
import { gardePerimetre } from '@/lib/auth/perimetre-server';
import type { Proposition } from '@/lib/contracts/propositions';
import { lireProposition, listerPropositions, propositionVisible, refuserProposition } from '@/services/propositions-admin';

/** Propositions de création : liste et revue (qui les voit) ; relecture (déposant, contrathèque) ; refus (contrathèque). */
type Result<T> = { success: true; data: T } | { success: false; error: string };
const run = async <T,>(f: (u: Awaited<ReturnType<typeof requireUser>>) => Promise<T>): Promise<Result<T>> => {
    try { return { success: true, data: JSON.parse(JSON.stringify(await f(await requireUser()))) as T }; }
    catch (e) { return { success: false, error: e instanceof Error ? e.message : 'Opération impossible.' }; }
};

export const listerPropositionsAction = async (): Promise<Result<Proposition[]>> => run(u => listerPropositions(u, gardePerimetre(u)));
export const propositionAction = async (id: string): Promise<Result<Proposition>> => run(u => propositionVisible(String(id), u, gardePerimetre(u)));
export const relirePropositionAction = async (id: string): Promise<Result<Proposition>> => run(async u => {
    const p = await propositionVisible(String(id), u, gardePerimetre(u));
    if (!u.isAdmin && !u.isContratheque && p.deposePar !== u.email) throw new Error('Seuls le déposant et la contrathèque relancent une lecture.');
    return lireProposition(p.id);
});
export const refuserPropositionAction = async (id: string, motif: string): Promise<Result<null>> => run(async u => {
    await propositionVisible(String(id), u, gardePerimetre(u));
    await refuserProposition(String(id), String(motif ?? ''), u);
    return null;
});
