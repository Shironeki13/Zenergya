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
    /** Valeurs saisies, normalisées, de chaque champ à contrôler (CHAMPS_VALIDATION). */
    valeurs: Record<string, ValeurChamp>;
};

// --- Contrôle par la contrathèque : chaque valeur saisie est comparée au document avant validation ---

export type TypeChamp = 'texte' | 'date' | 'montant' | 'booleen' | 'email';
export type ValeurChamp = string | number | boolean | null;
export type DefChamp = {
    cle: string;
    libelle: string;
    type: TypeChamp;
    /** Toujours contrôlé, même vide (sinon : contrôlé seulement s'il est renseigné). */
    requis?: boolean;
    /** Non corrigeable ici (donnée reprise d'une autre fiche). */
    fige?: boolean;
};

const MONTANTS_AVENANT: DefChamp[] = (['P1', 'P2', 'P3', 'P3R'] as const).map(p => ({ cle: `impact${p}`, libelle: `Impact ${p} (€ HT/an)`, type: 'montant' as const }));
const AVENANT: DefChamp[] = [
    { cle: 'description', libelle: 'Objet', type: 'texte', requis: true },
    { cle: 'effectiveDate', libelle: "Date d'effet", type: 'date', requis: true },
    { cle: 'signed', libelle: 'Signé', type: 'booleen', requis: true },
    { cle: 'impactsDuration', libelle: 'Modifie la durée', type: 'booleen', requis: true },
    { cle: 'newEndDate', libelle: 'Nouvelle fin du contrat', type: 'date' },
    ...MONTANTS_AVENANT,
];

/** Champs contrôlés, par type de document. */
export const CHAMPS_VALIDATION: Record<TypeValidation, DefChamp[]> = {
    contrat: [
        { cle: 'clientName', libelle: 'Client', type: 'texte', requis: true, fige: true },
        { cle: 'label', libelle: 'Libellé', type: 'texte', requis: true },
        { cle: 'startDate', libelle: 'Début', type: 'date', requis: true },
        { cle: 'endDate', libelle: 'Fin', type: 'date', requis: true },
        { cle: 'marketType', libelle: 'Type de marché', type: 'texte' },
        { cle: 'baseAmountP1', libelle: 'Base marché P1 (€ HT/an)', type: 'montant' },
        { cle: 'baseAmountP2', libelle: 'Base marché P2 (€ HT/an)', type: 'montant' },
        { cle: 'baseAmountP3', libelle: 'Base marché P3 (€ HT/an)', type: 'montant' },
        { cle: 'baseAmountP3R', libelle: 'Base marché P3R (€ HT/an)', type: 'montant' },
        { cle: 'tacitRenewal', libelle: 'Tacite reconduction', type: 'booleen', requis: true },
        { cle: 'renewalDuration', libelle: 'Durée de reconduction', type: 'texte' },
        { cle: 'noticePeriod', libelle: 'Préavis', type: 'texte' },
    ],
    avenant: AVENANT,
    os: AVENANT,
    reconduction: [
        { cle: 'duration', libelle: 'Durée', type: 'texte', requis: true },
        { cle: 'newEndDate', libelle: 'Nouvelle fin du contrat', type: 'date', requis: true },
    ],
    resiliation: [
        { cle: 'effectiveDate', libelle: "Date d'effet", type: 'date', requis: true },
        { cle: 'reason', libelle: 'Motif', type: 'texte', requis: true },
    ],
    syndic: [
        { cle: 'currentRepresentative', libelle: 'Syndic sortant', type: 'texte' },
        { cle: 'newRepresentative', libelle: 'Nouveau syndic', type: 'texte', requis: true },
        { cle: 'contactEmail', libelle: 'E-mail de contact', type: 'email' },
        { cle: 'effectiveDate', libelle: "Date d'effet", type: 'date', requis: true },
    ],
    be: [
        { cle: 'currentBe', libelle: 'BE sortant', type: 'texte' },
        { cle: 'newBe', libelle: "Nouveau bureau d'études", type: 'texte', requis: true },
        { cle: 'contactEmail', libelle: 'E-mail de contact', type: 'email' },
        { cle: 'effectiveDate', libelle: "Date d'effet", type: 'date', requis: true },
    ],
};

const vide = (v: ValeurChamp | undefined) => v === null || v === undefined || v === '';

