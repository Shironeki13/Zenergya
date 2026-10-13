// Tests de la numérotation des factures et avoirs (émulateur Firestore) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { createInvoice, convertProformaToInvoice, createCreditNote, resolveIssuingCompany } from '../src/services/firestore-admin';
import type { Company, Invoice } from '../src/lib/types';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const acme: Company = { id: 'acme', code: 'ACME', name: 'Acme' };
const beta: Company = { id: 'beta', code: 'BETA', name: 'Beta' };

const now = new Date();
const yymm = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
const yyyy = String(now.getFullYear());

function draft(overrides: Partial<Invoice> = {}) {
    return {
        contractId: 'ctr1', clientId: 'cli1', clientName: 'Client 1',
        date: '2026-10-01', dueDate: '2026-10-31', status: 'due' as const,
        lineItems: [{ description: 'P2', quantity: 1, unitPrice: 100, total: 100, activityCode: 'P2' }],
        subtotal: 100, tax: 10, total: 110,
        ...overrides,
    };
}

before(async () => {
    await adminDb.collection('companies').doc('acme').set({ code: 'ACME', name: 'Acme' });
    await adminDb.collection('companies').doc('beta').set({ code: 'BETA', name: 'Beta' });
    // Facture émise avant ce mécanisme (ancien compteur global) : la série BETA doit repartir après elle.
    await adminDb.collection('invoices').doc('legacy').set({ ...draft(), invoiceNumber: `BETA-${yymm}-0007` });
});

test('20 factures créées en parallèle : numéros uniques et continus', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => createInvoice(draft(), acme)));
    const numbers = results.map(r => r.invoiceNumber!).sort();
    const expected = Array.from({ length: 20 }, (_, i) => `ACME-${yymm}-${String(i + 1).padStart(4, '0')}`);
    assert.deepEqual(numbers, expected);

    const stored = await adminDb.collection('invoices').where('companyId', '==', 'acme').get();
    assert.equal(stored.size, 20);
    assert.ok(stored.docs.every(d => d.get('invoiceNumber') && d.get('issuedAt')));
});

test('série propre à chaque société, reprise après les numéros existants', async () => {
    const r = await createInvoice(draft(), beta);
    assert.equal(r.invoiceNumber, `BETA-${yymm}-0008`);
});

test('un proforma ne consomme pas de numéro ; sa conversion en attribue un', async () => {
    const pro = await createInvoice(draft({ status: 'proforma' }), acme);
    assert.equal(pro.invoiceNumber, undefined);

    const number = await convertProformaToInvoice(pro.id);
    assert.equal(number, `ACME-${yymm}-0021`);
    const snap = await adminDb.collection('invoices').doc(pro.id).get();
    assert.equal(snap.get('status'), 'due');

    await assert.rejects(convertProformaToInvoice(pro.id), /n'est pas un proforma/);
});

test('avoir : numéroté par société, factures annulées dans la même transaction', async () => {
    const inv = await createInvoice(draft(), acme);
    const build = (invoices: Invoice[]) => {
        if (invoices.some(i => i.status === 'cancelled')) throw new Error('déjà annulée');
        return {
            originalInvoiceIds: invoices.map(i => i.id), contractId: 'ctr1', clientId: 'cli1', clientName: 'Client 1',
            date: new Date().toISOString(), status: 'finalized' as const, lineItems: [], subtotal: -100, tax: -10, total: -110, reason: 'test',
        };
    };

    const cn = await createCreditNote([inv.id], build);
    assert.equal(cn.creditNoteNumber, `ACME-AV${yyyy}-0001`);
    const invoice = await adminDb.collection('invoices').doc(inv.id).get();
    assert.equal(invoice.get('status'), 'cancelled');
    assert.equal(invoice.get('cancelledByCreditNoteId'), cn.id);

    // Deuxième avoir sur la même facture : refusé, et aucun numéro consommé.
    await assert.rejects(createCreditNote([inv.id], build), /déjà annulée/);
    const other = await createInvoice(draft(), acme);
    const cn2 = await createCreditNote([other.id], build);
    assert.equal(cn2.creditNoteNumber, `ACME-AV${yyyy}-0002`);
});

test('avoir refusé si les factures viennent de deux sociétés', async () => {
    const a = await createInvoice(draft(), acme);
    const b = await createInvoice(draft(), beta);
    await assert.rejects(
        createCreditNote([a.id, b.id], () => { throw new Error('ne doit pas être appelé'); }),
        /même société/,
    );
});

test('société émettrice : contrat, puis client, sinon erreur explicite', async () => {
    assert.equal((await resolveIssuingCompany({ companyId: 'beta' } as any, { companyId: 'acme' } as any)).id, 'beta');
    assert.equal((await resolveIssuingCompany({} as any, { companyId: 'acme' } as any)).id, 'acme');
    await assert.rejects(resolveIssuingCompany({} as any, {} as any), /société émettrice/);
});
