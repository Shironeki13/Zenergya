import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/server';
import { DocumentIntegrityError, getDocumentPdf, type ArchivedKind } from '@/services/document-archive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS: Record<string, ArchivedKind> = { invoices: 'invoice', 'credit-notes': 'creditNote' };

/**
 * PDF d'une facture ou d'un avoir : /api/documents/invoices/{id} ou /api/documents/credit-notes/{id}.
 * Servi après vérification de la session (pas de lien public permanent) ; `?download=1` force le téléchargement.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
    try {
        await requireUser();
    } catch (error) {
        const status = error instanceof AuthError ? error.status : 401;
        return NextResponse.json({ error: (error as Error).message }, { status });
    }

    const { kind, id } = await params;
    const archivedKind = KINDS[kind];
    if (!archivedKind) return NextResponse.json({ error: 'Type de document inconnu.' }, { status: 404 });

    try {
        const { buffer, filename, sha256 } = await getDocumentPdf(archivedKind, id);
        const disposition = request.nextUrl.searchParams.get('download') ? 'attachment' : 'inline';
        return new NextResponse(new Uint8Array(buffer), {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Length': String(buffer.length),
                'Content-Disposition': `${disposition}; filename="${filename.replace(/"/g, '')}"`,
                'Cache-Control': 'private, no-store',
                ...(sha256 && { 'X-Content-SHA256': sha256 }),
            },
        });
    } catch (error) {
        console.error(`PDF ${kind}/${id} :`, error);
        if (error instanceof DocumentIntegrityError) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
        const message = error instanceof Error && /introuvable/.test(error.message) ? error.message : 'Génération du PDF impossible.';
        return NextResponse.json({ error: message }, { status: /introuvable/.test(message) ? 404 : 500 });
    }
}
