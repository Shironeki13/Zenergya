
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
      const collectionsToLoad = {
        clients: getClients,
        sites: getSites,
        contracts: getContracts,
        invoices: getInvoices,
        meters: getMeters,
        meterReadings: getMeterReadings,
        companies: getCompanies,
        agencies: getAgencies,
        sectors: getSectors,
        activities: getActivities,
        schedules: getSchedules,
        terms: getTerms,
        typologies: getTypologies,
        vatRates: getVatRates,
        revisionFormulas: getRevisionFormulas,
        paymentTerms: getPaymentTerms,
        pricingRules: getPricingRules,
        markets: getMarkets,
        roles: getRoles,
        users: getUsers,
      };

      const promises = Object.values(collectionsToLoad).map(fn => fn());
      const results = await Promise.allSettled(promises);
      
      const dataPayload = { ...data }; // Start with existing data structure

      Object.keys(collectionsToLoad).forEach((key, index) => {
        const result = results[index];
        if (result.status === 'fulfilled') {
          (dataPayload as any)[key] = result.value;
        } else {
          console.error(`Failed to load ${key}:`, result.reason);
          (dataPayload as any)[key] = []; // Ensure it's an empty array on failure
          toast({
            title: `Erreur de chargement de la collection: ${key}`,
            description: "Certaines données n'ont pas pu être chargées. L'application peut ne pas fonctionner comme prévu.",
            variant: "destructive",
          });
        }
      });
      
      setData(dataPayload);

    } catch (error) {
      console.error("Critical error during data loading:", error);
      toast({
        title: "Erreur de chargement critique",
        description: "Impossible de charger les données de l'application.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]); // Removed data from dependency array to avoid re-renders

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
