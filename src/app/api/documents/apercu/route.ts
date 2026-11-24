import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/server';
import { gardePerimetre, PerimetreError } from '@/lib/auth/perimetre-server';
import { prepareContractInvoice } from '@/services/contract-billing-admin';
import { toDay } from '@/lib/services/site-amounts';
import { apercuPdf } from '@/services/document-archive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Aperçu PDF d'une facture de contrat avant son émission (facturation manuelle) : POST { contractId, until?, selection }.
 * Même calcul que l'émission, à la date du jour ; rien n'est écrit.
 */
export async function POST(request: NextRequest) {
    let corps: { contractId?: unknown; invoiceDate?: unknown; until?: unknown; selection?: unknown };
    try { corps = await request.json(); } catch { return NextResponse.json({ error: 'Demande illisible.' }, { status: 400 }); }
    const contractId = String(corps.contractId ?? '');
    const selection = Array.isArray(corps.selection) ? corps.selection.filter((x): x is string => typeof x === 'string').slice(0, 500) : [];
    try {
        await gardePerimetre(await requireUser()).exiger('contrat', contractId);
    } catch (error) {
        const status = error instanceof AuthError ? error.status : error instanceof PerimetreError ? 403 : 401;
        return NextResponse.json({ error: (error as Error).message }, { status });
    }
    try {
        const p = await prepareContractInvoice(contractId, toDay(new Date())!, { isProforma: true, until: typeof corps.until === 'string' ? corps.until : undefined, selection });
        const buffer = await apercuPdf(p);
        return new NextResponse(new Uint8Array(buffer), {
            headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(buffer.length), 'Content-Disposition': 'inline; filename="Apercu.pdf"', 'Cache-Control': 'private, no-store' },
        });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Aperçu impossible.' }, { status: 422 });
    }
}
