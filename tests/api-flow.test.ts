// API externe (émulateur Firestore) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { adminDb } from '../src/lib/firebase-admin';
import { createApiKey, listApiKeys, revokeApiKey } from '../src/services/api-admin';
import { GET as list, POST as upsert } from '../src/app/api/v1/[resource]/route';
import { GET as detail } from '../src/app/api/v1/[resource]/[ref]/route';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const BASE = 'http://localhost/api/v1';
const req = (path: string, key?: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    new NextRequest(`${BASE}${path}`, {
        method: init.method ?? 'GET',
        headers: { ...(key && { authorization: `Bearer ${key}` }), ...(init.body !== undefined && { 'content-type': 'application/json' }), ...init.headers },
        ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
    });
const params = <T extends object>(p: T) => ({ params: Promise.resolve(p) });

let full = '';
let readOnly = '';

before(async () => {
    await adminDb.collection('companies').doc('api-co').set({ code: 'APIC', name: 'Veolia API' });
    await adminDb.collection('agencies').doc('api-ag').set({ name: 'Nantes', companyId: 'api-co' });
    await adminDb.collection('sectors').doc('api-se').set({ name: 'Nantes Nord', agencyId: 'api-ag' });
    await adminDb.collection('typologies').doc('api-ty').set({ name: 'Bailleur' });
    full = (await createApiKey({ name: 'ERP test', scopes: ['clients:read', 'clients:write', 'contacts:read', 'contacts:write'] }, 'admin@example.com')).key;
    readOnly = (await createApiKey({ name: 'Lecture seule', scopes: ['clients:read'] })).key;
});

test('clés : format, empreinte seule stockée, refus sans clé, clé fausse, droit manquant', async () => {
    assert.match(full, /^zen_[A-Za-z0-9]{10}_[A-Za-z0-9_-]{43}$/);
    const stored = (await adminDb.collection('apiKeys').where('name', '==', 'ERP test').get()).docs[0].data();
    // Secret entier, après le préfixe « zen_xxxxxxxxxx_ » (il peut lui-même contenir « _ »).
    assert.ok(stored.hash && !JSON.stringify(stored).includes(full.slice(full.indexOf('_', 4) + 1)), 'le secret n\'est jamais stocké');
    assert.ok((await listApiKeys()).every(k => !('hash' in k)));

    assert.equal((await list(req('/clients'), params({ resource: 'clients' }))).status, 401);
    const wrong = full.slice(0, -4) + 'AAAA';
    const bad = await list(req('/clients', wrong), params({ resource: 'clients' }));
    assert.equal(bad.status, 401);
    assert.equal((await bad.json()).error.code, 'unauthorized');
    const forbidden = await upsert(req('/clients', readOnly, { method: 'POST', body: [{ name: 'X' }] }), params({ resource: 'clients' }));
    assert.equal(forbidden.status, 403);
    assert.equal((await list(req('/clients', full), params({ resource: 'inconnue' }))).status, 404);
});

test('écriture par lot : mêmes contrôles que l\'import, résultat par élément, puis lecture par code', async () => {
    const body = [
        { name: 'Office HLM Ouest', clientType: 'public', siret: '88877766100024', address: '1 quai', postalCode: '44000', city: 'Nantes',
          typology: 'Bailleur', company: 'APIC', agency: 'Nantes', sector: 'Nantes Nord', useChorus: true, quoteCoefficient: 1.25 },
        { name: 'Sans rattachement', clientType: 'private', address: '2 rue', postalCode: '44000', city: 'Nantes' },
    ];
    const res = await upsert(req('/clients', full, { method: 'POST', body }), params({ resource: 'clients' }));
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.deepEqual(out.summary, { created: 1, updated: 0, unchanged: 0, errors: 1 });
    assert.equal(out.results[0].status, 'created');
    assert.match(out.results[0].code, /^CLI-\d{5}$/);
    assert.equal(out.results[0].id, undefined, 'pas d\'identifiant interne exposé');
    assert.equal(out.results[1].status, 'error');
    assert.ok(out.results[1].errors.some((e: string) => e.includes('obligatoire')));

    const code = out.results[0].code;
    const one = await (await detail(req(`/clients/${code}`, readOnly), params({ resource: 'clients', ref: code }))).json();
    assert.equal(one.data.name, 'Office HLM Ouest');
    assert.equal(one.data.company, 'APIC');
    assert.equal(one.data.agency, 'Nantes');
    assert.equal(one.data.useChorus, true);
    assert.equal(one.data.companyId, undefined, 'représentation en codes et noms');
    // Ce qui se lit se renvoie tel quel : mise à jour sans effet.
    const back = await (await upsert(req('/clients', full, { method: 'POST', body: [one.data] }), params({ resource: 'clients' }))).json();
    assert.equal(back.results[0].status, 'unchanged');

    const unknownField = await upsert(req('/clients', full, { method: 'POST', body: [{ nom: 'X' }] }), params({ resource: 'clients' }));
    assert.equal(unknownField.status, 400);
    assert.equal((await unknownField.json()).error.code, 'unknown_field');
    assert.equal((await detail(req('/clients/CLI-99999', full), params({ resource: 'clients', ref: 'CLI-99999' }))).status, 404);
});

test('idempotence : même clé et même requête → même réponse sans réécriture ; requête différente → 422', async () => {
    const client = (await adminDb.collection('clients').where('siret', '==', '88877766100024').get()).docs[0].data().externalCode;
    const body = [{ client, type: 'principal', name: 'Jeanne Leroy', email: 'jeanne.leroy@hlm.fr' }];
    const headers = { 'idempotency-key': 'commande-42' };
    const first = await upsert(req('/contacts', full, { method: 'POST', body, headers }), params({ resource: 'contacts' }));
    const firstBody = await first.json();
    assert.equal(firstBody.results[0].status, 'created');
    const replay = await upsert(req('/contacts', full, { method: 'POST', body, headers }), params({ resource: 'contacts' }));
    assert.equal(replay.headers.get('Idempotent-Replayed'), 'true');
    assert.deepEqual(await replay.json(), firstBody);
    assert.equal((await adminDb.collection('contacts').where('email', '==', 'jeanne.leroy@hlm.fr').get()).size, 1);
    const conflict = await upsert(req('/contacts', full, { method: 'POST', body: [{ ...body[0], phone: '02' }], headers }), params({ resource: 'contacts' }));
    assert.equal(conflict.status, 422);
});

test('pagination par curseur et filtres', async () => {
    const client = (await adminDb.collection('clients').where('siret', '==', '88877766100024').get()).docs[0].data().externalCode;
    await upsert(req('/contacts', full, { method: 'POST', body: [
        { client, type: 'technique', name: 'Paul A', email: 'paul.a@hlm.fr' },
        { client, type: 'facturation', name: 'Lea B', email: 'lea.b@hlm.fr' },
    ] }), params({ resource: 'contacts' }));
    const p1 = await (await list(req(`/contacts?client=${client}&limit=2`, full), params({ resource: 'contacts' }))).json();
    assert.equal(p1.data.length, 2);
    assert.ok(p1.nextCursor);
    const p2 = await (await list(req(`/contacts?client=${client}&limit=2&cursor=${p1.nextCursor}`, full), params({ resource: 'contacts' }))).json();
    assert.equal(p2.data.length, 1);
    assert.equal(p2.nextCursor, null);
    assert.ok([...p1.data, ...p2.data].every((c: { client: string }) => c.client === client));
    assert.equal((await list(req('/contacts?inconnu=1', full), params({ resource: 'contacts' }))).status, 400);
});

test('limite de débit, révocation, expiration, journal', async () => {
    const { key, record } = await createApiKey({ name: 'Petit débit', scopes: ['clients:read'], rateLimitPerMinute: 2 });
    for (let i = 0; i < 2; i++) assert.equal((await list(req('/clients?limit=1', key), params({ resource: 'clients' }))).status, 200);
    const limited = await list(req('/clients?limit=1', key), params({ resource: 'clients' }));
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('Retry-After')) > 0);

    await revokeApiKey(record.id, 'admin@example.com');
    assert.equal((await list(req('/clients', key), params({ resource: 'clients' }))).status, 401);
    const expired = (await createApiKey({ name: 'Expirée', scopes: ['clients:read'], expiresAt: '2020-01-01' })).key;
    assert.equal((await list(req('/clients', expired), params({ resource: 'clients' }))).status, 401);

    const logs = await adminDb.collection('apiLogs').where('keyName', '==', 'Petit débit').get();
    assert.deepEqual(logs.docs.map(d => d.get('status')).sort(), [200, 200, 429]);
});
