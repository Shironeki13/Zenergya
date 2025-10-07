
'use client';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { DataContextType } from '@/lib/types';
import {
  getClients, getSites, getContracts, getInvoices, getMeters, getMeterReadings,
  getCompanies, getAgencies, getSectors, getActivities, getSchedules, getTerms,
  getTypologies, getVatRates, getRevisionFormulas, getPaymentTerms,
  getPricingRules, getMarkets, getRoles, getUsers
} from '@/services/firestore';
import { useToast } from '@/hooks/use-toast';

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [data, setData] = useState<Omit<DataContextType, 'isLoading' | 'reloadData'>>({
    clients: [], sites: [], contracts: [], invoices: [], meters: [], meterReadings: [],
    companies: [], agencies: [], sectors: [], activities: [], schedules: [],
    terms: [], typologies: [], vatRates: [], revisionFormulas: [], paymentTerms: [],
    pricingRules: [], markets: [], roles: [], users: []
  });
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const loadAllData = useCallback(async () => {
    setIsLoading(true);
    try {
        const dataPayload: Omit<DataContextType, 'isLoading' | 'reloadData'> = {
            clients: [], sites: [], contracts: [], invoices: [], meters: [], meterReadings: [],
            companies: [], agencies: [], sectors: [], activities: [], schedules: [],
            terms: [], typologies: [], vatRates: [], revisionFormulas: [], paymentTerms: [],
            pricingRules: [], markets: [], roles: [], users: []
        };
        
        dataPayload.clients = await getClients();
        dataPayload.sites = await getSites();
        dataPayload.contracts = await getContracts();
        dataPayload.invoices = await getInvoices();
        dataPayload.meters = await getMeters();
        dataPayload.meterReadings = await getMeterReadings();
        dataPayload.companies = await getCompanies();
        dataPayload.agencies = await getAgencies();
        dataPayload.sectors = await getSectors();
        dataPayload.activities = await getActivities();
        dataPayload.schedules = await getSchedules();
        dataPayload.terms = await getTerms();
        dataPayload.typologies = await getTypologies();
        dataPayload.vatRates = await getVatRates();
        dataPayload.revisionFormulas = await getRevisionFormulas();
        dataPayload.paymentTerms = await getPaymentTerms();
        dataPayload.pricingRules = await getPricingRules();
        dataPayload.markets = await getMarkets();
        dataPayload.roles = await getRoles();
        dataPayload.users = await getUsers();

        setData(dataPayload);
    } catch (error) {
      console.error("Failed to load global data:", error);
      toast({
        title: "Erreur de chargement",
        description: "Impossible de charger toutes les données de l'application. Veuillez réessayer.",
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
    <DataContext.Provider value={{ ...data, isLoading, reloadData: loadAllData }}>
      {children}
    </DataContext.Provider>
  );
};

export const useData = () => {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
};
