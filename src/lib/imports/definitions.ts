import { MARCHES_BAREME, P1_PARAMS } from '@/lib/p1/stockage';
import { PERIODICITES_REVISION, UNITES_PRIX } from '@/lib/p1/parametrage';

/**
 * Imports en masse : description des données importables.
 *
 * Une seule description par type de données alimente les modèles (CSV, XLSX), la notice, la lecture des
 * fichiers, les contrôles et l'aperçu. Les en-têtes des fichiers sont les libellés ci-dessous (les clés et
 * alias sont aussi reconnus).
 */

export type FieldType = 'text' | 'number' | 'boolean' | 'enum' | 'siret' | 'email' | 'postalCode' | 'date';

/** Listes de référence, lues dans le paramétrage (onglet « Listes » du modèle XLSX). */
export type RefList = 'companies' | 'agencies' | 'sectors' | 'typologies' | 'meterTypes' | 'activities' | 'markets' | 'schedules' | 'terms' | 'vatRates' | 'paymentTerms' | 'revisionRules';

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
    /** Nombre : 0 accepté (par défaut, strictement positif). */
    allowZero?: boolean;
};

export type ImportEntityKey = 'clients' | 'contracts' | 'sites' | 'services' | 'contacts' | 'meters' | 'readings' | 'p1' | 'p1formules';

export type ImportEntity = {
    key: ImportEntityKey;
    label: string;
    description: string;
    /** Comment une ligne retrouve un élément existant (sinon : création). */
    matching: string;
    fields: ImportField[];
};

const OUI_NON = 'oui / non';

/** Paramètres P1 importables : « portée.clé » (voir lib/p1/stockage). Libellés repris du catalogue. */
const P1_PARAM_OPTIONS = Object.entries(P1_PARAMS)
    .flatMap(([scope, defs]) => Object.entries(defs).filter(([, d]) => d.kind !== 'interessement').map(([key, d]) => ({
        value: `${scope}.${key}`,
        label: `${d.label} (${({ site: 'site', poste: 'poste', meter: 'compteur', contract: 'contrat' } as Record<string, string>)[scope]})`,
        aliases: [key, `${scope}.${key}`],
    })))
    .concat(MARCHES_BAREME.flatMap(m => [
        { value: `contract.bareme:${m}`, label: `Barème de partage ${m} (contrat)`, aliases: [`bareme ${m} contrat`] },
        { value: `site.bareme:${m}`, label: `Barème de partage ${m} (site)`, aliases: [`bareme ${m} site`] },
    ]));

/** Référence dans un autre système (ancienne codification, TWIMM…) : 2e clé de correspondance, après le code Zenergya. */
const externalRef = (what: string): ImportField => ({
    key: 'externalRef', label: 'Réf. externe', type: 'text', aliases: ['ref externe', 'reference externe', 'externalRef'],
    help: `Code ${what} dans un autre système (ancienne codification). Retrouve ${what === 'du client' ? 'la fiche' : 'l\'élément'} au réimport et permet de le désigner dans les autres fichiers. Unique.`,
});

