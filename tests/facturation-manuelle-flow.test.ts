// Facturation manuelle : aperçu des échéances dues et émission des seules échéances cochées (émulateur) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../src/lib/firebase-admin';
import { apercuFacturation, prepareContractInvoice } from '../src/services/contract-billing-admin';
import { apercuPdf } from '../src/services/document-archive';
import { createInvoice } from '../src/services/firestore-admin';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const paris = (day: string) => Timestamp.fromDate(new Date(`${day}T12:00:00Z`));

before(async () => {
    await set('companies', 'fman-co', { code: 'FMAN', name: 'Société Manuelle' });
    await set('vatRates', 'fman-20', { code: 'TVA20M', rate: 20 });
    await set('terms', 'fman-echoir', { name: 'À échoir M' });
    await set('activities', 'fman-p2', { code: 'P2M', label: 'Conduite', type: 'P2', vatRateId: 'fman-20' });
    await set('activities', 'fman-p3', { code: 'P3M', label: 'Garantie totale', type: 'P3', vatRateId: 'fman-20' });
    await set('paymentTerms', 'fman-45', { code: '45M', deadline: '45 jours fin de mois', days: 45, endOfMonth: true });
    await set('clients', 'fman-cli', { name: 'Client Manuel', companyId: 'fman-co', paymentTermId: 'fman-45' });
    await set('contracts', 'fman-k', {
        contractNumber: 'CTN-09931', label: 'Sous-station', clientId: 'fman-cli', clientName: 'Client Manuel', companyId: 'fman-co', status: 'Actif',
        startDate: paris('2031-01-01'), endDate: paris('2033-12-31'), billingSchedule: 'Trimestriel', siteIds: ['fman-s1'], activityIds: ['fman-p2', 'fman-p3'], invoicingType: 'multi-site',
    });
    await set('sites', 'fman-s1', { code: 'SIT-09931', name: 'Sous-station', contractId: 'fman-k', termId: 'fman-echoir', amounts: [{ activityId: 'fman-p2', amount: 8400 }, { activityId: 'fman-p3', amount: 3100 }] });
});

test('aperçu : échéances dues à la date, prochaine échéance, conditions de paiement ; rien écrit', async () => {
    const a = await apercuFacturation('fman-k', '2031-04-01');
    assert.deepEqual(a.contrat, { id: 'fman-k', numero: 'CTN-09931', libelle: 'Sous-station', client: 'Client Manuel', global: false });
    assert.deepEqual(a.echeances.map(e => [e.activite, e.debut, e.fin, e.montant]), [
        ['P2M', '2031-01-01', '2031-03-31', 2100], ['P3M', '2031-01-01', '2031-03-31', 775],
        ['P2M', '2031-04-01', '2031-06-30', 2100], ['P3M', '2031-04-01', '2031-06-30', 775],
    ]);
    assert.equal(a.prochaine, '2031-07-01');
    assert.equal(a.paiement, '45 jours fin de mois');
    assert.deepEqual(a.blocages, []);
    assert.equal((await adminDb.collection('invoices').where('contractId', '==', 'fman-k').get()).size, 0);
});

test('émission : seules les échéances cochées sont facturées, le reste demeure dû ; sélection trouée ou périmée refusée', async () => {
    const a = await apercuFacturation('fman-k', '2031-04-01');
    const [p2t1, p3t1, p2t2] = a.echeances.map(e => e.id);
    await assert.rejects(prepareContractInvoice('fman-k', '2031-04-01', { isProforma: false, selection: [p2t2] }), /plus ancienne/);
    await assert.rejects(prepareContractInvoice('fman-k', '2031-04-01', { isProforma: false, selection: ['inconnue'] }), /ont changé/);
    await assert.rejects(prepareContractInvoice('fman-k', '2031-04-01', { isProforma: false, selection: [] }), /Aucune échéance/);

    const p = await prepareContractInvoice('fman-k', '2031-04-01', { isProforma: false, selection: [p2t1, p2t2] });
    assert.deepEqual(p.invoice.lineItems.map(l => [l.activityCode, l.periodStartDate, l.total]), [['P2M', '2031-01-01', 2100], ['P2M', '2031-04-01', 2100]]);
    assert.equal(p.invoice.subtotal, 4200);
    assert.equal(p.invoice.total, 5040);
    const emise = await createInvoice(p.invoice, p.company, { contractId: 'fman-k', billingVersion: p.billingVersion });
    assert.match(emise.invoiceNumber ?? '', /^FMAN-/);

    // Le P3 non coché reste dû, le P2 est facturé jusqu'au 30/06.
    const suite = await apercuFacturation('fman-k', '2031-04-01');
    assert.deepEqual(suite.echeances.map(e => [e.activite, e.debut]), [['P3M', '2031-01-01'], ['P3M', '2031-04-01']]);
    assert.equal(suite.echeances[0].id, p3t1);
    // D'avance : l'horizon élargi propose l'échéance suivante.
    const avance = await apercuFacturation('fman-k', '2031-07-01');
    assert.deepEqual(avance.echeances.map(e => [e.activite, e.debut]), [['P3M', '2031-01-01'], ['P3M', '2031-04-01'], ['P2M', '2031-07-01'], ['P3M', '2031-07-01']]);
});

test("blocage d'une prestation : listé sur son échéance, le reste du contrat reste facturable ; aperçu PDF sans écriture", async () => {
    await set('activities', 'fman-p1', { code: 'P1M', label: 'Abonnement', type: 'P1' });   // pas de TVA : bloquant
    await set('contracts', 'fman-k2', {
        contractNumber: 'CTN-09932', clientId: 'fman-cli', clientName: 'Client Manuel', companyId: 'fman-co', status: 'Actif',
        startDate: paris('2031-01-01'), endDate: paris('2033-12-31'), billingSchedule: 'Trimestriel', siteIds: ['fman-s2'], activityIds: ['fman-p1', 'fman-p2'], invoicingType: 'multi-site',
    });
    await set('sites', 'fman-s2', { code: 'SIT-09932', name: 'Chaufferie', address: '5 rue B', postalCode: '69007', city: 'Lyon', contractId: 'fman-k2', termId: 'fman-echoir', amounts: [{ activityId: 'fman-p1', amount: 4000 }, { activityId: 'fman-p2', amount: 1200 }] });

    const a = await apercuFacturation('fman-k2', '2031-01-01');
    assert.deepEqual(a.blocages, []);
    assert.deepEqual(a.echeances.map(e => [e.activite, e.montant, e.blocage?.nature ?? null]), [['P1M', 0, 'tva'], ['P2M', 300, null]]);
    const [p1, p2] = a.echeances.map(e => e.id);
    // Sans sélection (facturation groupée), l'anomalie bloque toujours tout le contrat.
    await assert.rejects(prepareContractInvoice('fman-k2', '2031-01-01', { isProforma: false }), /TVA non renseignée/);
    await assert.rejects(prepareContractInvoice('fman-k2', '2031-01-01', { isProforma: false, selection: [p1, p2] }), /bloquée/);
    const p = await prepareContractInvoice('fman-k2', '2031-01-01', { isProforma: true, selection: [p2] });
    assert.deepEqual(p.invoice.lineItems.map(l => [l.activityCode, l.total]), [['P2M', 300]]);

    const pdf = await apercuPdf(p);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.equal((await adminDb.collection('invoices').where('contractId', '==', 'fman-k2').get()).size, 0);
});
