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

export type ImportEntityKey = 'clients' | 'contracts' | 'sites' | 'services' | 'contacts' | 'meters' | 'readings' | 'p1' | 'p1formules' | 'p1reel';

export type ImportEntity = {
    key: ImportEntityKey;
    label: string;
    description: string;
    /** Comment une ligne retrouve un élément existant (sinon : création). */
    matching: string;
    fields: ImportField[];
    /** Rubrique de l'écran Imports. */
    groupe: GroupeImport;
    /** Une phrase : à quoi sert l'import (vignette de l'écran). */
    resume: string;
    /** Mode d'emploi : quand l'utiliser, ordre, pièges (écran et onglet Notice du modèle). */
    usage: string[];
    /** Colonnes qui retrouvent un élément existant (mise à jour), par ordre de priorité. */
    cles: string[];
};

export type GroupeImport = 'Référentiel' | 'Facturation' | 'Compteurs et relevés' | 'P1';
export const GROUPES_IMPORT: GroupeImport[] = ['Référentiel', 'Facturation', 'Compteurs et relevés', 'P1'];

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

/**
 * Paramétrage P1 dans les imports Sites, Compteurs et Contrats : une colonne « P1 · … » par paramètre (clé
 * `p1:<portée>:<paramètre>`), plus la date d'effet et le motif communs à la ligne. Une valeur crée une version datée
 * du paramétrage P1 (jamais d'écrasement) ; vide : inchangé.
 */
export const P1_COLONNE = (scope: string, key: string) => `p1:${scope}:${key}`;
const P1_EXEMPLES: Record<string, string> = {
    typeMarche: 'MCI', prixBase: '92,5', stationMeteo: 'LYON-BRON', usage: 'entrant', energie: 'gaz', qe: '0,01142',
    cibleNb: '850', cibleNbUnite: 'MWh', djuReference: '2150', formuleNc: 'CPT-00012 + CPT-00013',
};
const p1Colonnes = (scope: 'site' | 'poste' | 'meter' | 'contract', extra: [string, string][] = []): ImportField[] => [
    ...Object.entries(P1_PARAMS[scope]).filter(([, d]) => d.kind !== 'interessement').map(([key, d]) => ({ key, label: d.label, help: d.help, unit: d.unit })),
    ...extra.map(([key, label]) => ({ key, label, help: P1_BAREME_AIDE, unit: undefined })),
].map(({ key, label, help, unit }) => ({
    key: P1_COLONNE(scope, key), label: `P1 · ${scope === 'poste' ? 'Poste · ' : ''}${label}`, type: 'text' as FieldType,
    ...(P1_EXEMPLES[key] && { example: P1_EXEMPLES[key] }),
    help: [unit, help].filter(Boolean).join(' — ') || undefined,
    ...(scope === 'site' && key === 'stationMeteo' && { aliases: ['station meteo'] }),
}));
const P1_BAREME_AIDE = 'Tranches : « économie 0-10 % 50 % ; économie 10-100 % 70 % ; dépassement 0-100 % 30 % ».';
const P1_COMMUNES: ImportField[] = [
    { key: 'p1DateEffet', label: 'P1 · Date d\'effet', type: 'date', help: 'Date d\'effet des valeurs P1 de la ligne. Vide : valeur d\'origine si le paramètre n\'a encore aucune valeur ; sinon, obligatoire pour en changer.' },
    { key: 'p1Motif', label: 'P1 · Motif', type: 'text', example: 'avenant 2', help: 'Motif du changement (historique P1). Vide : « import ».' },
];

/** Référence dans un autre système (ancienne codification, TWIMM…) : 2e clé de correspondance, après le code Zenergya. */
const externalRef = (what: string): ImportField => ({
    key: 'externalRef', label: 'Réf. externe', type: 'text', aliases: ['ref externe', 'reference externe', 'externalRef'],
    help: `Code ${what} dans un autre système (ancienne codification). Retrouve ${what === 'du client' ? 'la fiche' : 'l\'élément'} au réimport et permet de le désigner dans les autres fichiers. Unique.`,
});

