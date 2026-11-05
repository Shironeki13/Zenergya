'use server';

import { requireUser } from '@/lib/auth/server';
import { deleteReading, readingLocks, saveReading, type ReadingInput, type ReadingLocks } from '@/services/readings-admin';

/** Relevés saisis à l'écran : écrits par le serveur (contrôles et relevés figés). */

type Result<T> = { success: true; data: T } | { success: false; error: string };
const fail = (e: unknown): { success: false; error: string } => ({ success: false, error: e instanceof Error ? e.message : 'Opération impossible.' });

export async function readingLocksAction(meterId: string): Promise<Result<ReadingLocks>> {
    try { await requireUser(); return { success: true, data: await readingLocks(meterId) }; } catch (e) { return fail(e); }
}

export async function saveReadingAction(input: ReadingInput): Promise<Result<string>> {
    try { const u = await requireUser(); return { success: true, data: await saveReading(input, u.email) }; } catch (e) { return fail(e); }
}

export async function deleteReadingAction(id: string): Promise<Result<null>> {
    try { await requireUser(); await deleteReading(id); return { success: true, data: null }; } catch (e) { return fail(e); }
}
