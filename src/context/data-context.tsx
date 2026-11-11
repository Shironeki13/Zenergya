
'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import {
  getMeterTypes, getCompanies, getAgencies, getSectors, getActivities, getSchedules, getTerms,
  getTypologies, getVatRates, getRevisionFormulas, getPaymentTerms, getPricingRules,
  getMarkets, getRoles, getUsers, getIndices, getIndexValues, getRevisionRules, getSettlementRules,
  getWeatherStations,
  initializeSettlementRules,
} from '@/services/firestore';
import { auth, firebaseReady } from '@/lib/firebase';
import { EAGER_COLLECTIONS, LAZY_COLLECTIONS, type CollectionKey, type DataContextType, type LazyCollectionKey, type User } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { COLLECTIONS_PERIMETRE, clientsDuPerimetre, filtrerPerimetre, type CollectionPerimetre } from '@/lib/perimetre';

const DataContext = createContext<DataContextType | undefined>(undefined);

/**
 * Données partagées entre les écrans.
 * - À l'ouverture : les référentiels et les listes de base (EAGER_COLLECTIONS).
 * - À la demande : les collections volumineuses (LAZY_COLLECTIONS — factures, avoirs, relevés, valeurs d'indices,
 *   contacts, compteurs), chargées au premier écran qui les demande par `useCollections(...)`, puis gardées.
 * - Après un enregistrement : `reloadData(['clients'])` ne recharge que les collections citées, sans écran d'attente.
 */
type Collections = Pick<DataContextType, CollectionKey>;
/** Chargeurs directs des référentiels. Les collections à périmètre viennent du serveur (/api/donnees). */
type CollectionDirecte = Exclude<CollectionKey, CollectionPerimetre>;
const LOADERS: { [K in CollectionDirecte]: () => Promise<Collections[K]> } = {
  companies: getCompanies, agencies: getAgencies, sectors: getSectors, activities: getActivities, schedules: getSchedules, terms: getTerms, typologies: getTypologies,
  vatRates: getVatRates, revisionFormulas: getRevisionFormulas, revisionRules: getRevisionRules, paymentTerms: getPaymentTerms, pricingRules: getPricingRules,
  markets: getMarkets, roles: getRoles, users: getUsers, indices: getIndices, meterTypes: getMeterTypes, settlementRules: getSettlementRules,
  weatherStations: getWeatherStations, indexValues: getIndexValues,
};
const estPerimetre = (k: CollectionKey): k is CollectionPerimetre => (COLLECTIONS_PERIMETRE as readonly string[]).includes(k);

/** Collections à périmètre, lues et filtrées par le serveur (/api/donnees). */
async function chargerDuServeur(keys: CollectionPerimetre[]): Promise<Partial<Record<CollectionPerimetre, unknown[]>>> {
  const res = await fetch(`/api/donnees?c=${keys.join(',')}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Lecture des données refusée (${res.status}).`);
  return res.json();
}

const estLazy = (k: CollectionKey): k is LazyCollectionKey => (LAZY_COLLECTIONS as readonly string[]).includes(k);

/**
 * Mémoire des collections à la demande utilisées par chaque écran (par adresse, identifiants neutralisés) : à
 * l'ouverture de l'application sur cet écran, elles sont chargées en même temps que le reste, sans attendre que
 * l'écran les demande. Simple optimisation : sans mémoire (premier passage, stockage indisponible), l'écran les demande.
 */
const CLE_MEMOIRE = 'zenergya.collections';
const cleRoute = () => window.location.pathname.replace(/\/[^/]*\d[^/]*|\/[A-Za-z0-9]{16,}/g, '/*');
function lireMemoire(): Record<string, LazyCollectionKey[]> {
  try { return JSON.parse(localStorage.getItem(CLE_MEMOIRE) ?? '{}'); } catch { return {}; }
}
function memoriser(keys: LazyCollectionKey[]) {
  try {
    const m = lireMemoire(), route = cleRoute();
    const tout = [...new Set([...(m[route] ?? []), ...keys])];
    if (tout.length !== (m[route] ?? []).length) localStorage.setItem(CLE_MEMOIRE, JSON.stringify({ ...m, [route]: tout }));
  } catch { /* stockage indisponible */ }
}

const createEmptyData = (): Collections => Object.fromEntries([...EAGER_COLLECTIONS, ...LAZY_COLLECTIONS].map(k => [k, []])) as unknown as Collections;

type SessionInfo = { user: User; isAdmin: boolean; isContratheque: boolean; isAcheteur: boolean };

