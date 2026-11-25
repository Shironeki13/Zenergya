/**
 * Notifications par mail (logique pure) : événements de la vie d'un contrat, règles de destinataires et texte des
 * mails. Les mails sont **internes** : seules les adresses des domaines autorisés sont retenues, les autres sont
 * écartées et le journal le dit. Rien n'est envoyé d'ici : le service écrit le mail dans le journal et le remet au
 * transport (simulation, ou messagerie).
 */

import { rendre, type ContexteMail, type Famille, type Mail, type ModeleMail, type NatureDocument } from './balises';
import { RAPPELS_DEFAUT, type ReglagesRappels } from './rappels';

export type { ContexteMail, Famille, Mail, ModeleMail, NatureDocument } from './balises';

export type Evenement = 'document_depose' | 'document_valide' | 'document_refuse' | 'document_en_attente' | 'preavis' | 'echeance' | 'echeance_depassee' | 'resiliation_validee'
    | 'commande_a_valider' | 'commande_validee' | 'commande_refusee' | 'heures_a_valider' | 'heures_refusees' | 'energie_a_renouveler';
export const EVENEMENTS: Evenement[] = ['document_depose', 'document_valide', 'document_refuse', 'document_en_attente', 'preavis', 'echeance', 'echeance_depassee', 'resiliation_validee',
    'commande_a_valider', 'commande_validee', 'commande_refusee', 'heures_a_valider', 'heures_refusees', 'energie_a_renouveler'];
/** Domaine de chaque événement : contrats, commandes d'achat, heures. */
export const FAMILLE_EVENEMENT: Record<Evenement, Famille> = {
    document_depose: 'contrat', document_valide: 'contrat', document_refuse: 'contrat', document_en_attente: 'contrat', preavis: 'contrat', echeance: 'contrat', echeance_depassee: 'contrat', resiliation_validee: 'contrat',
    commande_a_valider: 'commande', commande_validee: 'commande', commande_refusee: 'commande', heures_a_valider: 'heures', heures_refusees: 'heures', energie_a_renouveler: 'energie',
};
export const LIBELLE_FAMILLE: Record<Famille, string> = { contrat: 'Contrats', commande: 'Commandes d\'achat', heures: 'Heures', energie: "Contrats d'énergie" };
export const LIBELLE_EVENEMENT: Record<Evenement, string> = {
    document_depose: 'Document déposé', document_valide: 'Document validé', document_refuse: 'Document refusé', document_en_attente: 'Documents en attente (récapitulatif)',
    preavis: 'Date limite de préavis qui approche', echeance: 'Échéance qui approche', echeance_depassee: 'Échéance dépassée', resiliation_validee: 'Résiliation validée',
    commande_a_valider: 'Commande à valider', commande_validee: 'Commande validée', commande_refusee: 'Commande refusée',
    heures_a_valider: 'Heures à valider (récapitulatif)', heures_refusees: 'Heures refusées',
    energie_a_renouveler: "Fournitures d'énergie à renouveler (récapitulatif)",
};

export type RoleDestinataire = 'deposant' | 'contratheque' | 'responsable_facturation' | 'n1_responsable' | 'valideur' | 'demandeur' | 'acheteurs' | 'administrateurs';
export const ROLES_DESTINATAIRE: RoleDestinataire[] = ['deposant', 'contratheque', 'responsable_facturation', 'n1_responsable', 'valideur', 'demandeur', 'acheteurs', 'administrateurs'];
/** Rôles qui ont un sens pour chaque domaine (les autres n'auraient jamais de titulaire). */
export const ROLES_FAMILLE: Record<Famille, RoleDestinataire[]> = {
    contrat: ['deposant', 'contratheque', 'responsable_facturation', 'n1_responsable', 'administrateurs'], commande: ['valideur', 'demandeur', 'administrateurs'], heures: ['valideur', 'demandeur', 'administrateurs'], energie: ['acheteurs', 'administrateurs'],
};
export const LIBELLE_ROLE: Record<RoleDestinataire, string> = {
    deposant: 'Le déposant du document', contratheque: 'La contrathèque', responsable_facturation: 'Le responsable de facturation du contrat',
    n1_responsable: 'Le N+1 du responsable de facturation', valideur: 'Le valideur attendu (responsable, ou achats)', demandeur: 'Le demandeur, ou le salarié concerné', acheteurs: 'Les acheteurs (rôle Achats)', administrateurs: 'Les administrateurs',
};

