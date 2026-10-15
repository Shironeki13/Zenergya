// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getAuth, connectAuthEmulator } from "firebase/auth";

import { BROWSER_CONFIG_GLOBAL, readFirebaseConfigFromEnv, type FirebaseWebConfig } from './firebase-config';

// Configuration web Firebase, lue à l'exécution (voir firebase-config.ts) :
// - navigateur : posée par le script /api/firebase-config, chargé avant l'application ;
// - serveur : variables d'environnement du service.
// À défaut (ex. build Docker avec --build-arg), valeurs intégrées au moment du build.
const buildTimeConfig: FirebaseWebConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
};

// `export let` : liaisons ES « vivantes », les modules qui importent db/storage/auth voient leur valeur
// une fois Firebase initialisé, même si l'initialisation a lieu après le chargement de ce module.
export let db: any;
export let storage: any;
export let auth: any;

/** Configuration web Firebase absente côté serveur (variables NEXT_PUBLIC_FIREBASE_* du service non définies). */
export class FirebaseConfigError extends Error {
  code = 'app/config-missing';
  constructor() {
    super("Configuration Firebase absente sur le serveur : les variables NEXT_PUBLIC_FIREBASE_* du service ne sont pas définies (voir /api/firebase-config).");
  }
}

let resolveReady: () => void;
let rejectReady: (error: Error) => void;
let initialized = false;
/**
 * Résolue quand Firebase est initialisé (côté navigateur, à l'arrivée de la configuration),
 * rejetée avec FirebaseConfigError si la configuration est absente.
 */
export const firebaseReady = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
// Évite l'avertissement « promesse rejetée non gérée » : chaque utilisateur de firebaseReady gère l'erreur.
firebaseReady.catch(() => undefined);

function failMissingConfig() {
  const error = new FirebaseConfigError();
  console.error(error.message);
  rejectReady(error);
}

function initFirebase({ emulatorHost, ...config }: FirebaseWebConfig) {
  initialized = true;
  const app = !getApps().length ? initializeApp(config) : getApp();
  try {
    db = getFirestore(app);
  } catch (e) {
    console.warn("Firebase Firestore not initialized (likely on server):", e);
  }
  try {
    storage = getStorage(app);
  } catch (e) {
    console.warn("Firebase Storage not initialized (likely on server):", e);
  }
  try {
    auth = getAuth(app);
  } catch (e) {
    console.warn("Firebase Auth not initialized (likely on server):", e);
  }
  if (emulatorHost && typeof window !== 'undefined') {
    // Développement / tests uniquement (FIREBASE_WEB_EMULATOR_HOST).
    connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, emulatorHost, 8080);
    connectStorageEmulator(storage, emulatorHost, 9199);
  }
  resolveReady();
}

if (typeof window === 'undefined') {
  // Serveur : variables d'environnement du service.
  const runtimeConfig = readFirebaseConfigFromEnv();
  initFirebase(runtimeConfig.apiKey ? runtimeConfig : buildTimeConfig);
} else {
  const w = window as any;
  if (w[BROWSER_CONFIG_GLOBAL]?.apiKey) {
    initFirebase(w[BROWSER_CONFIG_GLOBAL]);
  } else if (buildTimeConfig.apiKey) {
    initFirebase(buildTimeConfig);
  } else if (BROWSER_CONFIG_GLOBAL in w) {
    // Le script /api/firebase-config a déjà répondu, sans configuration.
    failMissingConfig();
  } else {
    // Le script /api/firebase-config n'a pas encore été exécuté : on initialise dès qu'il pose la configuration.
    Object.defineProperty(w, BROWSER_CONFIG_GLOBAL, {
      configurable: true,
      get: () => undefined,
      set: (config: FirebaseWebConfig) => {
        Object.defineProperty(w, BROWSER_CONFIG_GLOBAL, { value: config, writable: true, configurable: true });
        if (config?.apiKey) {
          initFirebase(config);
        } else {
          failMissingConfig();
        }
      },
    });
    // Script de configuration jamais exécuté (erreur réseau…) : on n'attend pas indéfiniment.
    setTimeout(() => { if (!initialized) failMissingConfig(); }, 15000);
  }
}
