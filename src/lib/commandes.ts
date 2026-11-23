import { roundCents, sumCents } from '@/lib/money';
import type { AnalytiqueLigne } from '@/lib/analytique';

/**
 * Commandes d'achat (logique pure) : lignes affectées à un code analytique (affaire de travaux ou prestation d'un
 * contrat), circuit de validation à seuils, états. L'engagé d'un code est la somme de ses commandes validées ; le réel,
 * les montants facturés par les fournisseurs.
 *
 * Circuit, selon le total HT de la commande et les seuils de la société :
 * - jusqu'au seuil d'autovalidation : validée à la soumission ;
 * - au-delà : validation du responsable du demandeur (N+1) ;
 * - au-delà du seuil N+2 : en plus, validation du responsable du N+1 ;
 * - au-delà du seuil « achats » : en plus, validation d'un acheteur.
 * Les étapes se suivent dans cet ordre. Un administrateur peut valider toute étape (secours), jamais sa propre commande.
 */

export const NATURES_ACHAT = ['FOURNITURE', 'SOUS_TRAITANCE', 'DIVERS'] as const;
export type NatureAchat = typeof NATURES_ACHAT[number];
export const LIBELLE_NATURE_ACHAT: Record<NatureAchat, string> = { FOURNITURE: 'Fournitures', SOUS_TRAITANCE: 'Sous-traitance', DIVERS: 'Divers' };

/** Affectation d'une ligne : une affaire de travaux, ou une prestation (activité) d'un contrat. */
export type CibleCommande = { type: 'affaire'; projectId: string; libelle?: string } | { type: 'contrat'; contractId: string; serviceId?: string; activityCode?: string; libelle?: string };

export type LigneCommande = {
    id: string;
    label: string;
    quantity: number;
    unitPrice: number;
    total: number;
    nature: NatureAchat;
    cible: CibleCommande;
    /** Analytique figée à la soumission de la commande. */
    analytique?: AnalytiqueLigne | null;
};

export const STATUTS_COMMANDE = ['brouillon', 'a_valider', 'refusee', 'validee', 'passee', 'recue', 'soldee', 'annulee'] as const;
export type StatutCommande = typeof STATUTS_COMMANDE[number];
export const LIBELLE_STATUT: Record<StatutCommande, string> = {
    brouillon: 'Brouillon', a_valider: 'À valider', refusee: 'Refusée', validee: 'Validée', passee: 'Passée au fournisseur', recue: 'Reçue', soldee: 'Soldée', annulee: 'Annulée',
};
/** États qui comptent dans l'engagé d'un code analytique. */
export const STATUTS_ENGAGES: readonly StatutCommande[] = ['validee', 'passee', 'recue', 'soldee'];

/** Étape de validation : un niveau de la hiérarchie du demandeur (`n1`, `n2`, `n3`…) ou les achats. */
export type RoleEtape = `n${number}` | 'achats';
export const libelleEtape = (role: RoleEtape): string => (role === 'achats' ? 'Achats' : role === 'n1' ? 'Responsable (N+1)' : `Responsable N+${role.slice(1)}`);
export type EtapeValidation = {
    role: RoleEtape;
    /** Valideur attendu (N+1, N+2…) ; absent pour l'étape achats (tout acheteur). */
    approverId?: string; approverName?: string;
    /** Plafond de validation du valideur à la soumission (traçabilité). */
    plafond?: number;
    decision?: 'validee' | 'refusee';
    decidePar?: string; decideParNom?: string; decideLe?: string; commentaire?: string;
    /** Validée par un administrateur à la place du valideur attendu. */
    secours?: boolean;
};

export type FactureFournisseur = { id: string; numero: string; date: string; montantHT: number; saisiPar?: string; saisiLe: string };

export type Commande = {
    id: string;
    number?: string;                 // {CODE}-CMD{AAAA}-{NNNN}, attribué à la soumission
    companyId: string;
    supplierId: string; supplierName: string;
    title: string;
    date: string;                    // AAAA-MM-JJ
    deliveryDate?: string;
    notes?: string;
    lines: LigneCommande[];
    totalHT: number;
    status: StatutCommande;
    requesterId: string; requesterName: string; requesterEmail: string;
    etapes: EtapeValidation[];
    /** Seuils appliqués à la soumission (traçabilité). */
    seuils?: SeuilsValidation;
    autoValidee?: boolean;
    submittedAt?: string; validatedAt?: string; passedAt?: string; receivedAt?: string; cancelledAt?: string; cancelReason?: string;
    factures?: FactureFournisseur[];
    /** Import : référence de la commande dans l'outil d'origine (évite le double import) ; `importee` : validée hors Zenergya, sans circuit. */
    externalRef?: string;
    importee?: boolean; importedBy?: string;
    createdAt: string; updatedAt: string;
};