export type Regle = { actif: boolean; roles: RoleDestinataire[]; adresses: string[] };
export const REGLES_DEFAUT: Record<Evenement, Regle> = {
    document_depose: { actif: true, roles: ['contratheque'], adresses: [] },
    document_valide: { actif: true, roles: ['deposant', 'responsable_facturation'], adresses: [] },
    document_refuse: { actif: true, roles: ['deposant'], adresses: [] },
    document_en_attente: { actif: true, roles: ['contratheque'], adresses: [] },
    preavis: { actif: true, roles: ['responsable_facturation', 'n1_responsable'], adresses: [] },
    echeance: { actif: true, roles: ['responsable_facturation', 'contratheque'], adresses: [] },
    echeance_depassee: { actif: true, roles: ['responsable_facturation', 'contratheque'], adresses: [] },
    resiliation_validee: { actif: true, roles: ['responsable_facturation', 'n1_responsable'], adresses: [] },
    commande_a_valider: { actif: true, roles: ['valideur'], adresses: [] },
    commande_validee: { actif: true, roles: ['demandeur'], adresses: [] },
    commande_refusee: { actif: true, roles: ['demandeur'], adresses: [] },
    heures_a_valider: { actif: true, roles: ['valideur'], adresses: [] },
    heures_refusees: { actif: true, roles: ['demandeur'], adresses: [] },
    energie_a_renouveler: { actif: true, roles: ['acheteurs', 'administrateurs'], adresses: [] },
};

/** `simulation` : le mail est écrit au journal sans partir ; `messagerie` : remis à la messagerie ; `arret` : rien. */
export type ModeEnvoi = 'simulation' | 'messagerie' | 'arret';
export type ReglagesNotifications = {
    mode: ModeEnvoi;
    /** Boîte d'envoi (ex. contratheque@…). */
    expediteur: string;
    /** Domaines internes autorisés (ex. veolia.com) : toute autre adresse est écartée. */
    domaines: string[];
    /** Adresse de l'application, pour les liens des mails. */
    urlApplication: string;
    regles: Partial<Record<Evenement, Partial<Regle>>>;
    /** Modèles de mail propres : par événement, pour tous les documents (`defaut`) et par type de document. */
    modeles?: ModelesPropres;
    /** Paliers et intervalles des rappels programmés. */
    rappels: ReglagesRappels;
};
export type ModelesPropres = Partial<Record<Evenement, { defaut?: ModeleMail; parNature?: Partial<Record<NatureDocument, ModeleMail>> }>>;
export const REGLAGES_DEFAUT: ReglagesNotifications = { mode: 'simulation', expediteur: '', domaines: [], urlApplication: '', regles: {}, modeles: {}, rappels: RAPPELS_DEFAUT };

export const regleDe = (r: Pick<ReglagesNotifications, 'regles'>, e: Evenement): Regle => ({ ...REGLES_DEFAUT[e], ...(r.regles?.[e] ?? {}) });

/** Adresses connues pour un contrat : qui tient quel rôle. */
export type Annuaire = Partial<Record<RoleDestinataire, string[]>>;

const adresseValide = (a: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a);
export const domaineDe = (a: string) => a.slice(a.lastIndexOf('@') + 1).toLowerCase();

