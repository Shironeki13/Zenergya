import 'server-only';
import { FieldPath } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import {
    billingItems, billedUntil, dueDateFor, dueInvoiceLines, echeancesOf, frDay, vatTotals,
    type BillingInput, type BillingService, type BillingSite, type DueResult, type NamedRef,
} from '@/lib/billing/contract-billing';
import { toDay } from '@/lib/services/site-amounts';
import {
    getActivities, getClient, getContract, getIndexValues, getIndices, getInvoicesByContract, resolveIssuingCompany, resolvePaymentTerm,
} from '@/services/firestore-admin';
import type { Activity, Client, Company, Contract, Invoice, RevisionRule, VatRate } from '@/lib/types';
import { P1_DOC_ID, formuleAu, valeurAu, type P1ContractDoc, type P1MeterDoc, type P1SiteDoc } from '@/lib/p1/stockage';
import { prixRevise, type SerieValues } from '@/lib/p1/formules';
import type { Energie, TermeNc } from '@/lib/p1/parametrage';
import { loadSeries } from '@/services/p1-admin';
import type { P1AcompteSource } from '@/lib/billing/contract-billing';

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
    const [sites, services, activities, vatRates, schedules, terms, revisionRules, indices, indexValues] = await Promise.all([
        Promise.all(chunks.map(c => adminDb.collection('sites').where(FieldPath.documentId(), 'in', c).get())).then(s => s.flatMap(x => docs<BillingSite>(x))),
        adminDb.collection('services').where('contractId', '==', contract.id).get().then(s => docs<BillingService>(s)),
        getActivities(),
        adminDb.collection('vatRates').get().then(s => docs<VatRate>(s)),
        adminDb.collection('schedules').get().then(s => docs<NamedRef>(s)),
        adminDb.collection('terms').get().then(s => docs<NamedRef>(s)),
        adminDb.collection('revisionRules').get().then(s => docs<RevisionRule>(s)),
        getIndices(),
        getIndexValues(),
    ]);
    const p1 = services.some(s => s.p1Mode === 'acompte') ? await p1Source(contract.id, siteIds) : undefined;
    return {
        contract: {
            id: contract.id, siteIds, activityIds: contract.activityIds ?? [], invoicingType: contract.invoicingType,
            startDate: contract.startDate, endDate: contract.endDate, billingSchedule: contract.billingSchedule,
        },
        sites, services, activities: activities as Activity[], vatRates, schedules, terms, revisionRules, indices, indexValues, ...(p1 && { p1 }),
    };
}

/**
 * Source des acomptes P1 d'un contrat, à partir du paramétrage P1 daté, par usage :
 * - chauffage : quantité annuelle du site (sinon somme des cibles NB de ses postes, en MWh), répartition du contrat,
 *   prix de base du site × formule chauffage ;
 * - ECS : volume annuel ECS du site (m³), répartition ECS du contrat, prix de base ECS du site × formule ECS.
 */
