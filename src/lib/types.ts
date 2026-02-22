
import { z } from 'zod';
import type {
    WorkQuote as AdvWorkQuote,
    WorkQuoteVersion as AdvWorkQuoteVersion,
    WorkQuoteLine as AdvWorkQuoteLine,
    WorkAffair as AdvWorkAffair,
    WorkBudgetLine as AdvWorkBudgetLine,
    WorkLot as AdvWorkLot,
    WorkPoste as AdvWorkPoste,
    WorkSituation as AdvWorkSituation,
    WorkSituationLine as AdvWorkSituationLine,
    PurchaseOrder as AdvPurchaseOrder,
    PurchaseOrderLine as AdvPurchaseOrderLine,
    CatalogArticle as AdvCatalogArticle,
    CatalogOuvrage as AdvCatalogOuvrage,
    OuvrageComposant as AdvOuvrageComposant,
    WorkLineType as AdvWorkLineType
} from './works/types';

export type {
    AdvWorkQuote,
    AdvWorkQuoteVersion,
    AdvWorkQuoteLine,
    AdvWorkAffair,
    AdvWorkBudgetLine,
    AdvWorkLot,
    AdvWorkPoste,
    AdvWorkSituation,
    AdvWorkSituationLine,
    AdvPurchaseOrder,
    AdvPurchaseOrderLine,
    AdvCatalogArticle,
    AdvCatalogOuvrage,
    AdvOuvrageComposant,
    AdvWorkLineType
};

export const ContractDocumentSchema = z.object({
    name: z.string(),
    type: z.string(),
    url: z.string().url(),
});

export const RevisionBaseIndexSchema = z.object({
    code: z.string(),
    value: z.number(),
    description: z.string().optional(),
});

export const ActivityDetailSchema = z.object({
    activityId: z.string(),
    amount: z.number().optional(),
    termId: z.string().optional(),
    scheduleId: z.string().optional(),
    revisionFormula: z.string().optional(),
    revisionBaseIndices: z.array(RevisionBaseIndexSchema).optional(),
    // P1 specific fields
    weatherStation: z.string().optional(),
    contractualTemperature: z.number().optional(),
    contractualDJU: z.number().optional(),
    contractualNB: z.number().optional(),
    ecsSmallQ: z.number().optional(),
    ecsNB: z.number().optional(),
});
export type ActivityDetail = z.infer<typeof ActivityDetailSchema>;

export const ClientBaseSchema = z.object({
    name: z.string().min(2, "La raison sociale est requise."),
    address: z.string().min(1, "L'adresse est requise."),
    postalCode: z.string().min(1, "Le code postal est requis."),
    city: z.string().min(1, "La ville est requise."),
    clientType: z.enum(["private", "public"], { required_error: "Le type de client est requis." }),
    typologyId: z.string({ required_error: "La typologie est requise." }),
    // Hierarchy fields
    companyId: z.string({ required_error: "La société est requise." }).min(1, "La société est requise."),
    agencyId: z.string({ required_error: "L'agence est requise." }).min(1, "L'agence est requise."),
    sectorId: z.string({ required_error: "Le secteur est requis." }).min(1, "Le secteur est requis."),
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
});

export const ClientSchema = ClientBaseSchema.superRefine((data, ctx) => {
    if (data.useChorus && (!data.siret || data.siret.length === 0)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Le SIRET est obligatoire si le dépôt Chorus est activé.",
            path: ["siret"],
        });
    }
    if (data.clientType === 'public' && (!data.siret || data.siret.length === 0)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Le SIRET est obligatoire pour un client public.",
            path: ["siret"],
        });
    }
});


export type Client = z.infer<typeof ClientSchema> & {
    id: string;
    typologyName?: string; // denormalized for display
    clientNumber?: string; // N° Chrono
    createdAt?: string; // Timestamp
    createdBy?: string; // User ID/Name
};

// --- Contact Type ---
export type Contact = {
    id: string;
    clientId: string;
    type: 'technique' | 'facturation' | 'principal' | 'autre';
    name: string;
    email?: string;
    phone?: string;
    role?: string; // Descriptif libre du rôle (ex: "Gardien", "Directeur technique")
};


