/**
 * Configuration web Firebase (publique : elle est de toute façon envoyée au navigateur).
 *
 * Elle est lue À L'EXÉCUTION dans les variables d'environnement du serveur (ex. variables du service Cloud Run),
 * puis transmise au navigateur par /api/firebase-config : l'image Docker n'a pas besoin de la connaître au build.
 */
export type FirebaseWebConfig = {
    apiKey?: string;
    authDomain?: string;
    projectId?: string;
    storageBucket?: string;
    messagingSenderId?: string;
    appId?: string;
    measurementId?: string;
    /** Développement / tests uniquement : hôte des émulateurs Firebase (ports par défaut de firebase.json). */
    emulatorHost?: string;
};

const ENV_KEYS: Record<Exclude<keyof FirebaseWebConfig, 'emulatorHost'>, string> = {
    apiKey: 'NEXT_PUBLIC_FIREBASE_API_KEY',
    authDomain: 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
    projectId: 'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
    storageBucket: 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
    messagingSenderId: 'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
    appId: 'NEXT_PUBLIC_FIREBASE_APP_ID',
    measurementId: 'NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID',
};

/** Variable globale posée dans le navigateur par /api/firebase-config. */
export const BROWSER_CONFIG_GLOBAL = '__FIREBASE_CONFIG__';

/**
 * Lecture côté serveur, à l'exécution. L'accès par clé dynamique (`process.env[name]`) est volontaire :
 * Next.js remplace `process.env.NEXT_PUBLIC_…` écrit en clair par sa valeur au moment du build.
 */
export function readFirebaseConfigFromEnv(): FirebaseWebConfig {
    const env = process.env as Record<string, string | undefined>;
    const config: FirebaseWebConfig = {};
    for (const [key, name] of Object.entries(ENV_KEYS) as [keyof FirebaseWebConfig, string][]) {
        const value = env[name]?.trim();
        if (value) config[key as keyof typeof ENV_KEYS] = value;
    }
    // Jamais défini en production : connecte le navigateur aux émulateurs (auth 9099, firestore 8080, storage 9199).
    const emulatorHost = env.FIREBASE_WEB_EMULATOR_HOST?.trim();
    if (emulatorHost) config.emulatorHost = emulatorHost;
    return config;
}
