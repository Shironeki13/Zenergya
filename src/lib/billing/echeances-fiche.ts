import { billingItems, echeancesOf, lineItemKeys } from '@/lib/billing/contract-billing';
import { toDay } from '@/lib/services/site-amounts';
import type { Activity, Contract, Invoice, Schedule, Service, Site, Term, VatRate } from '@/lib/types';

/**
 * Échéances des éléments facturés d'un contrat (prestations, montants de sites), avec la facture qui couvre chacune :
 * même échéancier que la facture (lib/billing/contract-billing). Sert aux fiches site et contrat (indicateurs, « à faire »,
 * calendrier), côté navigateur, à partir des données déjà chargées.
 */

export type PeriodeFiche = {
    itemKey: string;
    serviceId: string | null;
    siteId: string;
    periodStart: Date;
    periodEnd: Date;
    /** Date à partir de laquelle l'échéance est facturable. */
    dueDate: Date;
    invoice: Invoice | null;
    /** Montant avant révision ; null pour un acompte P1 ou une ECS au relevé (calculés à la facture). */
    amount: number | null;
};

export type DonneesFacturation = {
    services: Service[]; activities: Activity[]; vatRates: VatRate[]; schedules: Schedule[]; terms: Term[]; invoices: Invoice[];
};

/** Échéances de chaque élément facturé des `sites` du contrat (clé : élément de l'échéancier). */
export function periodesDuContrat(contract: Contract, sites: Site[], d: DonneesFacturation, max = 120): Map<string, PeriodeFiche[]> {
    const map = new Map<string, PeriodeFiche[]>();
    const contractStart = toDay(contract.startDate);
    if (!contractStart || !sites.length) return map;
    const input = {
        contract: {
            id: contract.id, siteIds: contract.siteIds ?? [], activityIds: contract.activityIds ?? [], invoicingType: contract.invoicingType,
            startDate: contract.startDate, endDate: contract.endDate, billingSchedule: contract.billingSchedule,
        },
        sites, services: d.services, activities: d.activities, vatRates: d.vatRates, schedules: d.schedules, terms: d.terms,
    } as Parameters<typeof billingItems>[0];
    const factures = d.invoices.filter(inv => inv.contractId === contract.id && inv.status !== 'cancelled' && !inv.cancelledByCreditNoteId);
    for (const item of billingItems(input).items) {
        map.set(item.key, echeancesOf(item, contractStart, null, item.to, max).map(e => {
            // Facture qui couvre l'échéance : ligne de cet élément sur cette période (ou facture antérieure par site et activité).
            const invoice = factures.find(inv => (inv.lineItems ?? []).some(l => {
                const keys = lineItemKeys(l);
                if (keys.length) return keys.includes(item.key) && !!l.periodStartDate && l.periodStartDate <= e.start && (toDay(l.periodEndDate) ?? '') >= e.end;
                return l.activityCode === item.activity.code && (!l.siteId || l.siteId === item.site.id)
                    && (toDay(inv.periodStartDate) ?? '') <= e.start && (toDay(inv.periodEndDate) ?? '') >= e.end;
            })) ?? null;
            return {
                itemKey: item.key, serviceId: item.serviceId ?? null, siteId: item.site.id,
                periodStart: new Date(e.start), periodEnd: new Date(e.end), dueDate: new Date(e.billableOn), invoice,
                amount: item.p1Acompte || item.p1Releve ? null : e.amount,
            };
        }));
    }
    return map;
}

/** Échéances facturables (date passée) sans facture, de la plus ancienne à la plus récente. */
export function enRetard(periodes: Iterable<PeriodeFiche[]>, maintenant = new Date()): PeriodeFiche[] {
    return [...periodes].flat().filter(p => !p.invoice && p.dueDate <= maintenant).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}
