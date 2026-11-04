// Import des contrats et cohérence des liens clients → contrats → sites → compteurs (émulateur) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
import { adminDb } from '../src/lib/firebase-admin';
import { applyImport, planImport } from '../src/services/imports-admin';
import { createApiKey } from '../src/services/api-admin';
import { GET as list, POST as upsert } from '../src/app/api/v1/[resource]/route';
import { GET as detail } from '../src/app/api/v1/[resource]/[ref]/route';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const one = async (c: string, field: string, value: unknown) => {
    const docs = (await adminDb.collection(c).where(field, '==', value).get()).docs;
    assert.equal(docs.length, 1, `${c}.${field} = ${value} : ${docs.length} élément(s)`);
    return { id: docs[0].id, ...docs[0].data() } as any;
};
const actions = (plan: { items: { action: string }[] }) => plan.items.map(i => i.action);
const run = (entity: Parameters<typeof applyImport>[0], table: unknown[][]) => applyImport(entity, table, { fileName: 'test', by: 'admin@example.com' });

const CLIENTS = [
    ['Réf. externe', 'Raison sociale', 'Type', 'Adresse', 'Code postal', 'Ville', 'Typologie', 'Société', 'Agence', 'Secteur'],
    ['TW-C1', 'Syndic Liens', 'Privé', '1 rue des Liens', '33000', 'Bordeaux', 'Copro K', 'KTR', 'Bordeaux K', 'Bordeaux Centre K'],
];
const CONTRACTS = [
    ['Réf. externe', 'Client', 'Libellé', 'Date de début', 'Date de fin', 'Marché', 'Activités', 'Montant base P2', 'Échéancier de facturation',
        'Cadre Chorus', "N° d'engagement juridique", 'Tacite reconduction'],
    ['TW-K1', 'TW-C1', 'Chauffage Liens', '01/07/2025', '30/06/2030', 'MCI-K', 'CHAUF-K; P2-K', '12000', 'trimestriel k', 'A1', 'EJ-001', 'oui'],
];
const SITES = [
    ['Réf. externe', 'Client', 'Contrat', 'Nom du site', 'Adresse', 'Code postal', 'Ville'],
    ['TW-S1', 'TW-C1', 'TW-K1', 'Résidence Liens', '2 rue des Liens', '33000', 'Bordeaux'],
];
const METERS = [
    ['Réf. externe', 'Site', 'Nom', 'Type de compteur'],
    ['TW-M1', 'TW-S1', 'Gaz chaufferie', 'GAZ-K'],
];

before(async () => {
    await set('companies', 'k-co', { code: 'KTR', name: 'Veolia Liens' });
    await set('agencies', 'k-ag', { name: 'Bordeaux K', companyId: 'k-co' });
    await set('sectors', 'k-se', { name: 'Bordeaux Centre K', agencyId: 'k-ag' });
    await set('typologies', 'k-ty', { name: 'Copro K' });
    await set('activities', 'k-a1', { code: 'CHAUF-K', label: 'Chauffage K', type: 'P1' });
    await set('activities', 'k-a2', { code: 'P2-K', label: 'Maintenance K', type: 'P2' });
    await set('markets', 'k-mk', { code: 'MCI-K', label: 'Marché à intéressement K' });
    await set('schedules', 'k-sc', { name: 'Trimestriel K' });
    await set('meterTypes', 'k-mt', { code: 'GAZ-K', label: 'Gaz K', unit: 'kWh' });
});

test('reprise complète par références externes : clients → contrats → sites → compteurs → relevés, liens tenus des deux côtés', async () => {
    assert.equal((await run('clients', CLIENTS)).created, 1);
    const contracts = await run('contracts', CONTRACTS);
    assert.deepEqual([contracts.created, contracts.errors.length], [1, 0], JSON.stringify(contracts.errors));
    assert.match(contracts.results[0].code!, /^CTN-\d{5}$/);
    assert.equal((await run('sites', SITES)).created, 1);
    assert.equal((await run('meters', METERS)).created, 1);
    const readings = await run('readings', [['Compteur', 'Date du relevé', 'Index'], ['TW-M1', '2025-07-01', '100']]);
    assert.equal(readings.created, 1);

    const client = await one('clients', 'externalRef', 'TW-C1');
    const contract = await one('contracts', 'externalRef', 'TW-K1');
    const site = await one('sites', 'externalRef', 'TW-S1');
    const meter = await one('meters', 'externalRef', 'TW-M1');
    assert.match(client.externalCode, /^CLI-\d{5}$/);
    assert.equal(contract.clientId, client.id);
    assert.equal(contract.clientName, 'Syndic Liens');
    assert.equal(contract.name, 'Syndic Liens - Chauffage Liens');
    assert.deepEqual([contract.status, contract.validationStatus, contract.validatedBy], ['Actif', 'validated', 'import']);
    assert.ok(contract.startDate instanceof Timestamp);
    assert.equal(contract.startDate.toDate().toISOString(), '2025-06-30T22:00:00.000Z');   // 1er juillet, minuit à Paris
    assert.deepEqual(contract.activityIds, ['k-a1', 'k-a2']);
    assert.deepEqual([contract.marketId, contract.billingSchedule, contract.baseAmountP2, contract.tacitRenewal], ['k-mk', 'Trimestriel K', 12000, true]);
    assert.deepEqual(contract.chorus, { framework: 'A1', legalCommitments: [{ number: 'EJ-001', startDate: '2025-07-01', endDate: '2030-06-30' }] });
    assert.deepEqual(contract.siteIds, [site.id]);
    assert.equal(site.contractId, contract.id);
    assert.equal(site.clientId, client.id);
    assert.equal(meter.siteId, site.id);
    const reading = await one('meterReadings', 'meterId', meter.id);
    assert.equal(reading.contractId, contract.id);
});

