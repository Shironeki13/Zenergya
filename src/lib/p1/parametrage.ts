/**
 * Paramétrage P1 : types proposés (voir docs/parametrage-p1.md).
 *
 * Proposition de modèle, pas encore branchée à Firestore ni aux écrans.
 * Les noms et valeurs reprennent ceux que lit le moteur P1, pour que l'export
 * vers BigQuery (tables p_*) se fasse sans traduction.
 *
 * Règles communes :
 * - une valeur décidée est une `Version` : elle vaut à partir de `dateEffet`,
 *   avec son motif ; un avenant ajoute une version, il n'écrase rien ;
 * - `null` signifie « non renseigné » et rend le calcul non calculable avec sa
 *   cause : il ne vaut jamais 0 ;
 * - les codes Zenergya (contrat, site, compteur) sont les identifiants maîtres ;
 *   les codes TWIMM ne sont qu'une correspondance datée, tenue tant que des
 *   données de BigQuery restent indexées par TWIMM.
 */

// ---------------------------------------------------------------------------
// Historique
// ---------------------------------------------------------------------------

/** Date ISO `YYYY-MM-DD`. */
export type IsoDate = string;

/** Trace de saisie et de retrait d'une décision. */
export type Trace = {
    saisiLe: string;          // horodatage ISO
    saisiPar: string;         // email de l'auteur
    retireLe?: string | null;
    retirePar?: string | null;
    motifRetrait?: string | null;
};

/**
 * Une valeur et la date à partir de laquelle elle vaut.
 * `dateEffet` null : valeur d'origine du marché (le socle).
 */
export type Version<T> = Trace & {
    valeur: T;
    dateEffet: IsoDate | null;
    motif: string;            // « avenant n°2 », « correction », …
    document?: string | null; // pièce justificative (lien GED)
};

/** Un paramètre historisé : ses versions, triées par date d'effet. */
export type Historise<T> = Version<T>[];

// ---------------------------------------------------------------------------
// Référentiels
// ---------------------------------------------------------------------------

export const TYPES_MARCHE = ['MC', 'MCI', 'MT', 'MTI', 'CP', 'CPI', 'PFI', 'PF'] as const;
export type TypeMarche = typeof TYPES_MARCHE[number];

export const PERIODES_REFERENCE = ['saison_de_chauffe', 'annee_civile'] as const;
export type PeriodeReference = typeof PERIODES_REFERENCE[number];

export const REGIMES_CP = ['refacturation', 'frais_gestion', 'coefficient', 'revise'] as const;
export type RegimeCp = typeof REGIMES_CP[number];

export const PERIODICITES_REVISION = ['mensuel', 'annuel_dju', 'annuel_temps', 'annuel_cloture'] as const;
export type PeriodiciteRevision = typeof PERIODICITES_REVISION[number];

export const TYPES_POSTE_FACTURATION = ['chauffage', 'ecs', 'annexe', 'autre'] as const;
export type TypePosteFacturation = typeof TYPES_POSTE_FACTURATION[number];

export const UNITES_PRIX = ['EUR/MWh', 'EUR/m3', 'EUR/t', 'EUR/L'] as const;
export type UnitePrix = typeof UNITES_PRIX[number];

export type Energie = 'gaz' | 'fioul' | 'bois' | 'electricite' | 'reseau_chaleur' | 'propane' | 'autre';

// ---------------------------------------------------------------------------
// Grille : ce que chaque type de marché exige d'avoir saisi
// ---------------------------------------------------------------------------

export type ExigencesMarche = {
    suivi: boolean;                              // PF : hors suivi P1
    assiette: 'NC' | "N'B" | 'energie_entrante' | 'aucune';
    prixEtFormule: boolean;                      // prix de base + formule de révision
    cible: 'entrante' | 'sortante' | null;       // maille de la cible NB
    bareme: boolean;                             // intéressement : barème de partage
    regimeCp: boolean;                           // CP / CPI : régime de refacturation
    prixEnergieClient: boolean;                  // PFI
};

