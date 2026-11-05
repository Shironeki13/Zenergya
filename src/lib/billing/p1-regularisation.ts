import { roundCents, sumCents } from '@/lib/money';
import type { InvoiceLineItem } from '@/lib/types';

/**
 * Régularisation P1 d'un contrat sur une période (calcul pur).
 *
 * Pour chaque site : réel P1 du moteur (importé, par mois) − acomptes P1 facturés sur ces mois (détail mensuel des
 * lignes d'acompte des factures non annulées). Un mois déjà régularisé (facture ou avoir de régularisation) ne se
 * régularise pas une seconde fois ; un mois facturé en acompte sans réel importé bloque (rien de supposé).
 * S'y ajoutent les intéressements calculés (écran d'intéressement) dont la saison finit dans la période et qui
 * n'ont pas encore été facturés.
 *
 * Les lignes positives (à facturer au client) forment une facture ; les négatives (en sa faveur) un avoir de
 * régularisation, qui n'annule pas les factures d'acompte.
 */

export type RegulDocument = {
    id: string;
    kind: 'invoice' | 'creditNote';
    status?: string;
    cancelledByCreditNoteId?: string;
    lineItems: Pick<InvoiceLineItem, 'p1Acompte' | 'p1Regul' | 'vatRate'>[];
};

export type RegulInput = {
    mois: string[];
    sites: { id: string; name: string; vatRate?: number; activityCode: string }[];
    /** Réel du moteur par site puis par mois (€ HT). */
    reel: Map<string, Map<string, number>>;
    documents: RegulDocument[];
    interests: { id: string; siteId: string; seasonLabel: string; endDate: string; amount: number }[];
};

export type RegulResult = {
    lines: InvoiceLineItem[];
    errors: string[];
    /** Factures d'acompte concernées (référence de l'avoir). */
    acompteInvoiceIds: string[];
    detail: { siteId: string; site: string; reel: number; acomptes: number; ecart: number }[];
};

const frMois = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
const eur = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function regularisationP1(input: RegulInput): RegulResult {
    const { mois } = input;
    const debut = mois[0];
    const fin = mois[mois.length - 1];
    const errors: string[] = [];
    const lines: InvoiceLineItem[] = [];
    const detail: RegulResult['detail'] = [];
    const acompteInvoiceIds = new Set<string>();
    const valid = input.documents.filter(d => d.status !== 'cancelled' && d.status !== 'proforma' && !d.cancelledByCreditNoteId);

    // Mois déjà régularisés et intéressements déjà facturés.
    const regularises = new Set<string>();
    const interetsFactures = new Set<string>();
    for (const d of valid) for (const l of d.lineItems) {
        if (!l.p1Regul) continue;
        if ('interestId' in l.p1Regul) interetsFactures.add(l.p1Regul.interestId);
        else for (const m of l.p1Regul.mois) regularises.add(`${l.p1Regul.siteId}|${m}`);
    }

    for (const site of input.sites) {
        const deja = mois.filter(m => regularises.has(`${site.id}|${m}`));
        if (deja.length) { errors.push(`Site ${site.name} : ${deja.map(frMois).join(', ')} déjà régularisé(s).`); continue; }
        let vatRate = site.vatRate;
        const acomptesParMois = new Map<string, number[]>();
        for (const d of valid.filter(x => x.kind === 'invoice')) for (const l of d.lineItems) {
            if (l.p1Acompte?.siteId !== site.id) continue;
            for (const am of l.p1Acompte.mois) {
                if (am.mois < debut || am.mois > fin) continue;
                acomptesParMois.set(am.mois, [...(acomptesParMois.get(am.mois) ?? []), am.montant]);
                acompteInvoiceIds.add(d.id);
                vatRate = vatRate ?? l.vatRate;
            }
        }
        const reel = input.reel.get(site.id) ?? new Map<string, number>();
        const manquants = mois.filter(m => acomptesParMois.has(m) && !reel.has(m));
        if (manquants.length) { errors.push(`Site ${site.name} : réel P1 du moteur non importé pour ${manquants.map(frMois).join(', ')}.`); continue; }
        const moisRegul = mois.filter(m => acomptesParMois.has(m) || reel.has(m));
        if (moisRegul.length === 0) continue;
        if (vatRate === undefined) { errors.push(`Site ${site.name} : TVA de la prestation P1 inconnue.`); continue; }
        const totalReel = sumCents(moisRegul.map(m => reel.get(m) ?? 0));
        const totalAcomptes = sumCents(moisRegul.flatMap(m => acomptesParMois.get(m) ?? []));
        const ecart = roundCents(totalReel - totalAcomptes);
        detail.push({ siteId: site.id, site: site.name, reel: totalReel, acomptes: totalAcomptes, ecart });
        lines.push({
            description: `Régularisation P1 — Site : ${site.name} — du ${frMois(moisRegul[0])} au ${frMois(moisRegul[moisRegul.length - 1])} : `
                + `réel ${eur(totalReel)} € − acomptes ${eur(totalAcomptes)} €`,
            quantity: 1, unitPrice: ecart, total: ecart, siteId: site.id, activityCode: site.activityCode, vatRate,
            periodStartDate: `${moisRegul[0]}-01`, periodEndDate: new Date(Date.UTC(+moisRegul[moisRegul.length - 1].slice(0, 4), +moisRegul[moisRegul.length - 1].slice(5, 7), 0)).toISOString().slice(0, 10),
            p1Regul: { siteId: site.id, mois: moisRegul, reel: totalReel, acomptes: totalAcomptes },
        });
    }

    for (const i of input.interests) {
        if (interetsFactures.has(i.id) || i.endDate.slice(0, 7) < debut || i.endDate.slice(0, 7) > fin) continue;
        const site = input.sites.find(s => s.id === i.siteId);
        if (!site) continue;
        const vatRate = site.vatRate ?? lines.find(l => l.siteId === site.id)?.vatRate;
        if (vatRate === undefined) { errors.push(`Intéressement ${i.seasonLabel} (site ${site.name}) : TVA inconnue.`); continue; }
        const amount = roundCents(i.amount);
        if (amount === 0) continue;
        lines.push({
            description: `Intéressement P1 — Site : ${site.name} — saison ${i.seasonLabel}`,
            quantity: 1, unitPrice: amount, total: amount, siteId: site.id, activityCode: site.activityCode, vatRate,
            p1Regul: { siteId: site.id, interestId: i.id },
        });
    }
    return { lines: lines.filter(l => l.total !== 0), errors, acompteInvoiceIds: [...acompteInvoiceIds], detail };
}
