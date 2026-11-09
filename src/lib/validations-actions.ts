'use server';

import { requireContratheque } from '@/lib/auth/server';
import { fileValidation, traiterValidation, type DecisionValidation } from '@/services/validations-admin';
import type { ElementAValider, TypeValidation } from '@/lib/validations';

/** Validation des documents de contrat : réservée à la contrathèque. */

type Result<T> = { success: true; data: T } | { success: false; error: string };
const fail = (e: unknown): { success: false; error: string } => ({ success: false, error: e instanceof Error ? e.message : 'Opération impossible.' });

export async function fileValidationAction(): Promise<Result<ElementAValider[]>> {
    try { await requireContratheque(); return { success: true, data: await fileValidation() }; } catch (e) { return fail(e); }
}

export async function traiterValidationAction(type: TypeValidation, id: string, choix: DecisionValidation): Promise<Result<null>> {
    try { const user = await requireContratheque(); await traiterValidation(type, id, choix, user); return { success: true, data: null }; } catch (e) { return fail(e); }
}