/**
 * Seuils en € HT, par société.
 * - `auto` : montant d'autovalidation **par défaut** — celui d'un utilisateur qui n'a pas le sien ;
 * - `n2` : plafond de validation **par défaut** — celui d'un valideur qui n'a pas le sien ;
 * - `achats` : seuil global au-delà duquel les achats valident aussi.
 * Chaque utilisateur peut avoir son montant d'autovalidation et, s'il valide, son plafond (fiche utilisateur).
 */
export type SeuilsValidation = { auto: number; n2: number; achats: number };
export const SEUILS_DEFAUT: SeuilsValidation = { auto: 500, n2: 5000, achats: 10000 };

export function controleSeuils(s: SeuilsValidation): string | null {
    if (![s.auto, s.n2, s.achats].every(v => Number.isFinite(v) && v >= 0)) return 'Seuils : montants positifs ou nuls.';
    if (s.n2 < s.auto) return 'Le plafond de validation par défaut ne peut pas être inférieur au montant d\'autovalidation par défaut.';
    return null;
}

export const totalLigne = (l: Pick<LigneCommande, 'quantity' | 'unitPrice'>) => roundCents(l.quantity * l.unitPrice);
export const totalCommande = (lines: Pick<LigneCommande, 'quantity' | 'unitPrice'>[]) => sumCents(lines.map(totalLigne));

/** Utilisateur dans la hiérarchie : son responsable, son montant d'autovalidation et son plafond de validation (facultatifs). */
export type Hierarchie = { id: string; name: string; managerId?: string | null; autoValidationLimit?: number | null; validationLimit?: number | null };

const montant = (propre: number | null | undefined, defaut: number) => (typeof propre === 'number' && Number.isFinite(propre) && propre >= 0 ? propre : defaut);
/** Montant jusqu'auquel l'utilisateur valide lui-même ses commandes : le sien, sinon celui de la société. */
export const autovalidationDe = (u: Pick<Hierarchie, 'autoValidationLimit'>, s: SeuilsValidation) => montant(u.autoValidationLimit, s.auto);
/** Plafond jusqu'auquel l'utilisateur valide les commandes des autres : le sien, sinon celui de la société. */
export const plafondDe = (u: Pick<Hierarchie, 'validationLimit'>, s: SeuilsValidation) => montant(u.validationLimit, s.n2);

const eur = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/**
 * Étapes d'une commande à sa soumission.
 * - Jusqu'à son montant d'autovalidation, le demandeur valide lui-même.
 * - Au-delà : son responsable (N+1) valide **toujours** ; si le plafond du N+1 ne couvre pas le total, la commande monte
 *   au N+2, et ainsi de suite jusqu'à un valideur dont le plafond suffit.
 * - Au-delà du seuil global des achats, un acheteur valide en dernier, quel que soit le reste du circuit.
 * Renvoie un message si un responsable manque ou si personne, en haut de la hiérarchie, n'a un plafond suffisant.
 */
export function etapesPour(total: number, seuils: SeuilsValidation, demandeur: Hierarchie, utilisateurs: Hierarchie[]): EtapeValidation[] | string {
    const parId = new Map(utilisateurs.map(u => [u.id, u]));
    const etapes: EtapeValidation[] = [];
    if (total > autovalidationDe(demandeur, seuils)) {
        const vus = new Set([demandeur.id]);
        let courant = demandeur;
        for (let niveau = 1; ; niveau++) {
            const chef = courant.managerId ? parId.get(courant.managerId) : undefined;
            if (!chef || vus.has(chef.id)) {
                if (niveau === 1) return `Responsable (N+1) de ${demandeur.name} non renseigné : à compléter dans Utilisateurs.`;
                return `Aucun valideur n'a un plafond suffisant pour ${eur(total)} : ${courant.name}, en haut de la hiérarchie, valide jusqu'à ${eur(plafondDe(courant, seuils))}. Relevez son plafond de validation (Utilisateurs) ou renseignez son responsable.`;
            }
            vus.add(chef.id);
            const plafond = plafondDe(chef, seuils);
            etapes.push({ role: `n${niveau}`, approverId: chef.id, approverName: chef.name, plafond });
            if (plafond >= total) break;
            courant = chef;
        }
    }
    if (total > seuils.achats) etapes.push({ role: 'achats' });
    return etapes;
}

