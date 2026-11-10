import { roundCents, sumCents } from '@/lib/money';
import type { InvoiceLineItem } from '@/lib/types';

/**
 * Régularisation P1 d'un contrat sur une période (calcul pur).
 *
 * Pour chaque site : réel P1 du moteur (importé, par mois) − acomptes P1 facturés sur ces mois (détail mensuel des
 * lignes d'acompte des factures non annulées). Le réel s'importe soit **au total** (chauffage, ECS et annexes : une
 * ligne par site, à condition que les acomptes du site aient une seule TVA), soit **par usage** (chauffage, ECS :
 * une ligne par usage, à sa TVA) ; mélanger les deux sur une période est refusé.
 * Un mois déjà régularisé (facture ou avoir de régularisation) ne se régularise pas une seconde fois ; un mois
 * facturé en acompte sans réel importé bloque (rien de supposé). S'y ajoutent les intéressements calculés (écran
 * d'intéressement) dont la saison finit dans la période et qui n'ont pas encore été facturés.
 *
 * Les lignes positives (à facturer au client) forment une facture ; les négatives (en sa faveur) un avoir de
 * régularisation, qui n'annule pas les factures d'acompte.
 */

export type UsageReel = 'total' | 'chauffage' | 'ecs';
export type UsageP1 = 'chauffage' | 'ecs';

export type RegulDocument = {
    id: string;
    kind: 'invoice' | 'creditNote';
    status?: string;
    cancelledByCreditNoteId?: string;
    lineItems: Pick<InvoiceLineItem, 'p1Acompte' | 'p1Regul' | 'vatRate'>[];
};

export type RegulSite = {
    id: string;
    name: string;
    activityCode: string;
    /** TVA des prestations P1 du site, par usage (à défaut des lignes d'acompte). */
    vatRates?: Partial<Record<UsageP1, number>>;
    /** ECS facturée au relevé (déjà au réel) : seul le chauffage se régularise. */
    ecsAuReleve?: boolean;
    /** Chauffage facturé au compteur (déjà au réel) : seule l'ECS se régularise. */
    chauffageAuReleve?: boolean;
    /** Décompte MTI : le réel chauffage est le P1 dû de la saison (détail repris dans la ligne). */
    decompte?: import('./p1-decompte').DecompteSaison[];
};

export type RegulInput = {
    mois: string[];
    sites: RegulSite[];
    /** Réel du moteur par site, puis par « usage|mois » (€ HT). */
    reel: Map<string, Map<string, number>>;
    documents: RegulDocument[];
    interests: { id: string; siteId: string; seasonLabel: string; endDate: string; amount: number }[];
};

export type RegulResult = {
    lines: InvoiceLineItem[];
    errors: string[];
    /** Factures d'acompte concernées (référence de l'avoir). */
    acompteInvoiceIds: string[];
    detail: { siteId: string; site: string; usage: UsageReel; reel: number; acomptes: number; ecart: number }[];
};