export const EXIGENCES_MARCHE: Record<TypeMarche, ExigencesMarche> = {
    MC:  { suivi: true,  assiette: 'NC',               prixEtFormule: true,  cible: null,        bareme: false, regimeCp: false, prixEnergieClient: false },
    MCI: { suivi: true,  assiette: 'NC',               prixEtFormule: true,  cible: 'sortante',  bareme: true,  regimeCp: false, prixEnergieClient: false },
    MT:  { suivi: true,  assiette: "N'B",              prixEtFormule: true,  cible: 'entrante',  bareme: false, regimeCp: false, prixEnergieClient: false },
    MTI: { suivi: true,  assiette: "N'B",              prixEtFormule: true,  cible: 'entrante',  bareme: true,  regimeCp: false, prixEnergieClient: false },
    CP:  { suivi: true,  assiette: 'energie_entrante', prixEtFormule: false, cible: null,        bareme: false, regimeCp: true,  prixEnergieClient: false },
    CPI: { suivi: true,  assiette: 'energie_entrante', prixEtFormule: false, cible: 'entrante',  bareme: true,  regimeCp: true,  prixEnergieClient: false },
    PFI: { suivi: true,  assiette: 'aucune',           prixEtFormule: false, cible: 'entrante',  bareme: true,  regimeCp: false, prixEnergieClient: true },
    PF:  { suivi: false, assiette: 'aucune',           prixEtFormule: false, cible: null,        bareme: false, regimeCp: false, prixEnergieClient: false },
};

/** Un CP / CPI au régime « révisé » se facture comme un marché à consommation. */
export function exigePrixEtFormule(marche: TypeMarche, regime: RegimeCp | null): boolean {
    return EXIGENCES_MARCHE[marche].prixEtFormule || (EXIGENCES_MARCHE[marche].regimeCp && regime === 'revise');
}

// ---------------------------------------------------------------------------
// Contrat
// ---------------------------------------------------------------------------

/** Les codes TWIMM d'un contrat, pour rapprocher les sources encore indexées par TWIMM. */
export type CorrespondanceContratTwimm = {
    codeContrat: string;
    codeClient: string | null;
};

export type ParametrageContratP1 = {
    contractId: string;
    codeContrat: string;                         // code Zenergya, maître (CTN-00001)
    correspondanceTwimm: Historise<CorrespondanceContratTwimm>;
    regimeCp: Historise<RegimeCp>;
    coefficientGestion: Historise<number>;       // régime « coefficient »
    regularisation: Historise<'reel_moteur' | 'decompte_dju'>;   // acomptes P1 : réel du moteur importé, ou décompte MTI calculé
    fraisGestionAnnuels: Historise<number>;      // régime « frais_gestion », EUR HT / an
    interessementContrat: InteressementContrat[];
    sansSite: Version<boolean> | null;           // le contrat ne porte légitimement aucun site
    formules: FormuleRevision[];
    baremes: BaremePartage[];
    qualificationsAchat: QualificationAchat[];
};

/** Intéressement calculé une seule fois sur la somme des sites du contrat. */
export type InteressementContrat = Trace & {
    marche: TypeMarche;
    repartition: 'contrat' | 'prorata_nb';       // la régularisation reste au contrat ou se répartit
    plafondPct: number | null;                   // % du P2 total
    plafonne: boolean;
};

// ---------------------------------------------------------------------------
// Site
// ---------------------------------------------------------------------------

export type ParametrageSiteP1 = {
    siteId: string;
    codeSite: string;                            // code Zenergya, maître et immuable (SIT-00001)
    correspondanceTwimm: Historise<string>;      // code site TWIMM
    rattachement: Historise<string>;             // contractId
    typeMarche: Historise<TypeMarche>;
    periodeReference: Historise<PeriodeReference>;
    prixBase: Historise<number>;                 // EUR/MWh
    prixBaseEcs: Historise<number>;              // EUR/m3
    stationMeteo: string | null;
    prixEnergieClient: PrixEnergieClient[];      // PFI
    p2: P2Site[];
    referencesClient: ReferenceSiteClient[];
    perimetreInteressement: PerimetreInteressement[];
    compteurs: CompteurP1[];
    postesConsommation: PosteConsommation[];
    postesFacturation: PosteFacturation[];
};

