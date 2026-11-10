import { roundCents } from '@/lib/money';
import { NATURES_ACHAT, totalCommande, type NatureAchat } from '@/lib/commandes';
import { estJour, jourImport, norme } from '@/lib/heures';

/**
 * Import de commandes d'achat saisies dans un autre outil (logique pure) : une ligne de fichier par ligne de commande ;
 * les lignes portant la même « Référence » forment une commande. Les références (fournisseur, demandeur, affaire,
 * contrat) sont résolues côté serveur.
 */

export const ETATS_IMPORT = ['brouillon', 'validee'] as const;
export type EtatImport = typeof ETATS_IMPORT[number];

export const COLONNES_IMPORT_COMMANDES = [
    { cle: 'reference', libelle: 'Référence', obligatoire: true, aide: 'numéro de la commande dans votre outil : les lignes de même référence forment une commande', alias: ['ref', 'reference commande', 'numero', 'n commande', 'numero de commande'] },
    { cle: 'date', libelle: 'Date', obligatoire: true, aide: 'AAAA-MM-JJ ou JJ/MM/AAAA', alias: ['date de commande'] },
    { cle: 'fournisseur', libelle: 'Fournisseur', obligatoire: true, aide: 'code (FRN-00001) ou nom exact du fournisseur', alias: ['code fournisseur', 'nom fournisseur'] },
    { cle: 'objet', libelle: 'Objet', obligatoire: true, aide: 'objet de la commande', alias: ['titre', 'intitule'] },
    { cle: 'demandeur', libelle: 'Demandeur (email)', obligatoire: false, aide: 'email de l\'utilisateur Zenergya ; vide : vous', alias: ['demandeur', 'email', 'acheteur'] },
    { cle: 'etat', libelle: 'État', obligatoire: false, aide: '« brouillon » (défaut : à soumettre au circuit de validation) ou « validée » (déjà validée hors Zenergya ; réservé aux achats et aux administrateurs)', alias: ['etat', 'statut'] },
    { cle: 'designation', libelle: 'Désignation', obligatoire: true, aide: 'désignation de la ligne', alias: ['libelle', 'article', 'description'] },
    { cle: 'nature', libelle: 'Nature', obligatoire: true, aide: 'Fournitures, Sous-traitance ou Divers', alias: ['type'] },
    { cle: 'quantite', libelle: 'Quantité', obligatoire: true, aide: 'strictement positive', alias: ['qte', 'quantite commandee'] },
    { cle: 'prix', libelle: 'Prix unitaire HT', obligatoire: true, aide: 'en euros, hors taxes', alias: ['pu ht', 'pu', 'prix unitaire', 'prix'] },
    { cle: 'affaire', libelle: 'Affaire', obligatoire: false, aide: 'code de l\'affaire (ex. ZEN-AFF2026-0003) ; sinon contrat et activité', alias: ['code affaire'] },
    { cle: 'contrat', libelle: 'Contrat', obligatoire: false, aide: 'numéro du contrat (ex. CTN-00001), si pas d\'affaire', alias: ['numero de contrat', 'n contrat'] },
    { cle: 'activite', libelle: 'Activité', obligatoire: false, aide: 'code de l\'activité du contrat (ex. P2)', alias: ['code activite'] },
    { cle: 'livraison', libelle: 'Livraison souhaitée', obligatoire: false, aide: 'date, facultative', alias: ['date de livraison', 'livraison'] },
] as const;
type Cle = typeof COLONNES_IMPORT_COMMANDES[number]['cle'];

const NATURE: Record<string, NatureAchat> = {
    fourniture: 'FOURNITURE', fournitures: 'FOURNITURE', materiel: 'FOURNITURE', 'sous traitance': 'SOUS_TRAITANCE', soustraitance: 'SOUS_TRAITANCE', st: 'SOUS_TRAITANCE', divers: 'DIVERS', autre: 'DIVERS',
    ...Object.fromEntries(NATURES_ACHAT.map(n => [norme(n), n])),
};
const ETAT: Record<string, EtatImport> = { '': 'brouillon', brouillon: 'brouillon', validee: 'validee', valide: 'validee', passee: 'validee' };
const nombre = (v: string) => (v.trim() === '' ? NaN : Number(v.replace(/[\s  €]/g, '').replace(',', '.')));

export type LigneImportCommande = { ligne: number; label: string; nature: NatureAchat | null; quantity: number; unitPrice: number; affaire: string; contrat: string; activite: string; erreurs: string[] };
export type CommandeImportee = {
    reference: string; ligne: number;
    date: string; fournisseur: string; objet: string; demandeur: string; etat: EtatImport | null; livraison: string;
    lignes: LigneImportCommande[];
    totalHT: number;
    erreurs: string[];
};

