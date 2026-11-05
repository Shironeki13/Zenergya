// Facturation d'un contrat : période, TVA par ligne, prorata, échéance (émulateur) : npm run test:billing
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

before(async () => {
    await set('companies', 'fb-co', { code: 'FACT', name: 'Veolia Facturation' });
    await set('vatRates', 'fb-20', { code: 'TVA20F', rate: 20 });
    await set('vatRates', 'fb-55', { code: 'TVA55F', rate: 5.5 });
    await set('activities', 'fb-p2', { code: 'P2F', label: 'Maintenance', type: 'P2', vatRateId: 'fb-20' });
    await set('activities', 'fb-p1', { code: 'P1F', label: 'Abonnement chaleur', type: 'P1' });   // pas de TVA par défaut
    await set('paymentTerms', 'fb-45', { code: '45FDM', deadline: '45 jours fin de mois', days: 45, endOfMonth: true });
    await set('paymentTerms', 'fb-0', { code: 'RECEPTION', deadline: 'À réception', days: 0 });
    await set('clients', 'fb-cli', { name: 'Copropriété Facturée', companyId: 'fb-co', paymentTermId: 'fb-45' });
    await set('contracts', 'fb-k', {
        contractNumber: 'CTN-06601', clientId: 'fb-cli', clientName: 'Copropriété Facturée', companyId: 'fb-co', status: 'Actif',
        startDate: paris('2025-07-01'), endDate: paris('2030-06-30'), billingSchedule: 'Trimestriel', siteIds: ['fb-s1', 'fb-s2'],
        activityIds: ['fb-p1', 'fb-p2'], invoicingType: 'multi-site',
    });
    await set('sites', 'fb-s1', { code: 'SIT-06601', name: 'Bâtiment A', contractId: 'fb-k', amounts: [{ activityId: 'fb-p2', amount: 4000 }] });
    await set('sites', 'fb-s2', { code: 'SIT-06602', name: 'Bâtiment B', contractId: 'fb-k', amountsSource: 'services', amounts: [] });
    await set('services', 'fb-sv1', { siteId: 'fb-s2', contractId: 'fb-k', activityId: 'fb-p1', type: 'P1', price: 1840, startDate: '2025-08-01', endDate: '2030-06-30', isActive: true, vatRateId: 'fb-55' });
    await set('services', 'fb-sv2', { siteId: 'fb-s2', contractId: 'fb-k', activityId: 'fb-p2', type: 'P2', price: 2000, startDate: '2025-07-01', endDate: '2030-06-30', isActive: true });
});

test('première période : lignes par site, TVA de la prestation ou de l\'activité, prorata, échéance du client', async () => {
    const { invoice, period } = await prepareContractInvoice('fb-k', '2025-10-15', { isProforma: false });
    assert.deepEqual([period.start, period.end], ['2025-07-01', '2025-09-30']);
    assert.deepEqual(invoice.lineItems.map(l => [l.siteId, l.activityCode, l.total, l.vatRate]), [
        ['fb-s1', 'P2F', 1000, 20],
        ['fb-s2', 'P1F', 305, 5.5],       // 1 840 / 4 = 460 × 61 / 92
        ['fb-s2', 'P2F', 500, 20],
    ]);
    assert.deepEqual(invoice.vatBreakdown, [{ rate: 20, base: 1500, amount: 300 }, { rate: 5.5, base: 305, amount: 16.78 }]);
    assert.deepEqual([invoice.subtotal, invoice.tax, invoice.total, invoice.taxRate], [1805, 316.78, 2121.78, undefined]);
    assert.equal(invoice.dueDate, '2025-11-30');   // 15/10 + 45 j = 29/11, fin de mois
    assert.deepEqual([invoice.periodStartDate, invoice.periodEndDate, invoice.status], ['2025-07-01', '2025-09-30', 'due']);
});

test('période suivante après émission ; période déjà facturée refusée ; conditions du contrat prioritaires', async () => {
    const first = await prepareContractInvoice('fb-k', '2025-10-15', { isProforma: false, expectedPeriodStart: '2025-07-01' });
    await createInvoice(first.invoice, first.company);
    await assert.rejects(prepareContractInvoice('fb-k', '2025-10-15', { isProforma: false, expectedPeriodStart: '2025-07-01' }), /déjà facturée \(prochaine période : 2025-10-01\)/);

    await adminDb.collection('contracts').doc('fb-k').update({ paymentTermId: 'fb-0' });
    const second = await prepareContractInvoice('fb-k', '2025-12-01', { isProforma: false });
    assert.equal(second.period.start, '2025-10-01');
    assert.equal(second.invoice.dueDate, '2025-12-01');
    assert.equal(second.invoice.lineItems.find(l => l.activityCode === 'P1F')!.total, 460);   // trimestre plein
});

test('TVA manquante : facture refusée avec les lignes concernées', async () => {
    await adminDb.collection('services').doc('fb-sv1').update({ vatRateId: '' });
    await assert.rejects(prepareContractInvoice('fb-k', '2025-12-01', { isProforma: false }), /TVA non renseignée : P1F sur le site Bâtiment B/);
    await adminDb.collection('services').doc('fb-sv1').update({ vatRateId: 'fb-55' });
});

test('proforma converti : échéance recalculée à la date d\'émission, selon les conditions de paiement', async () => {
    await adminDb.collection('contracts').doc('fb-k').update({ paymentTermId: 'fb-45' });
    const pro = await prepareContractInvoice('fb-k', '2025-12-01', { isProforma: true });
    const { id } = await createInvoice(pro.invoice, pro.company);
    // Un proforma en attente occupe sa période : pas de seconde facture pour la même période.
    await assert.rejects(prepareContractInvoice('fb-k', '2025-12-01', { isProforma: false, expectedPeriodStart: '2025-10-01' }), /déjà facturée/);
    await convertProformaToInvoice(id);
    const converted = (await getInvoice(id))!;
    const today = toDay(new Date())!;
    assert.equal(toDay(converted.dueDate), dueDateFor(today, { days: 45, endOfMonth: true }));
});
