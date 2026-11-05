import 'server-only';
import { FieldPath } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import {
    billingItems, billedUntil, dueDateFor, dueInvoiceLines, echeancesOf, frDay, vatTotals,
    type BillingInput, type BillingService, type BillingSite, type DueResult, type NamedRef,
} from '@/lib/billing/contract-billing';
import { toDay } from '@/lib/services/site-amounts';
import {
    getActivities, getClient, getContract, getInvoicesByContract, resolveIssuingCompany, resolvePaymentTerm,
} from '@/services/firestore-admin';
import type { Activity, Client, Company, Contract, Invoice, VatRate } from '@/lib/types';

/**
 * Facture d'un contrat à une date : toutes les échéances facturables de ses prestations (et montants de sites sans
 * prestation) jusqu'à cette date, d'après l'échéancier (lib/billing/contract-billing). Rien n'est écrit ici.
 */

export type PreparedInvoice = {
    contract: Contract;
    client: Client;
    company: Company;
    due: DueResult;
    /** Verrou optimiste : version de facturation du contrat lue, vérifiée à l'écriture de la facture. */
    billingVersion: number;
    invoice: Omit<Invoice, 'id' | 'invoiceNumber' | 'companyId' | 'issuedAt' | 'pdf' | 'einvoicing'>;
};

const docs = <T>(snap: FirebaseFirestore.QuerySnapshot) => snap.docs.map(d => ({ id: d.id, ...d.data() }) as T);

/** Données de facturation d'un contrat (sites, prestations, paramétrage). */
export async function loadBillingInput(contract: Contract): Promise<BillingInput> {
    const siteIds = contract.siteIds ?? [];
    const chunks: string[][] = [];
    for (let i = 0; i < siteIds.length; i += 30) chunks.push(siteIds.slice(i, i + 30));
    const [sites, services, activities, vatRates, schedules, terms] = await Promise.all([
        Promise.all(chunks.map(c => adminDb.collection('sites').where(FieldPath.documentId(), 'in', c).get())).then(s => s.flatMap(x => docs<BillingSite>(x))),
        adminDb.collection('services').where('contractId', '==', contract.id).get().then(s => docs<BillingService>(s)),
        getActivities(),
        adminDb.collection('vatRates').get().then(s => docs<VatRate>(s)),
        adminDb.collection('schedules').get().then(s => docs<NamedRef>(s)),
        adminDb.collection('terms').get().then(s => docs<NamedRef>(s)),
    ]);
    return {
        contract: {
            id: contract.id, siteIds, activityIds: contract.activityIds ?? [], invoicingType: contract.invoicingType,
            startDate: contract.startDate, endDate: contract.endDate, billingSchedule: contract.billingSchedule,
        },
        sites, services, activities: activities as Activity[], vatRates, schedules, terms,
    };
}

/** Prochaine date à laquelle une échéance deviendra facturable (pour un message utile). */
function nextBillableOn(input: BillingInput, invoices: Invoice[]): string | null {
    const { items } = billingItems(input);
    const billed = billedUntil(items, invoices);
    const start = toDay(input.contract.startDate)!;
    const next = items.map(i => echeancesOf(i, start, billed.get(i.key) ?? null, '9999-12-31', 1)[0]?.billableOn).filter(Boolean).sort();
    return next[0] ?? null;
}

export async function prepareContractInvoice(contractId: string, invoiceDate: string, opts: { isProforma: boolean; until?: string }): Promise<PreparedInvoice> {
    const [contract, versionSnap] = await Promise.all([getContract(contractId), adminDb.collection('contracts').doc(contractId).get()]);
    if (!contract) throw new Error('Contrat non trouvé.');
    const client = await getClient(contract.clientId);
    if (!client) throw new Error('Client non trouvé.');
    const company = await resolveIssuingCompany(contract, client);
    if ((contract.siteIds ?? []).length === 0) throw new Error("Aucun site n'est associé à ce contrat.");

    const [input, invoices, term] = await Promise.all([loadBillingInput(contract), getInvoicesByContract(contract.id), resolvePaymentTerm(contract, client)]);
    const day = toDay(invoiceDate) ?? toDay(new Date())!;
    const until = toDay(opts.until) ?? day;
    const due = dueInvoiceLines(input, invoices, until);
    if (due.errors.length) throw new Error(`Facture impossible : ${due.errors.join(' ')}`);
    if (due.lines.length === 0) {
        const next = nextBillableOn(input, invoices);
        throw new Error(`Rien à facturer au ${frDay(until)}${next ? ` : prochaine échéance facturable le ${frDay(next)}` : ' : tout est facturé'}.`);
    }
    const starts = due.lines.map(l => l.periodStartDate!).sort();
    const ends = due.lines.map(l => l.periodEndDate!).sort();
    return {
        contract, client, company, due,
        billingVersion: Number(versionSnap.get('billingVersion') ?? 0),
        invoice: {
            contractId: contract.id,
            clientId: contract.clientId,
            clientName: contract.clientName,
            date: day,
            dueDate: dueDateFor(day, term),
            periodStartDate: starts[0],
            periodEndDate: ends[ends.length - 1],
            status: opts.isProforma ? 'proforma' : 'due',
            lineItems: due.lines,
            ...vatTotals(due.lines),
        },
    };
}
