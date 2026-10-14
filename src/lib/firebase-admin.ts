import 'server-only';
import { initializeApp, getApps, getApp, cert, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * Firebase Admin SDK (serveur uniquement).
 *
 * Identifiants :
 * - Sur Cloud Run / Firebase App Hosting : identifiants par défaut du compte de service (ADC), rien à configurer.
 * - En local : soit GOOGLE_APPLICATION_CREDENTIALS (chemin vers une clé JSON),
 *   soit FIREBASE_SERVICE_ACCOUNT_KEY (contenu JSON de la clé).
 */
function createAdminApp(): App {
    if (getApps().length) return getApp();

    // Clé dynamique : lue à l'exécution (Next.js remplacerait process.env.NEXT_PUBLIC_… par sa valeur au build).
    const env = process.env as Record<string, string | undefined>;
    const projectId = env.FIREBASE_PROJECT_ID || env['NEXT_PUBLIC_FIREBASE_PROJECT_ID'];
    const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

    if (serviceAccountKey) {
        return initializeApp({ credential: cert(JSON.parse(serviceAccountKey)), projectId });
    }
    return initializeApp({ projectId });
}

const adminApp = createAdminApp();

export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);
try {
    // Même comportement que le SDK client utilisé jusqu'ici : les champs `undefined` sont ignorés.
    adminDb.settings({ ignoreUndefinedProperties: true });
} catch {
    // Déjà configuré (rechargement à chaud en développement).
}
