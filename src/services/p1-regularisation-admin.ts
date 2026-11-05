import 'server-only';
import { FieldPath } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { dueDateFor, vatTotals } from '@/lib/billing/contract-billing';
import { regularisationP1, type RegulDocument, type RegulResult } from '@/lib/billing/p1-regularisation';
import { toDay } from '@/lib/services/site-amounts';
import {
    createInvoice, createRegularisationCreditNote, getClient, getContract, getInvoicesByContract, resolveIssuingCompany, resolvePaymentTerm,
} from '@/services/firestore-admin';
import { archiveDocumentSafely } from '@/services/document-archive';
import type { Contract } from '@/lib/types';

/**
 * Régularisation P1 d'un contrat (préparation et émission) : réel du moteur importé (`p1Reel`) − acomptes facturés,
 * plus les intéressements de la période. Lignes positives : une facture ; négatives : un avoir de régularisation.
 */

const chunks = <T>(list: T[]) => Array.from({ length: Math.ceil(list.length / 30) }, (_, i) => list.slice(i * 30, i * 30 + 30));

/** Mois AAAA-MM de début à fin inclus. */
export function moisEntre(debut: string, fin: string): string[] {
    if (!/^\d{4}-\d{2}$/.test(debut) || !/^\d{4}-\d{2}$/.test(fin) || fin < debut) throw new Error('Période : mois de début et de fin (AAAA-MM), dans l\'ordre.');
    const out: string[] = [];
    for (let m = debut; m <= fin && out.length < 60; ) {
        out.push(m);
        const [y, mo] = m.split('-').map(Number);
        m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
    }
    return out;
}

export type RegulPreview = RegulResult & { contract: Contract; billingVersion: number };

export async function prepareP1Regularisation(contractId: string, debut: string, fin: string): Promise<RegulPreview> {
    const mois = moisEntre(debut, fin);
    const [contract, versionSnap] = await Promise.all([getContract(contractId), adminDb.collection('contracts').doc(contractId).get()]);
    if (!contract) throw new Error('Contrat non trouvé.');
    const siteIds = contract.siteIds ?? [];
    const [sites, services, activities, vatRates, invoices, creditNotes, reelDocs] = await Promise.all([
        Promise.all(chunks(siteIds).map(c => adminDb.collection('sites').where(FieldPath.documentId(), 'in', c).get())).then(s => s.flatMap(x => x.docs)),
        adminDb.collection('services').where('contractId', '==', contract.id).get().then(s => s.docs),
        adminDb.collection('activities').get().then(s => new Map(s.docs.map(d => [d.id, d.data()]))),
        adminDb.collection('vatRates').get().then(s => new Map(s.docs.map(d => [d.id, Number(d.get('rate'))]))),
        getInvoicesByContract(contract.id),
        adminDb.collection('creditNotes').where('contractId', '==', contract.id).get().then(s => s.docs),
        Promise.all(chunks(siteIds).map(c => adminDb.collection('p1Reel').where('siteId', 'in', c).get())).then(s => s.flatMap(x => x.docs)),
    ]);
    const p1Services = services.filter(d => d.get('type') === 'P1' && d.get('isActive') !== false);
    const interests = (await Promise.all(chunks(p1Services.map(d => d.id)).map(c => adminDb.collection('interests').where('serviceId', 'in', c).get()))).flatMap(s => s.docs);

    const reel = new Map<string, Map<string, number>>();
    for (const d of reelDocs) {
        const siteId = String(d.get('siteId'));
        if (!reel.has(siteId)) reel.set(siteId, new Map());
        reel.get(siteId)!.set(`${d.get('usage') ?? 'total'}|${d.get('mois')}`, Number(d.get('montantHt')));
    }
    const documents: RegulDocument[] = [
        ...invoices.map(i => ({ id: i.id, kind: 'invoice' as const, status: i.status, cancelledByCreditNoteId: i.cancelledByCreditNoteId, lineItems: i.lineItems ?? [] })),
        ...creditNotes.map(c => ({ id: c.id, kind: 'creditNote' as const, status: c.get('status'), lineItems: c.get('lineItems') ?? [] })),
    ];
    const result = regularisationP1({
        mois,
        sites: sites.map(site => {
            const ofSite = p1Services.filter(d => d.get('siteId') === site.id);
            // TVA par usage : prestation P1 ECS pour l'ECS, autre prestation P1 (en acompte de préférence) pour le chauffage.
            const pick = (ecs: boolean) => ofSite.filter(d => (d.get('p1Type') === 'ECS') === ecs).sort((a, b) => Number(b.get('p1Mode') === 'acompte') - Number(a.get('p1Mode') === 'acompte'))[0];
            const rateOf = (svc?: FirebaseFirestore.QueryDocumentSnapshot) => {
                if (!svc) return undefined;
                const activity = activities.get(String(svc.get('activityId')));
                const vatId = (svc.get('vatRateId') as string | undefined) || (activity?.vatRateId as string | undefined);
                return vatId && vatRates.has(vatId) ? vatRates.get(vatId)! : undefined;
            };
            const chauffage = pick(false);
            const ecs = pick(true);
            const activity = activities.get(String((chauffage ?? ecs)?.get('activityId')));
            const vat = { chauffage: rateOf(chauffage), ecs: rateOf(ecs) };
            return {
                id: site.id, name: String(site.get('name') ?? site.id), activityCode: String(activity?.code ?? 'P1'),
                vatRates: Object.fromEntries(Object.entries(vat).filter(([, v]) => v !== undefined)),
            };
        }),
        reel, documents,
        interests: interests.map(i => {
            const svc = p1Services.find(s => s.id === i.get('serviceId'));
            return { id: i.id, siteId: String(svc?.get('siteId') ?? ''), seasonLabel: String(i.get('seasonLabel') ?? ''), endDate: toDay(i.get('endDate')) ?? '', amount: Number(i.get('interestAmount') ?? 0) };
        }),
    });
    return { ...result, contract, billingVersion: Number(versionSnap.get('billingVersion') ?? 0) };
}

