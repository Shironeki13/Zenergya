'use server';

import { requireUser } from '@/lib/auth/server';
import type { SaisieHeures } from '@/lib/heures';
import { deleteHeures, importerHeures, listHeures, saveHeures, type HeuresInput, type RapportImportHeures } from '@/services/heures-admin';

/** Heures de main-d'œuvre : actions serveur (session requise ; qui saisit pour qui est contrôlé par le service). */

type Result<T> = { success: true; data: T } | { success: false; error: string };
const fail = (e: unknown): { success: false; error: string } => ({ success: false, error: e instanceof Error ? e.message : 'Opération impossible.' });
const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x ?? null));
const run = async <T,>(f: (u: Awaited<ReturnType<typeof requireUser>>) => Promise<T>): Promise<Result<T>> => { try { return { success: true, data: plain(await f(await requireUser())) }; } catch (e) { return fail(e); } };

export const listHeuresAction = async (filtre: { from?: string; to?: string; userId?: string; projectId?: string } = {}): Promise<Result<SaisieHeures[]>> => run(() => listHeures(filtre));
export const saveHeuresAction = async (input: HeuresInput): Promise<Result<SaisieHeures>> => run(u => saveHeures(input, u));
export const deleteHeuresAction = async (id: string): Promise<Result<null>> => run(async u => { await deleteHeures(id, u); return null; });
export const importerHeuresAction = async (table: unknown[][], appliquer: boolean): Promise<Result<RapportImportHeures>> => run(u => importerHeures(table, u, appliquer));
