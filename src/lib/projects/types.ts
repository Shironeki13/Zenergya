/**
 * Affaires de travaux : une affaire par devis accepté (P5 ou P6), à laquelle se rattachent les devis complémentaires.
 * Facturation directe (acompte, solde, totalité, depuis chaque devis) ou par situations mensuelles (le marché de
 * l'affaire). L'affaire porte le budget prévu de ses devis et son code analytique.
 * Collections `projects` et `projectSituations`, écrites par le serveur seulement.
 */

export type ProjectStatus = 'en_cours' | 'termine' | 'cloture';

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
    en_cours: 'En cours',
    termine: 'Travaux terminés',
    cloture: 'Clôturée',
};

/** Ligne du marché : une ligne chiffrée du devis, figée à la création de l'affaire. */
export type ProjectLine = {
    id: string;            // identifiant de la ligne du devis
    label: string;
    unit?: string;
    quantity: number;
    unitPrice: number;     // prix unitaire HT (remise déduite dans totalHT)
    totalHT: number;
    vatRate: number;       // %
    section?: string;      // titre du devis sous lequel figure la ligne
};

export type Project = {
    id: string;
    code: string;                    // {CODE}-AFF{AAAA}-{NNNN}
    companyId: string;
    clientId: string;
    clientName: string;
    siteId?: string;
    siteName?: string;
    contractId?: string;
    quoteId: string;
    quoteNumber: string;
    quoteVersion: number;
    purchaseOrderNumber?: string;
    title: string;
    status: ProjectStatus;
    lines: ProjectLine[];
    totalHT: number;
    totalTTC: number;
    vat: { rate: number; base: number; amount: number }[];
    /** Retenue de garantie, en % du TTC de chaque situation ; 0 si remplacée par une caution. */
    retentionPct: number;
    retentionBond?: boolean;         // caution bancaire en remplacement de la retenue
    authorName?: string;
    completedAt?: string;            // travaux terminés (réception)
    retentionReleasedAt?: string;    // retenue libérée (fin du délai de garantie)
    closedAt?: string;
    /** Facturation : par situations (défaut, affaires antérieures) ou directe depuis les devis. */
    billing?: import('./affaire').FacturationAffaire;
    mode?: 'P5' | 'P6';
    agencyId?: string;
    sectorId?: string;
    /** Devis de l'affaire (le premier, puis les complémentaires) avec leur budget. */
    quotes?: import('./affaire').DevisAffaire[];
    /** Budget prévu : somme des devis (vente, déboursé par nature, heures, marge). */
    budget?: import('./affaire').BudgetDevis;
    /** Analytique : code généré figé à la création, axes, code externe (lib/analytique). */
    analyticCode?: string | null;
    analyticAxes?: import('@/lib/analytique').AnalytiqueLigne['axes'];
    analyticExternal?: string | null;
    createdAt: string;
    createdBy?: string;
    updatedAt: string;
};

/** Avancement cumulé par ligne, en % (0 à 100). */
export type Progress = Record<string, number>;

export type ProjectSituation = {
    id: string;
    projectId: string;
    number: number;                  // n° de situation dans l'affaire
    period: string;                  // AAAA-MM
    progress: Progress;
    status: 'brouillon' | 'facturee';
    invoiceId?: string;
    invoiceNumber?: string;
    createdAt: string;
    createdBy?: string;
    updatedAt: string;
};

/** État cumulé après une situation facturée : enregistré sur sa facture (référence des suivantes). */
export type SituationSnapshot = {
    projectId: string;
    projectCode: string;
    situationId: string;
    number: number;
    period: string;
    progress: Progress;
    cumulative: { rate: number; base: number; amount: number }[];   // cumul HT et TVA par taux
    retention: { pct: number; amount: number };
    netToPay: number;
};