export type Site = {
    id: string;
    contractId: string; // Link to Contract
    clientId?: string; // Optional, can be derived or kept for easier querying
    clientName?: string; // Denormalized for display
    name: string;
    siteNumber?: string;
    address: string;
    postalCode?: string;
    city?: string;
    activityIds?: string[];
    amounts?: { activityId: string; amount: number }[]; // Montants à facturer par activité

    // --- Billing & Revision (moved from Contract) ---
    billingSchedule?: string; // Périodicité de facturation
    termId?: string; // Terme/Échéance
    monthlyBilling?: MonthlyBilling[]; // Échéancier mensuel

    // Revisions per site
    revisionP1?: RevisionInfo;
    revisionP2?: RevisionInfo;
    revisionP3?: RevisionInfo;
    analyticP1?: string;
    analyticP2?: string;
    analyticP3?: string;

    // --- P1 Specific (moved from Contract) ---
    hasHeating?: boolean;
    hasECS?: boolean;
    hasInterest?: boolean;
    heatingReferenceDju?: number; // DJU de référence annuel
    heatingWeatherStation?: string; // Station météo
    contractualNB?: number; // NB (Nombre de Base)
    smallQ?: number; // Petit q (Quantité/Coeff)

    // --- Legacy conditional fields (moved from Contract) ---
    heatingDays?: number; // Jours de chauffe (MF)
    baseDJU?: number; // DJU de base (MT)
    weatherStationCode?: string; // Station météo (MT)
    consumptionBase?: number; // Base de consommation (Intéressement)
    shareRateClient?: number; // Taux partage client (Intéressement)
    shareRateOperator?: number; // Taux partage exploitant (Intéressement)
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
    reference?: string; // PDL / PCE
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
    contractId?: string; // Optional, can be inferred from date/site
    date: string; // ISO String date
    value: number;
    type: 'REEL' | 'ESTIME' | 'CORRIGE' | 'AUTO';
    source: 'MANUEL' | 'IMPORT' | 'API';
    comment?: string;
    unit?: string; // Copied from meter for convenience
};


export type MonthlyBilling = {
    month: number;
    percentage: number;
    date?: number; // jour du mois
}

export type RevisionInfo = {
    ruleId?: string;          // Link to RevisionRule (calculation engine)
    formulaId?: string | null; // Link to RevisionFormula (contractual text)
    formula?: string;         // Custom formula string (fallback)
    periodicity?: 'annual' | 'semi-annual' | 'quarterly'; // Revision frequency
    anniversaryDate?: string; // Anniversary date for revision (MM-DD format)
    baseDate?: string;        // Reference/base date (YYYY-MM-DD)
    baseAmount?: number;      // Base amount to revise
    date?: string;            // Legacy: ISO String date
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
    activityIds: string[];
    status: "Actif" | "Résilié" | "Terminé" | "Brouillon";
    validationStatus: "pending_validation" | "validated" | "refused";
    marketId?: string;
    terminationDate?: string; // ISO String for cancellation date
    documents?: ContractDocument[]; // Champ pour la GED

    // Identification
    contractNumber?: string; // N° Contrat (CTR-ANNÉE-N° Client-001)
    createdAt?: string; // Timestamp
    createdBy?: string; // User ID/Name
    requesterEmail?: string; // Email of the user who created the contract
    refusalReason?: string; // Reason for refusal by admin
    label?: string; // Libellé (= Localité / Spécificité)
    name?: string; // Nom Contrat (= Nom Client + '-' + Libellé Contrat)
    externalRef?: string;

    // Global amounts
    baseAmountP1?: number; // Montant global base marché P1 HT/AN
    baseAmountP2?: number; // Montant global base marché P2 HT/AN
    baseAmountP3?: number; // Montant global base marché P3 HT/AN
    baseAmountP3R?: number; // Montant global base marché P3R HT/AN
    signedByCompany?: boolean;
    signedByClient?: boolean;

    // Contract conditions
    invoicingType: 'multi-site' | 'global';
    renewal: boolean;
    renewalDuration?: string;
    tacitRenewal: boolean;
    noticePeriod?: string;

    activitiesDetails?: ActivityDetail[];

    marketType?: 'Marché Public' | 'Marché Privé';
    shareRate?: number[];
    revisionFormula?: string;
    p1SubTypes?: string[]; // P1 sub-types: chauffage, ecs, refac, abonnement

    // --- Legacy fields kept for single-site inheritance ---
    // When a contract has a single site, these can be inherited by the site
    billingSchedule?: string; // Legacy: moved to Site
    term?: string; // Legacy: moved to Site
    monthlyBilling?: MonthlyBilling[]; // Legacy: moved to Site
    revisionP1?: RevisionInfo; // Legacy: moved to Site
    revisionP2?: RevisionInfo; // Legacy: moved to Site
    revisionP3?: RevisionInfo; // Legacy: moved to Site
};

