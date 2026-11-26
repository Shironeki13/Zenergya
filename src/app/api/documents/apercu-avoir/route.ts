import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/server';
import { gardePerimetre, PerimetreError } from '@/lib/auth/perimetre-server';
import { natureAvoir, texteMotif, type FactureAAnnuler } from '@/lib/billing/avoirs';
import { apercuAvoirPdf } from '@/services/document-archive';
import { getInvoice } from '@/services/firestore-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Aperçu PDF de l'avoir qui annulerait une facture : POST { invoiceId, motif, commentaire? }. Rien n'est écrit. */
export async function POST(request: NextRequest) {
    let corps: { invoiceId?: unknown; motif?: unknown; commentaire?: unknown };
    try { corps = await request.json(); } catch { return NextResponse.json({ error: 'Demande illisible.' }, { status: 400 }); }
    const invoiceId = String(corps.invoiceId ?? '');
    try {
        await gardePerimetre(await requireUser()).exiger('facture', invoiceId);
    } catch (error) {
        const status = error instanceof AuthError ? error.status : error instanceof PerimetreError ? 403 : 401;
        return NextResponse.json({ error: (error as Error).message }, { status });
    }
    try {
        const f = await getInvoice(invoiceId);
        if (!f) return NextResponse.json({ error: 'Facture introuvable.' }, { status: 404 });
        const reason = texteMotif(String(corps.motif ?? ''), typeof corps.commentaire === 'string' ? corps.commentaire : undefined) || 'Motif à préciser';
        const pdf = await apercuAvoirPdf(invoiceId, reason, natureAvoir(f as FactureAAnnuler) === 'interne');
        return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="apercu-avoir.pdf"', 'Cache-Control': 'no-store' } });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Aperçu impossible.' }, { status: 422 });
    }
}
