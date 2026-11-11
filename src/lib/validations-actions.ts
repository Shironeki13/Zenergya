'use server';

import { requireContratheque } from '@/lib/auth/server';
import { gardePerimetre } from '@/lib/auth/perimetre-server';
import { adminDb } from '@/lib/firebase-admin';
import { COLLECTION_VALIDATION } from '@/lib/validations';
import { fileValidation, traiterValidation, type DecisionValidation } from '@/services/validations-admin';
import type { ElementAValider, TypeValidation } from '@/lib/validations';

/** Validation des documents de contrat : réservée à la contrathèque. */

type Result<T> = { success: true; data: T } | { success: false; error: string };
const fail = (e: unknown): { success: false; error: string } => ({ success: false, error: e instanceof Error ? e.message : 'Opération impossible.' });

export async function fileValidationAction(): Promise<Result<ElementAValider[]>> {
    // La contrathèque valide les documents des clients de son périmètre.
    try { const garde = gardePerimetre(await requireContratheque()); return { success: true, data: await garde.filtrer(await fileValidation(), e => e.clientId) }; } catch (e) { return fail(e); }
}

export async function traiterValidationAction(type: TypeValidation, id: string, choix: DecisionValidation): Promise<Result<null>> {
    try {
        const user = await requireContratheque();
        const coll = COLLECTION_VALIDATION[type];
        const doc = coll ? await adminDb.collection(coll).doc(String(id)).get() : null;
        await gardePerimetre(user).exiger('contrat', type === 'contrat' ? String(id) : String(doc?.get('contractId') ?? ''));
        await traiterValidation(type, id, choix, user); return { success: true, data: null }; } catch (e) { return fail(e); }
}
