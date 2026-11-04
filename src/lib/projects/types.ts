/**
 * Affaires (P6) : un devis accepté facturé à l'avancement, par situations mensuelles.
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
