/**
 * Imports en masse : description des données importables.
 *
 * Une seule description par type de données alimente les modèles (CSV, XLSX), la notice, la lecture des
 * fichiers, les contrôles et l'aperçu. Les en-têtes des fichiers sont les libellés ci-dessous (les clés et
 * alias sont aussi reconnus).
 */

export type FieldType = 'text' | 'number' | 'boolean' | 'enum' | 'siret' | 'email' | 'postalCode';

/** Listes de référence, lues dans le paramétrage (onglet « Listes » du modèle XLSX). */
export type RefList = 'companies' | 'agencies' | 'sectors' | 'typologies' | 'meterTypes';

export type ImportField = {
    key: string;
    label: string;
    type: FieldType;
    /** 'create' : obligatoire pour créer (une cellule vide en mise à jour conserve la valeur). */
    required?: 'create';
    options?: { value: string; label: string; aliases?: string[] }[];
    refList?: RefList;
    example?: string;
    help?: string;
    aliases?: string[];
};

export type ImportEntityKey = 'clients' | 'sites' | 'contacts' | 'meters';

export type ImportEntity = {
    key: ImportEntityKey;
    label: string;
    description: string;
    /** Comment une ligne retrouve un élément existant (sinon : création). */
    matching: string;
    fields: ImportField[];
};

const OUI_NON = 'oui / non';

