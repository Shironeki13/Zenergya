
'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import {
  getClients, getContacts, getSites, getContracts, getInvoices, getCreditNotes, getMeters, getMeterTypes, getMeterReadings,
  getCompanies, getAgencies, getSectors, getActivities, getSchedules, getTerms,
  getTypologies, getVatRates, getRevisionFormulas, getPaymentTerms, getPricingRules,
  getMarkets, getRoles, getUsers, getIndices, getIndexValues, getRevisionRules, getServices,
  getAmendments, getTerminations, getRenewals, getTrusteeChanges, getBeChanges, getInterests, getSettlementRules,
  getWeatherStations,
  initializeSettlementRules,
  getAdvWorkQuotes, getAdvWorkQuoteVersions, getAdvWorkQuoteLines, getAdvWorkAffairs, getAdvWorkBudgetLines,
  getAdvWorkLots, getAdvWorkPostes, getAdvWorkSituations, getAdvWorkSituationLines, getAdvPurchaseOrders,
  getAdvPurchaseOrderLines, getCatalogArticles, getCatalogOuvrages, getOuvrageComposants
} from '@/services/firestore';
import { auth, firebaseReady } from '@/lib/firebase';
import type { DataContextType, Client, Contact, Site, Contract, Invoice, CreditNote, Meter, MeterType, MeterReading, Company, Agency, Sector, Activity, Schedule, Term, Typology, VatRate, RevisionFormula, PaymentTerm, PricingRule, Market, Role, User, Index, IndexValue, RevisionRule, Service, Amendment, Termination, Renewal, TrusteeChange, BeChange, Interest, SettlementRule, WorkProject, WorkQuote, ProgressSituation, AdvWorkQuote, AdvWorkQuoteVersion, AdvWorkQuoteLine, AdvWorkAffair, AdvWorkBudgetLine, AdvWorkLot, AdvWorkPoste, AdvWorkSituation, AdvWorkSituationLine, AdvPurchaseOrder, AdvPurchaseOrderLine, AdvCatalogArticle, AdvCatalogOuvrage, AdvOuvrageComposant, WeatherStation } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

const DataContext = createContext<DataContextType | undefined>(undefined);

const createEmptyData = () => ({
  clients: [] as Client[],
  contacts: [] as Contact[],
  sites: [] as Site[],
  contracts: [] as Contract[],
  invoices: [] as Invoice[],
  creditNotes: [] as CreditNote[],
  meters: [] as Meter[],
  meterTypes: [] as MeterType[],
  meterReadings: [] as MeterReading[],
  companies: [] as Company[],
  agencies: [] as Agency[],
  sectors: [] as Sector[],
  activities: [] as Activity[],
  schedules: [] as Schedule[],
  terms: [] as Term[],
  typologies: [] as Typology[],
  vatRates: [] as VatRate[],
  revisionFormulas: [] as RevisionFormula[],
  revisionRules: [] as RevisionRule[],
  services: [] as Service[],
  paymentTerms: [] as PaymentTerm[],
  pricingRules: [] as PricingRule[],
  markets: [] as Market[],
  roles: [] as Role[],
  users: [] as User[],
  indices: [] as Index[],
  indexValues: [] as IndexValue[],
  amendments: [] as Amendment[],
  terminations: [] as Termination[],
  renewals: [] as Renewal[],
  trusteeChanges: [] as TrusteeChange[],
  beChanges: [] as BeChange[],
  interests: [] as Interest[],
  settlementRules: [] as SettlementRule[],
  weatherStations: [] as WeatherStation[],
  // Legacy Works
  workProjects: [] as WorkProject[],
  workQuotes_legacy: [] as WorkQuote[],
  progressSituations: [] as ProgressSituation[],
  // Advanced Works
  advWorkQuotes: [] as AdvWorkQuote[],
  advWorkQuoteVersions: [] as AdvWorkQuoteVersion[],
  advWorkQuoteLines: [] as AdvWorkQuoteLine[],
  advWorkAffairs: [] as AdvWorkAffair[],
  advWorkBudgetLines: [] as AdvWorkBudgetLine[],
  advWorkLots: [] as AdvWorkLot[],
  advWorkPostes: [] as AdvWorkPoste[],
  advWorkSituations: [] as AdvWorkSituation[],
  advWorkSituationLines: [] as AdvWorkSituationLine[],
  advPurchaseOrders: [] as AdvPurchaseOrder[],
  advPurchaseOrderLines: [] as AdvPurchaseOrderLine[],
  advCatalogArticles: [] as AdvCatalogArticle[],
  advCatalogOuvrages: [] as AdvCatalogOuvrage[],
  advOuvrageComposants: [] as AdvOuvrageComposant[],
});

