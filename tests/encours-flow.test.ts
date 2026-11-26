// Encours par interlocuteur de paiement et encaissement (émulateur Firestore).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { encaisser, encours } from '../src/services/encours-admin';
import type { GardePerimetre } from '../src/lib/auth/perimetre-server';

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const garde = (clients: string[] | null, refuses: string[] = []) => ({
    clients: async () => (clients ? new Set(clients) : null),
    exiger: async (_t: string, id: string) => { if (refuses.includes(id)) throw new Error('Hors périmètre.'); },
}) as unknown as GardePerimetre;
const mien = (e: Awaited<ReturnType<typeof encours>>) => e.interlocuteurs.filter(i => i.clients.some(c => c.id.startsWith('enc-')));

before(async () => {
    await set('tiers', 'enc-t', { name: 'Syndic Encours Test', quality: 'syndic', address: '1 rue S', postalCode: '69001', city: 'Lyon', email: 'syndic@example.com' });
    await set('clients', 'enc-c1', { name: 'SDC Encours Un', representedBy: 'Syndic Encours Test' });
    await set('clients', 'enc-c2', { name: 'SDC Encours Deux', representedBy: 'syndic encours test' });
    await set('clients', 'enc-c3', { name: 'Client Encours Seul' });
    await set('contacts', 'enc-k', { clientId: 'enc-c3', type: 'facturation', name: 'Compta', email: 'compta@example.com' });
    const f = (id: string, clientId: string, status: string, total: number, extra: object = {}) => set('invoices', id, { invoiceNumber: `ENC-${id}`, clientId, clientName: 'x', date: '2020-01-01T00:00:00.000Z', dueDate: '2020-01-31T00:00:00.000Z', status, total, ...extra });
    await f('enc-f1', 'enc-c1', 'due', 100);
    await f('enc-f2', 'enc-c2', 'overdue', 250.5);
    await f('enc-f3', 'enc-c3', 'due', 40);
    await f('enc-f4', 'enc-c1', 'paid', 999);
    await f('enc-f5', 'enc-c1', 'proforma', 999, { invoiceNumber: '' });
});

test('encours : factures à payer seulement, regroupées par syndic commun ; contact du client sinon', async () => {
    const r = mien(await encours(garde(null)));
    assert.deepEqual(r.map(i => [i.name, i.role, i.factures.map(f => f.numero).sort(), i.encours, i.echu, i.email]), [
        ['Syndic Encours Test', 'representant', ['ENC-enc-f1', 'ENC-enc-f2'], 350.5, 350.5, 'syndic@example.com'],
        ['Client Encours Seul', 'client', ['ENC-enc-f3'], 40, 40, 'compta@example.com'],
    ]);
    assert.ok(r[0].retardMax > 2000);
});

test('périmètre : seuls les clients visibles sont comptés', async () => {
    const r = mien(await encours(garde(['enc-c2'])));
    assert.deepEqual(r.map(i => [i.name, i.clients.map(c => c.name), i.encours]), [['Syndic Encours Test', ['SDC Encours Deux'], 250.5]]);
});

test('encaissement : tout ou rien, dans le périmètre, seulement des factures encore à payer', async () => {
    await assert.rejects(encaisser([], garde(null), 't@x'), /Aucune facture/);
    await assert.rejects(encaisser(['enc-f1', 'enc-f2'], garde(null, ['enc-f2']), 't@x'), /Hors périmètre/);
    await assert.rejects(encaisser(['enc-f1', 'enc-f4'], garde(null), 't@x'), /ENC-enc-f4 n'est plus à payer/);
    assert.equal((await adminDb.collection('invoices').doc('enc-f1').get()).get('status'), 'due');
    assert.equal(await encaisser(['enc-f1', 'enc-f2', 'enc-f1'], garde(null), 't@x'), 2);
    const f1 = await adminDb.collection('invoices').doc('enc-f1').get();
    assert.deepEqual([f1.get('status'), f1.get('paidMarkedBy'), typeof f1.get('paidAt')], ['paid', 't@x', 'string']);
    assert.deepEqual(mien(await encours(garde(null))).map(i => i.name), ['Client Encours Seul']);
});
