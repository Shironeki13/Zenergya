import type { EcheanceSuivi } from '@/lib/pilotage/suivi-facturation';

/**
 * Pilotage ADV (calcul pur) : les échéances à facturer regroupées en tableau croisé Client → Contrat → Prestation
 * (→ échéances), avec à chaque niveau les montants en retard, du jour et à venir, les blocages et le dernier
 * commentaire de suivi.
 *
 * Une facture de contrat regroupe tout ce qui est facturable à la date : « factures à sortir » = contrats ayant au
 * moins une échéance facturable (en retard ou du jour).
 */

// ── Commentaires de suivi (historisés : on ajoute, on ne modifie ni ne supprime) ─────────────────────────────────

export const MOTIFS = {
    en_cours: 'En cours de traitement',
    attente_client: 'En attente client',
    attente_donnee: 'En attente de relevé / donnée',
    parametrage: 'Paramétrage à corriger',
    litige: 'Litige',
    resolu: 'Résolu',
    note: 'Note',
} as const;
export type Motif = keyof typeof MOTIFS;
export const isMotif = (m: unknown): m is Motif => typeof m === 'string' && Object.hasOwn(MOTIFS, m);

export type CommentaireSuivi = {
    id: string;
    contractId: string;
    /** Prestation visée ; null : le contrat entier. */
    itemKey: string | null;
    /** Libellé de la prestation au moment du commentaire (site — prestation). */
    cible: string;
    motif: Motif;
    texte: string;
    auteur: string;
    createdAt: string;
};

/** Clé d'un fil de commentaires : contrat, ou prestation du contrat. */
export const cleFil = (contractId: string, itemKey?: string | null) => itemKey ? `${contractId}|${itemKey}` : contractId;

/** Dernier commentaire et nombre de commentaires par fil. */
export type ResumeFil = { dernier: CommentaireSuivi; nombre: number };

export function resumerFils(commentaires: CommentaireSuivi[]): Map<string, ResumeFil> {
    const out = new Map<string, ResumeFil>();
    for (const c of commentaires) {
        const k = cleFil(c.contractId, c.itemKey);
        const r = out.get(k);
        if (!r) out.set(k, { dernier: c, nombre: 1 });
        else {
            r.nombre++;
            if (c.createdAt > r.dernier.createdAt) r.dernier = c;
        }
    }
    return out;
}

// ── Tableau croisé ───────────────────────────────────────────────────────────────────────────────────────────────

export type Totaux = {
    /** Échéances en retard (facturables avant aujourd'hui) : nombre et montant connu. */
    retard: number; montantRetard: number;
    /** Facturables aujourd'hui. */
    jour: number; montantJour: number;
    /** À venir dans l'horizon. */
    aVenir: number; montantAVenir: number;
    /** Échéances facturables dont le montant n'est connu qu'à la facture (acompte P1, ECS au relevé). */
    aLaFacture: number;
    /** Échéances facturables bloquées. */
    bloquees: number;
    /** Plus grand retard, en jours (0 : aucun). */
    retardMax: number;
    /** Date facturable la plus ancienne (en retard ou du jour). */
    plusAncienne: string | null;
};

export type NoeudPrestation = { key: string; itemKey: string; site: string; prestation: string; totaux: Totaux; echeances: EcheanceSuivi[]; blocages: string[]; suivi?: ResumeFil };
export type NoeudContrat = { key: string; contractId: string; contractNumber: string; totaux: Totaux; prestations: NoeudPrestation[]; suivi?: ResumeFil };
export type NoeudClient = { key: string; clientId: string; clientName: string; totaux: Totaux; contrats: NoeudContrat[] };

export type Synthese = Totaux & {
    clients: number;
    /** Clients ayant au moins une échéance facturable. */
    clientsAFacturer: number;
    contrats: number;
    /** Factures à sortir maintenant : contrats ayant au moins une échéance facturable. */
    facturesASortir: number;
    /** Dont bloquées : contrats dont une échéance facturable est bloquée. */
    facturesBloquees: number;
};

const vide = (): Totaux => ({ retard: 0, montantRetard: 0, jour: 0, montantJour: 0, aVenir: 0, montantAVenir: 0, aLaFacture: 0, bloquees: 0, retardMax: 0, plusAncienne: null });
const r2 = (n: number) => Math.round(n * 100) / 100;

function ajouter(t: Totaux, e: EcheanceSuivi) {
    const m = e.montant ?? 0;
    if (e.statut === 'retard') { t.retard++; t.montantRetard = r2(t.montantRetard + m); t.retardMax = Math.max(t.retardMax, e.jours); }
    else if (e.statut === 'aujourdhui') { t.jour++; t.montantJour = r2(t.montantJour + m); }
    else { t.aVenir++; t.montantAVenir = r2(t.montantAVenir + m); }
    if (e.statut !== 'a_venir') {
        if (e.montant === null) t.aLaFacture++;
        if (e.blocage) t.bloquees++;
        if (!t.plusAncienne || e.billableOn < t.plusAncienne) t.plusAncienne = e.billableOn;
    }
}

