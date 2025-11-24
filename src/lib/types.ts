
import { z } from 'zod';

export const ContractDocumentSchema = z.object({
  name: z.string(),
  type: z.string(),
  url: z.string().url(),
});

export const ClientSchema = z.object({
  name: z.string().min(2, "La raison sociale est requise."),
  address: z.string().optional(),
  postalCode: z.string().optional(),
  city: z.string().optional(),
  clientType: z.enum(["private", "public"], { required_error: "Le type de client est requis." }),
  typologyId: z.string({ required_error: "La typologie est requise." }),
  representedBy: z.string().optional(),
  externalCode: z.string().optional(),
  isBe: z.boolean().default(false),
  beName: z.string().optional(),
  beEmail: z.string().email({ message: "Email BE invalide." }).optional().or(z.literal('')),
  bePhone: z.string().optional(),
  useChorus: z.boolean().default(false),
  siret: z.string().optional(),
  chorusServiceCode: z.string().optional(),
  chorusLegalCommitmentNumber: z.string().optional(),
  chorusMarketNumber: z.string().optional(),
  invoicingType: z.enum(['multi-site', 'global'], { required_error: "Le type de facturation est requis."}),
  // Contract fields
  siteIds: z.array(z.string()).optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  renewal: z.boolean().default(false),
  renewalDuration: z.string().optional(),
  tacitRenewal: z.boolean().default(false),
  activityIds: z.array(z.string()).optional(),
  amounts: z.array(z.object({
      activityId: z.string(),
      amount: z.number(),
  })).optional(),
  documents: z.array(ContractDocumentSchema).optional(), // Champ pour la GED
}).superRefine((data, ctx) => {
    if (data.useChorus && (!data.siret || data.siret.length === 0)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Le SIRET est obligatoire si le dépôt Chorus est activé.",
            path: ["siret"],
        });
    }
    if (data.renewal && !data.renewalDuration) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "La durée de reconduction est requise.",
            path: ["renewalDuration"],
        });
    }
});


export type Client = z.infer<typeof ClientSchema> & {
    id: string;
    typologyName?: string; // denormalized for display
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

export type MeterType = {
    id: string;
    code: string;
    label: string;
    unit: string;
}

export type Meter = {
    id: string;
    code: string; // unique code, auto-generated from document ID
    name: string;
    siteId: string;
    siteName?: string; // denormalized
    clientName?: string; // denormalized from site
    type: string; // e.g., 'Eau Chaude', 'Chauffage' - From MeterType label
    unit: string; // e.g., 'kWh', 'm3' - From MeterType unit
    location?: string;
    status: 'on' | 'off';
    lastModified: string; // ISO date string
    modifiedBy: string; // user name/id
}

export type MeterReading = {
  id: string;
  meterId: string;
  contractId: string; // To know which contract the reading applies to for billing
  date: string; // ISO String date
  reading: number;
  unit: string; // Copied from meter for convenience
};


export type MonthlyBilling = {
  month: string;
  date: number; // jour du mois
  percentage: number;
}

export type RevisionInfo = {
  formulaId?: string | null;
  date?: string; // ISO String date
}

export type HeatingRevisionIndices = {
  molecule0?: number;
  ticgn0?: number;
  atrd2_0?: number;
  cee0?: number;
};

export type EcsRevisionIndices = {
  peg0?: number;
  ticgn0?: number;
  atrd3_0?: number;
  cee0?: number;
};

export type ContractDocument = z.infer<typeof ContractDocumentSchema>;

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
  status: "Actif" | "Résilié" | "Terminé" | "Brouillon";
  validationStatus: "pending_validation" | "validated" | "refused";
  marketId?: string;
  hasInterest?: boolean;
  terminationDate?: string; // ISO String for cancellation date
  documents?: ContractDocument[]; // Champ pour la GED
  
  revisionP1?: RevisionInfo;
  revisionP2?: RevisionInfo;
  revisionP3?: RevisionInfo;
  
  analyticP1?: string;
  analyticP2?: string;
  analyticP3?: string;

  monthlyBilling?: MonthlyBilling[];

  // P1 Specific Fields
  hasHeating: boolean;
  hasECS: boolean;

  // Heating fields
  heatingFlatRateHT?: number; // Forfait P1 CH HT (€/an)
  heatingUnitPriceKwh?: number; // PU kWh CH (€/kWh)
  heatingReferenceDju?: number; // DJU de référence annuel
  heatingWeatherStation?: string; // Station météo
  heatingRevisionIndices?: HeatingRevisionIndices;

  // ECS fields
  ecsFlatRateHT?: number; // Forfait P1 ECS HT (€/an)
  ecsUnitPriceM3?: number; // PU m3 ECS
  ecsRevisionIndices?: EcsRevisionIndices;


  // Conditional fields (legacy, to be reviewed if they overlap)
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

export type InvoiceStatus = "paid" | "due" | "overdue" | "proforma" | "cancelled";

export type InvoiceLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  siteId?: string; // Optional: for detailed billing per site
  activityCode: string; // To group items by P1, P2, etc.
};