/** Code analytique externe (outil comptable) : remplace le code généré par Zenergya pour ce niveau. */
const analyticExternal = (niveau: string): ImportField => ({
    key: 'analyticExternal', label: 'Analytique externe', type: 'text', aliases: ['code analytique externe', 'analytique', 'otp'], example: '',
    help: `Code analytique ${niveau} dans votre outil comptable. Il remplace le code généré par Zenergya ; les niveaux en dessous en héritent. Vide : inchangé.`,
});

const BASE: Record<ImportEntityKey, Omit<ImportEntity, 'groupe' | 'resume' | 'usage' | 'cles'>> = {
    clients: {
        key: 'clients',
        label: 'Clients et prospects',
        description: 'Fiches clients et prospects, avec leur rattachement, la facturation électronique, Chorus Pro et les conditions de devis.',
        matching: 'Code client (CLI-…), sinon réf. externe, sinon SIRET : la fiche existante est mise à jour ; sinon une fiche est créée (code CLI attribué). '
            + 'Sans aucune de ces clés, une fiche de même nom et même code postal est un doublon probable : ligne refusée.',
        fields: [
            { key: 'code', label: 'Code client', type: 'text', example: '', aliases: ['code', 'cli'], help: 'Vide pour une création (attribué : CLI-00001). Renseigné : met à jour cette fiche.' },
            externalRef('du client'), analyticExternal('du client'),
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
            + 'Les sites se rattachent aux contrats dans l\'import des sites (colonne Contrat). Un contrat importé est validé (trace : validé par import). '
            + "Colonnes « P1 · … » : paramétrage P1 daté (une valeur = une version à la date d'effet de la ligne, jamais d'écrasement). Paramètres P1 communs à tous les sites du contrat : régime, gestion, répartition des acomptes, barèmes.",
        matching: 'N° de contrat (CTN-…), sinon réf. externe : le contrat existant est mis à jour ; sinon il est créé (n° CTN attribué). '
            + 'Sans ces clés, un contrat du même client, de même libellé et de période qui se recouvre est un doublon probable : ligne refusée.',
        fields: [
            { key: 'code', label: 'N° de contrat', type: 'text', aliases: ['ctn', 'numero contrat', 'contractNumber'], help: 'Vide pour une création (attribué : CTN-00001).' },
            externalRef('du contrat'), analyticExternal('du contrat'),
            { key: 'client', label: 'Client', type: 'text', required: 'create', example: 'CLI-00012', help: 'Code client (CLI-…), SIRET ou réf. externe du client.' },
            { key: 'label', label: 'Libellé', type: 'text', required: 'create', example: 'Chauffage résidence Les Lilas', aliases: ['libelle'], help: 'Nom du contrat : « client - libellé ».' },
            { key: 'company', label: 'Société émettrice', type: 'text', refList: 'companies', example: 'VEF', help: 'Code ou nom (vide : celle du client).' },
            { key: 'billingManager', label: 'Responsable facturation', type: 'text', example: 'adv@exemple.fr', aliases: ['responsable', 'adv', 'gestionnaire'], help: "E-mail d'un utilisateur (vide : inchangé ; « - » : retiré)." },
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
            ...p1Colonnes('contract', MARCHES_BAREME.map(m => [`bareme:${m}`, `Barème de partage ${m}`])),
            ...P1_COMMUNES,
        ],
    },
    sites: {
        key: 'sites',
        label: 'Sites',
        description: "Sites des clients, rattachés le cas échéant à un contrat. Colonnes « P1 · … » : paramétrage P1 daté (une valeur = une version à la date d'effet de la ligne, jamais d'écrasement). Paramètres P1 du site (type de marché, prix de base, station…) et de son poste de consommation (formule de NC, cible NB, DJU).",
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
            ...p1Colonnes('site'),
            { key: 'p1Poste', label: 'P1 · Poste', type: 'text', example: 'Chauffage', help: 'Poste de consommation des colonnes « P1 · Poste · … » (créé s\'il n\'existe pas). Vide : « Chauffage ». Un site à plusieurs postes : une ligne par poste.' },
            ...p1Colonnes('poste'),
            ...P1_COMMUNES,
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
            externalRef('de la prestation'), analyticExternal('de la prestation'),
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
            {
                key: 'p1Mode', label: 'Facturation P1', type: 'enum', example: '',
                options: [
                    { value: 'forfait', label: 'Forfait' }, { value: 'acompte', label: 'Acomptes', aliases: ['acompte'] },
                    { value: 'releve', label: 'Au compteur', aliases: ['releve', 'relevé', 'au relevé', 'compteur'] },
                    { value: 'dju', label: 'MTI au DJU', aliases: ['dju', 'au dju', 'mti'] },
                ],
                help: 'P1 : forfait (montant annuel), acomptes (régularisés sur le réel), au compteur (chauffage ou ECS : consommation relevée chaque mois × prix), MTI au DJU (montant annuel × C/C0 × DJU chauffés / DJU contractuels). Vide : forfait.',
            },
            {
                key: 'p1PrixSource', label: 'Prix au m³', type: 'enum',
                options: [{ value: 'p1', label: 'Paramétrage P1', aliases: ['p1'] }, { value: 'prestation', label: 'Prestation', aliases: ['prix unitaire'] }],
                help: 'Au compteur : paramétrage P1 (prix de base × formule de révision P1) ou prix unitaire de la prestation × sa révision. Vide : paramétrage P1.',
            },
            { key: 'coefficientPrix', label: 'Coefficient de prix', type: 'number', help: 'Au compteur : coefficient de gestion de la prestation, appliqué au prix chaque mois (facultatif).' },
            {
                key: 'p1CoefGestion', label: 'Coefficient de gestion', type: 'enum',
                options: [{ value: 'aucun', label: 'Aucun' }, { value: 'prestation', label: 'Prestation' }, { value: 'contrat', label: 'Contrat' }],
                help: 'Au compteur : aucun, celui de la prestation (coefficient de prix) ou celui du contrat (paramétrage P1 daté). Vide : prestation s\'il est renseigné, sinon aucun.',
            },
            {
                key: 'p1Prorata', label: 'Prorata (mois partiel)', type: 'enum',
                options: [
                    { value: 'releve_jours', label: 'Relevé sinon jours', aliases: ['releve jours', 'relevé à la date sinon jours'] },
                    { value: 'releve_dju', label: 'Relevé sinon DJU', aliases: ['releve dju', 'relevé à la date sinon dju'] },
                    { value: 'jours', label: 'Jours' }, { value: 'dju', label: 'DJU' },
                ],
                help: 'Au compteur, mois couvert en partie : relevé à la date de coupure s\'il existe, sinon prorata des jours ou des DJU ; ou toujours jours, toujours DJU. Vide : relevé sinon jours.',
            },
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
        description: "Compteurs des sites. Colonnes « P1 · … » : paramétrage P1 daté (une valeur = une version à la date d'effet de la ligne, jamais d'écrasement). Paramètres P1 du compteur : usage, énergie, QE, qECS.",
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
            ...p1Colonnes('meter'),
            ...P1_COMMUNES,
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
        label: 'Paramétrage P1 détaillé (avancé)',
        description: 'Le paramétrage P1 courant se fait dans les imports Sites, Compteurs et Contrats (colonnes « P1 · … »). Cet import sert aux cas avancés : '
            + 'plusieurs versions d\'un même paramètre dans un fichier, sites à plusieurs postes, reprise d\'historique. Une ligne = une version d\'un paramètre P1 (site, poste de consommation, compteur, contrat) : valeur, date d\'effet, motif. '
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
            { key: 'facteur', label: 'Facteur fixe', type: 'number', help: 'Avenant : facteur multipliant le coefficient (ex. remplacement d\'un indice non publié). Vide : 1.' },
            { key: 'arrondiCoefficient', label: 'Arrondi du coefficient', type: 'number', allowZero: true, help: 'Nombre de décimales du coefficient C/C0 (ex. 5). Vide : non arrondi.' },
            { key: 'document', label: 'Pièce justificative', type: 'text' },
        ],
    },
    p1reel: {
        key: 'p1reel',
        label: 'Réel P1 du moteur',
        description: 'Résultat du moteur P1 (pas un paramétrage) : montant P1 HT réellement dû par site et par mois (table p1_facturation_site). '
            + 'La régularisation le compare aux acomptes P1 facturés (Facturation › P1). Visible sur la fiche du site (Paramétrage P1 › Réel P1 du moteur).',
        matching: 'Site + mois + usage : un montant identique est inchangé ; un autre montant remplace le précédent, sauf si le mois est déjà régularisé (refusé).',
        fields: [
            { key: 'site', label: 'Site', type: 'text', required: 'create', example: 'SIT-00021', aliases: ['code_site'], help: 'Code du site (SIT-…) ou réf. externe.' },
            { key: 'mois', label: 'Mois', type: 'text', required: 'create', example: '2025-11', help: 'AAAA-MM (ou MM/AAAA, ou une date du mois).' },
            { key: 'montant', label: 'Montant P1 HT', type: 'number', allowZero: true, required: 'create', example: '12450,80', aliases: ['total_p1', 'montant'], help: '€ HT, réel facturable du mois.' },
            {
                key: 'usage', label: 'Usage', type: 'enum', example: 'Total',
                options: [{ value: 'total', label: 'Total', aliases: ['total_p1'] }, { value: 'chauffage', label: 'Chauffage' }, { value: 'ecs', label: 'ECS', aliases: ['eau chaude'] }],
                help: 'Vide : total (chauffage, ECS et annexes, p1_facturation_site). Chauffage ou ECS : réel par usage (p1_facturation_chauffage, p1_facturation_ecs), nécessaire si leurs TVA diffèrent.',
            },
        ],
    },
};


