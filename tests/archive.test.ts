// Tests de l'archivage des PDF (émulateurs Firestore + Storage) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes } from 'firebase/storage';
import { adminBucket, adminDb } from '../src/lib/firebase-admin';
import { createInvoice, createCreditNote } from '../src/services/firestore-admin';
import { archiveDocument, getDocumentPdf, sha256, DocumentIntegrityError } from '../src/services/document-archive';
import type { Company, Invoice } from '../src/lib/types';

if (!process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateurs requis).');

const acme: Company = { id: 'pdf-acme', code: 'PDFA', name: 'Acme Énergie', address: '1 rue du Four', postalCode: '75001', city: 'Paris', siret: '12345678900011', vatNumber: 'FR12123456789' };

function draft(overrides: Partial<Invoice> = {}) {
    return {
        contractId: 'ctr-pdf', clientId: 'cli-pdf', clientName: 'Client PDF',
        date: '2026-10-01', dueDate: '2026-10-31', status: 'due' as const,
        lineItems: [
            { description: 'Prestation P2 – Site A – période du 01/10/2026 au 31/10/2026', quantity: 1, unitPrice: 1234.56, total: 1234.56, activityCode: 'P2' },
            { description: 'Prestation P3 – Site A', quantity: 1, unitPrice: 83.33, total: 83.33, activityCode: 'P3' },
        ],
        subtotal: 1317.89, tax: 131.79, total: 1449.68, taxRate: 0.1,
        ...overrides,
    };
}

before(async () => {
    const { id, ...company } = acme;
    await adminDb.collection('companies').doc(id).set(company);
    await adminDb.collection('clients').doc('cli-pdf').set({ name: 'Client PDF', address: '2 avenue du Parc', postalCode: '69001', city: 'Lyon', siret: '98765432100022', companyId: id });
});

test('facture émise : PDF archivé une fois, empreinte enregistrée', async () => {
    const inv = await createInvoice(draft(), acme);
    const pdf = await archiveDocument('invoice', inv.id);

    const year = 2026;
    assert.equal(pdf.path, `archives/${acme.id}/invoices/${year}/${inv.invoiceNumber}.pdf`);
    const [stored] = await adminBucket().file(pdf.path).download();
    assert.equal(stored.subarray(0, 5).toString(), '%PDF-');
    assert.equal(sha256(stored), pdf.sha256);
    assert.equal(stored.length, pdf.size);

    const doc = await adminDb.collection('invoices').doc(inv.id).get();
    assert.deepEqual(doc.get('pdf'), pdf);

    // Second appel : rien n'est régénéré ni réécrit.
    const [meta1] = await adminBucket().file(pdf.path).getMetadata();
    const again = await archiveDocument('invoice', inv.id);
    const [meta2] = await adminBucket().file(pdf.path).getMetadata();
    assert.deepEqual(again, pdf);
    assert.equal(meta2.generation, meta1.generation);
});

test('appels simultanés : un seul fichier, même empreinte partout', async () => {
    const inv = await createInvoice(draft(), acme);
    const results = await Promise.all(Array.from({ length: 5 }, () => archiveDocument('invoice', inv.id)));
    assert.equal(new Set(results.map(r => r.sha256)).size, 1);
    const doc = await adminDb.collection('invoices').doc(inv.id).get();
    assert.equal(doc.get('pdf').sha256, results[0].sha256);
});

test('téléchargement : copie archivée vérifiée ; altération détectée', async () => {
    const inv = await createInvoice(draft(), acme);
    const pdf = await archiveDocument('invoice', inv.id);

    const downloaded = await getDocumentPdf('invoice', inv.id);
    assert.equal(downloaded.sha256, pdf.sha256);
    assert.equal(downloaded.filename, `Facture_${inv.invoiceNumber}.pdf`);

    await adminBucket().file(pdf.path).save(Buffer.from('%PDF-1.3 falsifié'));
    await assert.rejects(getDocumentPdf('invoice', inv.id), DocumentIntegrityError);
});

test('facture non encore archivée : archivée au premier téléchargement', async () => {
    const inv = await createInvoice(draft(), acme);
    const downloaded = await getDocumentPdf('invoice', inv.id);
    const doc = await adminDb.collection('invoices').doc(inv.id).get();
    assert.equal(doc.get('pdf').sha256, downloaded.sha256);
});

test('proforma : PDF généré à la demande, jamais archivé', async () => {
    const pro = await createInvoice(draft({ status: 'proforma' }), acme);
    const downloaded = await getDocumentPdf('invoice', pro.id);
    assert.equal(downloaded.buffer.subarray(0, 5).toString(), '%PDF-');
    assert.equal(downloaded.sha256, undefined);
    await assert.rejects(archiveDocument('invoice', pro.id), /proforma/);
    const doc = await adminDb.collection('invoices').doc(pro.id).get();
    assert.equal(doc.get('pdf'), undefined);
});

test('avoir : archivé dans credit-notes', async () => {
    const inv = await createInvoice(draft(), acme);
    const cn = await createCreditNote([inv.id], (invoices) => ({
        originalInvoiceIds: invoices.map(i => i.id), contractId: 'ctr-pdf', clientId: 'cli-pdf', clientName: 'Client PDF',
        date: '2026-10-15T00:00:00.000Z', status: 'finalized' as const,
        lineItems: invoices[0].lineItems.map(l => ({ ...l, unitPrice: -l.unitPrice, total: -l.total })),
        subtotal: -1317.89, tax: -131.79, total: -1449.68, reason: 'Erreur de période',
    }));
    const pdf = await archiveDocument('creditNote', cn.id);
    assert.equal(pdf.path, `archives/${acme.id}/credit-notes/2026/${cn.creditNoteNumber}.pdf`);
    const downloaded = await getDocumentPdf('creditNote', cn.id);
    assert.equal(downloaded.filename, `Avoir_${cn.creditNoteNumber}.pdf`);
});

test('règles Storage : archives inaccessibles depuis le navigateur', async () => {
    const env = await initializeTestEnvironment({
        projectId: process.env.FIREBASE_PROJECT_ID,
        storage: { rules: readFileSync(new URL('../storage.rules', import.meta.url), 'utf8') },
    });
    const user = env.authenticatedContext('u', { zen: true, admin: true }).storage(`gs://${process.env.FIREBASE_STORAGE_BUCKET}`);
    const stranger = env.authenticatedContext('s', {}).storage(`gs://${process.env.FIREBASE_STORAGE_BUCKET}`);
    const bytes = new Uint8Array([37, 80, 68, 70]);

    await assertFails(uploadBytes(ref(user, `archives/${acme.id}/invoices/2026/FAUX.pdf`), bytes));
    await assertFails(getBytes(ref(user, `archives/${acme.id}/invoices/2026/x.pdf`)));
    await assertSucceeds(uploadBytes(ref(user, 'contracts/test.pdf'), bytes));
    await assertFails(uploadBytes(ref(stranger, 'contracts/test2.pdf'), bytes));
    await env.cleanup();
});
