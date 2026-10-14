import { NextResponse } from 'next/server';
import { BROWSER_CONFIG_GLOBAL, readFirebaseConfigFromEnv } from '@/lib/firebase-config';

// Lu à chaque requête : la configuration vient des variables d'environnement du service, pas du build.
export const dynamic = 'force-dynamic';

/** Script chargé avant l'application (voir app/layout.tsx) : expose la configuration web Firebase au navigateur. */
export function GET() {
    const config = readFirebaseConfigFromEnv();
    if (!config.apiKey || !config.projectId) {
        console.error('Configuration Firebase incomplète : définissez les variables NEXT_PUBLIC_FIREBASE_* du service.');
    }
    return new NextResponse(`window.${BROWSER_CONFIG_GLOBAL}=${JSON.stringify(config)};`, {
        headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-store',
        },
    });
}
