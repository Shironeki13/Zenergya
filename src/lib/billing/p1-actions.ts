'use server';

import { requireUser } from '@/lib/auth/server';
import { emitP1Regularisation, prepareP1Regularisation } from '@/services/p1-regularisation-admin';
import { vatTotals } from '@/lib/billing/contract-billing';
import type { InvoiceLineItem } from '@/lib/types';

/** Régularisation P1 : aperçu et émission (au nom de l'utilisateur connecté). */

type Result<T> = { success: true; data: T } | { success: false; error: string };
const fail = (e: unknown): { success: false; error: string } => ({ success: false, error: e instanceof Error ? e.message : 'Opération impossible.' });

export type RegulPreviewView = {
    errors: string[];
    detail: { siteId: string; site: string; usage: 'total' | 'chauffage' | 'ecs'; reel: number; acomptes: number; ecart: number }[];
    lines: Pick<InvoiceLineItem, 'description' | 'total' | 'vatRate'>[];
    facture: { subtotal: number; tax: number; total: number } | null;
    avoir: { subtotal: number; tax: number; total: number } | null;
};

export async function previewP1RegularisationAction(contractId: string, debut: string, fin: string): Promise<Result<RegulPreviewView>> {
    try {
        await requireUser();
        const p = await prepareP1Regularisation(contractId, debut, fin);
        const pos = p.lines.filter(l => l.total > 0);
        const neg = p.lines.filter(l => l.total < 0);
        const pick = (t: ReturnType<typeof vatTotals>) => ({ subtotal: t.subtotal, tax: t.tax, total: t.total });
        return {
            success: true,
            data: {
                errors: p.errors, detail: p.detail, lines: p.lines.map(l => ({ description: l.description, total: l.total, vatRate: l.vatRate })),
                facture: pos.length ? pick(vatTotals(pos)) : null, avoir: neg.length ? pick(vatTotals(neg)) : null,
            },
        };
    } catch (e) { return fail(e); }
}

export async function emitP1RegularisationAction(contractId: string, debut: string, fin: string, date: string): Promise<Result<{ invoice?: { id: string; number?: string }; creditNote?: { id: string; number: string } }>> {
    try { await requireUser(); return { success: true, data: await emitP1Regularisation(contractId, debut, fin, date) }; } catch (e) { return fail(e); }
}
