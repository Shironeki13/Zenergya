import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/server';
import { gardePerimetre, PerimetreError } from '@/lib/auth/perimetre-server';
import { DocumentIntegrityError } from '@/services/document-archive';
import { getQuotePdf } from '@/services/quotes-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PDF d'un devis : /api/quotes/{id}/pdf[?version=N][&download=1].
 * Version envoyée : copie archivée, empreinte vérifiée. Brouillon : aperçu généré à la demande.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        await gardePerimetre(await requireUser()).exiger('devis', (await params).id);
    } catch (error) {
        const status = error instanceof AuthError ? error.status : error instanceof PerimetreError ? 403 : 401;
        return NextResponse.json({ error: (error as Error).message }, { status });
    }
    const { id } = await params;
    const versionParam = request.nextUrl.searchParams.get('version');
    const version = versionParam ? Number(versionParam) : undefined;
    if (version !== undefined && !(Number.isInteger(version) && version > 0)) {
        return NextResponse.json({ error: 'Version invalide.' }, { status: 400 });
    }
    try {
        const { buffer, filename, sha256 } = await getQuotePdf(id, version);
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
        console.error(`PDF devis ${id} :`, error);
        if (error instanceof DocumentIntegrityError) return NextResponse.json({ error: error.message }, { status: 500 });
        const message = error instanceof Error && /introuvable/i.test(error.message) ? error.message : 'Génération du PDF impossible.';
        return NextResponse.json({ error: message }, { status: /introuvable/i.test(message) ? 404 : 500 });
    }
}