/**
 * Destinataires d'un événement : adresses des rôles de la règle et adresses fixes, sans doublon, réduites aux
 * domaines internes. Les adresses écartées sont rendues avec leur motif (jamais d'envoi hors des domaines autorisés).
 */
export function destinataires(regle: Regle, annuaire: Annuaire, domaines: string[]): { retenus: string[]; ecartes: { adresse: string; motif: string }[] } {
    const autorises = new Set(domaines.map(d => d.trim().toLowerCase()).filter(Boolean));
    const vus = new Set<string>();
    const retenus: string[] = [];
    const ecartes: { adresse: string; motif: string }[] = [];
    for (const brut of [...regle.roles.flatMap(r => annuaire[r] ?? []), ...regle.adresses]) {
        const a = String(brut ?? '').trim().toLowerCase();
        if (!a || vus.has(a)) continue;
        vus.add(a);
        if (!adresseValide(a)) ecartes.push({ adresse: a, motif: 'adresse invalide' });
        else if (autorises.size === 0) ecartes.push({ adresse: a, motif: 'aucun domaine interne paramétré' });
        else if (!autorises.has(domaineDe(a))) ecartes.push({ adresse: a, motif: `domaine ${domaineDe(a)} hors des domaines internes` });
        else retenus.push(a);
    }
    return { retenus, ecartes };
}

// --- Modèles des mails ---

/** Événements qui portent sur un document (leur modèle peut différer par type de document). */
export const EVENEMENTS_DOCUMENT: Evenement[] = ['document_depose', 'document_valide', 'document_refuse'];

const PIED = 'Vie du contrat : <<Lien vers le contrat>>\n\nMessage automatique de Zenergya, réservé à un usage interne. Ne pas répondre.';
const K = '<<Numéro du contrat>> — <<Client>>';
const PIED_SIMPLE = 'Message automatique de Zenergya, réservé à un usage interne. Ne pas répondre.';