test('réimport des mêmes fichiers : aucune création, aucune modification', async () => {
    for (const [entity, table] of [['clients', CLIENTS], ['contracts', CONTRACTS], ['sites', SITES], ['meters', METERS]] as const) {
        const plan = await planImport(entity, table as unknown[][]);
        assert.deepEqual(actions(plan), ['unchanged'], `${entity} : ${JSON.stringify(plan.items)}`);
    }
});

test('doublons probables refusés quand aucune clé ne désigne l\'élément ; une clé distincte permet de créer', async () => {
    const clients = await planImport('clients', [CLIENTS[0].slice(1), CLIENTS[1].slice(1), ['Syndic  liens', 'Privé', 'x', '33000', 'Bordeaux', 'Copro K', 'KTR', 'Bordeaux K', 'Bordeaux Centre K']]);
    assert.deepEqual(actions(clients), ['error', 'error']);
    assert.match(clients.items[0].messages[0], /Doublon probable de CLI-/);

    const contracts = await planImport('contracts', [CONTRACTS[0].slice(1), ['TW-C1', 'chauffage liens', '01/01/2028', '31/12/2032', '', '', '', '', '', '', '']]);
    assert.match(contracts.items[0].messages.join(), /Doublon probable du contrat CTN-/);
    const later = await planImport('contracts', [CONTRACTS[0].slice(1), ['TW-C1', 'Chauffage Liens', '01/07/2030', '30/06/2035', '', '', '', '', '', '', '']]);
    assert.deepEqual(actions(later), ['create'], 'période suivante : pas un doublon');

    const sites = await planImport('sites', [['Client', 'Nom du site', 'Adresse', 'Code postal'], ['TW-C1', 'Autre nom', '2 Rue des  Liens', '33000']]);
    assert.match(sites.items[0].messages.join(), /Doublon probable du site SIT-/);
    const meters = await planImport('meters', [['Site', 'Nom', 'Type de compteur'], ['TW-S1', 'gaz chaufferie', 'GAZ-K']]);
    assert.match(meters.items[0].messages.join(), /Doublon probable du compteur CPT-/);
    const withRef = await planImport('meters', [['Réf. externe', 'Site', 'Nom', 'Type de compteur'], ['TW-M2', 'TW-S1', 'Gaz chaufferie', 'GAZ-K']]);
    assert.deepEqual(actions(withRef), ['create']);

    const taken = await planImport('sites', [['Code site', 'Réf. externe'], [(await one('sites', 'externalRef', 'TW-S1')).code, 'TW-S1'], ['', 'TW-S1']]);
    assert.match(taken.items[1].messages.join(), /Réf\. externe TW-S1 déjà présent ligne 2/);
});

