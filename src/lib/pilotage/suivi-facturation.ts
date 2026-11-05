import { billedUntil, billingItems, daysIn, dueInvoiceLines, echeancesOf, type BilledInvoice, type BillingInput } from '@/lib/billing/contract-billing';
import { toDay } from '@/lib/services/site-amounts';

/**
 * Suivi de la facturation (calcul pur) : les échéances de chaque contrat, du lendemain du dernier facturé jusqu'à un
 * horizon, avec leur statut — en retard (facturable et pas facturée), à facturer aujourd'hui, à venir — leur montant
 * et ce qui bloque leur facture. Même échéancier que la facture (lib/billing/contract-billing).
 *
 * Montants : pour une échéance facturable, celui que la facture porterait (révision, acompte P1, relevé compris) ;
 * pour une échéance à venir, le montant de base (avant révision ; acompte P1 et ECS au relevé : calculés à la
 * facture).
 */

export type StatutEcheance = 'retard' | 'aujourdhui' | 'a_venir';

export type EcheanceSuivi = {
    contractId: string;
    contractNumber: string;
    clientName: string;
    site: string;
    prestation: string;
    start: string;
    end: string;
    billableOn: string;
    statut: StatutEcheance;
    /** Retard en jours (statut « retard »), ou jours avant la date facturable (« à venir »). */
    jours: number;
    montant: number | null;
    /** Montant de base, avant révision et calcul au relevé ou en acompte. */
    estime: boolean;
    blocage?: string;
};

export type SuiviContrat = { contractId: string; contractNumber: string; clientName: string; echeances: EcheanceSuivi[]; erreurs: string[] };

export function suiviContrat(
    contract: { id: string; contractNumber: string; clientName: string },
    input: BillingInput, invoices: BilledInvoice[], today: string, horizon: string,
): SuiviContrat {
    const { items, errors } = billingItems(input);
    const contractStart = toDay(input.contract.startDate);
    if (errors.length || !contractStart) return { contractId: contract.id, contractNumber: contract.contractNumber, clientName: contract.clientName, echeances: [], erreurs: errors };
    const billed = billedUntil(items, invoices);
    // Ce que la facture du jour contiendrait : montants exacts et blocages des échéances déjà facturables.
    const due = dueInvoiceLines(input, invoices, today);
    const montantDu = new Map<string, number>();
    for (const l of due.lines) {
        // Ligne propre à une prestation (multi-site) ; une ligne regroupée (facturation globale) ne se répartit pas.
        if (!l.itemKey) continue;
        const k = `${l.itemKey}|${l.periodStartDate?.slice(0, 7)}`;
        montantDu.set(k, Math.round(((montantDu.get(k) ?? 0) + l.total) * 100) / 100);
    }
    const blocages = new Map<string, string>();
    for (const e of due.errors) for (const item of items) if (e.includes(`site ${item.site.name}`) || e.includes(`sur le site ${item.site.name}`)) blocages.set(item.key, e);

    const echeances: EcheanceSuivi[] = [];
    for (const item of items) {
        for (const e of echeancesOf(item, contractStart, billed.get(item.key) ?? null, horizon, 60)) {
            const facturable = e.billableOn <= today;
            const k = `${item.key}|${e.start.slice(0, 7)}`;
            const calcule = item.p1Acompte || item.p1Releve;
            echeances.push({
                contractId: contract.id, contractNumber: contract.contractNumber, clientName: contract.clientName,
                site: item.site.name, prestation: `${item.activity.code}${item.label ? ` — ${item.label}` : ''}${item.p1Acompte ? ' (acompte P1)' : item.p1Releve ? ' (ECS au relevé)' : ''}`,
                start: e.start, end: e.end, billableOn: e.billableOn,
                statut: !facturable ? 'a_venir' : e.billableOn === today ? 'aujourdhui' : 'retard',
                jours: facturable ? daysIn(e.billableOn, today) - 1 : daysIn(today, e.billableOn) - 1,
                montant: facturable && montantDu.has(k) ? montantDu.get(k)! : calcule ? null : e.amount,
                estime: !(facturable && montantDu.has(k)),
                ...(facturable && blocages.has(item.key) && { blocage: blocages.get(item.key) }),
            });
        }
    }
    // Contrat facturé globalement : un blocage sans site identifiable vaut pour toutes ses échéances facturables.
    const generiques = due.errors.filter(e => !items.some(i => e.includes(i.site.name)));
    if (generiques.length) for (const e of echeances) if (e.statut !== 'a_venir' && !e.blocage) e.blocage = generiques.join(' ');
    echeances.sort((a, b) => a.billableOn.localeCompare(b.billableOn) || a.site.localeCompare(b.site));
    return { contractId: contract.id, contractNumber: contract.contractNumber, clientName: contract.clientName, echeances, erreurs: [] };
}