export type Invoice = {
  id: string;
  invoiceNumber?: string; // Chronological invoice number, optional for proforma
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
  periodStartDate?: string; // ISO String date
  periodEndDate?: string; // ISO String date
};

export type CreditNote = {
    id: string;
    creditNoteNumber: string;
    originalInvoiceIds: string[];
    contractId: string;
    clientId: string;
    clientName: string;
    date: string; // ISO date
    status: 'finalized';
    lineItems: InvoiceLineItem[];
    subtotal: number;
    tax: number;
    total: number;
    reason: string;
}

// Settings Types
export type Company = {
    id: string;
    code: string;
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
  invoiceDate: z.string().describe('The date for the invoice in ISO format.'),
  isProforma: z.boolean().describe('Whether to generate a proforma invoice instead of a final one.'),
});
export type GenerateInvoiceInput = z.infer<typeof GenerateInvoiceInputSchema>;

export const GenerateInvoiceOutputSchema = z.object({
    success: z.boolean(),
    invoiceId: z.string().optional(),
    error: z.string().optional(),
});
export type GenerateInvoiceOutput = z.infer<typeof GenerateInvoiceOutputSchema>;

export const GenerateCreditNoteInputSchema = z.object({
    invoiceIds: z.array(z.string()).describe('The IDs of the invoices to create a credit note for.'),
    reason: z.string().describe('The reason for creating the credit note.'),
    creditNoteDate: z.string().describe('The date for the credit note in ISO format.'),
});
export type GenerateCreditNoteInput = z.infer<typeof GenerateCreditNoteInputSchema>;

export const GenerateCreditNoteOutputSchema = z.object({
    success: z.boolean(),
    creditNoteId: z.string().optional(),
    error: z.string().optional(),
});
export type GenerateCreditNoteOutput = z.infer<typeof GenerateCreditNoteOutputSchema>;


export const ExtractContractInfoInputSchema = z.object({
  documentDataUri: z.string().describe("A contract document as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:application/pdf;base64,<encoded_data>'."),
  activities: z.array(z.object({
    id: z.string(),
    code: z.string(),
    label: z.string(),
  })).describe('List of available activities to choose from.'),
  prompt: z.string().describe('The prompt to use for the AI analysis.'),
  typologies: z.array(z.object({
      id: z.string(),
      name: z.string(),
  })).describe('List of available typologies to choose from.'),
  schedules: z.array(z.object({
      id: z.string(),
      name: z.string(),
  })).describe('List of available billing schedules.'),
  terms: z.array(z.object({
      id: z.string(),
      name: z.string(),
  })).describe('List of available billing terms.'),
});
export type ExtractContractInfoInput = z.infer<typeof ExtractContractInfoInputSchema>;

const ExtractedAmountSchema = z.object({
    activityId: z.string().describe("L'ID de l'activité correspondante (P1, P2, P3, etc.)."),
    amount: z.number().describe("Le montant annuel HT associé à cette activité. Ne pas inclure de devise."),
});

