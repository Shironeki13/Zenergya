import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth/server';
import { isCronRequest } from '@/lib/auth/cron';
import { recomputeSiteAmounts } from '@/services/site-amounts-admin';

export const runtime = 'nodejs';

/**
 * Recalcul quotidien des montants des sites à partir de leurs prestations (une prestation qui commence ou se
 * termine change les montants facturés sans aucune écriture). Appel planifié avec CRON_SECRET, ou administrateur.
 * `?dryRun=1` : liste les changements sans rien écrire.
 */
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
        const dryRun = req.nextUrl.searchParams.get('dryRun') === '1';
        const { checked, changes } = await recomputeSiteAmounts(undefined, { dryRun });
        return NextResponse.json({ success: true, dryRun, checked, changed: changes.length, changes: changes.slice(0, 200) });
    } catch (error) {
        console.error('Recalcul des montants :', error);
        return NextResponse.json({ success: false, message: 'Erreur lors du recalcul des montants.' }, { status: 500 });
    }
}