// --- New Contract Event Types ---

export type Amendment = {
    id: string;
    contractId: string;
    contractNumber?: string; // Denormalized
    createdAt: string;
    createdBy: string;
    impactsDuration: boolean;
    newEndDate?: string;
    impactsServices: boolean;
    impactedServices?: string[]; // Activity IDs
    impactP1?: number; // +/- value
    impactP2?: number; // +/- value
    impactP3?: number; // +/- value
    impactP3R?: number; // +/- value
    effectiveDate: string;
    description: string;
    signed: boolean;
    documentUrl?: string; // Avenant PDF
    dpgfUrl?: string; // DPGF
};

export type Termination = {
    id: string;
    contractId: string;
    contractNumber?: string; // Denormalized
    createdAt: string;
    createdBy: string;
    effectiveDate: string;
    reason: string;
    documentUrl?: string;
};

export type Renewal = {
    id: string;
    contractId: string;
    contractNumber?: string; // Denormalized
    createdAt: string;
    createdBy: string;
    newEndDate: string;
    duration: string;
    documentUrl?: string;
};

export type TrusteeChange = {
    id: string;
    contractId: string;
    contractNumber?: string; // Denormalized
    createdAt: string;
    createdBy: string;
    currentRepresentative?: string;
    newRepresentative: string;
    contactEmail?: string;
    effectiveDate: string;
    documentUrl?: string;
};

export type BeChange = {
    id: string;
    contractId: string;
    contractNumber?: string; // Denormalized
    createdAt: string;
    createdBy: string;
    currentBe?: string;
    newBe: string;
    contactEmail?: string;
    effectiveDate: string;
    documentUrl?: string;
};

export type Interest = {
    id: string;
    serviceId: string; // P1 Heating Service
    meterId?: string; // Main Heating Meter
    seasonLabel: string; // e.g., '2024-2025'

    // Period
    startDate: string; // date_allumage
    endDate: string; // date_arret

    // Readings (Snapshots)
    startReadingId?: string;
    endReadingId?: string;
    startIndex: number;
    endIndex: number;

    // Reference Data (Snapshot from Service)
    referenceDju: number;
    referenceNb: number; // MWh
    conversionCoefficient: number; // Snapshot from meter/service

    // Calculated Results
    ncMwh: number; // (Index Fin - Index Début) * Coeff
    measuredDju: number; // Sum of daily DJU
    correctedNb: number; // NB * (DJU Mesure / DJU Ref)
    deviationPercentage: number; // (NC - NB Corr) / NB Corr
    sharingPercentage?: number; // Snapshot of % partagé
    sharingQuantity: number; // MWh subject to sharing
    unitPrice: number; // Snapshot
    interestAmount: number;
    gainLoss: number; // Numeric value of gain/loss

    calculationDate: string;
    comment?: string;
};

// --- Settlement System Types ---

export type SettlementTargetType = 'P1' | 'P2' | 'P3' | null;
export type SettlementMethodType = 'PRORATA_JOURS' | 'PRORATA_MOIS' | 'FORFAIT_FIXE' | 'CONSO_REELLE' | 'ECHEANCIER';

export type SettlementRule = {
    id: string;
    code: SettlementMethodType;
    label: string;
    description?: string;
    targetType: SettlementTargetType;
    isActive: boolean;
};

export type SettlementReason = 'RESILIATION' | 'FIN_ANNEE' | 'AVENANT' | 'CHANGEMENT_SYNDIC' | 'AUTRE';