/** Modèles d'origine, écrits avec les mêmes balises que ceux de l'administrateur. */
export const MODELES_DEFAUT: Record<Evenement, ModeleMail> = {
    document_depose: {
        objet: `[Contrathèque] <<Un document>> est à valider — ${K}`,
        corps: `Bonjour,\n\n<<Un document>> a été déposé<<e>> par <<Déposé par>> le <<Date de dépôt>> sur le contrat ${K}.\nObjet : <<Objet du document>>\nDate d'effet : <<Date d'effet>>\n<<Impacts par prestation>>\n\nIl attend votre validation : contrôlez-le contre sa pièce, puis validez ou refusez.\n\n${PIED}`,
    },
    document_valide: {
        objet: `[Contrathèque] <<Le document>> est validé<<e>> — ${K}`,
        corps: `Bonjour,\n\n<<Le document>> du contrat ${K} a été validé<<e>> par <<Décidé par>>.\nObjet : <<Objet du document>>\nDate d'effet : <<Date d'effet>>\n<<Impacts par prestation>>\n\nSes effets sont appliqués dans Zenergya.\n\n${PIED}`,
    },
    document_refuse: {
        objet: `[Contrathèque] <<Le document>> est refusé<<e>> — ${K}`,
        corps: `Bonjour,\n\n<<Le document>> du contrat ${K} a été refusé<<e>> par <<Décidé par>>.\nMotif : <<Motif du refus>>\nObjet : <<Objet du document>>\n\nCorrigez puis déposez à nouveau le document.\n\n${PIED}`,
    },
    document_en_attente: {
        objet: '[Contrathèque] <<Nombre de documents>> document(s) en attente de validation',
        corps: `Bonjour,\n\n<<Nombre de documents>> document(s) attendent leur validation, le plus ancien depuis <<Nombre de jours>> jours :\n\n<<Liste des documents>>\n\nMerci de les traiter : validation ou refus motivé.\n\nContrathèque : <<Lien vers la contrathèque>>\n\nMessage automatique de Zenergya, réservé à un usage interne. Ne pas répondre.`,
    },
    preavis: {
        objet: `[Contrats] Préavis dans <<Nombre de jours>> jours — ${K}`,
        corps: `Bonjour,\n\nLa date limite de préavis du contrat ${K} est le <<Date limite>>, dans <<Nombre de jours>> jours.\nPréavis : <<Durée du préavis>> avant l'échéance du <<Échéance du contrat>>.\nPassé cette date : <<Reconduction>>.\n\nDécidez de la suite à donner (poursuite, renégociation ou dénonciation) avant cette date.\n\n${PIED}`,
    },
    echeance: {
        objet: `[Contrats] Échéance dans <<Nombre de jours>> jours — ${K}`,
        corps: `Bonjour,\n\nLe contrat ${K} arrive à échéance le <<Date limite>>, dans <<Nombre de jours>> jours.\nReconduction prévue : <<Reconduction>>.\n\nPréparez sa reconduction ou sa fin.\n\n${PIED}`,
    },
    echeance_depassee: {
        objet: `[Contrats] Échéance dépassée depuis <<Nombre de jours>> jours — ${K}`,
        corps: `Bonjour,\n\nLe contrat ${K} a dépassé son échéance du <<Date limite>> depuis <<Nombre de jours>> jours et reste actif dans Zenergya.\n\nDéposez sa reconduction, ou terminez le contrat.\n\n${PIED}`,
    },
    resiliation_validee: {
        objet: `[Contrats] Résiliation validée — ${K}`,
        corps: `Bonjour,\n\nLa résiliation du contrat ${K} est validée.\nDate d'effet : <<Date d'effet>>\nMotif : <<Objet du document>>\n\nAnticipez la fin des prestations et la dernière facturation.\n\n${PIED}`,
    },
    commande_a_valider: {
        objet: '[Achats] Commande à valider — <<Numéro de commande>> — <<Montant de la commande>>',
        corps: `Bonjour,\n\nLa commande <<Numéro de commande>> de <<Demandeur>> attend votre validation (<<Étape de validation>>).\nObjet : <<Objet de la commande>>\nFournisseur : <<Fournisseur>>\nMontant : <<Montant de la commande>> HT\n\nValidez-la ou refusez-la avec un motif.\n\nCommande : <<Lien vers la commande>>\n\n${PIED_SIMPLE}`,
    },
    commande_validee: {
        objet: '[Achats] Votre commande <<Numéro de commande>> est validée',
        corps: `Bonjour,\n\nVotre commande <<Numéro de commande>> est validée : elle peut être passée au fournisseur.\nObjet : <<Objet de la commande>>\nFournisseur : <<Fournisseur>>\nMontant : <<Montant de la commande>> HT\nDernière validation par <<Décision prise par>>.\n\nCommande : <<Lien vers la commande>>\n\n${PIED_SIMPLE}`,
    },
    commande_refusee: {
        objet: '[Achats] Votre commande <<Numéro de commande>> est refusée',
        corps: `Bonjour,\n\nVotre commande <<Numéro de commande>> a été refusée par <<Décision prise par>>.\nMotif : <<Motif de la décision>>\nObjet : <<Objet de la commande>>\nMontant : <<Montant de la commande>> HT\n\nCorrigez-la puis soumettez-la à nouveau.\n\nCommande : <<Lien vers la commande>>\n\n${PIED_SIMPLE}`,
    },
    heures_a_valider: {
        objet: '[Heures] <<Nombre de saisies>> saisie(s) à valider — <<Total des heures>>',
        corps: `Bonjour,\n\n<<Nombre de saisies>> saisie(s) d'heures de votre équipe attendent votre validation, soit <<Total des heures>> :\n\n<<Liste des heures>>\n\nTant qu'elles ne sont pas validées, elles ne comptent pas dans la rentabilité des affaires.\n\nHeures : <<Lien vers les heures>>\n\n${PIED_SIMPLE}`,
    },
    heures_refusees: {
        objet: '[Heures] <<Nombre de saisies>> saisie(s) d\'heures refusée(s)',
        corps: `Bonjour,\n\n<<Nombre de saisies>> de vos saisies d'heures (<<Total des heures>>) ont été refusées par <<Décision prise par>>.\nMotif : <<Motif de la décision>>\n\n<<Liste des heures>>\n\nCorrigez-les : elles repartiront en validation.\n\nHeures : <<Lien vers les heures>>\n\n${PIED_SIMPLE}`,
    },
    energie_a_renouveler: {
        objet: '[Énergie] <<Nombre de points à renouveler>> point(s) de livraison à renouveler — première fin le <<Première fin de fourniture>>',
        corps: `Bonjour,\n\nLa fourniture d'énergie de <<Nombre de points à renouveler>> point(s) de livraison arrive à son terme sans contrat pour la suite :\n\n<<Liste des points à renouveler>>\n\n<<Points sans contrat en cours>> point(s) n'ont déjà plus de contrat en cours alors que le contrat client est actif.\n\nRenouveler, c'est ajouter la nouvelle période sur le point de livraison : <<Lien vers les contrats d'énergie>>`,
    },
};