// --- Mode d'emploi des imports (écran Imports et onglet Notice des modèles) ---

type Guide = Pick<ImportEntity, 'groupe' | 'resume' | 'usage' | 'cles'> & { label?: string; aides?: Record<string, string> };

const ORDRE = "Ordre conseillé : clients → contrats → sites → compteurs → prestations → relevés ; le P1 après les sites, compteurs et contrats.";

const GUIDES: Record<ImportEntityKey, Guide> = {
    clients: {
        groupe: 'Référentiel', resume: 'Fiches clients et prospects : identité, rattachement (société, agence, secteur), Chorus, facturation électronique.',
        usage: [
            'Premier import à faire : contrats, sites et contacts désignent ensuite le client par son code CLI, son SIRET ou sa réf. externe.',
            'Reprise depuis un autre logiciel : renseignez « Réf. externe » avec l\'ancien code ; les fichiers suivants pourront l\'utiliser.',
            'Mise à jour : seules les colonnes présentes et renseignées changent ; une cellule vide conserve la valeur.',
            ORDRE,
        ],
        cles: ['code', 'externalRef', 'siret'],
        aides: {
            name: 'Nom légal du client (ou du syndicat de copropriété).', address: 'Adresse de facturation.', postalCode: '5 chiffres.', city: 'Ville de l\'adresse de facturation.',
            representedBy: 'Syndic ou gestionnaire qui représente le client (copropriété).', chorusServiceCode: 'Code service du destinataire public dans Chorus Pro.',
            chorusLegalCommitmentNumber: 'N° d\'engagement juridique (bon de commande public) à porter sur les factures.', chorusMarketNumber: 'N° du marché public dans Chorus Pro.',
        },
    },
    contracts: {
        groupe: 'Référentiel', resume: 'Contrats : période, activités, facturation, reconduction, Chorus, responsable facturation et paramètres P1 du contrat.',
        usage: [
            'Après les clients. Le lien contrat ↔ sites se fait dans l\'import des sites (colonne Contrat).',
            'Un contrat importé est directement validé et actif (sauf statut indiqué).',
            'Colonnes « P1 · … » : paramètres P1 communs à tous les sites du contrat (régime, gestion, répartition des acomptes, barèmes). '
                + 'Chaque valeur ajoute une version datée : renseignez « P1 · Date d\'effet » pour changer une valeur existante.',
            ORDRE,
        ],
        cles: ['code', 'externalRef'],
        aides: {
            startDate: 'Début d\'exécution du contrat : point de départ de l\'échéancier de facturation.', endDate: 'Fin du contrat (avant reconduction).',
            billingSchedule: 'Périodicité par défaut (Mensuel, Trimestriel…) ; chaque prestation peut avoir la sienne.',
            renewalDuration: 'Durée de chaque reconduction, en texte libre (ex. « 1 an »).', noticePeriod: 'Délai de dénonciation, en texte libre (ex. « 3 mois »).',
            chorusMarketNumber: 'N° du marché public dans Chorus Pro.', [P1_COLONNE('contract', 'correspondanceTwimm')]: 'Code du contrat dans TWIMM (moteur P1) : rapproche les résultats du moteur.',
        },
    },
    sites: {
        groupe: 'Référentiel', resume: 'Sites des clients, leur rattachement au contrat, et leur paramétrage P1 (marché, prix de base, station, poste de consommation).',
        usage: [
            'Après les clients et les contrats : la colonne Contrat est le seul endroit où se fait le lien contrat ↔ site.',
            'Colonnes « P1 · … » : paramètres P1 du site. Colonnes « P1 · Poste · … » : poste de consommation (formule de NC, cible NB, DJU) ; '
                + 'un site à plusieurs postes se saisit sur plusieurs lignes, une par poste (colonne « P1 · Poste »).',
            'Chaque valeur P1 ajoute une version datée : la première est la valeur d\'origine ; pour en changer, renseignez « P1 · Date d\'effet » et « P1 · Motif ».',
            ORDRE,
        ],
        cles: ['code', 'externalRef'],
        aides: {
            name: 'Nom usuel du site (résidence, bâtiment).', address: 'Adresse du site (pas celle du client).', postalCode: '5 chiffres.', city: 'Ville du site.',
            [P1_COLONNE('site', 'periodeReference')]: 'Période de calcul de la cible et de l\'intéressement : saison de chauffe ou année civile.',
            [P1_COLONNE('site', 'correspondanceTwimm')]: 'Code du site dans TWIMM (moteur P1) : rapproche les résultats du moteur.',
            [P1_COLONNE('poste', 'cibleNb')]: 'Consommation contractuelle de référence du poste (N\'B), dans l\'unité de la cible.',
            [P1_COLONNE('poste', 'cibleNbUnite')]: 'Unité de la cible NB : MWh, t ou L.',
            [P1_COLONNE('poste', 'djuReference')]: 'DJU de la période de référence : la cible est corrigée de la rigueur climatique (station météo du site).',
        },
    },
    services: {
        groupe: 'Facturation', resume: 'Ce qui est facturé : une prestation par site et activité, avec son montant annuel, sa périodicité, sa TVA et sa révision.',
        usage: [
            'Source unique de la facturation : les montants des sites sont calculés à partir des prestations en vigueur.',
            'Après les sites (et les compteurs pour le P1) ; l\'activité doit faire partie de celles du contrat du site.',
            'Deux prestations du même site et de la même activité ne peuvent pas se recouvrir dans le temps.',
            ORDRE,
        ],
        cles: ['externalRef'],
        aides: {
            label: 'Libellé de la ligne de facture (vide : celui de l\'activité).', startDate: 'Début de facturation de la prestation.',
            unit: 'Unité du prix unitaire (ex. €/MWh, €/m³).', comment: 'Note interne, non imprimée.',
        },
    },
    contacts: {
        groupe: 'Référentiel', resume: 'Interlocuteurs des clients : principal, technique, facturation.',
        usage: ['Après les clients. L\'adresse e-mail du contact de facturation sert à l\'envoi des factures.'],
        cles: ['client', 'email'],
        aides: { name: 'Prénom et nom.', email: 'Adresse e-mail (sert de clé avec le client).', phone: 'Numéro de téléphone.', role: 'Fonction (ex. gardien, directeur technique).' },
    },
    meters: {
        groupe: 'Compteurs et relevés', resume: 'Compteurs des sites et leur paramétrage P1 (usage, énergie, coefficient de conversion).',
        usage: [
            'Après les sites. Les relevés et la formule de NC désignent ensuite le compteur par son code CPT ou sa réf. externe.',
            'Colonnes « P1 · … » : paramètres P1 du compteur ; chaque valeur ajoute une version datée (« P1 · Date d\'effet » pour en changer, ex. compteur remplacé).',
            ORDRE,
        ],
        cles: ['code', 'externalRef', 'reference'],
        aides: {
            name: 'Nom usuel (ex. « Gaz chaufferie »).', reference: 'Point de livraison (PDL électricité) ou de comptage (PCE gaz) : 2e clé avec le site.',
            location: 'Emplacement physique (sous-sol, chaufferie…).',
            [P1_COLONNE('meter', 'usage')]: 'Rôle dans le calcul P1 : entrant (énergie achetée), vente, ecs, eau_froide, annexe, autre.',
            [P1_COLONNE('meter', 'energie')]: 'Énergie mesurée (gaz, fioul, bois, electricite, reseau_chaleur, propane, autre) : choisit la formule de révision par énergie.',
        },
    },
    readings: {
        groupe: 'Compteurs et relevés', resume: 'Index relevés sur les compteurs : relevés terrain, télérelève, reprise d\'historique.',
        usage: [
            'Après les compteurs. Un relevé déjà facturé ou repris dans un intéressement ne se modifie plus.',
            'L\'ECS facturée au relevé se calcule par différence d\'index entre deux relevés mensuels.',
        ],
        cles: ['meter', 'date'],
        aides: { comment: 'Note libre (ex. compteur changé, relevé contrôlé).' },
    },
    p1formules: {
        label: 'P1 · Formules de révision',
        groupe: 'P1', resume: 'Formules de révision des prix P1 d\'un contrat (indices, M0, périodicité), par versions datées.',
        usage: [
            'Après les contrats et le paramétrage P1 des sites (le prix de base vient du site).',
            'Une ligne = une version d\'une formule ; la formule est créée à sa première ligne (usage et périmètre alors obligatoires).',
        ],
        cles: ['contrat', 'nom'],
        aides: { nom: 'Nom de la formule dans le contrat (ex. « Gaz — marché 2025 ») : clé avec le contrat.', motif: 'Pourquoi cette version (contrat d\'origine, avenant…).', document: 'Lien vers la pièce (avenant, contrat).' },
    },
    p1reel: {
        label: 'P1 · Réel du moteur (régularisation)',
        groupe: 'P1', resume: 'Résultat du moteur P1 (pas un paramétrage) : montant P1 HT réellement dû par site et par mois, comparé aux acomptes pour régulariser.',
        usage: [
            'Chaque mois (ou avant une régularisation), à partir de l\'export du moteur P1 (table p1_facturation_site).',
            'Un mois déjà régularisé ne change plus. Visible sur la fiche du site (Paramétrage P1 › Réel P1 du moteur).',
        ],
        cles: ['site', 'mois', 'usage'],
    },
    p1: {
        label: 'P1 · Paramétrage détaillé (avancé)',
        groupe: 'P1', resume: 'Cas avancés du paramétrage P1 : plusieurs versions d\'un paramètre dans un fichier, reprise d\'historique, intéressement.',
        usage: [
            'Le paramétrage P1 courant se fait dans les imports Sites, Compteurs et Contrats (colonnes « P1 · … »).',
            'Ici, une ligne = une version d\'un paramètre : élément (site, compteur, contrat), paramètre, valeur, date d\'effet, motif.',
        ],
        cles: ['element', 'parametre', 'poste', 'dateEffet'],
        aides: { motif: 'Pourquoi cette valeur (contrat d\'origine, avenant 2…) : conservé dans l\'historique.' },
    },
};

