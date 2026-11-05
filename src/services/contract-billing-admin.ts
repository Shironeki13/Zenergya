import 'server-only';
import { FieldPath } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import {
    contractInvoiceLines, dueDateFor, nextBillingPeriod, vatTotals,
    type BillingPeriod, type BillingService, type BillingSite,
} from '@/lib/billing/contract-billing';
import { toDay } from '@/lib/services/site-amounts';
import { getActivities, getClient, getContract, getInvoicesByContract, resolveIssuingCompany, resolvePaymentTerm } from '@/services/firestore-admin';
import type { Activity, Client, Company, Contract, Invoice, VatRate } from '@/lib/types';

/**
 * Préparation de la facture d'un contrat pour sa prochaine période (sans rien écrire) : période, lignes par
 * prestation ou par montant de site, TVA par ligne, totaux par taux, échéance selon les conditions de paiement.
 */

export type PreparedInvoice = {
    contract: Contract;
    client: Client;
    company: Company;
    period: BillingPeriod;
    invoice: Omit<Invoice, 'id' | 'invoiceNumber' | 'companyId' | 'issuedAt' | 'pdf' | 'einvoicing'>;
};

/** Fin de la dernière période facturée (factures émises ou proformas en attente ; avoirs exclus). */
export async function lastBilledPeriodEnd(contractId: string): Promise<string | null> {
    const invoices = await getInvoicesByContract(contractId);
    const ends = invoices
        .filter(inv => inv.status !== 'cancelled' && !inv.cancelledByCreditNoteId && inv.periodEndDate)
        .map(inv => toDay(inv.periodEndDate)!)
        .sort();
    return ends.pop() ?? null;
}

export async function prepareContractInvoice(contractId: string, invoiceDate: string, opts: { isProforma: boolean; expectedPeriodStart?: string }): Promise<PreparedInvoice> {
    const contract = await getContract(contractId);
    if (!contract) throw new Error('Contrat non trouvé.');
    const client = await getClient(contract.clientId);
    if (!client) throw new Error('Client non trouvé.');
    const company = await resolveIssuingCompany(contract, client);

    const period = nextBillingPeriod(contract, await lastBilledPeriodEnd(contract.id));
    if (!period) throw new Error('Toutes les périodes de facturation de ce contrat ont déjà été facturées.');
    if (opts.expectedPeriodStart && toDay(opts.expectedPeriodStart) !== period.start) {
        throw new Error(`La période du ${toDay(opts.expectedPeriodStart)} est déjà facturée (prochaine période : ${period.start}).`);
    }
    const siteIds = contract.siteIds ?? [];
    if (siteIds.length === 0) throw new Error("Aucun site n'est associé à ce contrat.");

    const chunks: string[][] = [];
    for (let i = 0; i < siteIds.length; i += 30) chunks.push(siteIds.slice(i, i + 30));
    const [sites, services, activities, vatRates, term] = await Promise.all([
        Promise.all(chunks.map(c => adminDb.collection('sites').where(FieldPath.documentId(), 'in', c).get()))
            .then(snaps => snaps.flatMap(s => s.docs.map(d => ({ id: d.id, ...d.data() }) as BillingSite))),
        adminDb.collection('services').where('contractId', '==', contract.id).get()
            .then(s => s.docs.map(d => ({ id: d.id, ...d.data() }) as BillingService)),
        getActivities(),
        adminDb.collection('vatRates').get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }) as VatRate)),
        resolvePaymentTerm(contract, client),
    ]);

    const { lines, errors } = contractInvoiceLines({
        contract: { id: contract.id, siteIds, activityIds: contract.activityIds ?? [], invoicingType: contract.invoicingType },
        sites, services, activities: activities as Activity[], vatRates,
    }, period);
    if (errors.length) throw new Error(`Facture impossible : ${errors.join(' ')}`);
    if (lines.length === 0) throw new Error('Aucune prestation facturable sur cette période pour les sites de ce contrat.');

    const day = toDay(invoiceDate) ?? toDay(new Date())!;
    return {
        contract, client, company, period,
        invoice: {
            contractId: contract.id,
            clientId: contract.clientId,
            clientName: contract.clientName,
            date: day,
            dueDate: dueDateFor(day, term),
            periodStartDate: period.start,
            periodEndDate: period.end,
            status: opts.isProforma ? 'proforma' : 'due',
            lineItems: lines,
            ...vatTotals(lines),
        },
    };
}