export const IMPORT_ENTITIES: Record<ImportEntityKey, ImportEntity> = {
    clients: {
        key: 'clients',
        label: 'Clients et prospects',
        description: 'Fiches clients et prospects, avec leur rattachement, la facturation électronique, Chorus Pro et les conditions de devis.',
        matching: 'Code client (CLI-…), sinon réf. externe, sinon SIRET : la fiche existante est mise à jour ; sinon une fiche est créée (code CLI attribué). '
            + 'Sans aucune de ces clés, une fiche de même nom et même code postal est un doublon probable : ligne refusée.',
        fields: [
            { key: 'code', label: 'Code client', type: 'text', example: '', aliases: ['code', 'cli'], help: 'Vide pour une création (attribué : CLI-00001). Renseigné : met à jour cette fiche.' },
            externalRef('du client'),
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
            { key: 'typology', label: 'Typologie', type: 'text', required: 'create', refList: 'typologies', example: 'Copropriété', help: 'Nom d\'une typologie du paramétrage (onglet Listes).' },
            { key: 'company', label: 'Société', type: 'text', required: 'create', refList: 'companies', example: 'VEF', help: 'Code ou nom de la société (onglet Listes).' },
            { key: 'agency', label: 'Agence', type: 'text', required: 'create', refList: 'agencies', example: 'Lyon', help: 'Nom d\'une agence de la société.' },
            { key: 'sector', label: 'Secteur', type: 'text', required: 'create', refList: 'sectors', example: 'Lyon Est', help: 'Nom d\'un secteur de l\'agence.' },
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
            { key: 'paymentTerm', label: 'Conditions de paiement', type: 'text', refList: 'paymentTerms', example: '', aliases: ['reglement'], help: 'Code des conditions de paiement (onglet Listes) ; jamais renseignées : 30 jours.' },
        ],
    },
    contracts: {
        key: 'contracts',
        label: 'Contrats',
        description: 'Contrats des clients : période, statut, activités, montants de base, facturation, reconduction, Chorus Pro. '
            + 'Les sites se rattachent aux contrats dans l\'import des sites (colonne Contrat). Un contrat importé est validé (trace : validé par import).',
        matching: 'N° de contrat (CTN-…), sinon réf. externe : le contrat existant est mis à jour ; sinon il est créé (n° CTN attribué). '
            + 'Sans ces clés, un contrat du même client, de même libellé et de période qui se recouvre est un doublon probable : ligne refusée.',
        fields: [
            { key: 'code', label: 'N° de contrat', type: 'text', aliases: ['ctn', 'numero contrat', 'contractNumber'], help: 'Vide pour une création (attribué : CTN-00001).' },
            externalRef('du contrat'),
            { key: 'client', label: 'Client', type: 'text', required: 'create', example: 'CLI-00012', help: 'Code client (CLI-…), SIRET ou réf. externe du client.' },
            { key: 'label', label: 'Libellé', type: 'text', required: 'create', example: 'Chauffage résidence Les Lilas', aliases: ['libelle'], help: 'Nom du contrat : « client - libellé ».' },
            { key: 'company', label: 'Société émettrice', type: 'text', refList: 'companies', example: 'VEF', help: 'Code ou nom (vide : celle du client).' },
            { key: 'startDate', label: 'Date de début', type: 'date', required: 'create', example: '2025-07-01', aliases: ['debut'] },
            { key: 'endDate', label: 'Date de fin', type: 'date', required: 'create', example: '2030-06-30', aliases: ['fin'] },
            {
                key: 'status', label: 'Statut', type: 'enum', example: 'Actif',
                options: [
                    { value: 'Actif', label: 'Actif' }, { value: 'Brouillon', label: 'Brouillon' },
                    { value: 'Résilié', label: 'Résilié', aliases: ['resilie'] }, { value: 'Terminé', label: 'Terminé', aliases: ['termine'] },
                ],
                help: 'Vide à la création : Actif.',
            },
            { key: 'terminationDate', label: 'Date de résiliation', type: 'date', help: 'Obligatoire si le statut est Résilié.' },
            {
                key: 'marketType', label: 'Type de marché', type: 'enum', example: 'Privé',
                options: [{ value: 'Marché Privé', label: 'Privé', aliases: ['marche prive', 'prive'] }, { value: 'Marché Public', label: 'Public', aliases: ['marche public'] }],
            },
            { key: 'market', label: 'Marché', type: 'text', refList: 'markets', example: 'MCI', help: 'Code du marché (paramétrage : MC, MCI, MT, MTI, CP, CPI, PFI, PF…).' },
            {
                key: 'activities', label: 'Activités', type: 'text', refList: 'activities', example: 'CHAUF; P2',
                help: 'Codes des activités, séparés par « ; ». Renseignées : remplacent la liste existante.',
            },
            { key: 'baseAmountP1', label: 'Montant base P1', type: 'number', allowZero: true, help: '€ HT / an.' },
            { key: 'baseAmountP2', label: 'Montant base P2', type: 'number', allowZero: true, example: '12000', help: '€ HT / an.' },
            { key: 'baseAmountP3', label: 'Montant base P3', type: 'number', allowZero: true, help: '€ HT / an.' },
            { key: 'baseAmountP3R', label: 'Montant base P3R', type: 'number', allowZero: true, help: '€ HT / an.' },
            { key: 'billingSchedule', label: 'Échéancier de facturation', type: 'text', refList: 'schedules', example: 'Trimestriel', aliases: ['echeancier', 'periodicite'] },
            {
                key: 'invoicingType', label: 'Facturation', type: 'enum', example: 'Multi-site',
                options: [{ value: 'multi-site', label: 'Multi-site', aliases: ['par site'] }, { value: 'global', label: 'Globale', aliases: ['global'] }],
                help: 'Vide à la création : Multi-site.',
            },
            { key: 'renewal', label: 'Reconduction', type: 'boolean', help: OUI_NON },
            { key: 'tacitRenewal', label: 'Tacite reconduction', type: 'boolean', help: OUI_NON },
            { key: 'renewalDuration', label: 'Durée de reconduction', type: 'text', example: '1 an' },
            { key: 'noticePeriod', label: 'Préavis', type: 'text', example: '3 mois' },
            { key: 'signedByCompany', label: 'Signé par la société', type: 'boolean', help: OUI_NON },
            { key: 'signedByClient', label: 'Signé par le client', type: 'boolean', help: OUI_NON },
            {
                key: 'chorusFramework', label: 'Cadre Chorus', type: 'enum',
                options: [{ value: 'A1', label: 'A1' }, { value: 'A9', label: 'A9' }, { value: 'A12', label: 'A12' }],
                help: 'A1 : titulaire ; A9 : sous-traitant (validé par le titulaire) ; A12 : cotraitant (validé par le mandataire).',
            },
            { key: 'chorusValidatorSiret', label: 'SIRET du valideur Chorus', type: 'siret', help: 'Obligatoire en A9 (titulaire) et A12 (mandataire).' },
            { key: 'chorusServiceCode', label: 'Code service Chorus', type: 'text', help: 'Prioritaire sur celui du client.' },
            { key: 'chorusMarketNumber', label: 'N° de marché Chorus', type: 'text' },
            { key: 'chorusLegalCommitment', label: "N° d'engagement juridique", type: 'text', help: 'Engagement valable sur toute la durée du contrat (ajouté s\'il est nouveau).' },
            { key: 'einvoicingAddress', label: 'Adresse de facturation électronique', type: 'text', help: 'Propre au contrat (prioritaire sur celle du client).' },
            { key: 'paymentTerm', label: 'Conditions de paiement', type: 'text', refList: 'paymentTerms', example: '', aliases: ['reglement'], help: 'Propres au contrat, prioritaires sur celles du client (code, onglet Listes).' },
        ],
    },
    sites: {
        key: 'sites',
        label: 'Sites',
        description: "Sites des clients, rattachés le cas échéant à un contrat.",
        matching: 'Code site (SIT-…), sinon réf. externe, sinon client + n° de site : le site existant est mis à jour ; sinon un site est créé (code SIT attribué). '
            + 'Sans aucune de ces clés, un site du même client à la même adresse est un doublon probable : ligne refusée.',
        fields: [
            { key: 'code', label: 'Code site', type: 'text', aliases: ['sit'], help: 'Vide pour une création (attribué : SIT-00001).' },
            externalRef('du site'),
            { key: 'client', label: 'Client', type: 'text', required: 'create', example: 'CLI-00012', help: 'Code client (CLI-…), SIRET ou réf. externe du client.' },
            {
                key: 'contract', label: 'Contrat', type: 'text', example: 'CTN-00034',
                help: 'N° de contrat (CTN-…) ou réf. externe du contrat, qui doit appartenir au client. Seul endroit où se fait le lien contrat ↔ site.',
            },
            { key: 'name', label: 'Nom du site', type: 'text', required: 'create', example: 'Résidence Les Lilas', aliases: ['nom', 'site'] },
            { key: 'siteNumber', label: 'N° de site', type: 'text', example: '0042', help: 'Numéro libre (client, ancien système).' },
            { key: 'address', label: 'Adresse', type: 'text', required: 'create', example: '5 rue des Lilas' },
            { key: 'postalCode', label: 'Code postal', type: 'postalCode', example: '69003', aliases: ['cp'] },
            { key: 'city', label: 'Ville', type: 'text', example: 'Lyon', aliases: ['commune'] },
            { key: 'heatingWeatherStation', label: 'Station météo', type: 'text', example: 'LYON-BRON' },
        ],
    },
    services: {
        key: 'services',
        label: 'Prestations et montants',
        description: 'Prestations des sites (contrat du site × activité) : montant annuel HT, période de validité, TVA, compteur P1. '
            + 'Les montants facturés du site sont calculés à partir des prestations en vigueur (ils ne se saisissent plus à la main).',
        matching: 'Réf. externe, sinon site + activité + date de début : la prestation existante est mise à jour ; sinon elle est créée. '
            + 'Deux prestations du même site et de la même activité ne peuvent pas se recouvrir (elles seraient facturées deux fois).',
        fields: [
            externalRef('de la prestation'),
            { key: 'site', label: 'Site', type: 'text', required: 'create', example: 'SIT-00021', help: 'Code du site (SIT-…) ou réf. externe ; le site doit être rattaché à un contrat.' },
            {
                key: 'activity', label: 'Activité', type: 'text', required: 'create', refList: 'activities', example: 'P2',
                help: 'Code de l\'activité, qui doit figurer parmi les activités du contrat du site. Détermine le type P1 / P2 / P3.',
            },
            { key: 'label', label: 'Libellé', type: 'text', example: 'Maintenance chaufferie', aliases: ['libelle'] },
            { key: 'startDate', label: 'Date de début', type: 'date', required: 'create', example: '2025-07-01', aliases: ['debut'] },
            { key: 'endDate', label: 'Date de fin', type: 'date', example: '2026-06-30', aliases: ['fin'], help: 'Incluse. Vide à la création : fin du contrat.' },
            { key: 'price', label: 'Montant annuel HT', type: 'number', allowZero: true, required: 'create', example: '4800', aliases: ['montant', 'prix'], help: '€ HT par an (montant forfaitaire), facturé selon l\'échéancier du contrat.' },
            { key: 'schedule', label: 'Périodicité', type: 'text', refList: 'schedules', example: 'Trimestriel', help: 'Mensuel, trimestriel, semestriel, annuel (vide : celle du site, sinon du contrat).' },
            { key: 'term', label: 'Terme', type: 'text', refList: 'terms', example: 'À échoir', help: 'À échoir (facturé en début de période) ou échu (après la période). Vide : à échoir.' },
            { key: 'vatRate', label: 'TVA', type: 'text', refList: 'vatRates', example: 'TVA20', help: 'Code du taux de TVA (paramétrage).' },
            { key: 'meter', label: 'Compteur', type: 'text', example: '', help: 'P1 : code du compteur (CPT-…) ou réf. externe, du même site.' },
            {
                key: 'p1Type', label: 'Type P1', type: 'enum',
                options: [{ value: 'CHAUFFAGE', label: 'Chauffage' }, { value: 'ECS', label: 'ECS' }, { value: 'EAU_FROIDE', label: 'Eau froide' }, { value: 'AUTRE', label: 'Autre' }],
            },
            {
                key: 'energyType', label: 'Énergie', type: 'enum',
                options: [
                    { value: 'Gaz', label: 'Gaz' }, { value: 'Electricité', label: 'Électricité', aliases: ['elec'] },
                    { value: 'Réseau de chaleur', label: 'Réseau de chaleur', aliases: ['rcu'] }, { value: 'Fioul', label: 'Fioul' },
                    { value: 'Biomasse', label: 'Biomasse', aliases: ['bois'] },
                ],
            },
            { key: 'revisionRule', label: 'Règle de révision', type: 'text', refList: 'revisionRules', example: '', help: 'Code de la règle (onglet Listes). Vide : prix ferme.' },
            {
                key: 'baseIndices', label: 'Indices de base', type: 'text', example: '', aliases: ['i0'],
                help: 'Valeurs de base (I0) : CODE=valeur@AAAA-MM, séparés par « ; » (ex. ICHT-E=121,4@2024-01; FSD2=135,2@2024-01). Un par indice de la règle.',
            },
            { key: 'revisionMonths', label: 'Révision tous les (mois)', type: 'number', example: '12', help: '12, 6, 3 ou 1 (vide : 12).' },
            { key: 'revisionAnchor', label: 'Date anniversaire de révision', type: 'text', example: '01/01', help: 'JJ/MM (vide : jour du début du contrat).' },
            { key: 'revisionFromStart', label: 'Révisé dès le début', type: 'boolean', help: 'oui : révisé dès le début du contrat ; non (vide) : prix de base jusqu\'à la première révision.' },
            { key: 'unitPrice', label: 'Prix unitaire de base', type: 'number', allowZero: true, help: 'P1 : prix de l\'unité (révisable).' },
            { key: 'unit', label: 'Unité du prix', type: 'text', example: '€/MWh' },
            { key: 'isActive', label: 'Active', type: 'boolean', example: 'oui', help: 'Vide à la création : oui. Non : jamais facturée.' },
            { key: 'comment', label: 'Commentaire', type: 'text' },
        ],
    },
    contacts: {
        key: 'contacts',
        label: 'Contacts',
        description: 'Interlocuteurs des clients.',
        matching: 'Client + email (sinon client + nom) : le contact existant est mis à jour ; sinon il est créé.',
        fields: [
            { key: 'client', label: 'Client', type: 'text', required: 'create', example: 'CLI-00012', help: 'Code client (CLI-…), SIRET ou réf. externe du client.' },
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
        matching: 'Code compteur (CPT-…), sinon réf. externe, sinon site + PDL/PCE : le compteur existant est mis à jour ; sinon il est créé (code CPT attribué). '
            + 'Sans aucune de ces clés, un compteur du même site et de même nom est un doublon probable : ligne refusée.',
        fields: [
            { key: 'code', label: 'Code compteur', type: 'text', aliases: ['cpt'], help: 'Vide pour une création (attribué : CPT-00001).' },
            externalRef('du compteur'),
            { key: 'site', label: 'Site', type: 'text', required: 'create', example: 'SIT-00021', help: 'Code du site (SIT-…) ou réf. externe du site.' },
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
    readings: {
        key: 'readings',
        label: 'Relevés de compteurs',
        description: 'Index relevés sur les compteurs : télérelève, relevés terrain, reprise d\'historique.',
        matching: 'Compteur + date et heure : le relevé existant à ce moment est mis à jour (index, type, commentaire) ; sinon il est créé.',
        fields: [
            { key: 'meter', label: 'Compteur', type: 'text', required: 'create', example: 'CPT-00012', aliases: ['cpt', 'code compteur'], help: 'Code du compteur (CPT-…) ou réf. externe du compteur.' },
            {
                key: 'date', label: 'Date du relevé', type: 'date', required: 'create', example: '2025-01-31', aliases: ['date'],
                help: 'AAAA-MM-JJ ou JJ/MM/AAAA, heure facultative (HH:MM), heure de Paris ; ou date ISO 8601 avec fuseau. Sans heure : minuit.',
            },
            { key: 'value', label: 'Index', type: 'number', allowZero: true, required: 'create', example: '125430', aliases: ['valeur', 'index'], help: 'Index du compteur, dans l\'unité du compteur.' },
            {
                key: 'type', label: 'Type de relevé', type: 'enum', example: 'Réel',
                options: [
                    { value: 'REEL', label: 'Réel' }, { value: 'ESTIME', label: 'Estimé' },
                    { value: 'CORRIGE', label: 'Corrigé' }, { value: 'AUTO', label: 'Automatique', aliases: ['telereleve', 'auto'] },
                ],
                help: 'Vide à la création : Réel. Automatique : télérelève.',
            },
            { key: 'comment', label: 'Commentaire', type: 'text', example: '', aliases: ['remarque'] },
        ],
    },
    p1: {
        key: 'p1',
        label: 'Paramétrage P1 (versions datées)',
        description: 'Une ligne = une version d\'un paramètre P1 (site, poste de consommation, compteur, contrat) : valeur, date d\'effet, motif. '
            + 'Une version ne remplace jamais la précédente : elle vaut à partir de sa date d\'effet.',
        matching: 'Élément + paramètre (+ poste) + date d\'effet : une version identique déjà saisie est inchangée ; une valeur différente à la même date est refusée '
            + '(retirez d\'abord la version à l\'écran, avec son motif). Un poste absent est créé.',
        fields: [
            { key: 'element', label: 'Élément', type: 'text', required: 'create', example: 'SIT-00021', help: 'Code du site (SIT-…), du compteur (CPT-…) ou du contrat (CTN-…), ou sa réf. externe.' },
            { key: 'poste', label: 'Poste', type: 'text', example: '', help: 'Paramètres de poste : désignation du poste de consommation du site (créé s\'il n\'existe pas).' },
            { key: 'parametre', label: 'Paramètre', type: 'enum', required: 'create', example: 'Type de marché (site)', options: P1_PARAM_OPTIONS },
            { key: 'valeur', label: 'Valeur', type: 'text', required: 'create', example: 'MCI', help: 'Formule de NC : « CPT-00012 + CPT-00013 - CPT-00020 ». Nombres : virgule ou point.' },
            { key: 'dateEffet', label: 'Date d\'effet', type: 'date', help: 'Vide : valeur d\'origine du marché.' },
            { key: 'motif', label: 'Motif', type: 'text', required: 'create', example: 'contrat d\'origine' },
            { key: 'document', label: 'Pièce justificative', type: 'text', help: 'Lien (facultatif).' },
        ],
    },
    p1formules: {
        key: 'p1formules',
        label: 'Formules de révision P1',
        description: 'Une ligne = une version d\'une formule de révision P1 d\'un contrat (forme, termes, M0, périodicité). Le prix de base vient du site.',
        matching: 'Contrat + nom de la formule : la formule est créée si elle n\'existe pas (usage et périmètre alors obligatoires) ; une version identique à la même date '
            + 'd\'effet est inchangée, une autre est refusée (retirez la version à l\'écran pour la remplacer).',
        fields: [
            { key: 'contrat', label: 'Contrat', type: 'text', required: 'create', example: 'CTN-00034', help: 'N° de contrat (CTN-…) ou réf. externe.' },
            { key: 'nom', label: 'Formule', type: 'text', required: 'create', example: 'Gaz 2025', aliases: ['nom'] },
            {
                key: 'usage', label: 'Usage', type: 'enum', example: 'Chauffage',
                options: [{ value: 'chauffage', label: 'Chauffage' }, { value: 'ecs', label: 'ECS', aliases: ['eau chaude'] }], help: 'Pour créer la formule.',
            },
            { key: 'perimetre', label: 'Périmètre', type: 'text', example: 'contrat', help: '« contrat », « énergies : gaz, fioul » ou « sites : SIT-00001, SIT-00002 » (pour créer la formule).' },
            { key: 'dateEffet', label: 'Date d\'effet', type: 'date', help: 'Vide : version d\'origine.' },
            { key: 'motif', label: 'Motif', type: 'text', required: 'create', example: 'marché d\'origine' },
            { key: 'forme', label: 'Forme', type: 'enum', required: 'create', example: 'A', options: [{ value: 'A', label: 'A', aliases: ['somme de rapports'] }, { value: 'B', label: 'B', aliases: ['rapport des sommes'] }] },
            { key: 'periodicite', label: 'Périodicité de révision', type: 'enum', required: 'create', example: 'mensuel', options: PERIODICITES_REVISION.map(p => ({ value: p, label: p.replace(/_/g, ' ') })) },
            { key: 'termes', label: 'Termes', type: 'text', required: 'create', example: 'p0=0,15 ; Kmol=0,60*PEGMA@25,30 ; TVD=0,25*ATRD_T2@3,10', help: 'code=coefficient*INDICE@base M0 ; « ! » base contractuelle ; « ~ » inactif ; panier *(1*IND1+0,8*#2,1).' },
            { key: 'dateM0', label: 'Mois M0', type: 'text', example: '2025-01', help: 'AAAA-MM. Vide : renseigner « M0 manquante ».' },
            { key: 'm0Manquante', label: 'M0 manquante', type: 'text', help: 'Ce qui manque quand M0 n\'est pas connue.' },
            { key: 'unitePrix', label: 'Unité du prix', type: 'enum', example: 'EUR/MWh', options: UNITES_PRIX.map(u => ({ value: u, label: u })), help: 'Vide : EUR/MWh.' },
            { key: 'mode', label: 'Mode', type: 'enum', options: [{ value: 'standard', label: 'standard' }, { value: 'derogatoire', label: 'dérogatoire', aliases: ['derogatoire'] }] },
            { key: 'baseEnergetique', label: 'Base énergétique', type: 'enum', options: [{ value: 'PCS', label: 'PCS' }, { value: 'PCI', label: 'PCI' }] },
            { key: 'regimeKmol', label: 'Régime de la molécule', type: 'enum', options: [{ value: 'variable', label: 'variable' }, { value: 'fixe', label: 'fixe' }] },
            { key: 'prixMolecule', label: 'Prix molécule négocié', type: 'number', help: 'Régime fixe.' },
            { key: 'prixFixe', label: 'Prix fixe', type: 'boolean', help: 'oui : prix non révisable.' },
            { key: 'document', label: 'Pièce justificative', type: 'text' },
        ],
    },
};

export const IMPORT_ENTITY_LIST = Object.values(IMPORT_ENTITIES);
