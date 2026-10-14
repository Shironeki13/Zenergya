// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";

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

let resolveReady: () => void;
/** Résolue quand Firebase est initialisé (côté navigateur, à l'arrivée de la configuration). */
export const firebaseReady = new Promise<void>(resolve => { resolveReady = resolve; });

function initFirebase(config: FirebaseWebConfig) {
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
          console.error('Configuration Firebase absente : définissez les variables NEXT_PUBLIC_FIREBASE_* du service (voir /api/firebase-config).');
        }
      },
    });
  }
}
