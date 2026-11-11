'use server';

import { requireUser } from '@/lib/auth/server';
import { ciblesDuPerimetre, HORS_PERIMETRE } from '@/lib/auth/perimetre-cibles';
import { adminDb } from '@/lib/firebase-admin';
import type { SaisieHeures } from '@/lib/heures';
import { deleteHeures, importerHeures, listHeures, saveHeures, type HeuresInput, type RapportImportHeures } from '@/services/heures-admin';

/** Heures de main-d'œuvre : actions serveur (session requise ; qui saisit pour qui est contrôlé par le service). */

type Result<T> = { success: true; data: T } | { success: false; error: string };
const fail = (e: unknown): { success: false; error: string } => ({ success: false, error: e instanceof Error ? e.message : 'Opération impossible.' });
const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x ?? null));
const run = async <T,>(f: (u: Awaited<ReturnType<typeof requireUser>>) => Promise<T>): Promise<Result<T>> => { try { return { success: true, data: plain(await f(await requireUser())) }; } catch (e) { return fail(e); } };

/**
 * Périmètre : un utilisateur voit ses heures, celles de son équipe directe, et celles saisies sur une affaire ou un
 * contrat de son périmètre. Il n'en saisit et n'en importe que sur son périmètre.
 */
export const listHeuresAction = async (filtre: { from?: string; to?: string; userId?: string; projectId?: string } = {}): Promise<Result<SaisieHeures[]>> => run(async u => {
    const [cible, toutes] = await Promise.all([ciblesDuPerimetre(u), listHeures(filtre)]);
    if (!cible) return toutes;
    const equipe = new Set((await adminDb.collection('users').where('managerId', '==', u.profile.id).select().get()).docs.map(d => d.id));
    return toutes.filter(s => s.userId === u.profile.id || equipe.has(s.userId) || cible(s.cible));
});
export const saveHeuresAction = async (input: HeuresInput): Promise<Result<SaisieHeures>> => run(async u => {
    const cible = await ciblesDuPerimetre(u);
    if (cible && input?.cible && !cible(input.cible)) throw new Error(`L'affaire ou le contrat choisi ${HORS_PERIMETRE}.`);
    return saveHeures(input, u);
});
export const deleteHeuresAction = async (id: string): Promise<Result<null>> => run(async u => { await deleteHeures(id, u); return null; });
export const importerHeuresAction = async (table: unknown[][], appliquer: boolean): Promise<Result<RapportImportHeures>> => run(async u => importerHeures(table, u, appliquer, (await ciblesDuPerimetre(u)) ?? undefined));
