'use server';

import { requireUser } from '@/lib/auth/server';
import { recomputeEInvoicingState, setEInvoicingStatus, type EInvoicingKind } from '@/services/firestore-admin';
import type { EInvoicingStatus } from '@/lib/types';

export type EInvoicingTarget = { kind: EInvoicingKind; id: string };
export type BatchResult = { succeeded: number; failed: { id: string; error: string }[] };

const MAX_BATCH = 500;

async function forEachTarget(targets: EInvoicingTarget[], run: (t: EInvoicingTarget) => Promise<unknown>): Promise<BatchResult> {
    if (targets.length > MAX_BATCH) throw new Error(`Au plus ${MAX_BATCH} documents à la fois.`);
    const result: BatchResult = { succeeded: 0, failed: [] };
    for (const target of targets) {
        try {
            await run(target);
            result.succeeded++;
        } catch (error) {
            result.failed.push({ id: target.id, error: error instanceof Error ? error.message : String(error) });
        }
    }
    return result;
}

/** Marque des factures / avoirs comme transmis, rejetés ou à retransmettre. */
export async function updateEInvoicingStatus(
    targets: EInvoicingTarget[], status: Exclude<EInvoicingStatus, 'not_applicable'>,
    meta: { platformReference?: string; comment?: string } = {},
): Promise<BatchResult> {
    const user = await requireUser();
    return forEachTarget(targets, t => setEInvoicingStatus(t.kind, t.id, status, { ...meta, by: user.email }));
}

/** Recalcule canal et adressage d'après la configuration actuelle (documents non encore transmis). */
export async function recomputeEInvoicing(targets: EInvoicingTarget[]): Promise<BatchResult> {
    await requireUser();
    return forEachTarget(targets, t => recomputeEInvoicingState(t.kind, t.id));
}
