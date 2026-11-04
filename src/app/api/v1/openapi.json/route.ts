import { NextResponse, type NextRequest } from 'next/server';
import { buildOpenApi } from '@/lib/api/openapi';

export const dynamic = 'force-dynamic';

/** Spécification OpenAPI de l'API externe (publique : ne contient aucune donnée). */
export function GET(req: NextRequest) {
    return NextResponse.json(buildOpenApi(`${req.nextUrl.origin}/api/v1`), { headers: { 'Cache-Control': 'public, max-age=300' } });
}