/** Imports, avec leur mode d'emploi et les aides complétées. */
export const IMPORT_ENTITIES: Record<ImportEntityKey, ImportEntity> = Object.fromEntries(
    (Object.keys(BASE) as ImportEntityKey[]).map(k => {
        const { aides = {}, label, ...guide } = GUIDES[k];
        return [k, {
            ...BASE[k], ...guide, ...(label && { label }),
            fields: BASE[k].fields.map(f => (!f.help && aides[f.key] ? { ...f, help: aides[f.key] } : f)),
        }];
    }),
) as Record<ImportEntityKey, ImportEntity>;

/** Ordre de l'écran : rubrique, puis ordre conseillé d'import. */
const ORDRE_IMPORTS: ImportEntityKey[] = ['clients', 'contracts', 'sites', 'contacts', 'services', 'meters', 'readings', 'p1formules', 'p1reel', 'p1'];
export const IMPORT_ENTITY_LIST = ORDRE_IMPORTS.map(k => IMPORT_ENTITIES[k]);

/** Statut d'une colonne : obligatoire à la création, clé de correspondance, ou facultative. */
export function statutColonne(entity: ImportEntity, f: ImportField): { obligatoire: boolean; cle: boolean } {
    return { obligatoire: f.required === 'create', cle: entity.cles.includes(f.key) };
}
