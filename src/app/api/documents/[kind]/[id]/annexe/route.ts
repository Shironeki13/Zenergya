import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/server';
import { getDocumentAnnexe, type ArchivedKind } from '@/services/document-archive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS: Record<string, ArchivedKind> = { invoices: 'invoice', 'credit-notes': 'creditNote' };

/**
 * Annexe P1 seule d'une facture ou d'un avoir : /api/documents/invoices/{id}/annexe (PDF) ou `?format=xlsx` (tableur).
 * Session requise ; `?download=1` force le téléchargement du PDF (le tableur est toujours téléchargé).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
    try {
        await requireUser();
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: error instanceof AuthError ? error.status : 401 });
    }
    const { kind, id } = await params;
    const archivedKind = KINDS[kind];
    if (!archivedKind) return NextResponse.json({ error: 'Type de document inconnu.' }, { status: 404 });
    const format = request.nextUrl.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'pdf';
    try {
        const { buffer, filename, contentType } = await getDocumentAnnexe(archivedKind, id, format);
        const disposition = format === 'xlsx' || request.nextUrl.searchParams.get('download') ? 'attachment' : 'inline';
        return new NextResponse(new Uint8Array(buffer), {
            headers: { 'Content-Type': contentType, 'Content-Length': String(buffer.length), 'Content-Disposition': `${disposition}; filename="${filename}"`, 'Cache-Control': 'private, no-store' },
        });
    } catch (error) {
        console.error(`Annexe ${kind}/${id} :`, error);
        const message = error instanceof Error && /introuvable/.test(error.message) ? error.message : "Génération de l'annexe impossible.";
        return NextResponse.json({ error: message }, { status: /introuvable/.test(message) ? 404 : 500 });
    }
}
