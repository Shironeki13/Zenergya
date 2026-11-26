// Émission d'avoirs : un par facture, nature interne ou standard, compte rendu (émulateurs Firestore et Storage).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { emettreAvoirs } from '../src/services/avoirs-admin';
import type { GardePerimetre } from '../src/lib/auth/perimetre-server';

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const get = async (c: string, id: string) => (await adminDb.collection(c).doc(id).get()).data()!;
const garde = (refuses: string[] = []) => ({ exiger: async (_t: string, id: string) => { if (refuses.includes(id)) throw new Error('Hors périmètre.'); } }) as unknown as GardePerimetre;
const ligne = { description: 'Maintenance', quantity: 1, unitPrice: 100, total: 100, vatRate: 20, itemKey: 'svc:x', periodStartDate: '2026-01-01', periodEndDate: '2026-03-31' };
const facture = (id: string, extra: object = {}) => set('invoices', id, {
    invoiceNumber: `AVF-${id}`, contractId: 'av-k', clientId: 'av-c', clientName: 'Client avoirs', companyId: 'av-co', date: new Date('2026-04-01'), dueDate: new Date('2026-05-01'),
    status: 'due', lineItems: [ligne], subtotal: 100, tax: 20, total: 120, vatBreakdown: [{ rate: 20, base: 100, amount: 20 }], ...extra,
});

before(async () => {
    await set('companies', 'av-co', { name: 'Société avoirs', code: 'AVO', siret: '90000000000013' });
    await set('clients', 'av-c', { name: 'Client avoirs', address: '1 rue A', postalCode: '69001', city: 'Lyon', clientType: 'private', companyId: 'av-co' });
    await set('contracts', 'av-k', { clientId: 'av-c', clientName: 'Client avoirs', siteIds: [], activityIds: [], status: 'Actif' });
    await facture('f1', { einvoicing: { regime: 'b2b', channel: 'pa', status: 'sent', computedAt: '2026-04-01' } });
    await facture('f2', { einvoicing: { regime: 'b2b', channel: 'pa', status: 'rejected', computedAt: '2026-04-01', comment: 'SIREN inconnu' } });
    await facture('f3', { status: 'cancelled', cancelledByCreditNoteId: 'autre' });
    await facture('f4');
});

test('un avoir par facture ; interne pour la facture rejetée ; refus détaillés sans bloquer les autres', async () => {
    await assert.rejects(emettreAvoirs(['f1'], '', undefined, garde()), /Choisissez un motif/);
    const r = await emettreAvoirs(['f1', 'f2', 'f3', 'f4', 'f1'], 'erreur_periode', 'trimestre en double', garde(['f4']));
    assert.deepEqual(r.map(x => [x.facture, !!x.avoir, x.nature ?? null, x.erreur ?? null]), [
        ['AVF-f1', true, 'standard', null], ['AVF-f2', true, 'interne', null], ['AVF-f3', false, null, 'déjà annulée par un avoir'], ['f4', false, null, 'Hors périmètre.'],
    ]);
    assert.notEqual(r[0].avoir, r[1].avoir);

    const [a1, a2] = [await get('creditNotes', r[0].avoirId!), await get('creditNotes', r[1].avoirId!)];
    assert.deepEqual([a1.originalInvoiceIds, a1.motif, a1.nature, a1.reason, a1.total], [['f1'], 'erreur_periode', 'standard', 'Erreur de période facturée — trimestre en double', -120]);
    assert.deepEqual([a1.einvoicing?.status], ['to_send']);
    // Avoir interne : jamais transmis.
    assert.deepEqual([a2.nature, a2.einvoicing?.status, a2.einvoicing?.blocking], ['interne', 'not_applicable', []]);
    assert.match(a2.einvoicing?.comment, /Avoir interne/);
    for (const id of ['f1', 'f2']) assert.deepEqual([(await get('invoices', id)).status, (await get('invoices', id)).cancelledByCreditNoteId], ['cancelled', r[id === 'f1' ? 0 : 1].avoirId]);
    assert.equal((await get('invoices', 'f4')).status, 'due');
    // Copie conforme archivée dès l'émission.
    assert.ok(a1.pdf?.sha256 && a2.pdf?.sha256);
});
