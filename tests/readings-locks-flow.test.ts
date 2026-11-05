// Relevés écrits par le serveur : relevés figés (facture, intéressement), période facturée (émulateur) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { deleteReading, readingLocks, saveReading } from '../src/services/readings-admin';
import { planImport } from '../src/services/imports-admin';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const ids: Record<string, string> = {};

before(async () => {
    await set('contracts', 'lk-k', { contractNumber: 'CTN-07071', clientId: 'x', siteIds: ['lk-s'] });
    await set('sites', 'lk-s', { code: 'SIT-07071', name: 'Site verrous', contractId: 'lk-k' });
    await set('meters', 'lk-m', { code: 'CPT-07071', name: 'ECS', siteId: 'lk-s', unit: 'm3' });
    for (const [k, date, value] of [['sep', '2025-09-30T10:00:00Z', 1000], ['oct', '2025-10-31T10:00:00Z', 1040], ['nov', '2025-11-28T10:00:00Z', 1100]] as const) {
        ids[k] = await saveReading({ meterId: 'lk-m', date, value, type: 'REEL' }, 'a@v.fr');
    }
    // Octobre facturé au relevé (30/09 → 31/10) ; relevé de novembre repris dans un intéressement.
    await set('invoices', 'lk-inv', {
        contractId: 'lk-k', status: 'due', invoiceNumber: 'LOCK-2511-0001', lineItems: [{
            p1Releve: { siteId: 'lk-s', mois: '2025-10', volume: 40, prix: 7, montant: 280, compteurs: [{
                meterId: 'lk-m', code: 'CPT-07071', volume: 40,
                debut: { readingId: ids.sep, date: '2025-09-30', index: 1000 }, fin: { readingId: ids.oct, date: '2025-10-31', index: 1040 },
            }] },
        }],
    });
    await set('interests', 'lk-int', { meterId: 'lk-m', seasonLabel: '2025-2026', startReadingId: ids.nov });
});

test('verrous : relevés de la facture et de l\'intéressement figés, dernier relevé facturé', async () => {
    const locks = await readingLocks('lk-m');
    assert.deepEqual(locks.locked, { [ids.sep]: 'la facture LOCK-2511-0001', [ids.oct]: 'la facture LOCK-2511-0001', [ids.nov]: "l'intéressement 2025-2026" });
    assert.deepEqual(locks.lastBilled, { date: '2025-10-31', readingId: ids.oct, invoice: 'LOCK-2511-0001' });
    const stored = (await adminDb.collection('meterReadings').doc(ids.sep).get()).data()!;
    assert.deepEqual([stored.source, stored.unit, stored.contractId, stored.createdBy], ['MANUEL', 'm3', 'lk-k', 'a@v.fr']);
});

test('écran : index figé, commentaire libre, suppression refusée, période facturée protégée', async () => {
    await assert.rejects(saveReading({ id: ids.oct, meterId: 'lk-m', date: '2025-10-31T10:00:00Z', value: 1045, type: 'REEL' }, 'b@v.fr'), /Relevé repris dans la facture LOCK-2511-0001 : index, date et type ne se modifient plus/);
    await assert.rejects(saveReading({ id: ids.nov, meterId: 'lk-m', date: '2025-11-28T10:00:00Z', value: 1100, type: 'CORRIGE' }, 'b@v.fr'), /intéressement 2025-2026/);
    await saveReading({ id: ids.oct, meterId: 'lk-m', date: '2025-10-31T10:00:00Z', value: 1040, type: 'REEL', comment: 'vérifié sur place' }, 'b@v.fr');
    assert.equal((await adminDb.collection('meterReadings').doc(ids.oct).get()).get('comment'), 'vérifié sur place');
    await assert.rejects(deleteReading(ids.oct), /ne se supprime pas/);
    await assert.rejects(saveReading({ meterId: 'lk-m', date: '2025-10-15T10:00:00Z', value: 1020, type: 'REEL' }, 'b@v.fr'), /Période déjà facturée jusqu'au 31\/10\/2025 \(facture LOCK-2511-0001\)/);
    await assert.rejects(saveReading({ meterId: 'lk-m', date: '2099-01-01T00:00:00Z', value: 1, type: 'REEL' }, 'b@v.fr'), /futur/);
    await assert.rejects(saveReading({ meterId: 'lk-m', date: '2025-12-01T00:00:00Z', value: -1, type: 'REEL' }, 'b@v.fr'), /positif ou nul/);
    // Un relevé libre se modifie et se supprime.
    const dec = await saveReading({ meterId: 'lk-m', date: '2025-12-30T10:00:00Z', value: 1150, type: 'ESTIME' }, 'b@v.fr');
    await saveReading({ id: dec, meterId: 'lk-m', date: '2025-12-31T10:00:00Z', value: 1160, type: 'REEL' }, 'b@v.fr');
    assert.equal((await adminDb.collection('meterReadings').doc(dec).get()).get('value'), 1160);
    await deleteReading(dec);
    assert.equal((await adminDb.collection('meterReadings').doc(dec).get()).exists, false);
});

test('import et API : relevé antérieur à la période facturée refusé, index d\'un relevé facturé figé', async () => {
    const plan = await planImport('readings', [['Compteur', 'Date du relevé', 'Index'], ['CPT-07071', '15/10/2025', '1020'], ['CPT-07071', '31/10/2025 11:00', '1050']]);
    assert.match(plan.items[0].messages[0], /Période déjà facturée jusqu'au 31\/10\/2025 \(facture LOCK-2511-0001\)/);
    assert.match(plan.items[1].messages[0], /Relevé repris dans la facture LOCK-2511-0001 \(ECS au relevé\) : index non modifiable/);
});