export const ExtractContractInfoOutputSchema = z.object({
  name: z.string().optional().describe("Raison sociale du client. Toujours en MAJUSCULES."),
  address: z.string().optional().describe("Adresse complète du client (numéro, rue, etc.)."),
  postalCode: z.string().optional().describe("Code postal du client."),
  city: z.string().optional().describe("Ville du client. Toujours en MAJUSCULES."),
  clientType: z.enum(["private", "public"]).optional().describe("Le type de client, 'private' (privé) ou 'public' (public)."),
  typologyId: z.string().optional().describe("L'ID de la typologie client. Ex: 'Copropriété', 'Industrie', 'Tertiaire'."),
  representedBy: z.string().optional().describe("Le représentant légal, pertinent seulement si la typologie est 'Copropriété'."),
  useChorus: z.boolean().optional().describe("Indique si le client utilise la facturation via Chorus Pro. Déduire si un SIRET est présent pour un client public."),
  siret: z.string().optional().describe("Le numéro de SIRET du client, si disponible."),
  chorusServiceCode: z.string().optional().describe("Le code service Chorus, si disponible."),
  chorusLegalCommitmentNumber: z.string().optional().describe("Le numéro d'engagement juridique (EJ) pour Chorus, si disponible."),
  activityIds: z.array(z.string()).optional().describe("Un tableau des IDs des prestations (activités) trouvées dans le document. Choisir parmi la liste fournie."),
  amounts: z.array(ExtractedAmountSchema).optional().describe("Un tableau des montants annuels HT pour chaque activité détectée. Ne renseigner que pour les activités effectivement présentes dans le contrat."),
  startDate: z.string().optional().describe("Date de démarrage du contrat au format ISO 8601 (YYYY-MM-DD)."),
  endDate: z.string().optional().describe("Date de fin du contrat au format ISO 8601 (YYYY-MM-DD)."),
  renewal: z.boolean().optional().describe("Indique si le contrat est à reconduction."),
  renewalDuration: z.string().optional().describe("La durée de la reconduction (ex: '1 an', '2 ans')."),
  tacitRenewal: z.boolean().optional().describe("Indique si la reconduction est tacite."),
  // New fields
  billingSchedule: z.string().optional().describe("L'échéancier de facturation, à choisir parmi la liste fournie."),
  term: z.string().optional().describe("Le terme de facturation, à choisir parmi la liste fournie."),
  weatherStation: z.string().optional().describe("La station météo de référence pour le contrat."),
  revisionP1: z.string().optional().describe("Formule de révision pour la prestation P1."),
  revisionP2: z.string().optional().describe("Formule de révision pour la prestation P2."),
  revisionP3: z.string().optional().describe("Formule de révision pour la prestation P3."),
  contractualTemperature: z.number().optional().describe("Température contractuelle moyenne en degrés Celsius."),
  contractualDJU: z.number().optional().describe("DJU (Degrés Jours Unifiés) contractuels."),
  contractualNB: z.number().optional().describe("NB contractuels (besoins en chauffage)."),
  ecsSmallQ: z.number().optional().describe("Petit q ECS (besoin en eau chaude sanitaire)."),
  ecsNB: z.number().optional().describe("NB ECS (besoins en eau chaude sanitaire)."),
});
export type ExtractContractInfoOutput = z.infer<typeof ExtractContractInfoOutputSchema>;


// Data Context Type
export type DataContextType = {
    clients: Client[];
    sites: Site[];
    contracts: Contract[];
    invoices: Invoice[];
    creditNotes: CreditNote[];
    meters: Meter[];
    meterTypes: MeterType[];
    meterReadings: MeterReading[];
    companies: Company[];
    agencies: Agency[];
    sectors: Sector[];
    activities: Activity[];
    schedules: Schedule[];
    terms: Term[];
    typologies: Typology[];
    vatRates: VatRate[];
    revisionFormulas: RevisionFormula[];
    paymentTerms: PaymentTerm[];
    pricingRules: PricingRule[];
    markets: Market[];
    roles: Role[];
    users: User[];
    isLoading: boolean;
    reloadData: () => Promise<void>;
};
    
    

    

    
