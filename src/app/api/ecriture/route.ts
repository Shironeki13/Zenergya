import { NextResponse, type NextRequest } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/server';
import { PerimetreError } from '@/lib/auth/perimetre-server';
import { ecrire } from '@/services/ecritures-admin';

export const dynamic = 'force-dynamic';

/**
 * Écriture nommée sur une collection à périmètre : POST /api/ecriture { nom, args }. Session requise ; l'objet doit
 * être dans le périmètre de l'utilisateur (403 sinon) ; un garde-fou métier refusé renvoie 400 avec son message.
 */
export async function POST(request: NextRequest) {
    try {
        const user = await requireUser();
        const { nom, args } = await request.json().catch(() => ({}));
        return NextResponse.json({ data: await ecrire(String(nom ?? ''), args, user) });
    } catch (error) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        if (error instanceof PerimetreError) return NextResponse.json({ error: error.message }, { status: 403 });
        console.error('Écriture :', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Écriture impossible.' }, { status: 400 });
    }
}