export type ServiceSettlement = {
    id: string;
    serviceId: string;
    ruleId: string; // FK to SettlementRule

    startDate: string; // Period start
    endDate: string; // Period end
    reason: SettlementReason;

    // Snapshots
    ruleSnapshot?: SettlementRule; // Snapshot of the rule used

    // P1 Details (Real Consumption)
    p1Detail?: {
        meterId?: string;
        startReadingId?: string;
        endReadingId?: string;
        startIndex: number;
        endIndex: number;
        consumption: number;
        conversionCoefficient: number;
    };

    // P2/P3 Details (Prorata/Flat Fee)
    fixedDetail?: {
        annualAmountReference: number; // Montant de base (Snapshot)
        prorataMode: 'JOURS' | 'MOIS' | 'ECHEANCES';
        daysInPeriod?: number; // Nb jours dans la période de décompte (numérateur)
        daysInBase?: number; // Nb jours dans l'année de référence (dénominateur)
        monthsInPeriod?: number;
        totalInstallments?: number; // Nb échéances total
        billedInstallments?: number; // Nb échéances déjà facturées
    };

    // Financial Results
    amountHt: number;
    vatRate: number; // Snapshot from service
    amountTtc: number;

    calculationDate: string;
    comment?: string;
};

export type Dju = {
    id: string;
    stationCode: string;
    stationName: string;
    date: string; // YYYY-MM-DD
    value: number;
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

// --- Travaux (Works) Types (Legacy) ---
export type WorkProject = {
    id: string;
    name: string;
    clientId: string;
    clientName: string;
    siteId: string;
    siteName: string;
    status: "En cours" | "Terminé" | "Brouillon";
    startDate: string;
    totalHT: number;
};

export type WorkQuote = {
    id: string;
    projectId: string;
    number: string;
    date: string;
    totalHT: number;
    status: "Brouillon" | "Envoyé" | "Accepté" | "Refusé";
};

export type ProgressSituation = {
    id: string;
    projectId: string;
    number: number;
    date: string;
    percentage: number;
    amount: number;
    status: "Brouillon" | "Validée" | "Facturée";
};


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
    type: 'P1' | 'P2' | 'P3';
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

export type UserScope = {
    companyIds: string[]; // IDs of allowed companies, or ['*'] for all
    agencyIds: string[]; // IDs of allowed agencies, or ['*'] for all
    sectorIds: string[]; // IDs of allowed sectors, or ['*'] for all
};

export type User = {
    id: string;
    name: string; // Last Name
    firstName?: string; // First Name
    email: string;
    roleId: string;
    roleName?: string; // Optional for display
    modules: string[]; // e.g., ['contracts', 'billing']
    scope: UserScope;
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


// Indices Types
export type Index = {
    id: string;
    code: string;
    label: string;
    unit: string;
    active: boolean;
    description?: string;
    type?: 'standard' | 'calculated';
    formula?: string;
    decimals?: number;
}

export type IndexValue = {
    id: string;
    indexId: string;
    period: string; // YYYY-MM
    value: number;
    lastUpdated?: string; // ISO String
    source?: string;
    comment?: string;
    publicationDate?: string; // DD/MM/YYYY
}



export type RevisionRuleType = 'PONDERE_SIMPLE' | 'PONDERE_A_B' | 'MONO_MOIS' | 'FIXE';

export type RevisionRuleIndex = {
    indexId: string;
    coefficient: number; // Weight of the index in the formula
}

export type RevisionRule = {
    id: string;
    code: string;
    name: string;
    type: RevisionRuleType;
    nbMonths: number; // Number of months for the average (e.g., 3)
    paramA?: number; // For PONDERE_A_B (e.g., 0.05)
    paramB?: number; // For PONDERE_A_B (e.g., 0.95)
    indices: RevisionRuleIndex[];
    description?: string;
    activityId?: string;
    p1Type?: string; // 'CHAUFFAGE', 'ECS', etc.
}

export type ServiceType = 'P1' | 'P2' | 'P3';

export type Service = {
    id: string;
    contractId: string;
    siteId: string;
    activityId: string; // Link to Activity (ECS, Chauffage, Maintenance...)
    type: ServiceType; // P1, P2, P3 (Derived from Activity)

    // Settings Links
    billingTermId?: string; // Link to Term (Trimestriel, Mensuel...)
    scheduleId?: string; // Link to Schedule (Echéancier)
    pricingRuleId?: string; // Link to PricingRule
    revisionRuleId?: string; // Link to RevisionRule

    // Financials
    price: number; // Base price or Flat rate

    // P1 Specific
    meterId?: string; // Link to Meter (if P1)

    // Validity
    startDate: string; // ISO String
    endDate: string; // ISO String

    // Identification
    code?: string; // code_prestation
    label?: string; // libelle

    // Typage
    energyType?: 'GAZ' | 'ELEC' | 'EAU' | 'AUTRE' | 'Gaz' | 'Electricité' | 'Réseau de chaleur' | 'Fioul' | 'Biomasse'; // type_energie
    p1Type?: 'ECS' | 'CHAUFFAGE' | 'EAU_FROIDE' | 'AUTRE'; // type_p1 (si P1)

    // Tarification
    unitPrice?: number; // prix_base / unit_price
    unit?: string; // unite_prix ('m3', 'MWh', '€/an', ...)
    vatRateId?: string; // id_tva
    isFixedPrice?: boolean; // Prix fixe (Oui/Non)
    moleculePrice?: number; // Prix Molécule base (si P1 et Prix fixe = oui)

    // Interest Parameters (P1 Heating)
    referenceNb?: number; // NB en MWh
    referenceDju?: number; // DJU de référence
    heatingContractType?: string; // MCI, MTI, etc.
    heatingWeatherStation?: string; // Station météo de référence
    sharingPercentage?: number; // % partagé
    interestUnitPrice?: number; // PU HT Intéressement
    settlementRuleId?: string; // Link to SettlementRule

    // Périodicité & validité
    // billingTermId already exists -> periodicite
    // startDate already exists -> date_debut
    // endDate already exists -> date_fin

    // Divers
    isActive: boolean; // actif
    comment?: string; // commentaire (alias for description)
    description?: string; // kept for backward compatibility or mapped to comment
    initialIndexValues?: ServiceInitialIndexValue[];
}

export type ServiceInitialIndexValue = {
    indexId: string;
    valueId?: string; // ID of the selected IndexValue (optional if manually entered)
    value: number; // Snapshot of the value
    period: string; // Snapshot of the period
};

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
    terms: z.array(z.object({
        id: z.string(),
        name: z.string(),
    })).describe('List of available billing terms to choose from.'),
    schedules: z.array(z.object({
        id: z.string(),
        name: z.string(),
    })).describe('List of available billing schedules to choose from.'),
});
export type ExtractContractInfoInput = z.infer<typeof ExtractContractInfoInputSchema>;