/** Modèle en vigueur : celui du type de document s'il existe, sinon celui de l'événement, sinon celui d'origine. */
export function modeleDe(modeles: ModelesPropres | undefined, e: Evenement, nature?: NatureDocument): { modele: ModeleMail; origine: 'nature' | 'evenement' | 'origine' } {
    const propres = modeles?.[e];
    const parNature = nature ? propres?.parNature?.[nature] : undefined;
    if (parNature) return { modele: parNature, origine: 'nature' };
    if (propres?.defaut) return { modele: propres.defaut, origine: 'evenement' };
    return { modele: MODELES_DEFAUT[e], origine: 'origine' };
}

/** Sujet et corps d'un mail : le modèle en vigueur, rempli avec les valeurs du contrat et du document. */
export const composer = (e: Evenement, c: ContexteMail, modeles?: ModelesPropres): Mail => rendre(modeleDe(modeles, e, c.document?.nature).modele, c);

/** Contexte d'exemple, pour l'aperçu des modèles (`nature` : type de document à montrer). */
export function contexteExemple(e: Evenement, urlApplication = 'https://zenergya.example', nature: NatureDocument = 'avenant'): ContexteMail {
    const base: ContexteMail = { contrat: { id: 'exemple', numero: 'CTN-00003', client: 'SDC Le Belvédère', montants: { p1: 80000, p2: 4800 } }, urlApplication, aujourdhui: '2026-11-23' };
    const RESUME: Record<NatureDocument, string> = {
        contrat: 'Exploitation chauffage et ECS', avenant: 'Avenant n°1 : prolongation après rénovation de la chaufferie', os: 'OS n°7 : remplacement du circulateur', reconduction: '1 an',
        resiliation: 'Vente de l\'immeuble', syndic: 'Syndic Démo Immobilier', be: 'BE Fluides Exemple',
    };
    const doc = { nature, resume: RESUME[nature], deposePar: 'adv@exemple.fr', deposeLe: '2026-11-03', effet: '2026-12-01', ...((nature === 'avenant' || nature === 'os') && { impacts: { p1: -2500, p2: 1200 } }) };
    if (e === 'document_depose') return { ...base, document: doc };
    if (e === 'document_valide') return { ...base, document: { ...doc, decidePar: 'contratheque@exemple.fr' } };
    if (e === 'document_refuse') return { ...base, document: { ...doc, decidePar: 'contratheque@exemple.fr', motifRefus: 'Document non signé par le client : joindre la version signée.' } };
    if (e === 'document_en_attente') return {
        contrat: { id: '', numero: '', client: '' }, urlApplication, aujourdhui: '2026-11-23', jours: 21,
        liste: [
            { numero: 'CTN-00007', client: 'Copropriété Square Voltaire', nature: 'reconduction', jours: 21, deposeLe: '2026-11-02', deposePar: 'adv@exemple.fr', resume: '1 an' },
            { numero: 'CTN-00003', client: 'SDC Le Belvédère', nature: 'avenant', jours: 20, deposeLe: '2026-11-03', deposePar: 'adv@exemple.fr', resume: 'Avenant n°1 : prolongation après rénovation de la chaufferie' },
            { numero: 'CTN-00011', client: 'Copropriété Le Clos Fleuri', nature: 'contrat', jours: 8, deposeLe: '2026-11-15', deposePar: 'adv2@exemple.fr' },
        ],
    };
    const vide = { contrat: { id: '', numero: '', client: '' }, urlApplication, aujourdhui: '2026-11-23' };
    const commande = { id: 'exemple', numero: 'ZEN-CMD2026-0012', objet: 'Remplacement de deux circulateurs', fournisseur: 'Chauffage Pro', montantHT: 8400, demandeur: 'Lucas Morel' };
    if (e === 'commande_a_valider') return { ...vide, commande: { ...commande, etape: 'Responsable (N+1)', valideur: 'Nadia Roche' } };
    if (e === 'commande_validee') return { ...vide, commande: { ...commande, decidePar: 'Paul Garnier' } };
    if (e === 'commande_refusee') return { ...vide, commande: { ...commande, decidePar: 'Nadia Roche', motif: 'Devis fournisseur manquant.' } };
    const lignes = [{ date: '2026-11-18', heures: 7.5, salarie: 'Lucas Morel', affectation: 'Affaire ZEN-AFF2026-0003 — Rénovation de chaufferie' }, { date: '2026-11-19', heures: 4, salarie: 'Lucas Morel', affectation: 'Contrat CTN-00003 — P2' }, { date: '2026-11-19', heures: 6, salarie: 'Emma Petit', affectation: 'Affaire ZEN-AFF2026-0001 — Circulateur' }];
    if (e === 'heures_a_valider') return { ...vide, heures: { lignes } };
    if (e === 'heures_refusees') return { ...vide, heures: { salarie: 'Lucas Morel', lignes: lignes.slice(0, 2), decidePar: 'Nadia Roche', motif: 'Affectation erronée : ces heures relèvent de l\'affaire, pas du contrat.' } };
    if (e === 'energie_a_renouveler') return { ...vide, energie: { sansContrat: 2, lignes: [
        { pdl: '21458100007919', client: 'Copropriété Les Tilleuls', site: 'Tilleuls - Bâtiment A', fournisseur: 'Gaz du Sud', numeroContrat: 'MULTISITES 2025/2026', fin: '2026-12-31', jours: 38 },
        { pdl: '21458100031676', client: 'Copropriété Square Voltaire', site: 'Square Voltaire - Chaufferie', fournisseur: 'Gaz du Sud', numeroContrat: 'MULTISITES 2025/2026', fin: '2026-12-31', jours: 38 },
        { pdl: '30002310560856', client: 'Ville de Bagnols', site: 'Groupe scolaire', fournisseur: 'Énergies du Rhône', numeroContrat: '', fin: '2027-03-31', jours: 128 },
    ] } };
    if (e === 'preavis') return { ...base, jours: 60, date: '2027-06-29', echeance: '2027-09-29', preavis: '3 mois', reconduction: 'sans dénonciation, reconduction tacite de 1 an' };
    if (e === 'echeance') return { ...base, jours: 180, date: '2027-09-29', reconduction: 'reconduction tacite de 1 an' };
    if (e === 'echeance_depassee') return { ...base, jours: 12, date: '2026-11-11' };
    return { ...base, document: { nature: 'resiliation', resume: 'Vente de l\'immeuble', effet: '2027-03-31' } };
}
