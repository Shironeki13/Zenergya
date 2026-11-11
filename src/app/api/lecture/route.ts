import { NextResponse, type NextRequest } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/server';
import { PerimetreError } from '@/lib/auth/perimetre-server';
import { lire } from '@/services/lectures-admin';

export const dynamic = 'force-dynamic';

/**
 * Lecture nommée d'une fiche ou des éléments d'un objet : POST /api/lecture { nom, args }. Session requise ; un objet
 * hors du périmètre de l'utilisateur est refusé (403, `horsPerimetre`).
 */
export async function POST(request: NextRequest) {
    try {
        const user = await requireUser();
        const { nom, args } = await request.json().catch(() => ({}));
        return NextResponse.json({ data: await lire(String(nom ?? ''), args ?? {}, user) }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        if (error instanceof PerimetreError) return NextResponse.json({ error: error.message, horsPerimetre: true }, { status: 403 });
        if (error instanceof Error && error.message === 'Lecture inconnue.') return NextResponse.json({ error: error.message }, { status: 400 });
        console.error('Lecture :', error);
        return NextResponse.json({ error: 'Lecture impossible.' }, { status: 500 });
    }
}
