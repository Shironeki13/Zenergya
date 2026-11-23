/**
 * Notifications par mail (logique pure) : événements de la vie d'un contrat, règles de destinataires et texte des
 * mails. Les mails sont **internes** : seules les adresses des domaines autorisés sont retenues, les autres sont
 * écartées et le journal le dit. Rien n'est envoyé d'ici : le service écrit le mail dans le journal et le remet au
 * transport (simulation, ou messagerie).
 */

import { rendre, type ContexteMail, type Mail, type ModeleMail, type NatureDocument } from './balises';

export type { ContexteMail, Mail, ModeleMail, NatureDocument } from './balises';

export type Evenement = 'document_depose' | 'document_valide' | 'document_refuse' | 'document_en_attente' | 'preavis' | 'echeance' | 'echeance_depassee' | 'resiliation_validee';
export const EVENEMENTS: Evenement[] = ['document_depose', 'document_valide', 'document_refuse', 'document_en_attente', 'preavis', 'echeance', 'echeance_depassee', 'resiliation_validee'];
export const LIBELLE_EVENEMENT: Record<Evenement, string> = {
    document_depose: 'Document déposé', document_valide: 'Document validé', document_refuse: 'Document refusé', document_en_attente: 'Document en attente depuis trop longtemps',
    preavis: 'Date limite de préavis qui approche', echeance: 'Échéance qui approche', echeance_depassee: 'Échéance dépassée', resiliation_validee: 'Résiliation validée',
};

export type RoleDestinataire = 'deposant' | 'contratheque' | 'responsable_facturation' | 'n1_responsable' | 'administrateurs';
export const ROLES_DESTINATAIRE: RoleDestinataire[] = ['deposant', 'contratheque', 'responsable_facturation', 'n1_responsable', 'administrateurs'];
export const LIBELLE_ROLE: Record<RoleDestinataire, string> = {
    deposant: 'Le déposant du document', contratheque: 'La contrathèque', responsable_facturation: 'Le responsable de facturation du contrat',
    n1_responsable: 'Le N+1 du responsable de facturation', administrateurs: 'Les administrateurs',
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
};
export type ModelesPropres = Partial<Record<Evenement, { defaut?: ModeleMail; parNature?: Partial<Record<NatureDocument, ModeleMail>> }>>;
export const REGLAGES_DEFAUT: ReglagesNotifications = { mode: 'simulation', expediteur: '', domaines: [], urlApplication: '', regles: {}, modeles: {} };

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
export const EVENEMENTS_DOCUMENT: Evenement[] = ['document_depose', 'document_valide', 'document_refuse', 'document_en_attente'];

const PIED = 'Vie du contrat : <<Lien vers le contrat>>\n\nMessage automatique de Zenergya, réservé à un usage interne. Ne pas répondre.';
const K = '<<Numéro du contrat>> — <<Client>>';

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
        objet: `[Contrathèque] <<Un document>> attend depuis <<Nombre de jours>> jours — ${K}`,
        corps: `Bonjour,\n\n<<Le document>> déposé<<e>> par <<Déposé par>> le <<Date de dépôt>> sur le contrat ${K} attend sa validation depuis <<Nombre de jours>> jours.\nObjet : <<Objet du document>>\n\nMerci de le traiter : validation ou refus motivé.\n\n${PIED}`,
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
    if (e === 'document_en_attente') return { ...base, document: doc, jours: 9 };
    if (e === 'preavis') return { ...base, jours: 60, date: '2027-06-29', echeance: '2027-09-29', preavis: '3 mois', reconduction: 'sans dénonciation, reconduction tacite de 1 an' };
    if (e === 'echeance') return { ...base, jours: 180, date: '2027-09-29', reconduction: 'reconduction tacite de 1 an' };
    if (e === 'echeance_depassee') return { ...base, jours: 12, date: '2026-11-11' };
    return { ...base, document: { nature: 'resiliation', resume: 'Vente de l\'immeuble', effet: '2027-03-31' } };
}