type SessionInfo = { user: User; isAdmin: boolean };

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
  const sessionRef = useRef<{ uid: string; promise: Promise<SessionInfo> } | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const loadAllData = useCallback(async () => {
    setIsLoading(true);
    try {
      const results = await Promise.allSettled([
        getClients(), getContacts(), getSites(), getContracts(), getInvoices(), getCreditNotes(), getMeters(), getMeterTypes(), getMeterReadings(),
        getCompanies(), getAgencies(), getSectors(), getActivities(), getSchedules(), getTerms(),
        getTypologies(), getVatRates(), getRevisionFormulas(), getPaymentTerms(), getPricingRules(),
        getMarkets(), getRoles(), getUsers(), getIndices(), getIndexValues(), getRevisionRules(), getServices(),
        getAmendments(), getTerminations(), getRenewals(), getTrusteeChanges(), getBeChanges(), getInterests(), getSettlementRules(),
        getAdvWorkQuotes(), getAdvWorkQuoteVersions(), getAdvWorkQuoteLines(), getAdvWorkAffairs(), getAdvWorkBudgetLines(),
        getAdvWorkLots(), getAdvWorkPostes(), getAdvWorkSituations(), getAdvWorkSituationLines(), getAdvPurchaseOrders(),
        getAdvPurchaseOrderLines(), getCatalogArticles(), getCatalogOuvrages(), getOuvrageComposants(),
        getWeatherStations()
      ]);

      const [
        clients, contacts, sites, contracts, invoices, creditNotes, meters, meterTypes, meterReadings,
        companies, agencies, sectors, activities, schedules, terms,
        typologies, vatRates, revisionFormulas, paymentTerms, pricingRules,
        markets, roles, users, indices, indexValues, revisionRules, services,
        amendments, terminations, renewals, trusteeChanges, beChanges, interests, settlementRules,
        advWorkQuotes, advWorkQuoteVersions, advWorkQuoteLines, advWorkAffairs, advWorkBudgetLines,
        advWorkLots, advWorkPostes, advWorkSituations, advWorkSituationLines, advPurchaseOrders,
        advPurchaseOrderLines, advCatalogArticles, advCatalogOuvrages, advOuvrageComposants,
        weatherStations
      ] = results;

      if (clients.status === 'rejected') console.error("Failed to load clients", clients.reason);
      if (contacts.status === 'rejected') console.error("Failed to load contacts", contacts.reason);
      if (sites.status === 'rejected') console.error("Failed to load sites", sites.reason);
      if (contracts.status === 'rejected') console.error("Failed to load contracts", contracts.reason);
      if (invoices.status === 'rejected') console.error("Failed to load invoices", invoices.reason);
      if (creditNotes.status === 'rejected') console.error("Failed to load credit notes", creditNotes.reason);
      if (meters.status === 'rejected') console.error("Failed to load meters", meters.reason);
      if (meterTypes.status === 'rejected') console.error("Failed to load meterTypes", meterTypes.reason);
      if (meterReadings.status === 'rejected') console.error("Failed to load meterReadings", meterReadings.reason);
      if (companies.status === 'rejected') console.error("Failed to load companies", companies.reason);
      if (agencies.status === 'rejected') console.error("Failed to load agencies", agencies.reason);
      if (sectors.status === 'rejected') console.error("Failed to load sectors", sectors.reason);
      if (activities.status === 'rejected') console.error("Failed to load activities", activities.reason);
      if (schedules.status === 'rejected') console.error("Failed to load schedules", schedules.reason);
      if (terms.status === 'rejected') console.error("Failed to load terms", terms.reason);
      if (typologies.status === 'rejected') console.error("Failed to load typologies", typologies.reason);
      if (vatRates.status === 'rejected') console.error("Failed to load vatRates", vatRates.reason);
      if (revisionFormulas.status === 'rejected') console.error("Failed to load revisionFormulas", revisionFormulas.reason);
      if (paymentTerms.status === 'rejected') console.error("Failed to load paymentTerms", paymentTerms.reason);
      if (pricingRules.status === 'rejected') console.error("Failed to load pricingRules", pricingRules.reason);
      if (markets.status === 'rejected') console.error("Failed to load markets", markets.reason);
      if (roles.status === 'rejected') console.error("Failed to load roles", roles.reason);
      if (users.status === 'rejected') console.error("Failed to load users", users.reason);
      if (indices.status === 'rejected') console.error("Failed to load indices", indices.reason);
      if (indexValues.status === 'rejected') console.error("Failed to load indexValues", indexValues.reason);
      if (revisionRules.status === 'rejected') console.error("Failed to load revisionRules", revisionRules.reason);
      if (services.status === 'rejected') console.error("Failed to load services", services.reason);
      if (amendments.status === 'rejected') console.error("Failed to load amendments", amendments.reason);
      if (terminations.status === 'rejected') console.error("Failed to load terminations", terminations.reason);
      if (renewals.status === 'rejected') console.error("Failed to load renewals", renewals.reason);
      if (trusteeChanges.status === 'rejected') console.error("Failed to load trusteeChanges", trusteeChanges.reason);
      if (beChanges.status === 'rejected') console.error("Failed to load beChanges", beChanges.reason);
      if (interests.status === 'rejected') console.error("Failed to load interests", interests.reason);
      if (settlementRules.status === 'rejected') console.error("Failed to load settlementRules", settlementRules.reason);

      setData({
        clients: clients.status === 'fulfilled' ? clients.value : [],
        contacts: contacts.status === 'fulfilled' ? contacts.value : [],
        sites: sites.status === 'fulfilled' ? sites.value : [],
        contracts: contracts.status === 'fulfilled' ? contracts.value : [],
        invoices: invoices.status === 'fulfilled' ? invoices.value : [],
        creditNotes: creditNotes.status === 'fulfilled' ? creditNotes.value : [],
        meters: meters.status === 'fulfilled' ? meters.value : [],
        meterTypes: meterTypes.status === 'fulfilled' ? meterTypes.value : [],
        meterReadings: meterReadings.status === 'fulfilled' ? meterReadings.value : [],
        companies: companies.status === 'fulfilled' ? companies.value : [],
        agencies: agencies.status === 'fulfilled' ? agencies.value : [],
        sectors: sectors.status === 'fulfilled' ? sectors.value : [],
        activities: activities.status === 'fulfilled' ? activities.value : [],
        schedules: schedules.status === 'fulfilled' ? schedules.value : [],
        terms: terms.status === 'fulfilled' ? terms.value : [],
        typologies: typologies.status === 'fulfilled' ? typologies.value : [],
        vatRates: vatRates.status === 'fulfilled' ? vatRates.value : [],
        revisionFormulas: revisionFormulas.status === 'fulfilled' ? revisionFormulas.value : [],
        revisionRules: revisionRules.status === 'fulfilled' ? revisionRules.value : [],
        services: services.status === 'fulfilled' ? services.value : [],
        paymentTerms: paymentTerms.status === 'fulfilled' ? paymentTerms.value : [],
        pricingRules: pricingRules.status === 'fulfilled' ? pricingRules.value : [],
        markets: markets.status === 'fulfilled' ? markets.value : [],
        roles: roles.status === 'fulfilled' ? roles.value : [],
        users: users.status === 'fulfilled' ? users.value : [],
        indices: indices.status === 'fulfilled' ? indices.value : [],
        indexValues: indexValues.status === 'fulfilled' ? indexValues.value : [],
        amendments: amendments.status === 'fulfilled' ? amendments.value : [],
        terminations: terminations.status === 'fulfilled' ? terminations.value : [],
        renewals: renewals.status === 'fulfilled' ? renewals.value : [],
        trusteeChanges: trusteeChanges.status === 'fulfilled' ? trusteeChanges.value : [],
        beChanges: beChanges.status === 'fulfilled' ? beChanges.value : [],
        interests: interests.status === 'fulfilled' ? interests.value : [],
        settlementRules: settlementRules.status === 'fulfilled' ? settlementRules.value : [],
        weatherStations: weatherStations.status === 'fulfilled' ? weatherStations.value : [],
        // Advanced
        advWorkQuotes: advWorkQuotes.status === 'fulfilled' ? advWorkQuotes.value : [],
        advWorkQuoteVersions: advWorkQuoteVersions.status === 'fulfilled' ? advWorkQuoteVersions.value : [],
        advWorkQuoteLines: advWorkQuoteLines.status === 'fulfilled' ? advWorkQuoteLines.value : [],
        advWorkAffairs: advWorkAffairs.status === 'fulfilled' ? advWorkAffairs.value : [],
        advWorkBudgetLines: advWorkBudgetLines.status === 'fulfilled' ? advWorkBudgetLines.value : [],
        advWorkLots: advWorkLots.status === 'fulfilled' ? advWorkLots.value : [],
        advWorkPostes: advWorkPostes.status === 'fulfilled' ? advWorkPostes.value : [],
        advWorkSituations: advWorkSituations.status === 'fulfilled' ? advWorkSituations.value : [],
        advWorkSituationLines: advWorkSituationLines.status === 'fulfilled' ? advWorkSituationLines.value : [],
        advPurchaseOrders: advPurchaseOrders.status === 'fulfilled' ? advPurchaseOrders.value : [],
        advPurchaseOrderLines: advPurchaseOrderLines.status === 'fulfilled' ? advPurchaseOrderLines.value : [],
        advCatalogArticles: advCatalogArticles.status === 'fulfilled' ? advCatalogArticles.value : [],
        advCatalogOuvrages: advCatalogOuvrages.status === 'fulfilled' ? advCatalogOuvrages.value : [],
        advOuvrageComposants: advOuvrageComposants.status === 'fulfilled' ? advOuvrageComposants.value : [],
        // Legacy (Mocked for now as we don't have separate services for these placeholders yet)
        workProjects: [],
        workQuotes_legacy: [],
        progressSituations: [],
      });

      // Auto-init rules if empty (side effect, but ensures we exist)
      if (settlementRules.status === 'fulfilled' && settlementRules.value.length === 0) {
        await initializeSettlementRules();
        // Re-fetch settlement rules after initialization to get the new data
        const reFetchedSettlementRules = await getSettlementRules();
        setData(prevData => ({
          ...prevData,
          settlementRules: reFetchedSettlementRules,
        }));
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
  }, [toast]); // Added toast dependency

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
      return { user: body.user as User, isAdmin: body.isAdmin === true };
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
          setData(createEmptyData());
          setIsLoading(false);
          return;
        }

        try {
          const session = await establishSession(firebaseUser);
          setAuthUser(session.user);
          setCurrentUser(session.user);
          setIsAdmin(session.isAdmin);
          await loadAllData();
        } catch (error) {
          console.error('Session error:', error);
          await fetch('/api/auth/session', { method: 'DELETE' }).catch(() => undefined);
          await signOut(auth);
        }
      })
    );

    return () => {
      unsubscribe.then(unsub => unsub());
    };
  }, [loadAllData, establishSession]);

  return (
    <DataContext.Provider value={{ ...data, isLoading, reloadData: loadAllData, authUser, currentUser, setCurrentUser, isAdmin, login, loginWithGoogle, logout }}>
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
