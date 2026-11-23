/**
 * Modèles de mail à balises (logique pure). Un modèle est un objet et un corps en texte, où des balises entre
 * chevrons doubles — « <<Numéro du contrat>> » — sont remplacées par les valeurs du contrat et du document.
 *
 * - Une balise inconnue est refusée à l'enregistrement (le modèle ne partirait pas avec un trou).
 * - Une ligne dont **toutes** les balises sont vides disparaît : « Motif : <<Motif du refus>> » ne s'affiche que s'il y
 *   a un motif. Les lignes vides en trop sont resserrées.
 * - Le corps est du texte : dans le mail en HTML, chaque ligne devient un paragraphe, les adresses web des liens
 *   cliquables, et tout ce qui vient des données est échappé.
 */

export type NatureDocument = 'contrat' | 'avenant' | 'os' | 'reconduction' | 'resiliation' | 'syndic' | 'be';
export const NATURES: NatureDocument[] = ['contrat', 'avenant', 'os', 'reconduction', 'resiliation', 'syndic', 'be'];
export const LIBELLE_NATURE_DOCUMENT: Record<NatureDocument, string> = {
    contrat: 'Contrat', avenant: 'Avenant', os: 'Ordre de service', reconduction: 'Reconduction', resiliation: 'Résiliation', syndic: 'Changement de syndic', be: 'Changement de bureau d\'études',
};
const NATURE: Record<NatureDocument, { nom: string; un: string; le: string; e: string }> = {
    contrat: { nom: 'contrat', un: 'Un contrat', le: 'Le contrat', e: '' }, avenant: { nom: 'avenant', un: 'Un avenant', le: 'L\'avenant', e: '' },
    os: { nom: 'ordre de service', un: 'Un ordre de service', le: 'L\'ordre de service', e: '' }, reconduction: { nom: 'reconduction', un: 'Une reconduction', le: 'La reconduction', e: 'e' },
    resiliation: { nom: 'résiliation', un: 'Une résiliation', le: 'La résiliation', e: 'e' }, syndic: { nom: 'changement de syndic', un: 'Un changement de syndic', le: 'Le changement de syndic', e: '' },
    be: { nom: 'changement de bureau d\'études', un: 'Un changement de bureau d\'études', le: 'Le changement de bureau d\'études', e: '' },
};

/** Montants par prestation, en € HT par an (absent ou nul : sans objet). */
export type MontantsPrestation = Partial<Record<Prestation, number | null>>;
export type Prestation = 'p1' | 'p2' | 'p3' | 'p3r';
export const PRESTATIONS: Prestation[] = ['p1', 'p2', 'p3', 'p3r'];
const NOM_PRESTATION: Record<Prestation, string> = { p1: 'P1', p2: 'P2', p3: 'P3', p3r: 'P3R' };

export type ContexteMail = {
    /** `montants` : montants annuels HT du contrat par prestation (base marché). */
    contrat: { id: string; numero: string; client: string; montants?: MontantsPrestation };
    /** `impacts` : variation annuelle HT apportée par le document (avenant, ordre de service), par prestation. */
    document?: { nature: NatureDocument; resume?: string; deposePar?: string; deposeLe?: string | null; decidePar?: string; motifRefus?: string; effet?: string | null; impacts?: MontantsPrestation };
    /** Jours restants (préavis, échéance), d'attente (document en attente) ou de dépassement. */
    jours?: number;
    /** Jour concerné : date limite de préavis, échéance. */
    date?: string | null;
    echeance?: string | null;
    preavis?: string;
    reconduction?: string;
    urlApplication: string;
    /** Jour de composition (AAAA-MM-JJ) ; à défaut, aujourd'hui. */
    aujourdhui?: string;
};

export type GroupeBalise = 'Contrat' | 'Document' | 'Montants' | 'Dates et délais';
export const GROUPES_BALISE: GroupeBalise[] = ['Contrat', 'Document', 'Montants', 'Dates et délais'];

const nombre = (x: number) => Math.abs(x).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** « 12 400,00 € » ; vide si absent ou nul. */
const montant = (x?: number | null) => (x ? `${x < 0 ? '−' : ''}${nombre(x)} €` : '');
/** Variation signée : « +1 200,00 € », « −300,00 € » ; vide si absente ou nulle. */
const variation = (x?: number | null) => (x ? `${x < 0 ? '−' : '+'}${nombre(x)} €` : '');
const somme = (m?: MontantsPrestation) => PRESTATIONS.reduce((s, p) => s + (m?.[p] ?? 0), 0);
const aucun = (m?: MontantsPrestation) => !m || PRESTATIONS.every(p => !m[p]);

