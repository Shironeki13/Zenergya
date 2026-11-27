import { NextResponse, type NextRequest } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/server';
import { deposerProposition } from '@/services/propositions-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Dépôt d'un document pour proposition de création : POST /api/propositions (formulaire : fichier, type =
 * pdf-prive | pdf-public). Le document est enregistré puis lu par l'IA ; rien n'est créé. Module Contrats requis.
 */
export async function POST(request: NextRequest) {
    try {
        const user = await requireUser();
        if (!user.isAdmin && !user.isContratheque && !user.profile.modules?.includes('contracts')) return NextResponse.json({ error: 'Réservé au module Contrats.' }, { status: 403 });
        const form = await request.formData();
        const fichier = form.get('fichier');
        const type = String(form.get('type') ?? 'pdf-prive');
        if (!(fichier instanceof File)) return NextResponse.json({ error: 'Fichier manquant.' }, { status: 400 });
        if (type !== 'pdf-prive' && type !== 'pdf-public') return NextResponse.json({ error: 'Type de marché inconnu.' }, { status: 400 });
        const origine = `${request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '')}://${request.headers.get('x-forwarded-host') ?? request.headers.get('host')}`;
        const p = await deposerProposition({ nom: fichier.name, contentType: fichier.type, contenu: Buffer.from(await fichier.arrayBuffer()), type, origine }, user);
        return NextResponse.json({ id: p.id, statut: p.statut, erreur: p.erreur ?? null });
    } catch (error) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Dépôt impossible.' }, { status: 400 });
    }
}
