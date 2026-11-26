// Annuaire des tiers d'adressage et bloc « Facturé à » des factures (émulateur Firestore).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { enregistrerTiers, listerTiers, supprimerTiers } from '../src/services/tiers-admin';
import { clientBlock } from '../src/services/document-archive';
import type { Client } from '../src/lib/types';

const copro = { name: 'SDC Tiers Test', address: '140 bd Voltaire', postalCode: '75011', city: 'Paris', siret: '12345678900011', vatNumber: 'FR 12 123456789' };
let syndicId = '';

before(async () => {
    for (const d of (await adminDb.collection('tiers').get()).docs) await d.ref.delete();
    await adminDb.collection('clients').doc('tiers-c1').set({ ...copro, representedBy: 'cabinet tiers-test' });
    await adminDb.collection('clients').doc('tiers-c2').set({ name: 'Ministère Tiers Test', address: '3 rue B', postalCode: '75007', city: 'Paris', payer: 'Payeur Tiers Test' });
});

test('création : nom requis, SIRET contrôlé, pas de doublon de nom', async () => {
    await assert.rejects(enregistrerTiers(null, { name: ' ' }, 't@x'), /nom du tiers/);
    await assert.rejects(enregistrerTiers(null, { name: 'Cabinet Tiers-Test', siret: '123' }, 't@x'), /14 chiffres/);
    const t = await enregistrerTiers(null, { name: 'Cabinet Tiers-Test', quality: 'syndic', address: '12 rue de la République', postalCode: '69002', city: 'Lyon' }, 't@x');
    syndicId = t.id;
    await assert.rejects(enregistrerTiers(null, { name: 'cabinet tiers test' }, 't@x'), /existe déjà/);
    assert.deepEqual((await listerTiers()).map(x => x.name), ['Cabinet Tiers-Test']);
});

test('facture d\'une copropriété : nom, SIRET et TVA du client, adresse du syndic', async () => {
    const client = { id: 'tiers-c1', ...(await adminDb.collection('clients').doc('tiers-c1').get()).data() } as Client;
    assert.deepEqual(await clientBlock(client, 'x'), {
        name: 'SDC Tiers Test', address: '12 rue de la République', postalCode: '69002', city: 'Lyon', siret: '12345678900011', vatNumber: 'FR12123456789',
        representative: { name: 'Cabinet Tiers-Test', quality: 'syndic', address: '12 rue de la République', postalCode: '69002', city: 'Lyon' },
    });
});

test('payeur sans fiche : cité par son nom, adresse du client conservée ; client sans tiers : bloc inchangé', async () => {
    const ministere = { id: 'tiers-c2', ...(await adminDb.collection('clients').doc('tiers-c2').get()).data() } as Client;
    assert.deepEqual(await clientBlock(ministere, 'x'), { name: 'Ministère Tiers Test', address: '3 rue B', postalCode: '75007', city: 'Paris', siret: undefined, payer: { name: 'Payeur Tiers Test' } });
    assert.deepEqual(await clientBlock({ id: 'z', ...copro } as Client, 'x'), { name: 'SDC Tiers Test', address: '140 bd Voltaire', postalCode: '75011', city: 'Paris', siret: '12345678900011', vatNumber: 'FR12123456789' });
    assert.deepEqual(await clientBlock(null, 'Client disparu'), { name: 'Client disparu', address: '', postalCode: '', city: '' });
});

test('renommage reporté sur les clients ; suppression refusée tant qu\'un client cite le tiers', async () => {
    await adminDb.collection('clients').doc('tiers-c1').update({ representedBy: 'Cabinet Tiers-Test' });
    await enregistrerTiers(syndicId, { name: 'Cabinet Tiers Renommé', quality: 'syndic', address: '1 rue Neuve', postalCode: '69003', city: 'Lyon' }, 't@x');
    assert.equal((await adminDb.collection('clients').doc('tiers-c1').get()).get('representedBy'), 'Cabinet Tiers Renommé');
    await assert.rejects(supprimerTiers(syndicId), /cité par 1 client/);
    await adminDb.collection('clients').doc('tiers-c1').update({ representedBy: '' });
    await supprimerTiers(syndicId);
    assert.deepEqual(await listerTiers(), []);
});

test('changement de syndic validé : la fiche est créée, puis complétée sans écraser une adresse déjà saisie', async () => {
    const { completerTiers, annuaireTiers } = await import('../src/services/tiers-admin');
    assert.equal(await completerTiers({ name: ' ' }, 't@x'), null);
    const cree = await completerTiers({ name: 'Nouveau Syndic Test', quality: 'syndic', email: 'a@example.com' }, 't@x');
    assert.equal(cree?.address, '');
    // Complément : l'adresse arrive d'un bloc, l'e-mail déjà connu est gardé.
    const complete = await completerTiers({ name: 'nouveau syndic test', address: '5 rue A', postalCode: '69001', city: 'Lyon', email: 'b@example.com' }, 't@x');
    assert.deepEqual([complete?.id, complete?.address, complete?.city, complete?.email], [cree!.id, '5 rue A', 'Lyon', 'a@example.com']);
    const inchange = await completerTiers({ name: 'Nouveau Syndic Test', address: '9 rue Z', postalCode: '75001', city: 'Paris' }, 't@x');
    assert.deepEqual([inchange?.address, inchange?.city], ['5 rue A', 'Lyon']);

    // Annuaire : noms cités sans fiche en tête, comptés dans le périmètre demandé.
    await adminDb.collection('clients').doc('tiers-c1').update({ representedBy: 'Nouveau Syndic Test' });
    await adminDb.collection('clients').doc('tiers-c3').set({ name: 'SDC Tiers Trois', representedBy: 'Syndic Sans Fiche Test' });
    const tous = (await annuaireTiers(null)).filter(l => /Test$/.test(l.name));
    assert.deepEqual(tous.map(l => [l.name, !!l.tiers, l.complet, l.representes, l.payes]), [
        ['Payeur Tiers Test', false, false, 0, 1], ['Syndic Sans Fiche Test', false, false, 1, 0], ['Nouveau Syndic Test', true, true, 1, 0],
    ]);
    const restreint = (await annuaireTiers(new Set(['tiers-c1']))).filter(l => /Test$/.test(l.name));
    assert.deepEqual(restreint.map(l => [l.name, l.representes, l.clients.map(c => c.name)]), [['Nouveau Syndic Test', 1, ['SDC Tiers Test']]]);
});