const fr = (d?: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
const sansFin = (s?: string) => (s ?? '').trim().replace(/[.\s]+$/, '');

export type Balise = { nom: string; groupe: GroupeBalise; aide: string; valeur: (c: ContexteMail) => string };

/** Balises disponibles, dans l'ordre où l'écran les propose. */
export const BALISES: Balise[] = [
    { nom: 'Numéro du contrat', groupe: 'Contrat', aide: 'CTN-00003', valeur: c => c.contrat.numero },
    { nom: 'Client', groupe: 'Contrat', aide: 'Nom du client du contrat', valeur: c => c.contrat.client },
    { nom: 'Lien vers le contrat', groupe: 'Contrat', aide: 'Adresse de la vie du contrat dans Zenergya (cliquable dans le mail)', valeur: c => (c.urlApplication && c.contrat.id ? `${c.urlApplication.replace(/\/+$/, '')}/contracts/${c.contrat.id}?onglet=historique` : '') },
    { nom: 'Type de document', groupe: 'Document', aide: 'avenant, reconduction, résiliation…', valeur: c => (c.document ? NATURE[c.document.nature].nom : '') },
    { nom: 'Un document', groupe: 'Document', aide: '« Un avenant », « Une reconduction »… en début de phrase', valeur: c => (c.document ? NATURE[c.document.nature].un : '') },
    { nom: 'Le document', groupe: 'Document', aide: '« L\'avenant », « La reconduction »… en début de phrase', valeur: c => (c.document ? NATURE[c.document.nature].le : '') },
    { nom: 'e', groupe: 'Document', aide: 'Accord : « e » pour une reconduction ou une résiliation, rien sinon (« validé<<e>> »)', valeur: c => (c.document ? NATURE[c.document.nature].e : '') },
    { nom: 'Objet du document', groupe: 'Document', aide: 'Description de l\'avenant, motif de la résiliation, nouveau syndic…', valeur: c => sansFin(c.document?.resume) },
    { nom: 'Déposé par', groupe: 'Document', aide: 'Adresse de la personne qui a déposé le document', valeur: c => c.document?.deposePar ?? '' },
    { nom: 'Date de dépôt', groupe: 'Document', aide: 'JJ/MM/AAAA', valeur: c => fr(c.document?.deposeLe) },
    { nom: 'Décidé par', groupe: 'Document', aide: 'Adresse de la personne qui a validé ou refusé', valeur: c => c.document?.decidePar ?? '' },
    { nom: 'Motif du refus', groupe: 'Document', aide: 'Motif saisi par la contrathèque', valeur: c => sansFin(c.document?.motifRefus) },
    { nom: 'Date d\'effet', groupe: 'Document', aide: 'Date d\'effet du document, JJ/MM/AAAA', valeur: c => fr(c.document?.effet) },
    ...PRESTATIONS.map((p): Balise => ({ nom: `Montant ${NOM_PRESTATION[p]} du contrat`, groupe: 'Montants', aide: `Montant annuel HT ${NOM_PRESTATION[p]} du contrat ; vide s'il n'y en a pas`, valeur: c => montant(c.contrat.montants?.[p]) })),
    { nom: 'Montant total du contrat', groupe: 'Montants', aide: 'Somme annuelle HT des prestations du contrat', valeur: c => (aucun(c.contrat.montants) ? '' : montant(somme(c.contrat.montants))) },
    { nom: 'Montants du contrat', groupe: 'Montants', aide: 'Une ligne par prestation qui a un montant : « P1 : 80 000,00 € HT/an »', valeur: c => PRESTATIONS.filter(p => c.contrat.montants?.[p]).map(p => `${NOM_PRESTATION[p]} : ${montant(c.contrat.montants![p])} HT/an`).join('\n') },
    ...PRESTATIONS.map((p): Balise => ({ nom: `Impact ${NOM_PRESTATION[p]}`, groupe: 'Montants', aide: `Variation annuelle HT ${NOM_PRESTATION[p]} apportée par le document (« +1 200,00 € ») ; vide s'il n'y en a pas`, valeur: c => variation(c.document?.impacts?.[p]) })),
    { nom: 'Impact total', groupe: 'Montants', aide: 'Somme des variations du document, toutes prestations', valeur: c => (aucun(c.document?.impacts) ? '' : variation(somme(c.document?.impacts)) || '0,00 €') },
    { nom: 'Impacts par prestation', groupe: 'Montants', aide: 'Une ligne par prestation touchée : « P2 : +1 200,00 € HT/an »', valeur: c => PRESTATIONS.filter(p => c.document?.impacts?.[p]).map(p => `${NOM_PRESTATION[p]} : ${variation(c.document!.impacts![p])} HT/an`).join('\n') },
    { nom: 'Nombre de jours', groupe: 'Dates et délais', aide: 'Jours restants avant la date, jours d\'attente ou jours de dépassement', valeur: c => (c.jours === undefined ? '' : String(c.jours)) },
    { nom: 'Date limite', groupe: 'Dates et délais', aide: 'Date limite de préavis, ou échéance, selon l\'événement', valeur: c => fr(c.date) },
    { nom: 'Échéance du contrat', groupe: 'Dates et délais', aide: 'JJ/MM/AAAA', valeur: c => fr(c.echeance ?? c.date) },
    { nom: 'Durée du préavis', groupe: 'Dates et délais', aide: 'Telle qu\'elle est écrite sur le contrat (« 3 mois »)', valeur: c => c.preavis ?? '' },
    { nom: 'Reconduction', groupe: 'Dates et délais', aide: '« reconduction tacite de 1 an », « sans reconduction »…', valeur: c => c.reconduction ?? '' },
    { nom: 'Date du jour', groupe: 'Dates et délais', aide: 'Jour d\'envoi du mail, JJ/MM/AAAA', valeur: c => fr(c.aujourdhui ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' })) },
];

const cle = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’]/g, '\'').replace(/\s+/g, ' ').trim().toLowerCase();
const PAR_NOM = new Map(BALISES.map(b => [cle(b.nom), b]));
const MOTIF = /<<\s*([^<>]*?)\s*>>/g;

export type ModeleMail = { objet: string; corps: string };
export type Mail = { sujet: string; texte: string; html: string };

/** Balises d'un texte (telles qu'écrites). */
export const balisesDe = (texte: string): string[] => [...texte.matchAll(MOTIF)].map(m => m[1]);

/** Contrôle d'un modèle avant enregistrement ; liste d'erreurs (vide : bon). */
export function controlerModele(m: ModeleMail): string[] {
    const erreurs: string[] = [];
    if (!m.objet?.trim()) erreurs.push('L\'objet du mail est vide.');
    if (!m.corps?.trim()) erreurs.push('Le corps du mail est vide.');
    if ((m.objet ?? '').length > 250) erreurs.push('L\'objet dépasse 250 caractères.');
    if ((m.corps ?? '').length > 8000) erreurs.push('Le corps dépasse 8 000 caractères.');
    if (/[\r\n]/.test(m.objet ?? '')) erreurs.push('L\'objet tient sur une seule ligne.');
    const inconnues = [...new Set([...balisesDe(m.objet ?? ''), ...balisesDe(m.corps ?? '')].filter(b => !PAR_NOM.has(cle(b))))];
    if (inconnues.length) erreurs.push(`Balise(s) inconnue(s) : ${inconnues.map(b => `<<${b}>>`).join(', ')}. Choisissez-les dans la liste.`);
    const reste = `${m.objet ?? ''}\n${m.corps ?? ''}`.replace(MOTIF, '');
    if (reste.includes('<<') || reste.includes('>>')) erreurs.push('Une balise est mal fermée : elle s\'écrit <<Nom de la balise>>.');
    return erreurs;
}

const echapper = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const remplacer = (texte: string, c: ContexteMail) => texte.replace(MOTIF, (_t, nom: string) => PAR_NOM.get(cle(nom))?.valeur(c) ?? '');

/** Mail composé à partir d'un modèle et d'un contexte. */
export function rendre(m: ModeleMail, c: ContexteMail): Mail {
    const sujet = remplacer(m.objet, c).replace(/\s+/g, ' ').trim();
    // Une ligne dont toutes les balises sont vides disparaît.
    const lignes: string[] = [];
    for (const ligne of m.corps.replace(/\r\n?/g, '\n').split('\n')) {
        const noms = balisesDe(ligne);
        if (noms.length && noms.every(n => !(PAR_NOM.get(cle(n))?.valeur(c) ?? ''))) continue;
        lignes.push(remplacer(ligne, c).replace(/[ \t]+$/, ''));
    }
    // Lignes vides resserrées, et aucune en tête ni en fin.
    const texte = lignes.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    const html = texte.split(/\n{2,}/).map(bloc => `<p>${bloc.split('\n').map(l => echapper(l).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')).join('<br>')}</p>`).join('');
    return { sujet, texte, html };
}