export const ExtractContractInfoOutputSchema = z.object({
    client: z.object({
        name: z.string().optional().describe("Nom du client final (ex: Copropriété Le Bastion)."),
        representativeName: z.string().optional().describe("Nom du représentant/Syndic si applicable (sinon null)."),
        address: z.string().optional().describe("Adresse du site/immeuble concerné."),
        postalCode: z.string().optional().describe("Code postal."),
        city: z.string().optional().describe("Ville."),
        clientType: z.enum(["private", "public"]).optional().describe("Type de client."),
        typologyName: z.string().optional().describe("Copropriété, Tertiaire, Industrie ou Collectivité."),
        siret: z.string().optional().describe("SIRET du client (ou du représentant si copropriété)."),
        isBe: z.boolean().optional().default(false),
        useChorus: z.boolean().optional().describe("True UNIQUEMENT si le client est une entité publique."),
        contactTechnique: z.object({
            name: z.string().optional(),
            email: z.string().optional(),
            phone: z.string().optional(),
        }).optional(),
        contactFacturation: z.object({
            name: z.string().optional(),
            email: z.string().optional(),
            phone: z.string().optional(),
        }).optional(),
        invoicingType: z.enum(['multi-site', 'global']).optional().describe("Type de facturation (global ou multi-site)."),
    }),
    contrat: z.object({
        objet: z.string().optional().describe("Objet du contrat."),
        name: z.string().optional().describe("Nom du contrat (ex: Contrat Maintenance - Le Bastion)."),
        label: z.string().optional().describe("Libellé (ex: Chauffage & ECS)."),
        startDate: z.string().optional().describe("Date de début (YYYY-MM-DD)."),
        durationStr: z.string().optional().describe("Durée telle qu'écrite (ex: 2 ans)."),
        endDate: z.string().optional().describe("Date de fin (YYYY-MM-DD)."),
        tacitRenewal: z.boolean().optional(),
        noticePeriod: z.string().optional().describe("Préavis de résiliation."),
        baseAmountP1: z.number().optional().describe("Montant P1 HT annuel."),
        baseAmountP2: z.number().optional().describe("Montant P2 HT annuel."),
        baseAmountP3: z.number().optional().describe("Montant P3 HT annuel."),
        baseAmountP3R: z.number().optional().describe("Montant P3R HT annuel."),
        invoicingType: z.enum(['multi-site', 'global']).optional().describe("Type de facturation (global ou multi-site)."),
    }),
    site: z.object({
        name: z.string().optional().describe("Nom du site (souvent identique au nom client)."),
        address: z.string().optional().describe("Adresse du site."),
        postalCode: z.string().optional().describe("Code postal du site."),
        city: z.string().optional().describe("Ville du site."),
        billingSchedule: z.string().optional().describe("Périodicité de facturation (ex: Mensuel, Trimestriel)."),
        term: z.string().optional().describe("Terme de paiement (ex: Échu, Échoir)."),
        revisionP1: z.string().optional().describe("Formule de révision P1."),
        revisionP2: z.string().optional().describe("Formule de révision P2."),
        revisionP3: z.string().optional().describe("Formule de révision P3."),
        heatingReferenceDju: z.number().optional().describe("DJU de référence."),
        heatingWeatherStation: z.string().optional().describe("Station météo."),
        hasInterest: z.boolean().optional().describe("Avec intéressement ?"),
        hasHeating: z.boolean().optional().describe("Chauffage inclus ?"),
        hasECS: z.boolean().optional().describe("ECS inclus ?"),
        contractualNB: z.number().optional().describe("Valeur du NB (Nombre de Base)."),
        smallQ: z.number().optional().describe("Valeur du petit q."),
    }).optional(),
    activityIds: z.array(z.string()).optional(),
    activitiesDetails: z.array(ActivityDetailSchema).optional(),
});
export type ExtractContractInfoOutput = z.infer<typeof ExtractContractInfoOutputSchema>;