/** Lit un tableau (première ligne : en-têtes) et regroupe les lignes par référence ; contrôle la forme. */
export function lireImportCommandes(table: unknown[][]): { commandes: CommandeImportee[]; erreur?: string } {
    const entetes = (table[0] ?? []).map(norme);
    const index = {} as Record<Cle, number>;
    for (const c of COLONNES_IMPORT_COMMANDES) index[c.cle] = entetes.findIndex(e => e === norme(c.libelle) || e === c.cle || (c.alias as readonly string[]).includes(e));
    const manquantes = COLONNES_IMPORT_COMMANDES.filter(c => c.obligatoire && index[c.cle] < 0).map(c => c.libelle);
    if (manquantes.length) return { commandes: [], erreur: `Colonne(s) manquante(s) : ${manquantes.join(', ')}.` };
    if (index.affaire < 0 && index.contrat < 0) return { commandes: [], erreur: 'Colonne « Affaire » ou « Contrat » attendue.' };
    const cellule = (r: unknown[], c: Cle) => (index[c] < 0 ? '' : String(r[index[c]] ?? '').trim());
    const par = new Map<string, CommandeImportee>();
    const sansReference: number[] = [];
    table.slice(1).forEach((r, i) => {
        if (!r || r.every(x => String(x ?? '').trim() === '')) return;
        const n = i + 2;
        const reference = cellule(r, 'reference');
        if (!reference) { sansReference.push(n); return; }
        const entete = { date: jourImport(cellule(r, 'date')), fournisseur: cellule(r, 'fournisseur'), objet: cellule(r, 'objet'), demandeur: cellule(r, 'demandeur').toLowerCase(), etat: ETAT[norme(cellule(r, 'etat'))] ?? null, livraison: cellule(r, 'livraison') ? jourImport(cellule(r, 'livraison')) : '' };
        let c = par.get(reference.toUpperCase());
        if (!c) {
            c = { reference, ligne: n, ...entete, lignes: [], totalHT: 0, erreurs: [] };
            if (!entete.date) c.erreurs.push('date illisible');
            if (!entete.fournisseur) c.erreurs.push('fournisseur manquant');
            if (!entete.objet) c.erreurs.push('objet manquant');
            if (entete.etat === null) c.erreurs.push(`état inconnu : « ${cellule(r, 'etat')} » (brouillon ou validée)`);
            if (cellule(r, 'livraison') && !estJour(entete.livraison)) c.erreurs.push('date de livraison illisible');
            par.set(reference.toUpperCase(), c);
        } else {
            // Les lignes suivantes peuvent laisser l'en-tête vide ; s'il est rempli, il doit être le même.
            const ecarts = ([['date', 'date'], ['fournisseur', 'fournisseur'], ['objet', 'objet'], ['demandeur', 'demandeur']] as const)
                .filter(([k, col]) => cellule(r, col) && (k === 'fournisseur' || k === 'objet' ? norme(entete[k]) !== norme(c![k]) : entete[k] !== c![k])).map(([, col]) => col);
            if (ecarts.length) c.erreurs.push(`ligne ${n} : ${ecarts.join(', ')} différent(s) de la première ligne de la commande`);
        }
        const erreurs: string[] = [];
        const label = cellule(r, 'designation');
        const nature = NATURE[norme(cellule(r, 'nature'))] ?? null;
        const [quantity, unitPrice] = [nombre(cellule(r, 'quantite')), nombre(cellule(r, 'prix'))];
        const [affaire, contrat, activite] = [cellule(r, 'affaire'), cellule(r, 'contrat'), cellule(r, 'activite')];
        if (!label) erreurs.push('désignation manquante');
        if (!nature) erreurs.push(`nature inconnue : « ${cellule(r, 'nature')} » (Fournitures, Sous-traitance, Divers)`);
        if (!(quantity > 0)) erreurs.push('quantité strictement positive');
        if (!(unitPrice >= 0)) erreurs.push('prix unitaire HT invalide');
        if (!affaire && !contrat) erreurs.push('affaire ou contrat à renseigner');
        if (affaire && contrat) erreurs.push('affaire OU contrat, pas les deux');
        if (contrat && !activite) erreurs.push('activité du contrat à renseigner');
        c.lignes.push({ ligne: n, label, nature, quantity, unitPrice, affaire, contrat, activite, erreurs });
    });
    if (sansReference.length) return { commandes: [], erreur: `Référence manquante (ligne${sansReference.length > 1 ? 's' : ''} ${sansReference.slice(0, 10).join(', ')}${sansReference.length > 10 ? '…' : ''}).` };
    const commandes = [...par.values()];
    for (const c of commandes) c.totalHT = c.lignes.every(l => l.quantity > 0 && l.unitPrice >= 0) ? totalCommande(c.lignes) : roundCents(0);
    if (!commandes.length) return { commandes, erreur: 'Aucune ligne à importer.' };
    return { commandes };
}