/** Erreur d'authentification applicative (compte non autorisé, session impossible à ouvrir). */
class AppAuthError extends Error {
  constructor(public code: 'app/not-authorized' | 'app/session-failed', message: string) {
    super(message);
  }
}

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [data, setData] = useState(createEmptyData);

  // Utilisateur réellement authentifié (session serveur validée).
  const [authUser, setAuthUser] = useState<User | null>(null);
  // Utilisateur affiché : identique à authUser, sauf en mode « Preview As » (admin).
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isContratheque, setIsContratheque] = useState(false);
  const [isAcheteur, setIsAcheteur] = useState(false);
  const sessionRef = useRef<{ uid: string; promise: Promise<SessionInfo> } | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  // Collections à la demande : celles qu'un écran a demandées (à recharger avec le reste) et celles déjà chargées.
  const demandees = useRef(new Set<LazyCollectionKey>());
  const enCours = useRef(new Map<LazyCollectionKey, Promise<void>>());
  const [chargees, setChargees] = useState<Partial<Record<LazyCollectionKey, boolean>>>({});
  const connecte = useRef(false);

  /** Charge des collections et les range dans l'état ; une collection en échec garde sa valeur précédente. */
  const charger = useCallback(async (keys: CollectionKey[]) => {
    const uniques = [...new Set(keys)];
    // Collections à périmètre : une seule requête au serveur, qui ne renvoie que le périmètre de l'utilisateur.
    // Référentiels : lus directement dans la base.
    const duServeur = uniques.filter(estPerimetre);
    const serveur = duServeur.length ? chargerDuServeur(duServeur) : null;
    const resultats = await Promise.allSettled(uniques.map(k => (estPerimetre(k) ? serveur!.then(r => r[k] as Collections[typeof k]) : LOADERS[k]())));
    const maj: Partial<Collections> = {};
    resultats.forEach((r, i) => {
      if (r.status === 'fulfilled') (maj as Record<string, unknown>)[uniques[i]] = r.value;
      else console.error(`Failed to load ${uniques[i]}`, r.reason);
    });
    setData(prev => ({ ...prev, ...maj }));
    const lazy = uniques.filter(estLazy);
    if (lazy.length) setChargees(prev => ({ ...prev, ...Object.fromEntries(lazy.map(k => [k, true])) }));
    return resultats;
  }, []);

  const demander = useCallback((keys: LazyCollectionKey[], retenir = true) => {
    if (retenir && keys.length) memoriser(keys);
    for (const k of keys) {
      demandees.current.add(k);
      if (!connecte.current || enCours.current.has(k)) continue;
      const p = charger([k]).then(() => undefined).finally(() => { enCours.current.delete(k); });
      enCours.current.set(k, p);
    }
  }, [charger]);

  const loadAllData = useCallback(async () => {
    setIsLoading(true);
    try {
      connecte.current = true;
      // Collections dont cet écran a eu besoin la dernière fois : chargées d'emblée, avec le reste.
      for (const k of lireMemoire()[cleRoute()] ?? []) if (estLazy(k)) demandees.current.add(k);
      const keys: CollectionKey[] = [...EAGER_COLLECTIONS, ...demandees.current];
      const resultats = await charger(keys);

      // Auto-init rules if empty (side effect, but ensures we exist)
      const regles = resultats[keys.indexOf('settlementRules')];
      if (regles.status === 'fulfilled' && (regles.value as unknown[]).length === 0) {
        // Écriture d'un référentiel : possible avec le module Paramétrage seulement ; sinon, il sera créé par un utilisateur qui l'a.
        await initializeSettlementRules().then(() => charger(['settlementRules'])).catch(() => undefined);
      }
    } catch (error) {
      console.error("A critical error occurred during data loading:", error);
      toast({
        title: "Erreur de chargement",
        description: "Impossible de charger les données initiales de l'application.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast, charger]);

  /** Sans argument : tout ce qui est chargé, avec l'écran d'attente. Avec des collections : elles seules, sans écran d'attente. */
  const reloadData = useCallback(async (collections?: CollectionKey[]) => {
    if (!collections) return loadAllData();
    // Une collection à la demande que personne n'a encore demandée n'est pas en mémoire : rien à recharger.
    await charger(collections.filter(k => !estLazy(k) || demandees.current.has(k)));
  }, [loadAllData, charger]);

  /**
   * Ouvre la session serveur (cookie httpOnly) pour l'utilisateur Firebase connecté.
   * Le serveur vérifie qu'il est autorisé et positionne ses droits (custom claims) utilisés par les règles Firestore.
   * Un seul appel par utilisateur, même si login() et onAuthStateChanged le demandent tous les deux.
   */
  const establishSession = useCallback((firebaseUser: any): Promise<SessionInfo> => {
    const pending = sessionRef.current;
    if (pending && pending.uid === firebaseUser.uid) return pending.promise;

    const promise = (async () => {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) {
        if (res.status === 403) {
          throw new AppAuthError('app/not-authorized', "Ce compte n'est pas autorisé à accéder à l'application.");
        }
        throw new AppAuthError('app/session-failed', "Impossible d'ouvrir la session.");
      }
      const body = await res.json();
      // Les droits viennent d'être (re)positionnés : on force un nouveau jeton pour que Firestore les voie.
      if (body.claimsUpdated) await firebaseUser.getIdToken(true);
      return { user: body.user as User, isAdmin: body.isAdmin === true, isContratheque: body.isContratheque === true, isAcheteur: body.isAcheteur === true };
    })();

    sessionRef.current = { uid: firebaseUser.uid, promise };
    promise.catch(() => {
      if (sessionRef.current?.promise === promise) sessionRef.current = null;
    });
    return promise;
  }, []);

  // Authentication Methods
  const login = async (email: string, password: string) => {
    await firebaseReady;
    const { signInWithEmailAndPassword } = await import('firebase/auth');
    const credential = await signInWithEmailAndPassword(auth, email, password);
    await establishSession(credential.user);
  };

  const loginWithGoogle = async () => {
    await firebaseReady;
    const { signInWithPopup, GoogleAuthProvider } = await import('firebase/auth');
    const credential = await signInWithPopup(auth, new GoogleAuthProvider());
    await establishSession(credential.user);
  };

  const logout = async () => {
    await fetch('/api/auth/session', { method: 'DELETE' }).catch(() => undefined);
    await firebaseReady;
    const { signOut } = await import('firebase/auth');
    await signOut(auth);
  };

  useEffect(() => {
    // Firebase est initialisé dès que la configuration (lue à l'exécution) est disponible.
    const unsubscribe = firebaseReady.then(() => import('firebase/auth')).then(({ onAuthStateChanged, signOut }) =>
      onAuthStateChanged(auth, async (firebaseUser) => {
        if (!firebaseUser) {
          sessionRef.current = null;
          setAuthUser(null);
          setCurrentUser(null);
          setIsAdmin(false);
          setIsContratheque(false);
          setIsAcheteur(false);
          connecte.current = false;
          setData(createEmptyData());
          setChargees({});
          setIsLoading(false);
          return;
        }

        try {
          const session = await establishSession(firebaseUser);
          setAuthUser(session.user);
          setCurrentUser(session.user);
          setIsAdmin(session.isAdmin);
          setIsContratheque(session.isContratheque);
          setIsAcheteur(session.isAcheteur);
          await loadAllData();
        } catch (error) {
          console.error('Session error:', error);
          await fetch('/api/auth/session', { method: 'DELETE' }).catch(() => undefined);
          await signOut(auth);
        }
      })
    ).catch((error) => {
      // Configuration Firebase absente : on affiche la page de connexion, qui expliquera l'erreur.
      console.error('Firebase indisponible :', error);
      setIsLoading(false);
      return () => undefined;
    });

    return () => {
      unsubscribe.then(unsub => unsub());
    };
  }, [loadAllData, establishSession]);

  // Périmètre : les écrans ne reçoivent que les données des sociétés, agences et secteurs de l'utilisateur affiché.
  // Un administrateur voit tout, sauf lorsqu'il affiche l'application « en tant que » un autre utilisateur.
  const toutVoir = isAdmin && (!currentUser || currentUser.id === authUser?.id);
  const perimetre = currentUser?.scope;
  const visibles = useMemo(() => filtrerPerimetre(data, perimetre, toutVoir), [data, perimetre, toutVoir]);
  const clientsVisibles = useMemo(() => clientsDuPerimetre(data.clients, perimetre, toutVoir), [data.clients, perimetre, toutVoir]);
  const voitClient = useCallback((clientId?: string | null) => toutVoir || (!!clientId && clientsVisibles.has(clientId)), [toutVoir, clientsVisibles]);
  const modules = useMemo(() => currentUser?.modules ?? [], [currentUser]);

  return (
    <DataContext.Provider value={{ ...visibles, voitClient, toutVoir, modules, isLoading, reloadData, demander, chargees, authUser, currentUser, setCurrentUser, isAdmin, isContratheque, isAcheteur, login, loginWithGoogle, logout }}>
      {children}
    </DataContext.Provider>
  );
};

export const useData = (): DataContextType => {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
};

/**
 * Déclare les collections volumineuses dont l'écran a besoin (factures, avoirs, relevés, valeurs d'indices, contacts,
 * compteurs) : elles sont chargées à la première demande. Renvoie `true` quand elles sont toutes en mémoire.
 *   const { invoices } = useData();
 *   const pret = useCollections('invoices');
 */
export function useCollections(...collections: LazyCollectionKey[]): boolean {
  return useCollectionsOptions(collections, true);
}

/** Comme `useCollections`, pour un composant toujours affiché (recherche, fil d'Ariane) : sa demande n'est pas retenue pour l'écran. */
export function useCollectionsPonctuelles(...collections: LazyCollectionKey[]): boolean {
  return useCollectionsOptions(collections, false);
}

function useCollectionsOptions(collections: LazyCollectionKey[], retenir: boolean): boolean {
  const { demander, chargees, currentUser } = useData();
  const cle = collections.join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (currentUser) demander(collections, retenir); }, [cle, demander, currentUser, retenir]);
  return collections.every(k => chargees[k]);
}