// Data Context Type
export type DataContextType = {
    clients: Client[];
    contacts: Contact[]; // NEW: Contact entity
    sites: Site[];
    contracts: Contract[];
    invoices: Invoice[];
    creditNotes: CreditNote[];
    indices: Index[];
    indexValues: IndexValue[];
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
    revisionRules: RevisionRule[];
    services: Service[];
    paymentTerms: PaymentTerm[];
    pricingRules: PricingRule[];
    markets: Market[];
    roles: Role[];
    users: User[];
    // Contract Events
    amendments: Amendment[];
    terminations: Termination[];
    renewals: Renewal[];
    trusteeChanges: TrusteeChange[];
    beChanges: BeChange[];
    interests: Interest[];
    settlementRules: SettlementRule[];

    // Legacy Works (Keep for compatibility)
    workProjects: WorkProject[];
    workQuotes_legacy: WorkQuote[]; // renamed slightly in context if needed
    progressSituations: ProgressSituation[];

    // Advanced Works Collections
    advWorkQuotes: AdvWorkQuote[];
    advWorkQuoteVersions: AdvWorkQuoteVersion[];
    advWorkQuoteLines: AdvWorkQuoteLine[];
    advWorkAffairs: AdvWorkAffair[];
    advWorkBudgetLines: AdvWorkBudgetLine[];
    advWorkLots: AdvWorkLot[];
    advWorkPostes: AdvWorkPoste[];
    advWorkSituations: AdvWorkSituation[];
    advWorkSituationLines: AdvWorkSituationLine[];
    advPurchaseOrders: AdvPurchaseOrder[];
    advPurchaseOrderLines: AdvPurchaseOrderLine[];
    advCatalogArticles: AdvCatalogArticle[];
    advCatalogOuvrages: AdvCatalogOuvrage[];
    advOuvrageComposants: AdvOuvrageComposant[];

    currentUser: User | null;
    setCurrentUser: (user: User | null) => void;
    isLoading: boolean;
    reloadData: () => Promise<void>;
    login: (email: string, password: string) => Promise<void>;
    signup: (email: string, password: string) => Promise<void>;
    loginWithGoogle: () => Promise<void>;
    logout: () => Promise<void>;
};

