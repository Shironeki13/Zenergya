import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { syncAllIndices } from '@/services/index-sync';
import { AuthError, requireAdmin } from '@/lib/auth/server';

export const runtime = 'nodejs';

/** Appel planifié (Cloud Scheduler…) : en-tête `Authorization: Bearer <CRON_SECRET>`. */
function isCronRequest(req: NextRequest): boolean {
    const secret = process.env.CRON_SECRET;
    const header = req.headers.get('authorization');
    if (!secret || !header) return false;
    const expected = Buffer.from(`Bearer ${secret}`);
    const received = Buffer.from(header);
    return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function POST(req: NextRequest) {
    if (!isCronRequest(req)) {
        try {
            await requireAdmin();
        } catch (error) {
            const status = error instanceof AuthError ? error.status : 401;
            return NextResponse.json({ success: false, message: (error as Error).message }, { status });
        }
    }

    try {
        console.log('API Sync: Starting synchronization...');
        const stats = await syncAllIndices();
        console.log('API Sync: Synchronization finished', stats);
        return NextResponse.json({
            success: true,
            message: 'Indices synchronisés avec succès',
            stats
        });
    } catch (error: any) {
        console.error('API Sync Error:', error);
        return NextResponse.json({
            success: false,
            message: 'Erreur lors de la synchronisation',
            error: error.message,
        }, { status: 500 });
    }
}

// GET accepté pour les déclencheurs planifiés simples (même contrôle d'accès que POST).
export async function GET(req: NextRequest) {
    return POST(req);
}
