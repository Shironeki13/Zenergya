import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/server';
import { invalidSearch, type EntrepriseSearchParams } from '@/lib/entreprises';
import { EntreprisesApiError, searchEntreprises } from '@/services/entreprises';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Recherche dans le répertoire des entreprises (API de l'État), réservée aux utilisateurs connectés.
 * GET /api/entreprises/search?q=…&codePostal=…&departement=…&inclureCessees=1&page=…
 */
export async function GET(request: NextRequest) {
    try {
        await requireUser();
    } catch (error) {
        const status = error instanceof AuthError ? error.status : 401;
        return NextResponse.json({ error: (error as Error).message }, { status });
    }

    const sp = request.nextUrl.searchParams;
    const params: EntrepriseSearchParams = {
        q: sp.get('q') ?? '',
        codePostal: sp.get('codePostal') || undefined,
        departement: sp.get('departement') || undefined,
        inclureCessees: sp.get('inclureCessees') === '1',
        page: Number(sp.get('page')) || 1,
    };
    const invalid = invalidSearch(params);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    try {
        return NextResponse.json(await searchEntreprises(params), { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
        if (error instanceof EntreprisesApiError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error('Recherche d\'entreprises :', error);
        return NextResponse.json({ error: 'Recherche impossible.' }, { status: 500 });
    }
}