const frMois = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
const eur = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const finMois = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
const LIBELLE: Record<UsageReel, string> = { total: 'P1', chauffage: 'P1 chauffage', ecs: 'P1 ECS' };

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

        // Acomptes facturés par usage et par mois, et leur TVA.
        const acomptes: Record<UsageP1, Map<string, number[]>> = { chauffage: new Map(), ecs: new Map() };
        const tva: Partial<Record<UsageP1, number>> = { ...site.vatRates };
        for (const d of valid.filter(x => x.kind === 'invoice')) for (const l of d.lineItems) {
            if (l.p1Acompte?.siteId !== site.id) continue;
            const usage: UsageP1 = l.p1Acompte.usage ?? 'chauffage';
            for (const am of l.p1Acompte.mois) {
                if (am.mois < debut || am.mois > fin) continue;
                acomptes[usage].set(am.mois, [...(acomptes[usage].get(am.mois) ?? []), am.montant]);
                acompteInvoiceIds.add(d.id);
                if (l.vatRate !== undefined) tva[usage] = l.vatRate;
            }
        }
        const reel = input.reel.get(site.id) ?? new Map<string, number>();
        const has = (usage: UsageReel, m: string) => reel.has(`${usage}|${m}`);
        const parUsage = mois.some(m => has('chauffage', m) || has('ecs', m));
        const auTotal = mois.some(m => has('total', m));
        if (parUsage && auTotal) { errors.push(`Site ${site.name} : réel importé à la fois au total et par usage sur la période ; n'en gardez qu'un.`); continue; }
        if (site.ecsAuReleve) {
            // L'ECS est déjà facturée au réel (relevés) : un réel total la compterait deux fois.
            if (auTotal) { errors.push(`Site ${site.name} : ECS facturée au relevé, le réel total la compterait deux fois : importez le réel chauffage seul (usage chauffage).`); continue; }
            if (acomptes.ecs.size) { errors.push(`Site ${site.name} : acomptes ECS et ECS au relevé sur la même période.`); continue; }
        }
        if (site.chauffageAuReleve) {
            if (auTotal) { errors.push(`Site ${site.name} : chauffage facturé au compteur, le réel total le compterait deux fois : importez le réel ECS seul (usage ECS).`); continue; }
            if (acomptes.chauffage.size) { errors.push(`Site ${site.name} : acomptes chauffage et chauffage au compteur sur la même période.`); continue; }
        }

        const regulariser = (usage: UsageReel, acompteMois: Map<string, number[]>, vatRate: number | undefined) => {
            const manquants = mois.filter(m => acompteMois.has(m) && !has(usage, m));
            if (manquants.length) {
                errors.push(`Site ${site.name} : réel ${usage === 'total' ? 'P1' : LIBELLE[usage]} du moteur non importé pour ${manquants.map(frMois).join(', ')}.`);
                return;
            }
            const moisRegul = mois.filter(m => acompteMois.has(m) || has(usage, m));
            if (moisRegul.length === 0) return;
            if (vatRate === undefined) { errors.push(`Site ${site.name} : TVA de la prestation ${LIBELLE[usage]} inconnue.`); return; }
            const totalReel = sumCents(moisRegul.map(m => reel.get(`${usage}|${m}`) ?? 0));
            const totalAcomptes = sumCents(moisRegul.flatMap(m => acompteMois.get(m) ?? []));
            const ecart = roundCents(totalReel - totalAcomptes);
            detail.push({ siteId: site.id, site: site.name, usage, reel: totalReel, acomptes: totalAcomptes, ecart });
            const dec = usage === 'chauffage' && site.decompte?.length ? site.decompte : null;
            lines.push({
                description: dec
                    ? `Décompte P1 chauffage MTI — Site : ${site.name} — saison ${dec.map(d => d.saison).join(', ')} : ${dec.map(d => `P1₀ ${eur(d.p1Base)} € × C/C0 ${d.coefficient.toLocaleString('fr-FR', { maximumFractionDigits: 5 })} × ${d.dju.toLocaleString('fr-FR')} / ${d.djuReference.toLocaleString('fr-FR')} DJU = ${eur(d.du)} €`).join(' ; ')}`
                        + ` (période du ${frMois(moisRegul[0])} au ${frMois(moisRegul[moisRegul.length - 1])} : ${eur(totalReel)} €) − acomptes ${eur(totalAcomptes)} €`
                    : `Régularisation ${LIBELLE[usage]} — Site : ${site.name} — du ${frMois(moisRegul[0])} au ${frMois(moisRegul[moisRegul.length - 1])} : `
                    + `réel ${eur(totalReel)} € − acomptes ${eur(totalAcomptes)} €`,
                quantity: 1, unitPrice: ecart, total: ecart, siteId: site.id, activityCode: site.activityCode, vatRate,
                periodStartDate: `${moisRegul[0]}-01`, periodEndDate: finMois(moisRegul[moisRegul.length - 1]),
                p1Regul: { siteId: site.id, usage, mois: moisRegul, reel: totalReel, acomptes: totalAcomptes, ...(dec && { decompte: dec }) },
            });
        };

        if (parUsage || site.ecsAuReleve || site.chauffageAuReleve) {
            for (const usage of (['chauffage', 'ecs'] as const).filter(u => !(u === 'ecs' ? site.ecsAuReleve : site.chauffageAuReleve))) regulariser(usage, acomptes[usage], tva[usage]);
        } else {
            // Au total : chauffage et ECS confondus, possible seulement avec une TVA commune.
            const usages = (['chauffage', 'ecs'] as const).filter(u => acomptes[u].size > 0);
            const taux = [...new Set(usages.map(u => tva[u]))];
            if (taux.length > 1) {
                errors.push(`Site ${site.name} : acomptes chauffage et ECS à des TVA différentes (${taux.map(t => t?.toLocaleString('fr-FR')).join(' % et ')} %) : importez le réel par usage.`);
                continue;
            }
            const total = new Map<string, number[]>();
            for (const u of usages) for (const [m, v] of acomptes[u]) total.set(m, [...(total.get(m) ?? []), ...v]);
            regulariser('total', total, taux[0] ?? tva.chauffage ?? tva.ecs);
        }
    }

    for (const i of input.interests) {
        if (interetsFactures.has(i.id) || i.endDate.slice(0, 7) < debut || i.endDate.slice(0, 7) > fin) continue;
        const site = input.sites.find(s => s.id === i.siteId);
        if (!site) continue;
        const vatRate = site.vatRates?.chauffage ?? lines.find(l => l.siteId === site.id)?.vatRate;
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
