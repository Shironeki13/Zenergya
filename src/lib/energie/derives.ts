/**
 * Dérives P1 : les sites dont la marge P1 (P1 facturé face aux factures du fournisseur d'énergie) se dégrade, sur les
 * douze derniers mois, comparée à la même période un an plus tôt et au budget du contrat.
 *
 * Pour aider à comprendre : variation du prix moyen d'achat (€ par unité facturée par le fournisseur), de la quantité
 * achetée et des ventes P1, sur les mois complets (ventes et achats connus). Module sans dépendance serveur.
 */
import type { MargeP1 } from './marge';

export type SeuilsDerive = {
    /** Taux de marge P1 en dessous duquel un site est signalé (%). */
    tauxMin: number;
    /** Perte de taux de marge par rapport à l'an dernier au-delà de laquelle un site est signalé (points). */
    baisseN1: number;
    /** Écart au taux de marge budgété au-delà duquel un site est signalé (points). */
    ecartBudget: number;
    /** Nombre de mois complets en dessous duquel la marge n'est pas jugée (trop peu de données). */
    moisMin: number;
};
export const SEUILS_DEFAUT: SeuilsDerive = { tauxMin: 10, baisseN1: 10, ecartBudget: 5, moisMin: 3 };

export function controleSeuils(s: Partial<SeuilsDerive>): SeuilsDerive {
    const lire = (k: keyof SeuilsDerive, min: number, max: number) => {
        const v = Number(s[k] ?? SEUILS_DEFAUT[k]);
        if (!Number.isFinite(v) || v < min || v > max) throw new Error(`Seuil « ${k} » : entre ${min} et ${max}.`);
        return Math.round(v * 10) / 10;
    };
    return { tauxMin: lire('tauxMin', -100, 100), baisseN1: lire('baisseN1', 0, 100), ecartBudget: lire('ecartBudget', 0, 100), moisMin: Math.round(lire('moisMin', 1, 12)) };
}

export type Variation = { actuel: number | null; precedent: number | null; ecart: number | null };
export type Gravite = 'forte' | 'attention';
export type AnalyseDerive = {
    taux: number | null;
    tauxN1: number | null;
    /** Points de taux gagnés (+) ou perdus (−) par rapport à l'an dernier. */
    ecartN1: number | null;
    tauxBudget: number | null;
    ecartBudget: number | null;
    /** Variations en % : prix moyen d'achat, quantité achetée, ventes P1. */
    prixAchat: Variation; quantite: Variation; ventes: Variation;
    motifs: string[];
    gravite: Gravite | null;
    /** Explication la plus probable de la dérive, en clair. */
    cause: string | null;
};

const r1 = (n: number) => Math.round(n * 10) / 10;
/** Nombre à la française dans les textes (virgule décimale, signe moins simple). */
const fr = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 }).replace(/\u2212/g, '-').replace(/[\u202f\u00a0]/g, ' ');
const variation = (a: number | null, p: number | null): Variation => ({ actuel: a, precedent: p, ecart: a !== null && p !== null && p !== 0 ? r1(((a - p) / Math.abs(p)) * 100) : null });
const quantiteComplets = (m: MargeP1) => m.mois.filter(x => x.complet).reduce((s, x) => s + x.quantite, 0);

/** Taux de marge budgété d'après les montants du budget P1 (CA et énergie) ; null sans CA budgété. */
export const tauxBudget = (ca: number, energie: number) => (ca > 0 ? r1(((ca - energie) / ca) * 100) : null);

export function analyserDerive(actuel: MargeP1, precedent: MargeP1 | null, budget: number | null, s: SeuilsDerive = SEUILS_DEFAUT): AnalyseDerive {
    const jugeable = actuel.moisComplets >= s.moisMin && actuel.taux !== null;
    const tauxN1 = precedent && precedent.moisComplets >= s.moisMin ? precedent.taux : null;
    const ecartN1 = jugeable && tauxN1 !== null ? r1(actuel.taux! - tauxN1) : null;
    const ecartBudget = jugeable && budget !== null ? r1(actuel.taux! - budget) : null;
    const qA = quantiteComplets(actuel), qP = precedent ? quantiteComplets(precedent) : 0;
    const prixAchat = variation(qA > 0 ? actuel.achats / qA : null, precedent && qP > 0 ? precedent.achats / qP : null);
    const quantite = variation(qA > 0 ? qA : null, qP > 0 ? qP : null);
    const ventes = variation(actuel.moisComplets ? actuel.ventes : null, precedent?.moisComplets ? precedent.ventes : null);
    const motifs: string[] = [];
    if (jugeable) {
        if (actuel.taux! < 0) motifs.push(`Marge négative (${fr(actuel.taux!)} %)`);
        else if (actuel.taux! < s.tauxMin) motifs.push(`Marge sous ${fr(s.tauxMin)} % (${fr(actuel.taux!)} %)`);
        if (ecartN1 !== null && ecartN1 <= -s.baisseN1) motifs.push(`${fr(ecartN1)} points par rapport à l'an dernier`);
        if (ecartBudget !== null && ecartBudget <= -s.ecartBudget) motifs.push(`${fr(ecartBudget)} points par rapport au budget`);
    }
    const gravite: Gravite | null = !motifs.length ? null : (actuel.taux ?? 0) < 0 || motifs.length >= 2 ? 'forte' : 'attention';
    // Cause : ce qui a le plus bougé, du côté des achats (prix, quantité) ou des ventes.
    let cause: string | null = null;
    if (gravite) {
        const candidats: [number, string][] = [];
        if (prixAchat.ecart !== null && prixAchat.ecart > 3) candidats.push([prixAchat.ecart, `prix d'achat de l'énergie en hausse de ${fr(prixAchat.ecart)} %`]);
        if (quantite.ecart !== null && quantite.ecart > 3 && (ventes.ecart === null || ventes.ecart < quantite.ecart - 3)) candidats.push([quantite.ecart - (ventes.ecart ?? 0), `consommation en hausse de ${fr(quantite.ecart)} % sans hausse équivalente des ventes`]);
        if (ventes.ecart !== null && ventes.ecart < -3) candidats.push([-ventes.ecart, `P1 facturé en baisse de ${fr(-ventes.ecart)} %`]);
        candidats.sort((a, b) => b[0] - a[0]);
        cause = candidats[0]?.[1] ?? (tauxN1 === null ? 'pas d\'historique sur l\'an dernier pour comparer' : 'ni le prix, ni la consommation, ni les ventes ne varient nettement : vérifier le paramétrage P1 du site');
    }
    return { taux: jugeable ? actuel.taux : null, tauxN1, ecartN1, tauxBudget: budget, ecartBudget, prixAchat, quantite, ventes, motifs, gravite, cause };
}

/** Fenêtre précédente : la même, un an plus tôt (AAAA-MM). */
export const unAnAvant = (m: string) => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;

/** Sites entrés en dérive depuis le dernier passage (pour le mail récapitulatif). */
export const nouveauxEnDerive = (enDerive: string[], precedents: string[]) => enDerive.filter(id => !precedents.includes(id));
