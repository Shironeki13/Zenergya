// Relevés de compteurs par l'API et par import de fichier (émulateur Firestore) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
import { adminDb } from '../src/lib/firebase-admin';
import { createApiKey } from '../src/services/api-admin';
import { applyImport } from '../src/services/imports-admin';
import { GET as list, POST as upsert } from '../src/app/api/v1/[resource]/route';
import { GET as detail } from '../src/app/api/v1/[resource]/[ref]/route';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const BASE = 'http://localhost/api/v1';
const req = (path: string, key: string, body?: unknown) => new NextRequest(`${BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${key}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
});
const R = { params: Promise.resolve({ resource: 'readings' }) };
const one = (ref: string) => ({ params: Promise.resolve({ resource: 'readings', ref }) });
const post = async (key: string, body: unknown) => (await upsert(req('/readings', key, body), R)).json();
const get = async (key: string, query: string) => (await list(req(`/readings${query}`, key), R)).json();

let key = '';
let readOnly = '';

before(async () => {
    await adminDb.collection('contracts').doc('rd-ctr').set({ contractNumber: 'CTN-08800', clientId: 'x', siteIds: ['rd-site'] });
    await adminDb.collection('sites').doc('rd-site').set({ code: 'SIT-08800', name: 'Chaufferie test', clientId: 'x' });
    await adminDb.collection('meters').doc('rd-m1').set({ code: 'CPT-08801', name: 'Gaz', siteId: 'rd-site', type: 'Gaz', unit: 'kWh', status: 'on' });
    await adminDb.collection('meters').doc('rd-m2').set({ code: 'CPT-08802', name: 'Eau', siteId: 'rd-site', type: 'Eau', unit: 'm3', status: 'off' });
    key = (await createApiKey({ name: 'Télérelève', scopes: ['readings:read', 'readings:write'] })).key;
    readOnly = (await createApiKey({ name: 'Relevés lecture', scopes: ['readings:read'] })).key;
});

test('envoi par lot : création, contrôles, avertissement de baisse d\'index, contrat du site, date en horodatage', async () => {
    const out = await post(key, [
        { meter: 'CPT-08801', date: '2025-01-01', value: 1000 },
        { meter: 'cpt-08801', date: '2025-02-01', value: 1500, type: 'AUTO' },
        { meter: 'CPT-08801', date: '2025-03-01', value: 1400, comment: 'compteur changé' },
        { meter: 'CPT-99999', date: '2025-01-01', value: 1 },
        { meter: 'CPT-08801', date: '2099-01-01', value: 2000 },
        { meter: 'CPT-08801', date: '01/01/2025', value: 0 },
        { meter: 'CPT-08801', date: '2025-04-01' },
    ]);
    assert.deepEqual(out.summary, { created: 3, updated: 0, unchanged: 0, errors: 4 });
    assert.deepEqual(out.results.map((r: { status: string }) => r.status), ['created', 'created', 'created', 'error', 'error', 'error', 'error']);
    assert.ok(out.results[0].id);
    assert.match(out.results[2].warnings[0], /inférieur au relevé précédent \(1500/);
    assert.match(out.results[3].errors[0], /introuvable/);
    assert.match(out.results[4].errors[0], /Date future/);
    assert.match(out.results[5].errors[0], /ligne 2/);
    assert.match(out.results[6].errors[0], /Index obligatoire/);

    const stored = (await adminDb.collection('meterReadings').doc(out.results[0].id).get()).data()!;
    assert.ok(stored.date instanceof Timestamp);
    assert.equal(stored.date.toDate().toISOString(), '2024-12-31T23:00:00.000Z');   // minuit, heure de Paris
    assert.equal(stored.source, 'API');
    assert.equal(stored.type, 'REEL');
    assert.equal(stored.unit, 'kWh');
    assert.equal(stored.contractId, 'rd-ctr');
});

test('lecture : tri par date, période, pagination, détail ; ce qui se lit se renvoie sans effet', async () => {
    const all = await get(readOnly, '?meter=CPT-08801');
    assert.deepEqual(all.data.map((r: { value: number }) => r.value), [1000, 1500, 1400]);
    assert.deepEqual(all.data[0], {
        id: all.data[0].id, meter: 'CPT-08801', date: '2024-12-31T23:00:00.000Z', value: 1000, unit: 'kWh', type: 'REEL', source: 'API', contract: 'CTN-08800',
    });
    const feb = await get(readOnly, '?meter=CPT-08801&from=2025-01-15&to=2025-03-01');
    assert.deepEqual(feb.data.map((r: { value: number }) => r.value), [1500]);

    const p1 = await get(readOnly, '?meter=CPT-08801&limit=2');
    assert.equal(p1.data.length, 2);
    const p2 = await get(readOnly, `?meter=CPT-08801&limit=2&cursor=${p1.nextCursor}`);
    assert.deepEqual(p2.data.map((r: { value: number }) => r.value), [1400]);
    assert.equal(p2.nextCursor, null);
    assert.equal((await list(req('/readings?cursor=nimporte', readOnly), R)).status, 400);
    assert.equal((await list(req('/readings?from=hier', readOnly), R)).status, 400);

    const d = await (await detail(req(`/readings/${all.data[1].id}`, readOnly), one(all.data[1].id))).json();
    assert.equal(d.data.type, 'AUTO');
    assert.equal((await detail(req('/readings/inconnu', readOnly), one('inconnu'))).status, 404);
    assert.equal((await detail(req('/readings/a%2Fb', readOnly), one('a/b'))).status, 404);

    const back = await post(key, all.data);
    assert.deepEqual(back.summary, { created: 0, updated: 0, unchanged: 3, errors: 0 });
    assert.equal((await upsert(req('/readings', readOnly, [{ meter: 'CPT-08801', date: '2025-05-01', value: 1 }]), R)).status, 403);
});

test('site : relevés de tous ses compteurs ; compteur hors service signalé', async () => {
    const out = await post(key, [{ meter: 'CPT-08802', date: '2025-01-15T08:30:00+01:00', value: 12.5 }]);
    assert.equal(out.results[0].status, 'created');
    assert.match(out.results[0].warnings[0], /hors service/);
    const site = await get(readOnly, '?site=SIT-08800');
    assert.deepEqual(site.data.map((r: { meter: string; value: number }) => `${r.meter}:${r.value}`), ['CPT-08801:1000', 'CPT-08802:12.5', 'CPT-08801:1500', 'CPT-08801:1400']);
    assert.equal(site.data[1].date, '2025-01-15T07:30:00.000Z');
    assert.deepEqual((await get(readOnly, '?site=SIT-INCONNU')).data, []);
});

test('relevé repris dans un intéressement : index figé, commentaire modifiable', async () => {
    const jan = (await get(readOnly, '?meter=CPT-08801&to=2025-01-02')).data[0];
    await adminDb.collection('interests').doc('rd-int').set({ seasonLabel: '2024-2025', startReadingId: jan.id, endReadingId: 'autre' });
    const refused = await post(key, [{ meter: 'CPT-08801', date: jan.date, value: 999 }]);
    assert.match(refused.results[0].errors[0], /intéressement 2024-2025 : index non modifiable/);
    const ok = await post(key, [{ meter: 'CPT-08801', date: jan.date, value: 1000, comment: 'vérifié' }]);
    assert.equal(ok.results[0].status, 'updated');
    assert.equal((await adminDb.collection('meterReadings').doc(jan.id).get()).get('comment'), 'vérifié');
});

test('import de fichier : formats français, relevé à date texte (ancienne saisie) retrouvé et mis à jour', async () => {
    const legacy = await adminDb.collection('meterReadings').add({
        meterId: 'rd-m2', date: '2025-02-28T23:00:00.000Z', value: 20, type: 'REEL', source: 'MANUEL', unit: 'm3',
    });
    const report = await applyImport('readings', [
        ['Compteur', 'Date du relevé', 'Index', 'Type de relevé'],
        ['CPT-08802', '01/03/2025', '21,5', 'Corrigé'],
        ['CPT-08802', '01/04/2025 06:00', '30', ''],
    ], { fileName: 'releves.csv', by: 'admin@example.com' });
    assert.deepEqual([report.created, report.updated, report.errors.length], [1, 1, 0]);
    assert.equal(report.results[0].id, legacy.id);
    const updated = (await legacy.get()).data()!;
    assert.deepEqual([updated.value, updated.type], [21.5, 'CORRIGE']);
    const created = (await adminDb.collection('meterReadings').doc(report.results[1].id).get()).data()!;
    assert.equal(created.source, 'IMPORT');
    assert.equal(created.date.toDate().toISOString(), '2025-04-01T04:00:00.000Z');   // heure d'été
});
