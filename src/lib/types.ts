

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
};

export type Site = {
    id: string;
    clientId: string;
    name: string;
    address: string;
    meterReference?: string;
}

export type MonthlyBilling = {
  month: string;
  date: number; // jour du mois
  percentage: number;
}

export type Contract = {
  id: string;
  clientId: string;
  clientName: string; // Denormalized for easy display
  siteIds: string[];
  startDate: string;
  endDate: string;
  billingSchedule: string;
  term: string;
  activityIds: string[];
  status: "active" | "expired" | "pending";
  marketId?: string;
  hasInterest?: boolean;
  revisionFormulaId?: string;
  revisionDate?: string;
  monthlyBilling?: MonthlyBilling[];
  // Conditional fields
  heatingDays?: number; // Jours de chauffe (MF)
  baseDJU?: number; // DJU de base (MT)
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
  date: string;
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
  contractId: string;
  clientId: string;
  clientName: string; // Denormalized
  date: string;
  dueDate: string;
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
