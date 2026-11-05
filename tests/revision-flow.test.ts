// Révision des prix de bout en bout : import, facture révisée, coefficient figé, API (émulateur) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
import { adminDb } from '../src/lib/firebase-admin';
import { applyImport, planImport } from '../src/services/imports-admin';
import { prepareContractInvoice } from '../src/services/contract-billing-admin';
import { createInvoice } from '../src/services/firestore-admin';
import { createApiKey } from '../src/services/api-admin';
import { GET as list, POST as upsert } from '../src/app/api/v1/[resource]/route';
import { addMonthsToPeriod } from '../src/lib/billing/revision';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const paris = (day: string) => Timestamp.fromDate(new Date(`${day}T00:00:00+02:00`));
const HEADER = ['Site', 'Activité', 'Date de début', 'Montant annuel HT', 'Terme', 'Règle de révision', 'Indices de base', 'Date anniversaire de révision'];

before(async () => {
    await set('companies', 'rv-co', { code: 'REVI', name: 'Veolia Révision' });
    await set('vatRates', 'rv-20', { code: 'TVA20R', rate: 20 });
    await set('activities', 'rv-p2', { code: 'P2R', label: 'Maintenance', type: 'P2', vatRateId: 'rv-20' });
    await set('terms', 'rv-echoir', { name: 'À échoir R' });
    await set('indices', 'rv-i1', { code: 'ICHTR', label: 'ICHT-E', unit: '', active: true });
    await set('indices', 'rv-i2', { code: 'FSD2R', label: 'FSD2', unit: '', active: true });
    for (let i = 0; i < 24; i++) {
        const period = addMonthsToPeriod('2025-01', i);
        await set('indexValues', `rv-i1-${period}`, { indexId: 'rv-i1', period, value: 100 + i });
        await set('indexValues', `rv-i2-${period}`, { indexId: 'rv-i2', period, value: 200 + 2 * i });
    }
    await set('revisionRules', 'rv-r', {
        code: 'P2-REV', name: 'P2 révisable', type: 'PONDERE_A_B', nbMonths: 3, lagMonths: 1, paramA: 0.15, paramB: 0.85,
        indices: [{ indexId: 'rv-i1', coefficient: 0.6 }, { indexId: 'rv-i2', coefficient: 0.4 }],
    });
    await set('clients', 'rv-cli', { name: 'Client révisé', companyId: 'rv-co' });
    await set('contracts', 'rv-k', {
        contractNumber: 'CTN-05501', clientId: 'rv-cli', clientName: 'Client révisé', companyId: 'rv-co', status: 'Actif',
        startDate: paris('2025-07-01'), endDate: paris('2027-06-30'), billingSchedule: 'Trimestriel', siteIds: ['rv-s'], activityIds: ['rv-p2'],
    });
    await set('sites', 'rv-s', { code: 'SIT-05501', name: 'Site révisé', clientId: 'rv-cli', contractId: 'rv-k' });
});

test('import : règle, indices de base et anniversaire ; contrôles', async () => {
    const report = await applyImport('services', [HEADER, ['SIT-05501', 'P2R', '2025-07-01', '4000', 'À échoir R', 'P2-REV', 'ICHTR=100@2025-01; FSD2R=200,0@2025-01', '01/01']], { by: 'admin@example.com' });
    assert.deepEqual([report.created, report.errors.length], [1, 0], JSON.stringify(report.errors));
    const svc = (await adminDb.collection('services').where('siteId', '==', 'rv-s').get()).docs[0].data();
    assert.deepEqual([svc.revisionRuleId, svc.revisionAnchor, svc.initialIndexValues], ['rv-r', '01-01', [
        { indexId: 'rv-i1', value: 100, period: '2025-01' }, { indexId: 'rv-i2', value: 200, period: '2025-01' },
    ]]);
    const plan = await planImport('services', [HEADER,
        ['SIT-05501', 'P2R', '2027-01-01', '1', '', 'P2-REV', 'ICHTR=100@2025-01', ''],
        ['SIT-05501', 'P2R', '2027-01-01', '1', '', 'INCONNUE', '', ''],
        ['SIT-05501', 'P2R', '2027-01-01', '1', '', 'P2-REV', 'ICHTR:100', '31/02'],
    ]);
    const msgs = plan.items.map(i => i.messages.join(' '));
    assert.match(msgs[0], /Indices de base manquants pour la règle P2-REV : FSD2R/);
    assert.match(msgs[1], /Règle de révision « INCONNUE » inconnue/);
    assert.match(msgs[2], /CODE=valeur@AAAA-MM attendu.*Date anniversaire de révision « 31\/02 » invalide/);
});

test('facture : prix de base puis révision au 01/01 imprimée ; coefficient figé malgré une correction d\'indice', async () => {
    const first = await prepareContractInvoice('rv-k', '2026-01-05', { isProforma: false });
    assert.deepEqual(first.invoice.lineItems.map(l => [l.periodStartDate, l.total, l.revision?.coefficient ?? null]), [
        ['2025-07-01', 1000, null], ['2025-10-01', 1000, null], ['2026-01-01', 1085, 1.085],
    ]);
    assert.match(first.invoice.lineItems[2].description, /révision P2-REV du 01\/01\/2026 ×1,0850 \(ICHTR moy\. 2025-10→2025-12 : 110/);
    await createInvoice(first.invoice, first.company, { contractId: 'rv-k', billingVersion: first.billingVersion });

    // Correction ultérieure d'un indice d'octobre 2025 : la révision du 01/01/2026 déjà facturée ne bouge pas.
    await adminDb.collection('indexValues').doc('rv-i1-2025-10').update({ value: 150 });
    const next = await prepareContractInvoice('rv-k', '2026-04-02', { isProforma: false });
    assert.deepEqual(next.invoice.lineItems.map(l => [l.periodStartDate, l.total, l.revision?.coefficient]), [['2026-04-01', 1085, 1.085]]);
});

test('API : la prestation se relit avec sa révision et se renvoie sans effet', async () => {
    const key = (await createApiKey({ name: 'Révision', scopes: ['services:read', 'services:write'] })).key;
    const reqOf = (path: string, body?: unknown) => new NextRequest(`http://localhost/api/v1${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${key}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
        ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const R = { params: Promise.resolve({ resource: 'services' }) };
    const page = await (await list(reqOf('/services?site=SIT-05501'), R)).json();
    assert.deepEqual([page.data[0].revisionRule, page.data[0].baseIndices, page.data[0].revisionAnchor], ['P2-REV', 'ICHTR=100@2025-01; FSD2R=200@2025-01', '01-01']);
    const back = await (await upsert(reqOf('/services', page.data), R)).json();
    assert.deepEqual(back.summary, { created: 0, updated: 0, unchanged: 1, errors: 0 }, JSON.stringify(back));
});
