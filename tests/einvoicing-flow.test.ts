// Facturation électronique : état figé à l'émission, statuts, recalcul (émulateur Firestore) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { createInvoice, createCreditNote, convertProformaToInvoice, setEInvoicingStatus, recomputeEInvoicingState } from '../src/services/firestore-admin';
import type { Company, Invoice } from '../src/lib/types';

const company: Company = { id: 'rfe-co', code: 'RFE', name: 'RFE Énergie', einvoicingStartDate: '2026-09-01' };

function draft(clientId: string, overrides: Partial<Invoice> = {}) {
    return {
        contractId: 'rfe-ctr', clientId, clientName: clientId, date: '2026-10-15', dueDate: '2026-11-14', status: 'due' as const,
        lineItems: [{ description: 'P2', quantity: 1, unitPrice: 100, total: 100, activityCode: 'P2' }],
        subtotal: 100, tax: 10, total: 110, taxRate: 0.1, ...overrides,
    };
}
const state = async (id: string, collection = 'invoices') => (await adminDb.collection(collection).doc(id).get()).get('einvoicing');

before(async () => {
    const { id, ...data } = company;
    await adminDb.collection('companies').doc(id).set(data);
    await adminDb.collection('typologies').doc('t-part').set({ name: 'Particulier', einvoicingRegime: 'b2c' });
    await adminDb.collection('typologies').doc('t-pro').set({ name: 'Entreprise' });
    await adminDb.collection('contracts').doc('rfe-ctr').set({ clientId: 'x', einvoicingAddress: '' });
    await adminDb.collection('clients').doc('pro').set({ name: 'Pro', clientType: 'private', typologyId: 't-pro', siret: '73282932000074', companyId: id });
    await adminDb.collection('clients').doc('part').set({ name: 'Particulier', clientType: 'private', typologyId: 't-part', companyId: id });
    await adminDb.collection('clients').doc('pub').set({ name: 'Mairie', clientType: 'public', typologyId: 't-pro', siret: '21750001600019', useChorus: true, companyId: id });
    await adminDb.collection('clients').doc('nosiret').set({ name: 'Sans SIRET', clientType: 'private', typologyId: 't-pro', companyId: id });
});

test('état figé à l\'émission selon le client', async () => {
    const pro = await createInvoice(draft('pro'), company);
    assert.deepEqual(
        (({ regime, channel, address, addressSource, status }) => ({ regime, channel, address, addressSource, status }))(await state(pro.id)),
        { regime: 'b2b', channel: 'pa', address: '732829320', addressSource: 'siren', status: 'to_send' },
    );
    const part = await createInvoice(draft('part'), company);
    assert.equal((await state(part.id)).channel, 'ereporting');
    assert.equal((await state(part.id)).status, 'not_applicable');
    const pub = await createInvoice(draft('pub'), company);
    assert.equal((await state(pub.id)).channel, 'chorus');
    assert.equal((await state(pub.id)).status, 'to_send');
    const old = await createInvoice(draft('pro', { date: '2026-08-31' }), company);
    assert.equal((await state(old.id)).status, 'not_applicable');
});

test('proforma : pas d\'état ; conversion et avoir : état calculé', async () => {
    const pro = await createInvoice(draft('pro', { status: 'proforma' }), company);
    assert.equal(await state(pro.id), undefined);
    await convertProformaToInvoice(pro.id);
    assert.equal((await state(pro.id)).status, 'to_send');

    const inv = await createInvoice(draft('pro'), company);
    const cn = await createCreditNote([inv.id], (invoices) => ({
        originalInvoiceIds: invoices.map(i => i.id), contractId: 'rfe-ctr', clientId: 'pro', clientName: 'Pro',
        date: new Date().toISOString(), status: 'finalized' as const, lineItems: [], subtotal: -100, tax: -10, total: -110, reason: 'test',
    }));
    assert.equal((await state(cn.id, 'creditNotes')).channel, 'pa');
});

test('statuts : transitions contrôlées, trace de l\'auteur', async () => {
    const inv = await createInvoice(draft('pro'), company);
    const sent = await setEInvoicingStatus('invoice', inv.id, 'sent', { by: 'a@b.fr', platformReference: 'PA-123' });
    assert.equal(sent.status, 'sent');
    assert.equal(sent.statusBy, 'a@b.fr');
    assert.equal(sent.platformReference, 'PA-123');
    await assert.rejects(setEInvoicingStatus('invoice', inv.id, 'to_send', { by: 'a@b.fr' }), /non autorisé/);
    await assert.rejects(recomputeEInvoicingState('invoice', inv.id), /figé/);

    const part = await createInvoice(draft('part'), company);
    await assert.rejects(setEInvoicingStatus('invoice', part.id, 'sent', { by: 'a@b.fr' }), /non autorisé/);
});

test('recalcul après correction de la fiche client ; facture antérieure sans état', async () => {
    const inv = await createInvoice(draft('nosiret'), company);
    assert.match((await state(inv.id)).blocking[0], /Adresse électronique de facturation manquante/);

    await adminDb.collection('clients').doc('nosiret').update({ einvoicingAddress: '552100554_55210055400025' });
    const fixed = await recomputeEInvoicingState('invoice', inv.id);
    assert.equal(fixed?.address, '552100554_55210055400025');
    assert.equal(fixed?.addressSource, 'client');
    assert.equal(fixed?.blocking, undefined);

    // Facture émise avant la RFE (pas d'état) : calculée au premier changement de statut.
    const legacy = adminDb.collection('invoices').doc('legacy-rfe');
    await legacy.set({ ...draft('pro'), invoiceNumber: 'RFE-2610-9999', companyId: company.id });
    const s = await setEInvoicingStatus('invoice', 'legacy-rfe', 'sent', { by: 'a@b.fr' });
    assert.equal(s.status, 'sent');
});