test('contrôles des contrats : dates, résiliation, Chorus, activités, changement de client', async () => {
    const plan = await planImport('contracts', [
        ['Réf. externe', 'Client', 'Libellé', 'Date de début', 'Date de fin', 'Statut', 'Activités', 'Cadre Chorus'],
        ['TW-K9', 'TW-C1', 'A', '2026-01-01', '2025-01-01', '', '', ''],
        ['TW-K10', 'TW-C1', 'B', '2026-01-01', '2027-01-01', 'Résilié', '', ''],
        ['TW-K11', 'TW-C1', 'C', '2026-01-01', '2027-01-01', '', 'INCONNUE', ''],
        ['TW-K12', 'TW-C1', 'D', '2026-01-01', '2027-01-01', '', '', 'A9'],
        ['TW-K13', 'CLI-99999', 'E', '2026-01-01', '2027-01-01', '', '', ''],
    ]);
    const msgs = plan.items.map(i => i.messages.join(' '));
    assert.match(msgs[0], /fin doit être postérieure/);
    assert.match(msgs[1], /Date de résiliation obligatoire/);
    assert.match(msgs[2], /Activité « INCONNUE » inconnue/);
    assert.match(msgs[3], /A9 : SIRET du valideur obligatoire/);
    assert.match(msgs[4], /Client « CLI-99999 » introuvable/);

    await run('clients', [CLIENTS[0], ['TW-C2', 'Autre Syndic', 'Privé', '9 rue X', '33100', 'Bordeaux', 'Copro K', 'KTR', 'Bordeaux K', 'Bordeaux Centre K']]);
    const change = await planImport('contracts', [['Réf. externe', 'Client'], ['TW-K1', 'TW-C2']]);
    assert.match(change.items[0].messages.join(), /Changement de client refusé : le contrat a déjà des sites/);
});

test('site déplacé vers un autre contrat : retiré de l\'ancien (encore en cours), refusé vers le contrat d\'un autre client', async () => {
    await run('contracts', [CONTRACTS[0].slice(0, 5), ['TW-K2', 'TW-C1', 'Eau chaude Liens', '01/07/2025', '30/06/2030']]);
    const report = await run('sites', [['Réf. externe', 'Contrat'], ['TW-S1', 'TW-K2']]);
    assert.equal(report.updated, 1);
    assert.match(report.results[0].warnings![0], /retiré du contrat CTN-\d+, encore en cours/);
    const [k1, k2, site] = [await one('contracts', 'externalRef', 'TW-K1'), await one('contracts', 'externalRef', 'TW-K2'), await one('sites', 'externalRef', 'TW-S1')];
    assert.deepEqual(k1.siteIds, []);
    assert.deepEqual(k2.siteIds, [site.id]);
    assert.equal(site.contractId, k2.id);

    await run('contracts', [CONTRACTS[0].slice(0, 5), ['TW-K3', 'TW-C2', 'Autre', '01/07/2025', '30/06/2030']]);
    const refused = await planImport('sites', [['Réf. externe', 'Contrat'], ['TW-S1', 'TW-K3']]);
    assert.match(refused.items[0].messages.join(), /n'appartient pas à ce client/);
});

test('renommage d\'un client : reporté sur ses contrats, sites et compteurs', async () => {
    const report = await run('clients', [['Réf. externe', 'Raison sociale'], ['TW-C1', 'Syndic Liens Renommé']]);
    assert.equal(report.updated, 1);
    const k1 = await one('contracts', 'externalRef', 'TW-K1');
    assert.deepEqual([k1.clientName, k1.name], ['Syndic Liens Renommé', 'Syndic Liens Renommé - Chauffage Liens']);
    assert.equal((await one('sites', 'externalRef', 'TW-S1')).clientName, 'Syndic Liens Renommé');
    assert.equal((await one('meters', 'externalRef', 'TW-M1')).clientName, 'Syndic Liens Renommé');
});

test('API contrats : lecture par n° et filtre client, renvoi tel quel sans effet, droits', async () => {
    const key = (await createApiKey({ name: 'ERP contrats', scopes: ['contracts:read', 'contracts:write'] })).key;
    const reqOf = (path: string, body?: unknown) => new NextRequest(`http://localhost/api/v1${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${key}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
        ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const k1 = await one('contracts', 'externalRef', 'TW-K1');
    const res = await detail(reqOf(`/contracts/${k1.contractNumber}`), { params: Promise.resolve({ resource: 'contracts', ref: k1.contractNumber }) });
    const { data } = await res.json();
    assert.equal(data.startDate, '2025-07-01');
    assert.equal(data.endDate, '2030-06-30');
    assert.equal(data.activities, 'CHAUF-K; P2-K');
    assert.equal(data.market, 'MCI-K');
    assert.equal(data.client, (await one('clients', 'externalRef', 'TW-C1')).externalCode);
    assert.deepEqual(data.sites, []);
    assert.equal(data.chorusLegalCommitments[0].number, 'EJ-001');

    const back = await (await upsert(reqOf('/contracts', [data]), { params: Promise.resolve({ resource: 'contracts' }) })).json();
    assert.deepEqual(back.summary, { created: 0, updated: 0, unchanged: 1, errors: 0 }, JSON.stringify(back));
    const byClient = await (await list(reqOf(`/contracts?client=${data.client}`), { params: Promise.resolve({ resource: 'contracts' }) })).json();
    assert.deepEqual(byClient.data.map((c: { externalRef: string }) => c.externalRef).sort(), ['TW-K1', 'TW-K2']);
});