export const IMPORT_ENTITIES: Record<ImportEntityKey, ImportEntity> = {
    clients: {
        key: 'clients',
        label: 'Clients et prospects',
        description: 'Fiches clients et prospects, avec leur rattachement, la facturation électronique, Chorus Pro et les conditions de devis.',
        matching: 'Code client (CLI-…), sinon SIRET : la fiche existante est mise à jour ; sinon une fiche est créée (code CLI attribué).',
        fields: [
            { key: 'code', label: 'Code client', type: 'text', example: '', aliases: ['code', 'cli'], help: 'Vide pour une création (attribué : CLI-00001). Renseigné : met à jour cette fiche.' },
            { key: 'name', label: 'Raison sociale', type: 'text', required: 'create', example: 'SCI Les Lilas', aliases: ['nom', 'client', 'societe'] },
            {
                key: 'clientType', label: 'Type', type: 'enum', required: 'create', example: 'Privé',
                options: [{ value: 'private', label: 'Privé', aliases: ['prive', 'private'] }, { value: 'public', label: 'Public' }],
                help: 'Public : entité publique, factures déposées sur Chorus Pro.',
            },
            {
                key: 'relation', label: 'Relation', type: 'enum', example: 'Client',
                options: [{ value: 'client', label: 'Client' }, { value: 'prospect', label: 'Prospect' }], help: 'Vide à la création : Client.',
            },
            { key: 'siret', label: 'SIRET', type: 'siret', example: '73282932000074', help: '14 chiffres (clé de contrôle vérifiée). Obligatoire pour un client public.' },
            { key: 'address', label: 'Adresse', type: 'text', required: 'create', example: '5 rue des Lilas' },
            { key: 'postalCode', label: 'Code postal', type: 'postalCode', required: 'create', example: '69003', aliases: ['cp'] },
            { key: 'city', label: 'Ville', type: 'text', required: 'create', example: 'Lyon', aliases: ['commune'] },
            { key: 'typologyId', label: 'Typologie', type: 'text', required: 'create', refList: 'typologies', example: 'Copropriété', help: 'Nom d\'une typologie du paramétrage (onglet Listes).' },
            { key: 'companyId', label: 'Société', type: 'text', required: 'create', refList: 'companies', example: 'VEF', help: 'Code ou nom de la société (onglet Listes).' },
            { key: 'agencyId', label: 'Agence', type: 'text', required: 'create', refList: 'agencies', example: 'Lyon', help: 'Nom d\'une agence de la société.' },
            { key: 'sectorId', label: 'Secteur', type: 'text', required: 'create', refList: 'sectors', example: 'Lyon Est', help: 'Nom d\'un secteur de l\'agence.' },
            { key: 'representedBy', label: 'Représenté par', type: 'text', example: 'Syndic Dupont' },
            { key: 'useChorus', label: 'Dépôt Chorus', type: 'boolean', example: 'non', help: OUI_NON },
            { key: 'chorusServiceCode', label: 'Code service Chorus', type: 'text' },
            { key: 'chorusServiceCodeRequired', label: 'Code service obligatoire', type: 'boolean', help: OUI_NON },
            { key: 'chorusLegalCommitmentNumber', label: "N° d'engagement juridique", type: 'text' },
            { key: 'chorusLegalCommitmentRequired', label: 'Engagement obligatoire', type: 'boolean', help: OUI_NON },
            { key: 'chorusMarketNumber', label: 'N° de marché', type: 'text' },
            {
                key: 'einvoicingRegime', label: 'Régime facturation électronique', type: 'enum', example: 'Automatique',
                options: [
                    { value: 'auto', label: 'Automatique' }, { value: 'b2b', label: 'B2B' }, { value: 'b2g', label: 'B2G' },
                    { value: 'b2c', label: 'B2C' }, { value: 'international', label: 'International' }, { value: 'excluded', label: 'Hors champ' },
                ],
            },
            { key: 'einvoicingAddress', label: 'Adresse de facturation électronique', type: 'text', help: 'SIREN, SIREN_SIRET ou SIREN_SIRET_CODE.' },
            { key: 'quoteCoefficient', label: 'Coefficient devis', type: 'number', example: '1,35', help: 'Coefficient de vente propre au client (vide : celui de la société).' },
            { key: 'quoteLaborRate', label: 'Taux horaire MO devis', type: 'number', example: '58', help: '€ HT / h (vide : celui de la société).' },
        ],
    },
    sites: {
        key: 'sites',
        label: 'Sites',
        description: "Sites des clients, rattachés le cas échéant à un contrat.",
        matching: 'Code site (SIT-…), sinon client + n° de site : le site existant est mis à jour ; sinon un site est créé (code SIT attribué).',
        fields: [
            { key: 'code', label: 'Code site', type: 'text', aliases: ['sit'], help: 'Vide pour une création (attribué : SIT-00001).' },
            { key: 'client', label: 'Client', type: 'text', required: 'create', example: 'CLI-00012', help: 'Code client (CLI-…) ou SIRET du client.' },
            { key: 'contract', label: 'Contrat', type: 'text', example: 'CTN-00034', help: 'N° de contrat (CTN-…), facultatif ; il doit appartenir au client.' },
            { key: 'name', label: 'Nom du site', type: 'text', required: 'create', example: 'Résidence Les Lilas', aliases: ['nom', 'site'] },
            { key: 'siteNumber', label: 'N° de site', type: 'text', example: '0042', help: 'Numéro libre (client, ancien système).' },
            { key: 'address', label: 'Adresse', type: 'text', required: 'create', example: '5 rue des Lilas' },
            { key: 'postalCode', label: 'Code postal', type: 'postalCode', example: '69003', aliases: ['cp'] },
            { key: 'city', label: 'Ville', type: 'text', example: 'Lyon', aliases: ['commune'] },
            { key: 'heatingWeatherStation', label: 'Station météo', type: 'text', example: 'LYON-BRON' },
        ],
    },
    contacts: {
        key: 'contacts',
        label: 'Contacts',
        description: 'Interlocuteurs des clients.',
        matching: 'Client + email (sinon client + nom) : le contact existant est mis à jour ; sinon il est créé.',
        fields: [
            { key: 'client', label: 'Client', type: 'text', required: 'create', example: 'CLI-00012', help: 'Code client (CLI-…) ou SIRET du client.' },
            {
                key: 'type', label: 'Type', type: 'enum', required: 'create', example: 'Principal',
                options: [
                    { value: 'principal', label: 'Principal' }, { value: 'technique', label: 'Technique' },
                    { value: 'facturation', label: 'Facturation' }, { value: 'autre', label: 'Autre' },
                ],
            },
            { key: 'name', label: 'Nom', type: 'text', required: 'create', example: 'Marie Durand' },
            { key: 'email', label: 'Email', type: 'email', example: 'marie.durand@exemple.fr' },
            { key: 'phone', label: 'Téléphone', type: 'text', example: '04 72 00 00 00', aliases: ['tel'] },
            { key: 'role', label: 'Fonction', type: 'text', example: 'Gestionnaire', aliases: ['role'] },
        ],
    },
    meters: {
        key: 'meters',
        label: 'Compteurs',
        description: 'Compteurs des sites.',
        matching: 'Code compteur (CPT-…), sinon site + PDL/PCE : le compteur existant est mis à jour ; sinon il est créé (code CPT attribué).',
        fields: [
            { key: 'code', label: 'Code compteur', type: 'text', aliases: ['cpt'], help: 'Vide pour une création (attribué : CPT-00001).' },
            { key: 'site', label: 'Site', type: 'text', required: 'create', example: 'SIT-00021', help: 'Code du site (SIT-…).' },
            { key: 'name', label: 'Nom', type: 'text', required: 'create', example: 'Gaz chaufferie' },
            { key: 'meterType', label: 'Type de compteur', type: 'text', required: 'create', refList: 'meterTypes', example: 'GAZ', help: 'Code ou libellé d\'un type de compteur (onglet Listes).' },
            { key: 'reference', label: 'PDL / PCE', type: 'text', example: 'GI123456', aliases: ['pdl', 'pce', 'reference'] },
            { key: 'location', label: 'Emplacement', type: 'text', example: 'Sous-sol' },
            {
                key: 'status', label: 'Statut', type: 'enum', example: 'En service',
                options: [{ value: 'on', label: 'En service', aliases: ['actif', 'on'] }, { value: 'off', label: 'Hors service', aliases: ['inactif', 'off'] }],
                help: 'Vide à la création : En service.',
            },
        ],
    },
};

export const IMPORT_ENTITY_LIST = Object.values(IMPORT_ENTITIES);
