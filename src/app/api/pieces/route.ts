import { randomUUID } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/server';
import { PerimetreError, gardePerimetre } from '@/lib/auth/perimetre-server';
import { adminBucket } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

const TAILLE_MAX = 20 * 1024 * 1024;
const TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const DOSSIERS = ['base-marche', 'avenants', 'ordres-de-service', 'resiliations', 'reconductions', 'changements-syndic', 'changements-be'];
/** Contrat en cours de création (assistant) : la pièce est déposée avant que le contrat existe. */
const A_RATTACHER = 'a-rattacher';

/**
 * Dépôt d'une pièce justificative de contrat : POST /api/pieces (formulaire : fichier, contractId, dossier).
 * Le serveur vérifie la session, le périmètre (contrat d'un client de l'utilisateur), le type et la taille du fichier,
 * puis l'enregistre dans le stockage. Le navigateur n'écrit pas dans le stockage. Renvoie l'adresse du document.
 */
export async function POST(request: NextRequest) {
    try {
        const user = await requireUser();
        const form = await request.formData();
        const fichier = form.get('fichier');
        const contractId = String(form.get('contractId') ?? '');
        const dossier = String(form.get('dossier') ?? '');
        if (!(fichier instanceof File)) return NextResponse.json({ error: 'Fichier manquant.' }, { status: 400 });
        if (!DOSSIERS.includes(dossier)) return NextResponse.json({ error: 'Type de document inconnu.' }, { status: 400 });
        if (!TYPES.includes(fichier.type)) return NextResponse.json({ error: 'PDF, PNG ou JPEG uniquement.' }, { status: 400 });
        if (fichier.size === 0 || fichier.size > TAILLE_MAX) return NextResponse.json({ error: 'Fichier vide ou trop volumineux (20 Mo au plus).' }, { status: 400 });
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(contractId)) return NextResponse.json({ error: 'Contrat invalide.' }, { status: 400 });
        if (contractId !== A_RATTACHER) await gardePerimetre(user).exiger('contrat', contractId);

        const nom = fichier.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120) || 'document';
        const chemin = `contracts/${contractId}/${dossier}/${Date.now()}-${nom}`;
        const jeton = randomUUID();
        const bucket = adminBucket();
        await bucket.file(chemin).save(Buffer.from(await fichier.arrayBuffer()), {
            contentType: fichier.type,
            metadata: { contentDisposition: `inline; filename*=utf-8''${encodeURIComponent(fichier.name)}`, metadata: { firebaseStorageDownloadTokens: jeton, deposePar: user.email } },
        });
        // Adresse de téléchargement à jeton (même forme que celle du SDK). Émulateur : servie par la même origine.
        const base = process.env.FIREBASE_STORAGE_EMULATOR_HOST
            ? `${request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '')}://${request.headers.get('x-forwarded-host') ?? request.headers.get('host')}`
            : 'https://firebasestorage.googleapis.com';
        return NextResponse.json({ documentUrl: `${base}/v0/b/${bucket.name}/o/${encodeURIComponent(chemin)}?alt=media&token=${jeton}`, documentName: fichier.name });
    } catch (error) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        if (error instanceof PerimetreError) return NextResponse.json({ error: error.message }, { status: 403 });
        console.error('Dépôt de pièce :', error);
        return NextResponse.json({ error: 'Dépôt impossible.' }, { status: 500 });
    }
}
