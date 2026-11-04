// Facturation des devis (émulateurs Firestore + Storage) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminBucket, adminDb } from '../src/lib/firebase-admin';
import { invoiceQuote } from '../src/services/quote-billing';
import { computeQuoteTotals } from '../src/lib/quotes/pricing';
import { sumCents } from '../src/lib/money';
import type { Quote, QuoteLine, QuotePricing } from '../src/lib/quotes/types';
import type { Invoice } from '../src/lib/types';

if (!process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateurs requis).');

const pricing: QuotePricing = { coefficient: 1.35, laborRate: 58, laborCost: 36.5, defaultVatRate: 20 };
const lines: QuoteLine[] = [
    { id: 'f', kind: 'FOURNITURE', label: 'Brûleur', quantity: 1, unitCost: 4200, vatRate: 20 },
    { id: 'm', kind: 'MAIN_OEUVRE', label: 'Pose', unit: 'h', quantity: 14, vatRate: 20 },
    { id: 'r', kind: 'FOURNITURE', label: 'Robinets', unit: 'u', quantity: 12, unitCost: 38, vatRate: 10 },
    { id: 'o', kind: 'FOURNITURE', label: 'Option', quantity: 1, unitCost: 900, vatRate: 20, optional: true },
];
const totals = computeQuoteTotals(lines, pricing);

let n = 0;
async function acceptedQuote(clientId: string, overrides: Partial<Quote> = {}): Promise<string> {
    n++;
    const ref = adminDb.collection('quotes').doc();
    const q: Omit<Quote, 'id'> = {
        number: `QB-DEV2026-${String(n).padStart(4, '0')}`, companyId: 'qb-co', clientId, clientName: 'Client QB',
        title: 'Travaux', mode: 'P5', status: 'accepte', version: 1, date: '2026-11-01', validityDays: 30, validUntil: '2026-12-01',
        pricing, lines, totals,
        acceptance: { acceptedAt: '2026-11-02', signatoryName: 'M. Durand', purchaseOrderNumber: 'BC-2026-55', recordedAt: new Date().toISOString() },
        createdAt: '', updatedAt: '', ...overrides,
    };
    await ref.set(q);
    return ref.id;
}

async function invoicesOf(quoteId: string): Promise<Invoice[]> {
    const snap = await adminDb.collection('invoices').where('quoteId', '==', quoteId).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Invoice);
}

before(async () => {
    await adminDb.collection('companies').doc('qb-co').set({ code: 'QB', name: 'Veolia QB', siret: '73282932000074' });
    await adminDb.collection('clients').doc('qb-prive').set({ name: 'Client QB', clientType: 'private', siret: '73282932000074', companyId: 'qb-co' });
    await adminDb.collection('clients').doc('qb-public').set({
        name: 'Commune QB', clientType: 'public', siret: '21690123100011', useChorus: true, companyId: 'qb-co', chorusLegalCommitmentRequired: true,
    });
});

test('acompte puis solde : numérotation légale, PDF archivé, somme égale au devis', async () => {
    const id = await acceptedQuote('qb-prive');
    const a = await invoiceQuote(id, { kind: 'acompte', percent: 30 }, 'jeanne@example.com');
    assert.match(a.invoiceNumber, /^QB-\d{4}-\d{4}$/);
    const s = await invoiceQuote(id, { kind: 'solde' });

    const invoices = await invoicesOf(id);
    assert.equal(invoices.length, 2);
    const acompte = invoices.find(i => i.id === a.invoiceId)!;
    const solde = invoices.find(i => i.id === s.invoiceId)!;
    assert.equal(acompte.quote?.billingKind, 'acompte');
    assert.equal(acompte.quote?.purchaseOrderNumber, 'BC-2026-55');
    assert.equal(acompte.vatBreakdown?.length, 2);
    assert.equal(solde.quote?.deposits?.[0].invoiceNumber, a.invoiceNumber);
    assert.ok(solde.lineItems.some(l => l.total < 0 && l.description.includes(a.invoiceNumber)));
    assert.equal(sumCents([acompte.total, solde.total]), totals.totalTTC);
    assert.equal(sumCents([acompte.tax, solde.tax]), totals.totalVAT);

    // Copie conforme archivée pour chaque facture.
    for (const inv of [acompte, solde]) {
        const pdf = (await adminDb.collection('invoices').doc(inv.id).get()).get('pdf');
        assert.ok(pdf?.path, `PDF archivé pour ${inv.invoiceNumber}`);
        const [buffer] = await adminBucket().file(pdf.path).download();
        assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
    }

    await assert.rejects(invoiceQuote(id, { kind: 'solde' }), /entièrement facturé/);
    await assert.rejects(invoiceQuote(id, { kind: 'acompte', percent: 10 }), /entièrement facturé/);
});

test('deux facturations simultanées du même devis : une seule passe', async () => {
    const id = await acceptedQuote('qb-prive');
    const results = await Promise.allSettled([
        invoiceQuote(id, { kind: 'totale' }),
        invoiceQuote(id, { kind: 'totale' }),
        invoiceQuote(id, { kind: 'totale' }),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const invoices = await invoicesOf(id);
    assert.equal(invoices.length, 1);
    assert.equal(invoices[0].total, totals.totalTTC);
});

test("client public : le bon de commande devient l'engagement juridique Chorus", async () => {
    const id = await acceptedQuote('qb-public');
    const { invoiceId } = await invoiceQuote(id, { kind: 'totale' });
    const inv = (await adminDb.collection('invoices').doc(invoiceId).get()).data() as Invoice;
    assert.equal(inv.einvoicing?.channel, 'chorus');
    assert.equal(inv.einvoicing?.chorus?.legalCommitment, 'BC-2026-55');
    assert.equal(inv.einvoicing?.chorus?.legalCommitmentSource, 'order');
    assert.deepEqual(inv.einvoicing?.blocking ?? [], []);
});

test('devis non accepté : refusé', async () => {
    const id = await acceptedQuote('qb-prive', { status: 'envoye' });
    await assert.rejects(invoiceQuote(id, { kind: 'totale' }), /accepté/);
    assert.equal((await invoicesOf(id)).length, 0);
});