export async function p1Source(contractId: string, siteIds: string[], series?: SerieValues): Promise<P1AcompteSource> {
    const meters = siteIds.length ? (await Promise.all(Array.from({ length: Math.ceil(siteIds.length / 30) }, (_, i) =>
        adminDb.collection('meters').where('siteId', 'in', siteIds.slice(i * 30, i * 30 + 30)).select('siteId').get()))).flatMap(s => s.docs) : [];
    const ids = [P1_DOC_ID.contract(contractId), ...siteIds.map(P1_DOC_ID.site), ...meters.map(m => P1_DOC_ID.meter(m.id))];
    const snaps = ids.length ? await adminDb.getAll(...ids.map(id => adminDb.collection('p1Parametrage').doc(id))) : [];
    const docs = new Map(snaps.filter(d => d.exists).map(d => [d.id, d.data()]));
    const contractDoc = (docs.get(P1_DOC_ID.contract(contractId)) ?? null) as P1ContractDoc | null;
    const seriesValues = series ?? (await loadSeries()).series;
    const day = (mois: string) => `${mois}-01`;
    const energiesOf = (siteId: string, date: string) => [...new Set(meters.filter(m => m.get('siteId') === siteId)
        .map(m => valeurAu<Energie>((docs.get(P1_DOC_ID.meter(m.id)) as P1MeterDoc | undefined)?.params, 'energie', date))
        .filter((e): e is Energie => !!e))];
    return {
        quantite: (siteId, mois, usage) => {
            const site = docs.get(P1_DOC_ID.site(siteId)) as P1SiteDoc | undefined;
            if (usage === 'ecs') return valeurAu<number>(site?.params, 'quantiteAcompteEcs', day(mois)) ?? 'volume annuel des acomptes ECS (site) non renseigné';
            const propre = valeurAu<number>(site?.params, 'quantiteAcompte', day(mois));
            if (propre) return propre;
            const postes = Object.values(site?.postes ?? {}).filter(p => !p.retireLe && valeurAu<TermeNc[]>(p.params, 'formuleNc', day(mois)));
            if (postes.length === 0) return 'quantité annuelle des acomptes (site) non renseignée, et aucun poste de consommation';
            let total = 0;
            for (const p of postes) {
                const nb = valeurAu<number>(p.params, 'cibleNb', day(mois));
                const unite = valeurAu<string>(p.params, 'cibleNbUnite', day(mois));
                if (!nb || unite !== 'MWh') return `quantité annuelle des acomptes (site) non renseignée, et cible NB du poste « ${p.designation} » ${!nb ? 'absente' : `en ${unite}`}`;
                total += nb;
            }
            return total;
        },
        repartition: (mois, usage) => valeurAu<number[]>(contractDoc?.params, usage === 'ecs' ? 'repartitionAcomptesEcs' : 'repartitionAcomptes', day(mois))
            ?? `répartition des acomptes ${usage === 'ecs' ? 'ECS' : 'P1'} du contrat non renseignée`,
        prix: (siteId, mois, usage) => {
            const site = docs.get(P1_DOC_ID.site(siteId)) as P1SiteDoc | undefined;
            const f = formuleAu(contractDoc, siteId, energiesOf(siteId, day(mois)), usage, day(mois));
            if (!f) return `aucune formule de révision P1 ${usage === 'ecs' ? 'ECS' : 'chauffage'} en vigueur`;
            const base = valeurAu<number>(site?.params, usage === 'ecs' ? 'prixBaseEcs' : 'prixBase', day(mois));
            if (usage === 'ecs' && base === null) return 'prix de base ECS du site non renseigné';
            const r = prixRevise(f.version, base, mois, seriesValues);
            return 'causes' in r ? r.causes.join(' ; ') : r.prix;
        },
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

export type BatchRow = {
    contractId: string; contractNumber: string; clientName: string; periodStart: string; periodEnd: string;
    echeances: number; subtotal: number; tax: number; warnings: string[]; error?: string;
};

/** Aperçu de la facturation groupée : pour chaque contrat actif, ce que sa facture contiendrait à la date (même calcul). */
export async function previewBatchBilling(until: string): Promise<BatchRow[]> {
    const day = toDay(until)!;
    const snap = await adminDb.collection('contracts').where('status', '==', 'Actif').get();
    const rows: BatchRow[] = [];
    for (const c of snap.docs) {
        const contract = await getContract(c.id);
        if (!contract) continue;
        const base = { contractId: contract.id, contractNumber: contract.contractNumber ?? contract.id, clientName: contract.clientName };
        try {
            const [input, invoices] = await Promise.all([loadBillingInput(contract), getInvoicesByContract(contract.id)]);
            const due = dueInvoiceLines(input, invoices, day);
            if (!due.errors.length && due.lines.length === 0) continue;
            const totals = vatTotals(due.lines);
            const starts = due.lines.map(l => l.periodStartDate!).sort();
            const ends = due.lines.map(l => l.periodEndDate!).sort();
            rows.push({
                ...base, periodStart: starts[0] ?? '', periodEnd: ends[ends.length - 1] ?? '', echeances: due.lines.length,
                subtotal: totals.subtotal, tax: totals.tax, warnings: due.warnings, ...(due.errors.length && { error: due.errors.join(' ') }),
            });
        } catch (e) {
            rows.push({ ...base, periodStart: '', periodEnd: '', echeances: 0, subtotal: 0, tax: 0, warnings: [], error: (e as Error).message });
        }
    }
    return rows.sort((a, b) => a.clientName.localeCompare(b.clientName));
}
