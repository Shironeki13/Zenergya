/**
 * Validation des documents de contrat (logique pure) : types de documents, file d'attente, effets d'une validation sur
 * le contrat ou le client. Le traitement est fait au serveur (services/validations-admin), par un administrateur.
 */

export const TYPES_VALIDATION = ['contrat', 'avenant', 'os', 'reconduction', 'resiliation', 'syndic', 'be'] as const;
export type TypeValidation = typeof TYPES_VALIDATION[number];

export const LIBELLES_VALIDATION: Record<TypeValidation, string> = {
    contrat: 'Base marché', avenant: 'Avenants', os: 'Ordres de service', reconduction: 'Reconductions', resiliation: 'Résiliations',
    syndic: 'Changements de syndic', be: 'Changements de BE',
};
export const LIBELLE_UNITAIRE: Record<TypeValidation, string> = {
    contrat: 'contrat (base marché)', avenant: 'avenant', os: 'ordre de service', reconduction: 'reconduction', resiliation: 'résiliation',
    syndic: 'changement de syndic', be: 'changement de BE',
};

/** Libellé unitaire précédé du démonstratif accordé (« ce contrat », « cette reconduction »). */
const FEMININ: TypeValidation[] = ['reconduction', 'resiliation'];
export const ceUnitaire = (t: TypeValidation) => (t === 'contrat' ? 'le contrat' : `${FEMININ.includes(t) ? 'cette' : 'ce'} ${LIBELLE_UNITAIRE[t]}`);
export const aucunUnitaire = (t: TypeValidation) => `${FEMININ.includes(t) ? 'Aucune' : 'Aucun'} ${LIBELLE_UNITAIRE[t]}`;

/** Collection Firestore de chaque type (avenants et OS partagent la leur, distingués par `nature`). */
export const COLLECTION_VALIDATION: Record<TypeValidation, string> = {
    contrat: 'contracts', avenant: 'amendments', os: 'amendments', reconduction: 'renewals', resiliation: 'terminations', syndic: 'trusteeChanges', be: 'beChanges',
};

export type ElementAValider = {
    type: TypeValidation;
    id: string;
    contractId: string;
    contractNumber: string;
    clientId: string;
    clientName: string;
    demandePar: string;
    demandeLe: string | null;
    /** Date d'effet (événements) ou début du contrat. */
    effet: string | null;
    details: string;
    documentUrl: string | null;
    documentName: string | null;
    /** Données utiles aux effets (nouvelle fin, nouveau syndic…). */
    donnees: Record<string, unknown>;
};

const jour = (d: unknown) => {
    if (!d) return '';
    const t = new Date(String(d));
    return Number.isNaN(t.getTime()) ? String(d) : t.toLocaleDateString('fr-FR');
};

/** Ce que la validation changera (affiché avant de confirmer). */
export function effetsValidation(e: Pick<ElementAValider, 'type' | 'donnees' | 'effet'>): string[] {
    const d = e.donnees;
    switch (e.type) {
        case 'contrat': return ['Le contrat devient « Actif » et entre dans la facturation.', 'Les valeurs P1 saisies à la création sont reprises dans le paramétrage P1 de ses sites.'];
        case 'avenant':
        case 'os': return d.impactsDuration && d.newEndDate ? [`La fin du contrat passe au ${jour(d.newEndDate)}.`] : ['Aucun changement automatique : document ajouté à l\'historique du contrat.'];
        case 'reconduction': return d.newEndDate ? [`La fin du contrat passe au ${jour(d.newEndDate)}.`] : [];
        case 'resiliation': return [`Le contrat passe « Résilié » au ${jour(e.effet)}.`];
        case 'syndic': return [`Le client est désormais représenté par ${String(d.newRepresentative ?? '')}.`];
        case 'be': return [`Bureau d'études du client : ${String(d.newBe ?? '')}${d.contactEmail ? ` (${String(d.contactEmail)})` : ''}.`];
    }
}

/** Résumé d'un document en attente, selon son type. */
export function detailsElement(type: TypeValidation, d: Record<string, unknown>): string {
    switch (type) {
        case 'contrat': return [d.label, d.startDate && d.endDate ? `${jour(d.startDate)} → ${jour(d.endDate)}` : '', Array.isArray(d.siteIds) ? `${d.siteIds.length} site(s)` : ''].filter(Boolean).join(' · ');
        case 'avenant':
        case 'os': return [String(d.description ?? ''), d.impactsDuration && d.newEndDate ? `nouvelle fin ${jour(d.newEndDate)}` : ''].filter(Boolean).join(' · ');
        case 'reconduction': return [d.duration ? `durée ${d.duration}` : '', d.newEndDate ? `nouvelle fin ${jour(d.newEndDate)}` : ''].filter(Boolean).join(' · ');
        case 'resiliation': return String(d.reason ?? '');
        case 'syndic': return `${d.currentRepresentative ? `${d.currentRepresentative} → ` : ''}${d.newRepresentative ?? ''}`;
        case 'be': return `${d.currentBe ? `${d.currentBe} → ` : ''}${d.newBe ?? ''}`;
    }
}

/** Type d'un document de la collection des avenants. */
export const typeAvenant = (d: Record<string, unknown>): TypeValidation => (d.nature === 'os' ? 'os' : 'avenant');
