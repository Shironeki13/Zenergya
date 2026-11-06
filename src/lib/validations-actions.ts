'use server';

import { requireAdmin } from '@/lib/auth/server';
import { fileValidation, traiterValidation } from '@/services/validations-admin';
import type { ElementAValider, TypeValidation } from '@/lib/validations';

/** Validation des documents de contrat : réservée aux administrateurs. */

type Result<T> = { success: true; data: T } | { success: false; error: string };
const fail = (e: unknown): { success: false; error: string } => ({ success: false, error: e instanceof Error ? e.message : 'Opération impossible.' });

export async function fileValidationAction(): Promise<Result<ElementAValider[]>> {
    try { await requireAdmin(); return { success: true, data: await fileValidation() }; } catch (e) { return fail(e); }
}

export async function traiterValidationAction(type: TypeValidation, id: string, decision: 'valider' | 'refuser', motif = ''): Promise<Result<null>> {
    try { const user = await requireAdmin(); await traiterValidation(type, id, decision, motif, user); return { success: true, data: null }; } catch (e) { return fail(e); }
}