function cumuler(t: Totaux, u: Totaux) {
    t.retard += u.retard; t.montantRetard = r2(t.montantRetard + u.montantRetard);
    t.jour += u.jour; t.montantJour = r2(t.montantJour + u.montantJour);
    t.aVenir += u.aVenir; t.montantAVenir = r2(t.montantAVenir + u.montantAVenir);
    t.aLaFacture += u.aLaFacture; t.bloquees += u.bloquees;
    t.retardMax = Math.max(t.retardMax, u.retardMax);
    if (u.plusAncienne && (!t.plusAncienne || u.plusAncienne < t.plusAncienne)) t.plusAncienne = u.plusAncienne;
}

/** Facturable (en retard ou du jour). */
export const facturable = (t: Totaux) => t.retard + t.jour > 0;

/** Ordre : les plus en retard d'abord (retard max, puis montant en retard), puis les plus proches. */
const urgence = (a: { totaux: Totaux }, b: { totaux: Totaux }) =>
    b.totaux.retardMax - a.totaux.retardMax
    || (b.totaux.montantRetard + b.totaux.montantJour) - (a.totaux.montantRetard + a.totaux.montantJour)
    || (b.totaux.retard + b.totaux.jour) - (a.totaux.retard + a.totaux.jour);

export type Focus = 'tout' | 'retard' | 'bloque';

/**
 * Tableau croisé des échéances. Focus « retard » : seulement les échéances facturables (en retard ou du jour) ;
 * « bloque » : seulement les facturables bloquées. Les commentaires sont rattachés au contrat ou à la prestation.
 */
export function construireTcd(echeances: EcheanceSuivi[], commentaires: CommentaireSuivi[] = [], focus: Focus = 'tout'): { clients: NoeudClient[]; synthese: Synthese } {
    const fils = resumerFils(commentaires);
    const retenues = echeances.filter(e =>
        focus === 'tout' || (e.statut !== 'a_venir' && (focus === 'retard' || !!e.blocage)));
    const clients = new Map<string, NoeudClient>();
    const contrats = new Map<string, NoeudContrat>();
    const prestations = new Map<string, NoeudPrestation>();
    for (const e of retenues) {
        let cl = clients.get(e.clientId);
        if (!cl) clients.set(e.clientId, cl = { key: `c:${e.clientId}`, clientId: e.clientId, clientName: e.clientName, totaux: vide(), contrats: [] });
        let ct = contrats.get(e.contractId);
        if (!ct) {
            contrats.set(e.contractId, ct = { key: `k:${e.contractId}`, contractId: e.contractId, contractNumber: e.contractNumber, totaux: vide(), prestations: [], suivi: fils.get(cleFil(e.contractId)) });
            cl.contrats.push(ct);
        }
        const pk = cleFil(e.contractId, e.itemKey);
        let pr = prestations.get(pk);
        if (!pr) {
            prestations.set(pk, pr = { key: `p:${pk}`, itemKey: e.itemKey, site: e.site, prestation: e.prestation, totaux: vide(), echeances: [], blocages: [], suivi: fils.get(pk) });
            ct.prestations.push(pr);
        }
        pr.echeances.push(e);
        ajouter(pr.totaux, e);
        if (e.blocage && !pr.blocages.includes(e.blocage)) pr.blocages.push(e.blocage);
    }
    for (const ct of contrats.values()) {
        for (const pr of ct.prestations) {
            pr.echeances.sort((a, b) => a.billableOn.localeCompare(b.billableOn));
            cumuler(ct.totaux, pr.totaux);
        }
        ct.prestations.sort((a, b) => urgence(a, b) || a.site.localeCompare(b.site) || a.prestation.localeCompare(b.prestation));
    }
    const synthese: Synthese = { ...vide(), clients: clients.size, clientsAFacturer: 0, contrats: contrats.size, facturesASortir: 0, facturesBloquees: 0 };
    for (const cl of clients.values()) {
        for (const ct of cl.contrats) {
            cumuler(cl.totaux, ct.totaux);
            if (facturable(ct.totaux)) synthese.facturesASortir++;
            if (ct.totaux.bloquees > 0) synthese.facturesBloquees++;
        }
        cl.contrats.sort((a, b) => urgence(a, b) || a.contractNumber.localeCompare(b.contractNumber));
        cumuler(synthese, cl.totaux);
        if (facturable(cl.totaux)) synthese.clientsAFacturer++;
    }
    const liste = [...clients.values()].sort((a, b) => urgence(a, b) || a.clientName.localeCompare(b.clientName));
    return { clients: liste, synthese };
}