/** Émet la régularisation : avoir (lignes négatives) puis facture (lignes positives). */
export async function emitP1Regularisation(contractId: string, debut: string, fin: string, date: string): Promise<{ invoice?: { id: string; number?: string }; creditNote?: { id: string; number: string } }> {
    const prep = await prepareP1Regularisation(contractId, debut, fin);
    if (prep.errors.length) throw new Error(`Régularisation impossible : ${prep.errors.join(' ')}`);
    if (prep.lines.length === 0) throw new Error('Rien à régulariser sur cette période.');
    const { contract } = prep;
    const client = await getClient(contract.clientId);
    if (!client) throw new Error('Client non trouvé.');
    const company = await resolveIssuingCompany(contract, client);
    const day = toDay(date) ?? toDay(new Date())!;
    const negatives = prep.lines.filter(l => l.total < 0);
    const positives = prep.lines.filter(l => l.total > 0);
    let version = prep.billingVersion;
    const out: { invoice?: { id: string; number?: string }; creditNote?: { id: string; number: string } } = {};
    const periode = `Régularisation P1 de ${debut} à ${fin}`;
    if (negatives.length) {
        const totals = vatTotals(negatives);
        const cn = await createRegularisationCreditNote({
            originalInvoiceIds: prep.acompteInvoiceIds, contractId: contract.id, clientId: contract.clientId, clientName: contract.clientName,
            date: day, status: 'finalized', lineItems: negatives, subtotal: totals.subtotal, tax: totals.tax, total: totals.total,
            vatBreakdown: totals.vatBreakdown, reason: periode,
        }, company, { contractId: contract.id, billingVersion: version });
        version++;
        await archiveDocumentSafely('creditNote', cn.id);
        out.creditNote = { id: cn.id, number: cn.creditNoteNumber };
    }
    if (positives.length) {
        const term = await resolvePaymentTerm(contract, client);
        const starts = positives.map(l => l.periodStartDate).filter((x): x is string => !!x).sort();
        const ends = positives.map(l => l.periodEndDate).filter((x): x is string => !!x).sort();
        const inv = await createInvoice({
            contractId: contract.id, clientId: contract.clientId, clientName: contract.clientName, date: day, dueDate: dueDateFor(day, term),
            ...(starts.length && { periodStartDate: starts[0], periodEndDate: ends[ends.length - 1] }),
            status: 'due', lineItems: positives, ...vatTotals(positives),
        }, company, { contractId: contract.id, billingVersion: version });
        await archiveDocumentSafely('invoice', inv.id);
        out.invoice = { id: inv.id, number: inv.invoiceNumber };
    }
    return out;
}
