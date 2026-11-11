'use server';

import { requireUser } from '@/lib/auth/server';
import { requireUserDans } from '@/lib/auth/perimetre-server';
import { deleteReading, readingLocks, saveReading, type ReadingInput, type ReadingLocks } from '@/services/readings-admin';

/** Relevés saisis à l'écran : écrits par le serveur (contrôles et relevés figés). */

type Result<T> = { success: true; data: T } | { success: false; error: string };
const fail = (e: unknown): { success: false; error: string } => ({ success: false, error: e instanceof Error ? e.message : 'Opération impossible.' });

export async function readingLocksAction(meterId: string): Promise<Result<ReadingLocks>> {
    try { await requireUserDans('compteur', meterId); return { success: true, data: await readingLocks(meterId) }; } catch (e) { return fail(e); }
}

export async function saveReadingAction(input: ReadingInput): Promise<Result<string>> {
    try { const u = await requireUserDans('compteur', input.meterId); return { success: true, data: await saveReading(input, u.email) }; } catch (e) { return fail(e); }
}

export async function deleteReadingAction(id: string): Promise<Result<null>> {
    try { await requireUserDans('releve', id); await deleteReading(id); return { success: true, data: null }; } catch (e) { return fail(e); }
}
