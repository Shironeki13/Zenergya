
import { z } from 'zod';

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

export const ClientSchema = z.object({
    name: z.string().min(2, "La raison sociale est requise."),
    address: z.string().optional(),
    postalCode: z.string().optional(),
    city: z.string().optional(),
    clientType: z.enum(["private", "public"], { required_error: "Le type de client est requis." }),
    typologyId: z.string({ required_error: "La typologie est requise." }),
    // Hierarchy fields
    companyId: z.string({ required_error: "La société est requise." }),
    agencyId: z.string({ required_error: "L'agence est requise." }),
    sectorId: z.string({ required_error: "Le secteur est requis." }),
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
    invoicingType: z.enum(['multi-site', 'global'], { required_error: "Le type de facturation est requis." }).default('multi-site'),
    // Contract fields
    siteIds: z.array(z.string()).optional(),
    startDate: z.date().optional(),
    endDate: z.date().optional(),
    renewal: z.boolean().default(false),
    renewalDuration: z.string().optional(),
    tacitRenewal: z.boolean().default(false),
    activityIds: z.array(z.string()).optional(),
    activitiesDetails: z.array(ActivityDetailSchema).optional(),
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
    formula?: string; // Custom formula string
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

    activitiesDetails?: z.infer<typeof ActivityDetailSchema>[];

    monthlyBilling?: MonthlyBilling[];

    // Revisions (Legacy/Global)
    revisionP1?: RevisionInfo;
    revisionP2?: RevisionInfo;
    revisionP3?: RevisionInfo;
    analyticP1?: string;
    analyticP2?: string;
    analyticP3?: string;

    // P1 Specific Fields (Legacy or kept for easy access?)
    // We might want to keep them for backward compatibility or ease of use if not using activitiesDetails everywhere yet
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
}

export type ServiceType = 'P1' | 'P2' | 'P3';

export type ServiceMeterAssociation = {
    meterId: string;
    usage: string; // e.g., 'ECS', 'Chauffage'
    distributionCoef: number; // e.g., 1.0 or 0.5
}

export type Service = {
    id: string;
    contractId: string;
    siteId: string;
    type: ServiceType; // P1, P2, P3
    activityId: string; // Link to Activity (ECS, Chauffage, Maintenance...)

    // Pricing & Revision
    billingMode?: string; // e.g., 'M3', 'KWH', 'FORFAIT'
    basePrice?: number; // Prix unitaire de base or Forfait amount
    baseIndexDate?: string; // Date de référence pour C0 (ISO string)
    baseIndexValue?: number; // Valeur C0 explicite (optional)

    revisionRuleId?: string; // Link to RevisionRule

    // P2/P3 Specifics
    periodicity?: string; // e.g., 'Mensuel', 'Trimestriel', 'Annuel'
    startDate?: string;
    endDate?: string;

    // P1 Specifics
    associatedMeters?: ServiceMeterAssociation[];

    description?: string;
}

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
    chorusMarketNumber: z.string().optional().describe("Le numéro de marché Chorus, si disponible."),
    startDate: z.string().optional().describe("Date de démarrage du contrat au format ISO 8601 (YYYY-MM-DD)."),
    endDate: z.string().optional().describe("Date de fin du contrat au format ISO 8601 (YYYY-MM-DD)."),
    renewal: z.boolean().optional().describe("Indique si le contrat est à reconduction."),
    renewalDuration: z.string().optional().describe("La durée de la reconduction (ex: '1 an', '2 ans')."),
    tacitRenewal: z.boolean().optional().describe("Indique si la reconduction est tacite."),

    activityIds: z.array(z.string()).optional().describe("Un tableau des IDs des prestations (activités) trouvées dans le document. Choisir parmi la liste fournie."),
    activitiesDetails: z.array(ActivityDetailSchema).optional().describe("Détails par activité (montant, terme, échéance, révision, etc.)."),
});
export type ExtractContractInfoOutput = z.infer<typeof ExtractContractInfoOutputSchema>;


// Data Context Type
export type DataContextType = {
    clients: Client[];
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
    currentUser: User | null;
    setCurrentUser: (user: User | null) => void;
    isLoading: boolean;
    reloadData: () => Promise<void>;
    login: (email: string, password: string) => Promise<void>;
    signup: (email: string, password: string) => Promise<void>;
    loginWithGoogle: () => Promise<void>;
    logout: () => Promise<void>;
};

