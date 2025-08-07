

import { z } from 'zod';

export type Client = {
  id: string;
  name: string; // Raison Sociale
  address?: string;
  postalCode?: string;
  city?: string;
  clientType: 'private' | 'public';
  typologyId: string;
  typologyName?: string; // denormalized for display
  representedBy?: string; // Si typologyId correspond à 'Copropriété'
  externalCode?: string;
  isBe: boolean; // Bureau d'études
  beName?: string;
  beEmail?: string;
  bePhone?: string;
  useChorus: boolean; // Dépôt Chorus
  siret?: string;
  chorusServiceCode?: string;
  chorusLegalCommitmentNumber?: string;
  chorusMarketNumber?: string;
  contactEmail?: string;
};

export type Site = {
    id: string;
    clientId: string;
    clientName?: string; // Denormalized for display
    name: string;
    siteNumber?: string;
    address: string;
    postalCode?: string;
    city?: string;
    activityIds?: string[];
    amounts?: { activityId: string; amount: number }[]; // Montants à facturer par activité
}

export type MonthlyBilling = {
  month: string;
  date: number; // jour du mois
  percentage: number;
}

export type RevisionInfo = {
  formulaId?: string;
  date?: string; // ISO String date
}

export type Contract = {
  id: string;
  clientId: string;
  clientName: string; // Denormalized for easy display
  siteIds: string[];
  startDate: string; // ISO String date
  endDate: string; // ISO String date
  billingSchedule: string;
  term: string;
  activityIds: string[];
  status: "active" | "expired" | "pending";
  marketId?: string;
  hasInterest?: boolean;
  
  revisionP1?: RevisionInfo;
  revisionP2?: RevisionInfo;
  revisionP3?: RevisionInfo;

  monthlyBilling?: MonthlyBilling[];
  // Conditional fields
  heatingDays?: number; // Jours de chauffe (MF)
  baseDJU?: number; // DJU de base (MT)
  weatherStationCode?: string; // Station météo (MT)
  consumptionBase?: number; // Base de consommation (Intéressement)
  shareRateClient?: number; // Taux partage client (Intéressement)
  shareRateOperator?: number; // Taux partage exploitant (Intéressement)
  flatRateAmount?: number; // Montant forfaitaire (CP, PF)
  managementFees?: number; // Frais de gestion (CP, PF)
  unitPriceUsefulMWh?: number; // Prix €/MWh utile (MC)
  unitPricePrimaryMWh?: number; // Prix €/MWh primaire (CP)
};

export type MeterReading = {
  id: string;
  siteId: string;
  contractId: string; // To know which contract the reading applies to for billing
  date: string; // ISO String date
  reading: number;
  unit: "kWh";
  service: "hot_water" | "heating";
};

export type InvoiceStatus = "paid" | "due" | "overdue";

export type InvoiceLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  siteId?: string; // Optional: for detailed billing per site
};

export type Invoice = {
  id: string;
  invoiceNumber?: string; // Chronological invoice number
  contractId: string;
  clientId: string;
  clientName: string; // Denormalized
  date: string; // ISO String date
  dueDate: string; // ISO String date
  status: InvoiceStatus;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  tax: number;
  total: number;
};

// Settings Types
export type Company = {
    id: string;
    name: string;
    logoUrl?: string;
    address?: string;
    postalCode?: string;
    city?: string;
    siret?: string;
    siren?: string;
    vatNumber?: string;
}

export type Agency = {
    id: string;
    name: string;
    companyId: string;
    companyName?: string; // Optional for display
}

export type Sector = {
    id: string;
    name: string;
    agencyId: string;
    agencyName?: string; // Optional for display
}

export type Activity = {
    id: string;
    code: string;
    label: string;
}

export type Schedule = {
    id: string;
    name: string;
}

export type Term = {
    id: string;
    name: string;
}

export type Typology = {
    id: string;
    name: string;
}

export type VatRate = {
    id: string;
    code: string;
    rate: number;
}

export type RevisionFormula = {
    id: string;
    code: string;
    formula: string;
    activityId: string;
    activityCode?: string; // For display
    activityLabel?: string; // For display
}

export type PaymentTerm = {
    id: string;
    code: string;
    deadline: string;
}

export type PricingRule = {
    id: string;
    activityId: string;
    rule: string;
    description: string;
    activityCode?: string; // For display purposes
    activityLabel?: string; // For display purposes
}

export type Market = {
    id: string;
    code: string;
    label: string;
    description?: string;
}


// User Management Types
export type Role = {
    id: string;
    name: string;
}

export type User = {
    id: string;
    name: string;
    email: string;
    roleId: string;
    roleName?: string; // Optional for display
}

// Genkit Flow Schemas
export const GenerateInvoiceInputSchema = z.object({
  contractId: z.string().describe('The ID of the contract to generate an invoice for.'),
});
export type GenerateInvoiceInput = z.infer<typeof GenerateInvoiceInputSchema>;

export const GenerateInvoiceOutputSchema = z.object({
    success: z.boolean(),
    invoiceId: z.string().optional(),
    error: z.string().optional(),
});
export type GenerateInvoiceOutput = z.infer<typeof GenerateInvoiceOutputSchema>;
