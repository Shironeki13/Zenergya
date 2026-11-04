/**
 * Devis : modèle de données.
 *
 * Principes (docs/devis.md) :
 * - un devis porte sur un client ou un prospect ; le site et le contrat sont facultatifs
 *   (sans site : une adresse d'intervention) ;
 * - le chiffrage interne (déboursé, coefficient, marge) et le prix client sont distincts ;
 * - les paramètres de prix (coefficient, taux horaire de main-d'œuvre) sont recopiés sur le devis
 *   à sa création : modifier la fiche client ensuite ne change pas un devis existant ;
 * - montants au centime, TVA par ligne, totaux recalculés à chaque enregistrement.
 */

export const QUOTE_STATUSES = ['brouillon', 'envoye', 'accepte', 'refuse', 'expire', 'annule'] as const;
export type QuoteStatus = typeof QUOTE_STATUSES[number];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
    brouillon: 'Brouillon',
    envoye: 'Envoyé',
    accepte: 'Accepté',
    refuse: 'Refusé',
    expire: 'Expiré',
    annule: 'Annulé',
};

export type QuoteMode = 'P5' | 'P6';

/**
 * Nature d'une ligne :
 * - FOURNITURE, SOUS_TRAITANCE, DIVERS : prix = déboursé unitaire × coefficient ;
 * - MAIN_OEUVRE : quantité en heures, prix = taux horaire de vente, coût = coût horaire interne ;
 * - TITRE, SOUS_TOTAL, TEXTE : structure et commentaires, sans montant propre.
 */
export const QUOTE_LINE_KINDS = ['TITRE', 'FOURNITURE', 'MAIN_OEUVRE', 'SOUS_TRAITANCE', 'DIVERS', 'TEXTE', 'SOUS_TOTAL'] as const;
export type QuoteLineKind = typeof QUOTE_LINE_KINDS[number];

export const PRICED_KINDS: readonly QuoteLineKind[] = ['FOURNITURE', 'MAIN_OEUVRE', 'SOUS_TRAITANCE', 'DIVERS'];

export const QUOTE_LINE_KIND_LABELS: Record<QuoteLineKind, string> = {
    TITRE: 'Titre',
    FOURNITURE: 'Fourniture',
    MAIN_OEUVRE: "Main-d'œuvre",
    SOUS_TRAITANCE: 'Sous-traitance',
    DIVERS: 'Divers',
    TEXTE: 'Texte',
    SOUS_TOTAL: 'Sous-total',
};

export type QuoteLine = {
    id: string;
    kind: QuoteLineKind;
    label: string;
    description?: string;
    unit?: string;               // u, m, m², h, ens…
    quantity: number;
    /** Déboursé unitaire HT (main-d'œuvre : vide = coût horaire du devis). */
    unitCost?: number | null;
    /** Coefficient propre à la ligne (vide = celui du devis). */
    coefficient?: number | null;
    /** Prix unitaire de vente imposé (vide = calculé). */
    unitPriceOverride?: number | null;
    discountPct?: number;        // remise de la ligne, en %
    vatRate: number;             // en % (20, 10, 5.5…)
    /** Ligne en option : affichée, non comptée dans les totaux. */
    optional?: boolean;
    level?: number;              // niveau d'un titre (0, 1…)
};

/** Paramètres de prix du devis, recopiés depuis la fiche client puis la société. */
export type QuotePricing = {
    coefficient: number | null;      // coefficient de vente sur le déboursé
    laborRate: number | null;        // taux horaire de main-d'œuvre facturé (€ HT / h)
    laborCost: number | null;        // coût horaire interne de la main-d'œuvre (€ / h)
    defaultVatRate: number;          // TVA proposée pour une nouvelle ligne
    /** D'où vient chaque paramètre, pour l'afficher. */
    sources?: Partial<Record<'coefficient' | 'laborRate' | 'laborCost', 'client' | 'company'>>;
};

export type QuoteAddress = { address: string; postalCode?: string; city?: string };

export type QuoteTotals = {
    totalHT: number;
    vat: { rate: number; base: number; amount: number }[];
    totalVAT: number;
    totalTTC: number;
    totalCost: number;              // déboursé total
    margin: number;                 // totalHT - totalCost
    marginRate: number | null;      // marge / prix de vente
    effectiveCoefficient: number | null; // prix de vente / déboursé
    laborHours: number;
    optionsHT: number;              // montant des options (non compté)
};

export type Quote = {
    id: string;
    number: string;                 // {CODE}-DEV{AAAA}-{NNNN}
    companyId: string;
    clientId: string;
    clientName: string;
    /** Le client était un prospect à la création du devis. */
    prospect?: boolean;
    contractId?: string;
    siteId?: string;
    siteName?: string;
    /** Lieu d'intervention quand le devis ne porte pas sur un site existant. */
    interventionAddress?: QuoteAddress;
    title: string;                  // objet du devis
    mode: QuoteMode;
    // Suivi commercial
    authorId?: string;              // rédacteur du devis (utilisateur responsable, chargé d'affaires)
    authorName?: string;            // copie : reste lisible si l'utilisateur change ou part
    authorEmail?: string;
    agencyId?: string;              // analytique et périmètre (repris du client)
    sectorId?: string;
    contactId?: string;             // interlocuteur chez le client (destinataire du devis)
    contactName?: string;           // copie au moment du devis
    contactEmail?: string;
    contactPhone?: string;
    clientReference?: string;       // référence du client : n° de consultation, de demande…
    requestDate?: string;           // date de la demande du client (YYYY-MM-DD)
    status: QuoteStatus;
    version: number;                // 1, 2… (une nouvelle version à chaque modification après envoi)
    date: string;                   // YYYY-MM-DD
    validityDays: number;
    validUntil: string;             // YYYY-MM-DD
    paymentTerms?: string;
    estimatedStart?: string;        // date de début estimée (YYYY-MM-DD)
    estimatedDuration?: string;     // durée estimée (texte libre : « 3 jours »)
    notes?: string;                 // conditions particulières, affichées sur le devis
    internalNotes?: string;         // jamais affichées au client
    pricing: QuotePricing;
    lines: QuoteLine[];
    totals: QuoteTotals;
    createdAt: string;
    createdBy?: string;
    updatedAt: string;
    updatedBy?: string;
};
