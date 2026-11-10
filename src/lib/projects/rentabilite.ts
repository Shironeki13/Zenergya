import { roundCents, sumCents } from '@/lib/money';
import { engagements, type Commande } from '@/lib/commandes';
import { totalHeures, type SaisieHeures } from '@/lib/heures';
import type { ComponentKind } from '@/lib/quotes/types';
import { NATURES, type BudgetDevis } from './affaire';

/**
 * Rentabilité d'une affaire de travaux (logique pure), par nature de dépense :
 * - **prévu** : déboursé des devis de l'affaire ;
 * - **engagé** : commandes validées affectées à l'affaire (les commandes à valider sont à part) ; pour la main-d'œuvre,
 *   les heures saisies (une heure faite est une dépense faite) ;
 * - **réel** : factures des fournisseurs sur ces commandes ; coût des heures saisies ;
 * - **facturé** : ventes HT facturées au client.
 * Le **coût à terminaison** retient, nature par nature, le plus grand du prévu et de l'engagé : tant qu'une nature n'a
 * pas dépassé son budget on suppose qu'il sera consommé ; dès qu'elle le dépasse, le dépassement réduit la marge.
 */

export type LigneRentabilite = {
    nature: ComponentKind;
    prevu: number; engage: number; reel: number; enValidation: number;
    /** Prévu − engagé : reste à engager (négatif : dépassement). */
    reste: number;
    depassement: boolean;
};

export type Rentabilite = {
    lignes: LigneRentabilite[];
    total: Omit<LigneRentabilite, 'nature'>;
    heuresPrevues: number; heuresReelles: number;
    vente: number; facture: number; resteAFacturer: number;
    margePrevue: number; tauxMargePrevue: number | null;
    coutATerminaison: number; margeATerminaison: number; tauxMargeATerminaison: number | null;
    /** Écart de marge entre la terminaison et le prévu (négatif : la marge se dégrade). */
    ecartMarge: number;
    /** Facturé − réel : résultat constaté à ce jour. */
    resultatADate: number;
    alertes: string[];
};

const LIB: Record<ComponentKind, string> = { FOURNITURE: 'Fournitures', MAIN_OEUVRE: "Main-d'œuvre", SOUS_TRAITANCE: 'Sous-traitance', DIVERS: 'Divers' };
const eur = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const taux = (marge: number, vente: number) => (vente > 0 ? Math.round((marge / vente) * 10000) / 10000 : null);

export function rentabilite(p: {
    projectId: string;
    /** Budget des devis ; absent (affaire antérieure) : pas de prévu, la vente est le montant du marché. */
    budget?: BudgetDevis | null;
    vente?: number;
    commandes: Pick<Commande, 'status' | 'lines' | 'totalHT' | 'factures'>[];
    heures: Pick<SaisieHeures, 'hours' | 'cost'>[];
    facture: number;
}): Rentabilite {
    const achats = engagements(p.commandes, l => l.cible.type === 'affaire' && l.cible.projectId === p.projectId);
    const mo = totalHeures(p.heures);
    const lignes: LigneRentabilite[] = NATURES.map(nature => {
        const prevu = p.budget?.parNature?.[nature] ?? 0;
        const e = nature === 'MAIN_OEUVRE' ? { engage: mo.cout, reel: mo.cout, enValidation: 0 } : achats[nature];
        const reste = roundCents(prevu - e.engage);
        return { nature, prevu, ...e, reste, depassement: reste < 0 };
    });
    const somme = (c: 'prevu' | 'engage' | 'reel' | 'enValidation') => sumCents(lignes.map(l => l[c]));
    const total = { prevu: somme('prevu'), engage: somme('engage'), reel: somme('reel'), enValidation: somme('enValidation'), reste: 0, depassement: false };
    total.reste = roundCents(total.prevu - total.engage);
    total.depassement = total.reste < 0;
    const vente = p.budget?.vente ?? p.vente ?? 0;
    const margePrevue = roundCents(vente - total.prevu);
    const coutATerminaison = sumCents(lignes.map(l => Math.max(l.prevu, l.engage)));
    const margeATerminaison = roundCents(vente - coutATerminaison);
    const heuresPrevues = p.budget?.heures ?? 0;
    const alertes: string[] = [];
    if (p.budget) {
        for (const l of lignes.filter(x => x.depassement)) alertes.push(`${LIB[l.nature]} : ${eur(l.engage)} engagés pour ${eur(l.prevu)} prévus (dépassement de ${eur(-l.reste)}).`);
        if (mo.heures > heuresPrevues && !lignes.find(l => l.nature === 'MAIN_OEUVRE')!.depassement) alertes.push(`Heures : ${mo.heures.toLocaleString('fr-FR')} h saisies pour ${heuresPrevues.toLocaleString('fr-FR')} h prévues.`);
        if (margeATerminaison < 0) alertes.push(`Marge à terminaison négative : ${eur(margeATerminaison)}.`);
    }
    for (const l of lignes.filter(x => x.reel > x.engage)) alertes.push(`${LIB[l.nature]} : factures fournisseurs (${eur(l.reel)}) supérieures aux commandes (${eur(l.engage)}).`);
    return {
        lignes, total, heuresPrevues, heuresReelles: mo.heures,
        vente, facture: p.facture, resteAFacturer: roundCents(vente - p.facture),
        margePrevue, tauxMargePrevue: taux(margePrevue, vente),
        coutATerminaison, margeATerminaison, tauxMargeATerminaison: taux(margeATerminaison, vente),
        ecartMarge: roundCents(margeATerminaison - margePrevue),
        resultatADate: roundCents(p.facture - total.reel),
        alertes,
    };
}
