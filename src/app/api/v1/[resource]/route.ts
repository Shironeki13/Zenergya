import { type NextRequest } from 'next/server';
import { handleApi, notFound } from '@/lib/api/http';
import { isApiResource } from '@/lib/api/scopes';
import { listResource, upsertResource } from '@/services/api-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/{ressource} : liste paginée. POST : création / mise à jour par lot. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ resource: string }> }) {
    const { resource } = await params;
    if (!isApiResource(resource)) return notFound();
    return handleApi(req, `${resource}:read`, async () => {
        const page = await listResource(resource, req.nextUrl.searchParams);
        return { body: page, items: page.data.length };
    });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ resource: string }> }) {
    const { resource } = await params;
    if (!isApiResource(resource)) return notFound();
    return handleApi(req, `${resource}:write`, async (caller, body) => {
        const result = await upsertResource(resource, body, caller);
        return { body: result, items: result.results.length };
    });
}
