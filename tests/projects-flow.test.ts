// Affaires P6 et situations de travaux (émulateurs Firestore + Storage) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminBucket, adminDb } from '../src/lib/firebase-admin';
import {
    createProjectFromQuote, deleteSituationDraft, getProjectInvoices, invoiceSituation, saveSituationDraft, setProjectMilestone,
} from '../src/services/projects-admin';
import { invoiceQuote } from '../src/services/quote-billing';
import { computeQuoteTotals } from '../src/lib/quotes/pricing';
import { sumCents } from '../src/lib/money';
import type { Quote, QuoteLine, QuotePricing } from '../src/lib/quotes/types';

if (!process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateurs requis).');

const pricing: QuotePricing = { coefficient: 1.35, laborRate: 58, laborCost: 36.5, defaultVatRate: 20 };
const lines: QuoteLine[] = [
    { id: 'a', kind: 'FOURNITURE', label: 'Chaudière', quantity: 1, unitCost: 10000, vatRate: 20 },
    { id: 'b', kind: 'MAIN_OEUVRE', label: 'Pose', unit: 'h', quantity: 120, vatRate: 20 },
    { id: 'c', kind: 'SOUS_TRAITANCE', label: 'Fumisterie', quantity: 1, unitCost: 3333.33, vatRate: 10 },
];
const totals = computeQuoteTotals(lines, pricing);

let n = 0;
async function acceptedQuote(overrides: Partial<Quote> = {}): Promise<string> {
    n++;
    const ref = adminDb.collection('quotes').doc();
    await ref.set({
        number: `PF-DEV2026-${String(n).padStart(4, '0')}`, companyId: 'pf-co', clientId: 'pf-cli', clientName: 'Bailleur PF',
        title: 'Rénovation chaufferie', mode: 'P6', status: 'accepte', version: 1, date: '2026-10-01', validityDays: 30, validUntil: '2026-10-31',
        pricing, lines, totals,
        acceptance: { acceptedAt: '2026-10-15', signatoryName: 'Mme Roux', purchaseOrderNumber: 'BC-P6-1', recordedAt: new Date().toISOString() },
        createdAt: '', updatedAt: '', ...overrides,
    } satisfies Omit<Quote, 'id'>);
    return ref.id;
}

before(async () => {
    await adminDb.collection('companies').doc('pf-co').set({ code: 'PF', name: 'Veolia PF', siret: '73282932000074' });
    await adminDb.collection('clients').doc('pf-cli').set({ name: 'Bailleur PF', clientType: 'private', siret: '73282932000074', companyId: 'pf-co' });
});

test('affaire : marché figé depuis le devis, code attribué, devis rattaché et fermé à la facturation directe', async () => {
    const quoteId = await acceptedQuote();
    const project = await createProjectFromQuote(quoteId, { retentionPct: 5 }, 'jeanne@example.com');
    assert.match(project.code, /^PF-AFF\d{4}-\d{4}$/);
    assert.deepEqual(project.lines.map(l => l.id), ['a', 'b', 'c']);
    assert.equal(project.totalTTC, totals.totalTTC);
    assert.equal(project.purchaseOrderNumber, 'BC-P6-1');
    const quote = (await adminDb.collection('quotes').doc(quoteId).get()).data()!;
    assert.equal(quote.projectId, project.id);
    await assert.rejects(createProjectFromQuote(quoteId, { retentionPct: 5 }), /existe déjà/);
    await assert.rejects(invoiceQuote(quoteId, { kind: 'totale' }), /avancement/);
});

