// Prestations : import, contrôles, montants des sites calculés, API (émulateur) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
import { adminDb } from '../src/lib/firebase-admin';
import { applyImport, planImport } from '../src/services/imports-admin';
import { recomputeSiteAmounts } from '../src/services/site-amounts-admin';
import { todayInParis } from '../src/lib/services/site-amounts';
import { createApiKey } from '../src/services/api-admin';
import { GET as list, POST as upsert } from '../src/app/api/v1/[resource]/route';
import { GET as detail } from '../src/app/api/v1/[resource]/[ref]/route';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const site = async (id: string) => (await adminDb.collection('sites').doc(id).get()).data()!;
const run = (table: unknown[][]) => applyImport('services', table, { fileName: 'prestations.csv', by: 'admin@example.com' });
const HEADER = ['Site', 'Activité', 'Date de début', 'Date de fin', 'Montant annuel HT', 'Compteur', 'TVA', 'Périodicité'];
// Dates relatives au jour du test : une prestation passée, une en cours.
const year = Number(todayInParis().slice(0, 4));
const past = { start: `${year - 2}-07-01`, end: `${year - 1}-06-30` };
const current = `${year - 1}-07-01`;
const contractStart = `${year - 2}-07-01`;
const contractEnd = `${year + 3}-06-30`;
const paris = (day: string) => Timestamp.fromDate(new Date(`${day}T00:00:00+02:00`));

before(async () => {
    await set('activities', 'sv-p1', { code: 'P1S', label: 'Chauffage S', type: 'P1' });
    await set('activities', 'sv-p2', { code: 'P2S', label: 'Maintenance S', type: 'P2' });
    await set('activities', 'sv-p3', { code: 'P3S', label: 'Gros entretien S', type: 'P3' });
    await set('schedules', 'sv-t', { name: 'Trimestriel S' });
    await set('vatRates', 'sv-v', { code: 'TVA20S', rate: 0.2 });
    await set('clients', 'sv-cli', { name: 'Client prestations', externalCode: 'CLI-07700' });
    await set('contracts', 'sv-k1', {
        contractNumber: 'CTN-07701', clientId: 'sv-cli', siteIds: ['sv-s1'], activityIds: ['sv-p1', 'sv-p2'], status: 'Actif',
        startDate: paris(contractStart), endDate: paris(contractEnd),
    });
    await set('contracts', 'sv-k2', { contractNumber: 'CTN-07702', clientId: 'sv-cli', siteIds: [], activityIds: ['sv-p2'], status: 'Actif', startDate: paris(contractStart), endDate: paris(contractEnd) });
    await set('sites', 'sv-s1', { code: 'SIT-07701', name: 'Chaufferie S', clientId: 'sv-cli', contractId: 'sv-k1', amounts: [{ activityId: 'sv-p2', amount: 1 }] });
    await set('sites', 'sv-s2', { code: 'SIT-07702', name: 'Sans contrat', clientId: 'sv-cli', contractId: '' });
    await set('sites', 'sv-s3', { code: 'SIT-07703', name: 'Manuel', clientId: 'sv-cli', contractId: 'sv-k2', amounts: [{ activityId: 'sv-p2', amount: 500 }] });
    await set('meters', 'sv-m1', { code: 'CPT-07701', siteId: 'sv-s1', name: 'Gaz', status: 'on' });
    await set('meters', 'sv-m2', { code: 'CPT-07702', siteId: 'sv-s3', name: 'Gaz', status: 'on' });
});

test('import : prestations créées, fin par défaut = fin du contrat, montants du site recalculés', async () => {
    const report = await run([
        HEADER,
        ['SIT-07701', 'P2S', past.start, past.end, '4000', '', 'TVA20S', 'Trimestriel S'],
        ['SIT-07701', 'p2s', current, '', '4200,105', '', '', ''],
        ['SIT-07701', 'P1S', contractStart, '', '1000', 'CPT-07701', '', ''],
    ]);
    assert.deepEqual([report.created, report.errors.length], [3, 0], JSON.stringify(report.errors));
    const services = (await adminDb.collection('services').where('siteId', '==', 'sv-s1').get()).docs.map(d => d.data());
    const p2 = services.find(s => s.startDate === current)!;
    assert.deepEqual([p2.contractId, p2.type, p2.endDate, p2.isActive, p2.price], ['sv-k1', 'P2', contractEnd, true, 4200.105]);
    assert.equal(services.find(s => s.activityId === 'sv-p1')!.meterId, 'sv-m1');
    assert.equal(services.find(s => s.startDate === past.start && s.activityId === 'sv-p2')!.vatRateId, 'sv-v');

    const s1 = await site('sv-s1');
    assert.equal(s1.amountsSource, 'services');
    assert.deepEqual(s1.amounts, [{ activityId: 'sv-p1', amount: 1000 }, { activityId: 'sv-p2', amount: 4200.11 }]);
    assert.deepEqual(s1.activityIds, ['sv-p1', 'sv-p2']);
});