/** Prix de l'énergie du client (PFI), par saison : un prix, ou montant et quantité. */
export type PrixEnergieClient = Trace & {
    saison: string;                              // « 2025-2026 »
    prix: number | null;                         // EUR/MWh
    montantHt: number | null;
    quantite: number | null;                     // MWh
};

export type P2Site = Trace & {
    exercice: number;
    montant: number | null;                      // EUR HT
    document: string | null;
    libelleDocument: string | null;
};

export type ReferenceSiteClient = Trace & {
    reference: string;                           // numéro ou libellé chez le client
    libelle: string | null;
};

export type PerimetreInteressement = Trace & {
    marche: TypeMarche;
    exercice: number;
    inclus: boolean;
};

// ---------------------------------------------------------------------------
// Compteurs et postes
// ---------------------------------------------------------------------------

export type CompteurP1 = {
    meterId: string;
    codeCompteur: string;                        // code Zenergya, maître et immuable (CPT-00001)
    correspondanceTwimm: Historise<string>;      // code compteur TWIMM (change si le compteur est remplacé)
    usage: 'entrant' | 'vente' | 'ecs' | 'eau_froide' | 'annexe' | 'autre';
    energie: Energie | null;
    unite: string;                               // kWh, MWh, m3, L, t…
    qe: Historise<number>;                       // index → MWh ; vide si inconnu, jamais 1 par défaut
    qecs: Historise<number>;                     // compteurs d'ECS volumétriques
    pdlPce: string | null;
    codeImmeuble: string | null;
};

/** Un terme de la formule de NC : un compteur et son signe. */
export type TermeNc = {
    codeCompteur: string;                        // code Zenergya
    signe: 1 | -1;                               // +1 entrée, -1 déduction (ECS, sous-comptage)
};

/** Poste de consommation : formule de NC et engagement (cible, DJU de référence). */
export type PosteConsommation = Trace & {
    designation: string;
    formuleNc: Historise<TermeNc[]>;
    cibleNb: Historise<number>;
    cibleNbUnite: Historise<'MWh' | 't' | 'L'>;
    djuReference: Historise<number>;
};

export type PosteFacturation = Trace & {
    rang: number;
    libelle: string;
    type: TypePosteFacturation;
    compteurs: string[];                         // codes compteur Zenergya
    unitePrix: UnitePrix;
};

// ---------------------------------------------------------------------------
// Formules de révision
// ---------------------------------------------------------------------------

export type PerimetreFormule =
    | { type: 'contrat' }
    | { type: 'energies'; energies: Energie[] }
    | { type: 'sites'; siteIds: string[] };

export type ElementPanier = {
    serie: string | null;                        // code de l'indice
    valeurFixe: number | null;
    coefficient: number;
};

export type TermeRevision = {
    code: 'p0' | 'Kmol' | 'TVD' | 'Accise' | 'CEE' | 'CPB' | 'Infra' | string;
    coefficient: number;                         // a_i (forme A) ou c_i (forme B)
    serie: string | null;                        // null pour p0
    valeurBaseM0: number | null;
    baseContractuelle: boolean;                  // valeur stipulée au marché, et non publiée à M0
    unite: string;
    actif: boolean;
    panier: ElementPanier[] | null;
};

export type VersionFormule = {
    forme: 'A' | 'B';
    mode: 'standard' | 'derogatoire';
    baseEnergetique: 'PCS' | 'PCI';
    prixBase: number | null;                     // K0
    unitePrix: UnitePrix;
    dateM0: IsoDate | null;
    m0Manquante: string | null;                  // ce qui manque quand M0 n'est pas connue
    regimeKmol: 'variable' | 'fixe';
    prixMoleculeNegocie: number | null;          // régime fixe
    prixFixe: boolean;                           // prix non révisable
    periodicite: PeriodiciteRevision;
    termes: TermeRevision[];
};

