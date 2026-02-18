import { NextResponse } from 'next/server';
import { syncAllIndices } from '@/services/index-sync';

export async function POST() {
    try {
        const stats = await syncAllIndices();
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
            error: error.message
        }, { status: 500 });
    }
}

// Allow GET for manual debugging or simple cron triggers
export async function GET() {
    return POST();
}