test('contrôles : recouvrement, activité hors contrat, site sans contrat, compteur', async () => {
    const plan = await planImport('services', [
        HEADER,
        ['SIT-07701', 'P2S', `${year}-01-01`, '', '10', '', '', ''],
        ['SIT-07701', 'P3S', current, '', '10', '', '', ''],
        ['SIT-07702', 'P2S', current, '', '10', '', '', ''],
        ['SIT-07701', 'P1S', `${year + 4}-01-01`, '', '10', 'CPT-07702', '', ''],
        ['SIT-07703', 'P2S', current, '', '10', 'CPT-07702', '', ''],
        ['SIT-07703', 'P2S', current, `${year}-12-31`, '10', '', '', ''],
        ['SIT-07703', 'P2S', `${year}-06-01`, '', '10', '', '', ''],
        ['SIT-07703', 'P2S', current, '', '', '', '', 'Mensuel inconnu'],
    ]);
    const msgs = plan.items.map(i => i.messages.join(' '));
    assert.match(msgs[0], /Recouvre la prestation P2S/);
    assert.match(msgs[1], /Activité P3S absente du contrat CTN-07701/);
    assert.match(msgs[2], /sans contrat/);
    assert.match(msgs[3], /n'est pas sur ce site/);
    assert.match(msgs[4], /ne se rattache qu'à une prestation P1/);
    assert.equal(plan.items[5].action, 'create');
    assert.match(msgs[6], /Recouvre la prestation de la ligne 7/);
    assert.match(msgs[7], /Périodicité « Mensuel inconnu » inconnue/);
});

test('réimport sans effet ; modification retrouvée par site + activité + date de début ; site manuel intact', async () => {
    const same = await planImport('services', [HEADER, ['SIT-07701', 'P2S', current, '', '4200,105', '', '', '']]);
    assert.deepEqual(same.items.map(i => i.action), ['unchanged']);
    const report = await run([['Site', 'Activité', 'Date de début', 'Montant annuel HT'], ['SIT-07701', 'P2S', current, '4300']]);
    assert.equal(report.updated, 1);
    assert.deepEqual((await site('sv-s1')).amounts, [{ activityId: 'sv-p1', amount: 1000 }, { activityId: 'sv-p2', amount: 4300 }]);

    // Recalcul de tous les sites : le site sans prestation garde ses montants saisis.
    await recomputeSiteAmounts();
    assert.deepEqual((await site('sv-s3')).amounts, [{ activityId: 'sv-p2', amount: 500 }]);
    assert.equal((await site('sv-s3')).amountsSource, undefined);
    // À une date passée, c'est la prestation de l'époque qui est en vigueur.
    const then = await recomputeSiteAmounts(['sv-s1'], { day: `${year - 1}-01-15`, dryRun: true });
    assert.deepEqual(then.changes[0].after, [{ activityId: 'sv-p1', amount: 1000 }, { activityId: 'sv-p2', amount: 4000 }]);
});

test('API prestations : liste par site, détail, renvoi tel quel sans effet ; montants du site exposés', async () => {
    const key = (await createApiKey({ name: 'ERP prestations', scopes: ['services:read', 'services:write', 'sites:read'] })).key;
    const reqOf = (path: string, body?: unknown) => new NextRequest(`http://localhost/api/v1${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${key}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
        ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const R = { params: Promise.resolve({ resource: 'services' }) };
    const page = await (await list(reqOf('/services?site=SIT-07701'), R)).json();
    assert.equal(page.data.length, 3);
    const p1 = page.data.find((s: { activity: string }) => s.activity === 'P1S');
    assert.deepEqual([p1.site, p1.contract, p1.meter, p1.type, p1.startDate, p1.endDate], ['SIT-07701', 'CTN-07701', 'CPT-07701', 'P1', contractStart, contractEnd]);
    const one = await (await detail(reqOf(`/services/${p1.id}`), { params: Promise.resolve({ resource: 'services', ref: p1.id }) })).json();
    assert.equal(one.data.price, 1000);
    const back = await (await upsert(reqOf('/services', page.data), R)).json();
    assert.deepEqual(back.summary, { created: 0, updated: 0, unchanged: 3, errors: 0 }, JSON.stringify(back));

    const s1 = await (await detail(reqOf('/sites/SIT-07701'), { params: Promise.resolve({ resource: 'sites', ref: 'SIT-07701' }) })).json();
    assert.deepEqual(s1.data.amounts, { P1S: 1000, P2S: 4300 });
    assert.equal(s1.data.amountsSource, 'services');
});

test('site déplacé vers un contrat sans prestation : plus aucun montant facturé', async () => {
    const report = await applyImport('sites', [['Code site', 'Contrat'], ['SIT-07701', 'CTN-07702']], { by: 'admin@example.com' });
    assert.equal(report.updated, 1, JSON.stringify(report.errors));
    const s1 = await site('sv-s1');
    assert.deepEqual([s1.contractId, s1.amounts, s1.amountsSource], ['sv-k2', [], 'services']);
});
