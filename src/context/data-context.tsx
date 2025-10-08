
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
      const results = await Promise.allSettled([
        getClients(), getSites(), getContracts(), getInvoices(), getMeters(), getMeterReadings(),
        getCompanies(), getAgencies(), getSectors(), getActivities(), getSchedules(),
        getTerms(), getTypologies(), getVatRates(), getRevisionFormulas(), getPaymentTerms(),
        getPricingRules(), getMarkets(), getRoles(), getUsers()
      ]);

      const [
        clients, sites, contracts, invoices, meters, meterReadings,
        companies, agencies, sectors, activities, schedules,
        terms, typologies, vatRates, revisionFormulas, paymentTerms,
        pricingRules, markets, roles, users
      ] = results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          // Log l'erreur pour le débogage sans arrêter toute l'application
          console.error(`Failed to load collection at index ${index}:`, result.reason);
          toast({
            title: "Erreur de chargement partielle",
            description: `Impossible de charger une partie des données. Certaines informations peuvent manquer.`,
            variant: "destructive",
          });
          return []; // Retourne un tableau vide en cas d'échec pour cette collection
        }
      });
      
      setData({
        clients, sites, contracts, invoices, meters, meterReadings,
        companies, agencies, sectors, activities, schedules,
        terms, typologies, vatRates, revisionFormulas, paymentTerms,
        pricingRules, markets, roles, users
      });

    } catch (error) {
      // Ce catch est une sécurité, mais allSettled ne devrait pas le déclencher.
      console.error("Critical error during data loading:", error);
      toast({
        title: "Erreur de chargement critique",
        description: "Impossible de charger les données de l'application.",
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