test('trois situations jusqu\'à 100 % : somme égale au devis, retenue, numéros légaux, PDF', async () => {
    const project = await createProjectFromQuote(await acceptedQuote(), { retentionPct: 5 });
    const steps = [
        { period: '2026-11', progress: { a: 50, b: 20, c: 0 } },
        { period: '2026-12', progress: { a: 80, b: 55.5, c: 33.33 } },
        { period: '2027-01', progress: { a: 100, b: 100, c: 100 } },
    ];
    const numbers: string[] = [];
    for (const step of steps) {
        const draft = await saveSituationDraft(project.id, step);
        const again = await saveSituationDraft(project.id, step);   // une seule situation en préparation
        assert.equal(again.id, draft.id);
        numbers.push((await invoiceSituation(draft.id, 'jeanne@example.com')).invoiceNumber);
    }
    assert.equal(new Set(numbers).size, 3);

    const invoices = (await getProjectInvoices(project.id)).sort((a, b) => a.situation!.number - b.situation!.number);
    assert.deepEqual(invoices.map(i => i.situation?.number), [1, 2, 3]);
    assert.equal(sumCents(invoices.map(i => i.subtotal)), totals.totalHT);
    assert.equal(sumCents(invoices.map(i => i.tax)), totals.totalVAT);
    assert.equal(sumCents(invoices.map(i => i.total)), totals.totalTTC);
    for (const inv of invoices) {
        assert.equal(inv.situation!.retention.pct, 5);
        assert.equal(inv.situation!.netToPay, Math.round((inv.total - inv.situation!.retention.amount) * 100) / 100);
        const pdf = (await adminDb.collection('invoices').doc(inv.id).get()).get('pdf');
        const [buffer] = await adminBucket().file(pdf.path).download();
        assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
    }
});

test('contrôles : baisse d\'avancement refusée ; situation annulée par avoir → la précédente fait référence', async () => {
    const project = await createProjectFromQuote(await acceptedQuote(), { retentionPct: 5 });
    const s1 = await saveSituationDraft(project.id, { period: '2026-11', progress: { a: 50 } });
    await invoiceSituation(s1.id);
    const s2 = await saveSituationDraft(project.id, { period: '2026-12', progress: { a: 40 } });
    await assert.rejects(invoiceSituation(s2.id), /ne peut pas baisser/);
    await saveSituationDraft(project.id, { period: '2026-12', progress: { a: 70 } });
    const { invoiceId } = await invoiceSituation(s2.id);
    // Avoir sur la situation 2 : elle ne compte plus.
    await adminDb.collection('invoices').doc(invoiceId).update({ status: 'cancelled' });
    const s3 = await saveSituationDraft(project.id, { period: '2026-12', progress: { a: 60 } });
    assert.equal(s3.number, 3);
    const { invoiceId: id3 } = await invoiceSituation(s3.id);
    const inv3 = (await adminDb.collection('invoices').doc(id3).get()).data()!;
    // 60 % − 50 % (situation 1) de 13 500 = 1 350 HT
    assert.equal(inv3.subtotal, 1350);
    await assert.rejects(deleteSituationDraft(s3.id), /avoir/);
});

test('caution bancaire, jalons : réception, libération de la retenue, clôture', async () => {
    const project = await createProjectFromQuote(await acceptedQuote(), { retentionPct: 5, retentionBond: true });
    assert.equal(project.retentionPct, 0);
    const s = await saveSituationDraft(project.id, { period: '2026-11', progress: { a: 100, b: 100, c: 100 } });
    const { invoiceId } = await invoiceSituation(s.id);
    const inv = (await adminDb.collection('invoices').doc(invoiceId).get()).data()!;
    assert.equal(inv.situation.retention.amount, 0);
    assert.equal(inv.total, totals.totalTTC);

    await assert.rejects(setProjectMilestone(project.id, 'retentionReleased', '2027-12-01'), /réception/);
    await setProjectMilestone(project.id, 'completed', '2026-12-10');
    await setProjectMilestone(project.id, 'retentionReleased', '2027-12-10');
    const closed = await setProjectMilestone(project.id, 'closed', '2027-12-11');
    assert.equal(closed.status, 'cloture');
    await assert.rejects(saveSituationDraft(project.id, { period: '2028-01', progress: { a: 100 } }), /clôturée/);
});

test('devis déjà facturé directement : pas d\'affaire', async () => {
    const quoteId = await acceptedQuote({ mode: 'P5' });
    await invoiceQuote(quoteId, { kind: 'acompte', percent: 30 });
    await assert.rejects(createProjectFromQuote(quoteId, { retentionPct: 5 }), /déjà des factures/);
});