/** Valeur stockée → valeur de contrôle (date « AAAA-MM-JJ », montant nombre, oui / non booléen, texte). */
export function valeurChamp(def: DefChamp, brut: unknown): ValeurChamp {
    if (brut === null || brut === undefined || brut === '') return null;
    switch (def.type) {
        case 'date': {
            const t = typeof (brut as { toDate?: () => Date }).toDate === 'function' ? (brut as { toDate: () => Date }).toDate() : new Date(String(brut));
            if (Number.isNaN(t.getTime())) return String(brut);
            // Les dates saisies « AAAA-MM-JJ » sont gardées telles quelles ; les instants, ramenés au jour de Paris.
            return /^\d{4}-\d{2}-\d{2}$/.test(String(brut)) ? String(brut) : t.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
        }
        case 'montant': { const n = Number(brut); return Number.isFinite(n) ? n : null; }
        case 'booleen': return brut === true || brut === 'true';
        default: return String(brut).trim();
    }
}

/** Valeurs de contrôle de tous les champs d'un type. */
export const valeursDocument = (type: TypeValidation, d: Record<string, unknown>): Record<string, ValeurChamp> =>
    Object.fromEntries(CHAMPS_VALIDATION[type].map(c => [c.cle, valeurChamp(c, d[c.cle])]));

/** Champs à cocher « conforme au document » : les champs requis et ceux renseignés. */
export const champsAControler = (type: TypeValidation, valeurs: Record<string, ValeurChamp>): DefChamp[] =>
    CHAMPS_VALIDATION[type].filter(c => c.requis || !vide(valeurs[c.cle]) || (c.type === 'booleen' && valeurs[c.cle] === true));

/** Vérifie et normalise une correction ; lève une erreur lisible si elle est invalide. */
export function normaliserCorrection(type: TypeValidation, cle: string, v: unknown): ValeurChamp {
    const def = CHAMPS_VALIDATION[type].find(c => c.cle === cle);
    if (!def) throw new Error(`Champ inconnu : ${cle}.`);
    if (def.fige) throw new Error(`« ${def.libelle} » ne se corrige pas ici.`);
    const brut = typeof v === 'string' ? v.trim() : v;
    if (brut === '' || brut === null || brut === undefined) {
        if (def.requis) throw new Error(`« ${def.libelle} » est obligatoire.`);
        return null;
    }
    switch (def.type) {
        case 'date':
            if (typeof brut !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(brut) || Number.isNaN(new Date(brut).getTime())) throw new Error(`« ${def.libelle} » : date invalide.`);
            return brut;
        case 'montant': {
            const n = typeof brut === 'number' ? brut : Number(String(brut).replace(/\s/g, '').replace(',', '.'));
            if (!Number.isFinite(n)) throw new Error(`« ${def.libelle} » : montant invalide.`);
            return Math.round(n * 100) / 100;
        }
        case 'booleen':
            if (typeof brut !== 'boolean') throw new Error(`« ${def.libelle} » : oui ou non attendu.`);
            return brut;
        case 'email':
            if (typeof brut !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(brut)) throw new Error(`« ${def.libelle} » : e-mail invalide.`);
            return brut;
        default:
            if (typeof brut !== 'string') throw new Error(`« ${def.libelle} » : texte attendu.`);
            return brut;
    }
}

/** Affichage d'une valeur de contrôle. */
export function afficherValeur(def: Pick<DefChamp, 'type'>, v: ValeurChamp): string {
    if (vide(v)) return '—';
    if (def.type === 'booleen') return v ? 'Oui' : 'Non';
    if (def.type === 'montant') return `${Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
    if (def.type === 'date') { const t = new Date(String(v)); return Number.isNaN(t.getTime()) ? String(v) : t.toLocaleDateString('fr-FR', { timeZone: 'UTC' }); }
    return String(v);
}

/** Contrôle complet : tous les champs à contrôler (après corrections) sont cochés. */
export function controleComplet(type: TypeValidation, valeurs: Record<string, ValeurChamp>, coches: Iterable<string>): { complet: boolean; manquants: DefChamp[] } {
    const c = new Set(coches);
    const manquants = champsAControler(type, valeurs).filter(d => !c.has(d.cle));
    return { complet: manquants.length === 0, manquants };
}

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
        case 'resiliation': return [`Le contrat passe « Résilié » au ${jour(d.effectiveDate ?? e.effet)}.`];
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