/** Prochaine étape à décider (les étapes se suivent) ; null si tout est validé ou si une étape est refusée. */
export function etapeEnCours(c: Pick<Commande, 'status' | 'etapes'>): EtapeValidation | null {
    if (c.status !== 'a_valider') return null;
    return c.etapes.find(e => !e.decision) ?? null;
}

export type Valideur = { id: string; isAdmin?: boolean; isAcheteur?: boolean };

/** L'utilisateur peut-il décider l'étape en cours ? Jamais sa propre commande. */
export function peutDecider(c: Pick<Commande, 'status' | 'etapes' | 'requesterId'>, u: Valideur): { ok: boolean; secours?: boolean; raison?: string } {
    const e = etapeEnCours(c);
    if (!e) return { ok: false, raison: 'Aucune validation en attente sur cette commande.' };
    if (u.id === c.requesterId) return { ok: false, raison: 'On ne valide pas sa propre commande.' };
    if (e.role === 'achats' ? u.isAcheteur : e.approverId === u.id) return { ok: true };
    if (u.isAdmin) return { ok: true, secours: true };
    return { ok: false, raison: e.role === 'achats' ? 'Étape réservée aux achats.' : `Étape à valider par ${e.approverName ?? 'le responsable'}.` };
}

/** Applique une décision à l'étape en cours ; renvoie les étapes et le statut qui en résulte. */
export function decider(c: Pick<Commande, 'status' | 'etapes' | 'requesterId'>, u: Valideur & { name?: string }, decision: 'validee' | 'refusee', commentaire: string, le: string):
    { etapes: EtapeValidation[]; status: StatutCommande } | string {
    const droit = peutDecider(c, u);
    if (!droit.ok) return droit.raison!;
    if (decision === 'refusee' && !commentaire.trim()) return 'Motif du refus obligatoire.';
    const courante = etapeEnCours(c)!;
    const etapes = c.etapes.map(e => (e === courante ? {
        ...e, decision, decidePar: u.id, ...(u.name && { decideParNom: u.name }), decideLe: le,
        ...(commentaire.trim() && { commentaire: commentaire.trim() }), ...(droit.secours && { secours: true }),
    } : e));
    const status: StatutCommande = decision === 'refusee' ? 'refusee' : etapes.every(e => e.decision === 'validee') ? 'validee' : 'a_valider';
    return { etapes, status };
}

/** Transitions manuelles après validation. */
export const SUITE: Partial<Record<StatutCommande, StatutCommande>> = { validee: 'passee', passee: 'recue' };
export const modifiable = (s: StatutCommande) => s === 'brouillon' || s === 'refusee';
export const annulable = (s: StatutCommande) => !['annulee', 'soldee'].includes(s);

export const factureHT = (c: Pick<Commande, 'factures'>) => sumCents((c.factures ?? []).map(f => f.montantHT));

/** Engagé et réel par code analytique et par nature, à partir des commandes. */
export type Engagement = { engage: number; reel: number; enValidation: number };
export function engagements(commandes: Pick<Commande, 'status' | 'lines' | 'totalHT' | 'factures'>[], filtre: (l: LigneCommande) => boolean): Record<NatureAchat, Engagement> & { total: Engagement } {
    const vide = (): Engagement => ({ engage: 0, reel: 0, enValidation: 0 });
    const out = { FOURNITURE: vide(), SOUS_TRAITANCE: vide(), DIVERS: vide(), total: vide() };
    for (const c of commandes) {
        const engagee = STATUTS_ENGAGES.includes(c.status);
        // Réel : montant facturé par le fournisseur, réparti sur les lignes au prorata de leur total.
        const reel = factureHT(c);
        for (const l of c.lines.filter(filtre)) {
            const part = c.totalHT ? roundCents(reel * (l.total / c.totalHT)) : 0;
            for (const cible of [out[l.nature], out.total]) {
                if (engagee) { cible.engage = roundCents(cible.engage + l.total); cible.reel = roundCents(cible.reel + part); }
                else if (c.status === 'a_valider') cible.enValidation = roundCents(cible.enValidation + l.total);
            }
        }
    }
    return out;
}
