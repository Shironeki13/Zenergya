// Facturation manuelle : aperçu des échéances dues et émission des seules échéances cochées (émulateur) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../src/lib/firebase-admin';
import { apercuFacturation, prepareContractInvoice, previewBatchBilling } from '../src/services/contract-billing-admin';
import { apercuPdf } from '../src/services/document-archive';
import { creerFactureEnergie, facturesEnergieDuSite, modifierFactureEnergie, supprimerFactureEnergie } from '../src/services/factures-energie-admin';
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
    // Contrôle avant émission : ce qui a été facturé sert de référence.
    assert.equal(suite.precedent.nombre, 1);
    assert.deepEqual([suite.precedent.derniere?.numero, suite.precedent.derniere?.totalHT], [emise.invoiceNumber, 4200]);
    assert.deepEqual(Object.values(suite.precedent.parCle).map(l => [l.montant, l.jours, l.fin]), [[4200, 181, '2031-06-30']]);
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

test('file de travail : retard compté depuis la plus ancienne échéance réellement à facturer', async () => {
    const lignes = await previewBatchBilling('2031-04-11');
    const k = lignes.find(l => l.contractId === 'fman-k')!;
    // Le P2 est facturé jusqu'au 30/06 ; le P3 est dû depuis le 01/01 (à échoir).
    assert.deepEqual([k.periodStart, k.periodEnd, k.subtotal, k.dueSince], ['2031-01-01', '2031-06-30', 1550, '2031-01-01']);
    const k2 = lignes.find(l => l.contractId === 'fman-k2')!;
    assert.match(k2.error ?? '', /TVA non renseignée/);
    assert.equal(k2.dueSince, '2031-01-01');
});

test('refacturation à l\'euro l\'euro : facture du fournisseur saisie, proposée une fois, refacturée, puis verrouillée', async () => {
    await set('activities', 'fman-p1e', { code: 'P1RM', label: 'Énergie refacturée', type: 'P1', vatRateId: 'fman-20' });
    await set('contracts', 'fman-k3', {
        contractNumber: 'CTN-09933', clientId: 'fman-cli', clientName: 'Client Manuel', companyId: 'fman-co', status: 'Actif',
        startDate: paris('2031-01-01'), endDate: paris('2033-12-31'), billingSchedule: 'Trimestriel', siteIds: ['fman-s3'], activityIds: ['fman-p1e'], invoicingType: 'multi-site',
    });
    await set('sites', 'fman-s3', { code: 'SIT-09933', name: 'Chaufferie refacturée', contractId: 'fman-k3', amountsSource: 'services', amounts: [] });
    await set('services', 'fman-ee', { siteId: 'fman-s3', contractId: 'fman-k3', activityId: 'fman-p1e', type: 'P1', p1Type: 'REFACTURATION', startDate: paris('2031-01-01'), isActive: true });

    const f1 = await creerFactureEnergie('fman-s3', { fournisseur: 'Gaz du Sud', numero: 'G-501', date: '2031-02-10', debut: '2031-01-01', fin: '2031-01-31', montantHT: 1254.3 }, 'adv@v.fr');
    const f2 = await creerFactureEnergie('fman-s3', { fournisseur: 'Gaz du Sud', numero: 'G-502', date: '2031-03-10', montantHT: 980 }, 'adv@v.fr');
    await assert.rejects(creerFactureEnergie('fman-s3', { fournisseur: 'gaz du sud', numero: 'G-501', date: '2031-02-11', montantHT: 1 }, 'adv@v.fr'), /déjà saisie sur ce site/);
    await assert.rejects(creerFactureEnergie('fman-s3', { fournisseur: '', numero: '', date: '', montantHT: 0 }, 'adv@v.fr'), /Fournisseur obligatoire/);

    // Au 28/02 : seule la facture de février est proposée, au montant exact.
    const a = await apercuFacturation('fman-k3', '2031-02-28');
    assert.deepEqual(a.echeances.map(e => [e.activite, e.montant, e.debut, e.fin]), [['P1RM', 1254.3, '2031-01-01', '2031-01-31']]);
    const p = await prepareContractInvoice('fman-k3', '2031-02-28', { isProforma: false, selection: [a.echeances[0].id] });
    assert.equal(p.invoice.lineItems[0].refacturation?.factureId, f1);
    assert.deepEqual([p.invoice.subtotal, p.invoice.tax, p.invoice.total], [1254.3, 250.86, 1505.16]);
    const emise = await createInvoice(p.invoice, p.company, { contractId: 'fman-k3', billingVersion: p.billingVersion });

    // Suivi sur le site : la première est refacturée et verrouillée, la seconde reste à refacturer et modifiable.
    const suivi = await facturesEnergieDuSite('fman-s3');
    assert.deepEqual(suivi.map(f => [f.numero, f.refacturee?.numero ?? null]), [['G-502', null], ['G-501', emise.invoiceNumber]]);
    await assert.rejects(modifierFactureEnergie(f1, { fournisseur: 'Gaz du Sud', numero: 'G-501', date: '2031-02-10', montantHT: 1 }, 'adv@v.fr'), /refacturée sur la facture/);
    await assert.rejects(supprimerFactureEnergie(f1), /refacturée sur la facture/);
    await modifierFactureEnergie(f2, { fournisseur: 'Gaz du Sud', numero: 'G-502', date: '2031-03-10', montantHT: 990 }, 'adv@v.fr');

    // Elle n'est plus proposée ; la suivante l'est, au montant corrigé.
    const suite = await apercuFacturation('fman-k3', '2031-03-31');
    assert.deepEqual(suite.echeances.map(e => e.montant), [990]);
    await supprimerFactureEnergie(f2);
    assert.deepEqual((await apercuFacturation('fman-k3', '2031-03-31')).echeances, []);
});
