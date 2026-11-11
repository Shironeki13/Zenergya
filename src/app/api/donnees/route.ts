import { NextResponse, type NextRequest } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/server';
import { COLLECTIONS_PERIMETRE, type CollectionPerimetre } from '@/lib/perimetre';
import { chargerDonnees } from '@/services/donnees-admin';

export const dynamic = 'force-dynamic';

/**
 * Collections à périmètre, filtrées pour l'utilisateur connecté : /api/donnees?c=clients,contracts,sites
 * (une seule requête pour plusieurs collections). Session requise.
 */
export async function GET(request: NextRequest) {
    try {
        const user = await requireUser();
        const keys = (request.nextUrl.searchParams.get('c') ?? '').split(',').map(k => k.trim()).filter(Boolean);
        const inconnues = keys.filter(k => !(COLLECTIONS_PERIMETRE as readonly string[]).includes(k));
        if (inconnues.length) return NextResponse.json({ error: `Collection inconnue : ${inconnues.join(', ')}.` }, { status: 400 });
        return NextResponse.json(await chargerDonnees(keys as CollectionPerimetre[], user), { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error('Lecture des données :', error);
        return NextResponse.json({ error: 'Lecture impossible.' }, { status: 500 });
    }
}
