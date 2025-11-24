
'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import {
  getClients, getSites, getContracts, getInvoices, getCreditNotes, getMeters, getMeterTypes, getMeterReadings,
  getCompanies, getAgencies, getSectors, getActivities, getSchedules, getTerms,
  getTypologies, getVatRates, getRevisionFormulas, getPaymentTerms, getPricingRules,
  getMarkets, getRoles, getUsers
} from '@/services/firestore';
import type { DataContextType, Client, Site, Contract, Invoice, CreditNote, Meter, MeterType, MeterReading, Company, Agency, Sector, Activity, Schedule, Term, Typology, VatRate, RevisionFormula, PaymentTerm, PricingRule, Market, Role, User } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [data, setData] = useState({
    clients: [] as Client[],
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
    paymentTerms: [] as PaymentTerm[],
    pricingRules: [] as PricingRule[],
    markets: [] as Market[],
    roles: [] as Role[],
    roles: [] as Role[],
    users: [] as User[],
  });

  // Mock Current User (Director by default)
  const [currentUser, setCurrentUser] = useState<User | null>({
    id: 'user-director',
    name: 'Directeur Général',
    email: 'director@zenergy.com',
    roleId: 'role-admin',
    roleName: 'Administrateur',
    modules: ['contracts', 'billing', 'settings'],
    scope: {
      companyIds: ['*'],
      agencyIds: ['*'],
      sectorIds: ['*'],
    }
  });

  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const loadAllData = useCallback(async () => {
    setIsLoading(true);
    try {
      const results = await Promise.allSettled([
        getClients(), getSites(), getContracts(), getInvoices(), getCreditNotes(), getMeters(), getMeterTypes(), getMeterReadings(),
        getCompanies(), getAgencies(), getSectors(), getActivities(), getSchedules(), getTerms(),
        getTypologies(), getVatRates(), getRevisionFormulas(), getPaymentTerms(), getPricingRules(),
        getMarkets(), getRoles(), getUsers()
      ]);

      const [
        clients, sites, contracts, invoices, creditNotes, meters, meterTypes, meterReadings,
        companies, agencies, sectors, activities, schedules, terms,
        typologies, vatRates, revisionFormulas, paymentTerms, pricingRules,
        markets, roles, users
      ] = results;

      if (clients.status === 'rejected') console.error("Failed to load clients", clients.reason);
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

      setData({
        clients: clients.status === 'fulfilled' ? clients.value : [],
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
        paymentTerms: paymentTerms.status === 'fulfilled' ? paymentTerms.value : [],
        pricingRules: pricingRules.status === 'fulfilled' ? pricingRules.value : [],
        markets: markets.status === 'fulfilled' ? markets.value : [],
        roles: roles.status === 'fulfilled' ? roles.value : [],
        users: users.status === 'fulfilled' ? users.value : [],
      });

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
  }, [toast]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  return (
    <DataContext.Provider value={{ ...data, isLoading, reloadData: loadAllData, currentUser, setCurrentUser }}>
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
