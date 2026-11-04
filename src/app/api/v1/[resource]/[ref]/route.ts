import { type NextRequest } from 'next/server';
import { handleApi, notFound } from '@/lib/api/http';
import { isApiResource } from '@/lib/api/scopes';
import { getResource } from '@/services/api-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/{ressource}/{code} : détail (code Zenergya ; identifiant pour un contact). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ resource: string; ref: string }> }) {
    const { resource, ref } = await params;
    if (!isApiResource(resource)) return notFound();
    return handleApi(req, `${resource}:read`, async () => ({ body: await getResource(resource, decodeURIComponent(ref)), items: 1 }));
}