export type FormuleRevision = Trace & {
    id: string;
    nom: string;
    usage: 'chauffage' | 'ecs';
    perimetre: PerimetreFormule;
    versions: Historise<VersionFormule>;
};

// ---------------------------------------------------------------------------
// Barème de partage et achats
// ---------------------------------------------------------------------------

export type TrancheBareme = {
    sens: 'economie' | 'depassement';
    borneBasse: number;                          // fraction du N'B (0,1 = 10 %)
    borneHaute: number;
    partClient: number;                          // fraction
};

export type BaremePartage = Trace & {
    marche: TypeMarche;
    siteId: string | null;                       // null : barème du contrat
    tranches: TrancheBareme[];
};

/**
 * Contrôle d'un barème : pour chaque sens, les tranches partent de 0 et se
 * suivent sans trou ni chevauchement. Rend la liste des anomalies.
 */
export function controlerBareme(tranches: TrancheBareme[]): string[] {
    const anomalies: string[] = [];
    for (const sens of ['economie', 'depassement'] as const) {
        const t = tranches.filter(x => x.sens === sens).sort((a, b) => a.borneBasse - b.borneBasse);
        if (t.length === 0) {
            anomalies.push(`aucune tranche pour le sens ${sens}`);
            continue;
        }
        if (Math.abs(t[0].borneBasse) > 1e-9) anomalies.push(`la première tranche ${sens} ne part pas de 0 %`);
        for (let i = 1; i < t.length; i++) {
            if (Math.abs(t[i - 1].borneHaute - t[i].borneBasse) > 1e-9) {
                anomalies.push(`trou ou chevauchement entre ${t[i - 1].borneHaute} et ${t[i].borneBasse} (${sens})`);
            }
        }
    }
    return anomalies;
}

export type QualificationAchat = Trace & {
    marche: TypeMarche;
    energie: Energie;
    siteId: string | null;
    composante: string;
    qualification: 'variable' | 'fixe';
    refacturee: boolean;
    auKFinal: boolean;
};

// ---------------------------------------------------------------------------
// Réglages généraux
// ---------------------------------------------------------------------------

export type ReglagesP1 = {
    defauts: {
        periodeReference: PeriodeReference;
        methodeAffectation: 'prorata';
    };
    seuils: {
        djuCouvertureBasse: number;              // 0,7
        djuCouvertureHaute: number;              // 1,15
        ecartRelatifAberrant: number;            // 0,6
        rendementMin: number;                    // 0,5
        rendementMax: number;                    // 1,05
        ecartAchatsReleves: number;              // 0,05
        reportIndiceMois: number;                // 3
        variationPrixMensuelle: number;          // 0,25
        partEstimeeAlerte: number;               // 0,2
        ecartReferenceAchat: number;             // 0,2
    };
};

export const REGLAGES_P1_DEFAUT: ReglagesP1 = {
    defauts: { periodeReference: 'saison_de_chauffe', methodeAffectation: 'prorata' },
    seuils: {
        djuCouvertureBasse: 0.7,
        djuCouvertureHaute: 1.15,
        ecartRelatifAberrant: 0.6,
        rendementMin: 0.5,
        rendementMax: 1.05,
        ecartAchatsReleves: 0.05,
        reportIndiceMois: 3,
        variationPrixMensuelle: 0.25,
        partEstimeeAlerte: 0.2,
        ecartReferenceAchat: 0.2,
    },
};

// ---------------------------------------------------------------------------
// Lecture d'un paramètre historisé
// ---------------------------------------------------------------------------

/** La version en vigueur à une date (versions retirées exclues), ou null. */
export function enVigueur<T>(versions: Historise<T>, date: IsoDate): Version<T> | null {
    let retenue: Version<T> | null = null;
    for (const v of versions) {
        if (v.retireLe) continue;
        const debut = v.dateEffet ?? '0000-01-01';
        if (debut <= date && (!retenue || debut >= (retenue.dateEffet ?? '0000-01-01'))) retenue = v;
    }
    return retenue;
}
