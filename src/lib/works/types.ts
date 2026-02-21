export type WorkMode = 'P5' | 'P6';
export type WorkQuoteStatus = 'brouillon' | 'envoye' | 'accepte' | 'refuse';
export type WorkVersionStatus = 'courante' | 'archivee';
export type WorkLineType = 'ARTICLE' | 'OUVRAGE' | 'TEXTE' | 'TITRE' | 'SOUS_TOTAL';
export type WorkAffairStatus = 'a_chiffrer' | 'en_cours' | 'cloture';
export type WorkSituationStatus = 'brouillon' | 'valide' | 'facture' | 'annule';

export interface WorkQuote {
    id: string;
    numero: string;
    date: string;
    statut: WorkQuoteStatus;
    clientId: string;
    siteId: string;
    affairId?: string;
    mode: WorkMode;
    validiteJours: number;
    conditionsPaiement: string;
    tvaMode: string;
    totalHT: number;
    totalTVA: number;
    totalTTC: number;
    currentVersionId: string;
}

export interface WorkQuoteVersion {
    id: string;
    quoteId: string;
    numeroVersion: string; // V1, V2...
    date: string;
    commentaire?: string;
    statut: WorkVersionStatus;
}

export interface WorkQuoteLine {
    id: string;
    versionId: string;
    type: WorkLineType;
    libelle: string;
    uom?: string; // Unit of Measure
    quantite: number;
    puHT: number;
    remisePct: number;
    tvaPct: number;
    coutUnitaire?: number; // Pre-calculation or "déboursé"

    // Analytics
    agencyId: string;
    sectorId: string;
    contractId?: string;
    siteId: string;
    affairId?: string;
    activite: string;
    natureCout: string;

    ordreAffichage: number;
    niveau: number; // For hierarchy
}

export interface WorkAffair {
    id: string;
    codeAffaire: string;
    clientId: string;
    contractId?: string;
    siteId: string;
    mode: WorkMode;
    statut: WorkAffairStatus;
    agencyId: string;
    sectorId: string;
    dateDebut?: string;
    dateFinPrevue?: string;
}

export interface WorkBudgetLine {
    id: string;
    affairId: string;
    poste: string; // MO, Matériel, ST, Location, Frais...
    quantite: number;
    coutUnitaire: number;
    coutTotal: number;
    lotId?: string;
    posteId?: string;
    activite: string;
    natureCout: string;
    quoteLineId?: string; // Traceability
}

export interface WorkLot {
    id: string;
    affairId: string;
    code: string;
    libelle: string;
    ordre: number;
}

export interface WorkPoste {
    id: string;
    lotId: string;
    code: string;
    libelle: string;
    uom: string;
    qteMarche: number;
    puHT: number;
}

export interface WorkSituation {
    id: string;
    affairId: string;
    periode: string; // YYYY-MM
    numero: number;
    date: string;
    retenueGarantiePct?: number;
    acompte?: number;
    totalHT: number;
    totalTVA: number;
    totalTTC: number;
    statut: WorkSituationStatus;
}

export interface WorkSituationLine {
    id: string;
    situationId: string;
    posteId?: string;
    quoteLineId?: string;
    qteMois: number;
    pctMois: number;
    cumulPrecedent: number;
    cumulActuel: number;
    montantHT: number;
}

export interface PurchaseOrder {
    id: string;
    affairId: string;
    numero: string;
    date: string;
    fournisseurId: string;
    statut: 'brouillon' | 'envoye' | 'recu' | 'facture';
    totalHT: number;
}

export interface PurchaseOrderLine {
    id: string;
    purchaseOrderId: string;
    libelle: string;
    quantite: number;
    puHT: number;
    natureCout: string;
    activite: string;
    lotId?: string;
    posteId?: string;
}

export interface CatalogArticle {
    id: string;
    code: string;
    libelle: string;
    uom: string;
    coutUnitaire: number;
    prixVenteBase: number;
}

export interface CatalogOuvrage {
    id: string;
    code: string;
    libelle: string;
    uom: string;
    prixVenteBase: number;
}

export interface OuvrageComposant {
    id: string;
    ouvrageId: string;
    articleId: string;
    quantite: number;
}
