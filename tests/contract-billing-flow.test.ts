// Facturation d'un contrat par échéancier : terme, périodicité, TVA par ligne, verrou (émulateur) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../src/lib/firebase-admin';
import { prepareContractInvoice } from '../src/services/contract-billing-admin';
import { createInvoice, convertProformaToInvoice, getInvoice } from '../src/services/firestore-admin';
import { dueDateFor } from '../src/lib/billing/contract-billing';
import { toDay } from '../src/lib/services/site-amounts';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const paris = (day: string) => Timestamp.fromDate(new Date(`${day}T00:00:00+02:00`));
const guarded = async (date: string, opts: { isProforma?: boolean; until?: string } = {}) => {
    const p = await prepareContractInvoice('fb-k', date, { isProforma: !!opts.isProforma, until: opts.until });
    return { p, create: () => createInvoice(p.invoice, p.company, { contractId: 'fb-k', billingVersion: p.billingVersion }) };
};

before(async () => {
    await set('companies', 'fb-co', { code: 'FACT', name: 'Veolia Facturation' });
    await set('vatRates', 'fb-20', { code: 'TVA20F', rate: 20 });
    await set('vatRates', 'fb-55', { code: 'TVA55F', rate: 5.5 });
    await set('schedules', 'fb-mens', { name: 'Mensuel F' });
    await set('terms', 'fb-echu', { name: 'Échu F' });
    await set('terms', 'fb-echoir', { name: 'À échoir F' });
    await set('activities', 'fb-p2', { code: 'P2F', label: 'Maintenance', type: 'P2', vatRateId: 'fb-20' });
    await set('activities', 'fb-p1', { code: 'P1F', label: 'Abonnement chaleur', type: 'P1' });   // pas de TVA par défaut
    await set('paymentTerms', 'fb-45', { code: '45FDM', deadline: '45 jours fin de mois', days: 45, endOfMonth: true });
    await set('clients', 'fb-cli', { name: 'Copropriété Facturée', companyId: 'fb-co', paymentTermId: 'fb-45' });
    await set('contracts', 'fb-k', {
        contractNumber: 'CTN-06601', clientId: 'fb-cli', clientName: 'Copropriété Facturée', companyId: 'fb-co', status: 'Actif',
        startDate: paris('2025-07-01'), endDate: paris('2030-06-30'), billingSchedule: 'Trimestriel', siteIds: ['fb-s1', 'fb-s2'],
        activityIds: ['fb-p1', 'fb-p2'], invoicingType: 'multi-site',
    });
    await set('sites', 'fb-s1', { code: 'SIT-06601', name: 'Bâtiment A', contractId: 'fb-k', amounts: [{ activityId: 'fb-p2', amount: 4000 }], termId: 'fb-echoir' });
    await set('sites', 'fb-s2', { code: 'SIT-06602', name: 'Bâtiment B', contractId: 'fb-k', amountsSource: 'services', amounts: [] });
    // P1 : mensuel, à terme échu ; P2 : trimestriel (contrat), à échoir.
    await set('services', 'fb-sv1', {
        siteId: 'fb-s2', contractId: 'fb-k', activityId: 'fb-p1', type: 'P1', price: 1840, startDate: '2025-08-01', endDate: '2030-06-30',
        isActive: true, vatRateId: 'fb-55', scheduleId: 'fb-mens', billingTermId: 'fb-echu',
    });
    await set('services', 'fb-sv2', {
        siteId: 'fb-s2', contractId: 'fb-k', activityId: 'fb-p2', type: 'P2', price: 2000, startDate: '2025-07-01', endDate: '2030-06-30',
        isActive: true, billingTermId: 'fb-echoir',
    });
});

test('rattrapage au 15/10 : chaque prestation selon sa périodicité et son terme, TVA par ligne, échéance du client', async () => {
    const { p } = await guarded('2025-10-15');
    assert.deepEqual(p.invoice.lineItems.map(l => [l.periodStartDate, l.siteId, l.activityCode, l.total, l.vatRate]), [
        ['2025-07-01', 'fb-s1', 'P2F', 1000, 20],
        ['2025-07-01', 'fb-s2', 'P2F', 500, 20],
        ['2025-08-01', 'fb-s2', 'P1F', 153.33, 5.5],     // août, échu : facturable le 01/09
        ['2025-09-01', 'fb-s2', 'P1F', 153.33, 5.5],     // septembre, échu : facturable le 01/10
        ['2025-10-01', 'fb-s1', 'P2F', 1000, 20],        // T4 à échoir : facturable le 01/10
        ['2025-10-01', 'fb-s2', 'P2F', 500, 20],
    ]);
    assert.deepEqual(p.invoice.vatBreakdown, [{ rate: 20, base: 3000, amount: 600 }, { rate: 5.5, base: 306.66, amount: 16.87 }]);
    assert.deepEqual([p.invoice.subtotal, p.invoice.tax, p.invoice.total], [3306.66, 616.87, 3923.53]);
    assert.deepEqual([p.invoice.periodStartDate, p.invoice.periodEndDate, p.invoice.dueDate], ['2025-07-01', '2025-12-31', '2025-11-30']);
});

test('après émission : seulement les nouvelles échéances ; rien à facturer avant la prochaine', async () => {
    const first = await guarded('2025-10-15');
    await first.create();
    await assert.rejects(prepareContractInvoice('fb-k', '2025-10-20', { isProforma: false }), /Rien à facturer au 20\/10\/2025 : prochaine échéance facturable le 01\/11\/2025/);
    const next = await guarded('2025-11-05');
    assert.deepEqual(next.p.invoice.lineItems.map(l => [l.periodStartDate, l.periodEndDate, l.activityCode, l.total]), [['2025-10-01', '2025-10-31', 'P1F', 153.33]]);
    // Facturation anticipée : jusqu'au 01/01, le T1 à échoir est aussi facturable.
    const ahead = await prepareContractInvoice('fb-k', '2025-11-05', { isProforma: false, until: '2026-01-01' });
    assert.equal(ahead.invoice.lineItems.filter(l => l.periodStartDate === '2026-01-01').length, 2);
});

test('deux facturations simultanées du même contrat : une seule passe', async () => {
    const [a, b] = await Promise.all([guarded('2025-11-05'), guarded('2025-11-05')]);
    const results = await Promise.allSettled([a.create(), b.create()]);
    assert.deepEqual(results.map(r => r.status).sort(), ['fulfilled', 'rejected']);
    assert.match(String((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason), /vient d'être facturé par ailleurs/);
    await assert.rejects(prepareContractInvoice('fb-k', '2025-11-05', { isProforma: false }), /Rien à facturer/);
});

test('TVA manquante : facture refusée avec les lignes concernées', async () => {
    await adminDb.collection('services').doc('fb-sv1').update({ vatRateId: '' });
    await assert.rejects(prepareContractInvoice('fb-k', '2025-12-05', { isProforma: false }), /TVA non renseignée : P1F sur le site Bâtiment B/);
    await adminDb.collection('services').doc('fb-sv1').update({ vatRateId: 'fb-55' });
});

test('proforma : occupe ses échéances ; converti, échéance recalculée à la date d\'émission', async () => {
    const pro = await guarded('2025-12-05', { isProforma: true });
    const { id } = await pro.create();
    await assert.rejects(prepareContractInvoice('fb-k', '2025-12-05', { isProforma: false }), /Rien à facturer/);
    await convertProformaToInvoice(id);
    const converted = (await getInvoice(id))!;
    assert.equal(toDay(converted.dueDate), dueDateFor(toDay(new Date())!, { days: 45, endOfMonth: true }));
});
