// Acomptes P1 et régularisation de bout en bout (émulateur) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../src/lib/firebase-admin';
import { prepareContractInvoice, previewBatchBilling } from '../src/services/contract-billing-admin';
import { createInvoice } from '../src/services/firestore-admin';
import { addP1Formule, addP1FormuleVersion, addP1Version } from '../src/services/p1-admin';
import { emitP1Regularisation, prepareP1Regularisation } from '../src/services/p1-regularisation-admin';
import { applyImport, planImport } from '../src/services/imports-admin';
import { parseTermes } from '../src/lib/p1/formules';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const paris = (day: string) => Timestamp.fromDate(new Date(`${day}T00:00:00+02:00`));
const origine = (valeur: unknown) => ({ valeur, dateEffet: null, motif: 'contrat d\'origine' });
const bill = async (date: string) => {
    const p = await prepareContractInvoice('ac-k', date, { isProforma: false });
    await createInvoice(p.invoice, p.company, { contractId: 'ac-k', billingVersion: p.billingVersion });
    return p.invoice;
};

before(async () => {
    await set('companies', 'ac-co', { code: 'ACPT', name: 'Veolia Acomptes' });
    await set('vatRates', 'ac-55', { code: 'TVA55A', rate: 5.5 });
    await set('activities', 'ac-p1', { code: 'P1A', label: 'Énergie', type: 'P1' });
    await set('schedules', 'ac-mens', { name: 'Mensuel A' });
    await set('terms', 'ac-echoir', { name: 'À échoir A' });
    await set('indices', 'ac-i', { code: 'IDXAC', label: 'Indice', unit: '', active: true });
    await set('clients', 'ac-cli', { name: 'Copropriété Acomptes', companyId: 'ac-co' });
    await set('contracts', 'ac-k', {
        contractNumber: 'CTN-02201', clientId: 'ac-cli', clientName: 'Copropriété Acomptes', companyId: 'ac-co', status: 'Actif',
        startDate: paris('2025-10-01'), endDate: paris('2026-09-30'), billingSchedule: 'Mensuel A', siteIds: ['ac-s'], activityIds: ['ac-p1'],
    });
    await set('sites', 'ac-s', { code: 'SIT-02201', name: 'Chaufferie acomptes', clientId: 'ac-cli', contractId: 'ac-k', amountsSource: 'services' });
    await set('services', 'ac-svc', {
        siteId: 'ac-s', contractId: 'ac-k', activityId: 'ac-p1', type: 'P1', price: 0, startDate: '2025-10-01', endDate: '2026-09-30', isActive: true,
        vatRateId: 'ac-55', scheduleId: 'ac-mens', billingTermId: 'ac-echoir', p1Mode: 'acompte',
    });
    // Paramétrage P1 : prix de base 80 €/MWh (formule à prix fixe), 1 200 MWh/an, répartition sur la saison de chauffe.
    await addP1Version({ scope: 'site', id: 'ac-s' }, 'prixBase', origine(80), 'a@v.fr');
    await addP1Version({ scope: 'site', id: 'ac-s' }, 'quantiteAcompte', origine(1200), 'a@v.fr');
    await addP1Version({ scope: 'contract', id: 'ac-k' }, 'repartitionAcomptes', origine('12,5;12,5;12,5;12,5;12,5;0;0;0;0;12,5;12,5;12,5'), 'a@v.fr');
    const f = await addP1Formule('ac-k', { nom: 'Prix fixe', usage: 'chauffage', perimetre: { type: 'contrat' } }, 'a@v.fr');
    await addP1FormuleVersion('ac-k', f, {
        forme: 'A', mode: 'standard', baseEnergetique: 'PCS', unitePrix: 'EUR/MWh', dateM0: '2025-01', m0Manquante: null, regimeKmol: 'variable',
        prixMoleculeNegocie: null, prixFixe: true, periodicite: 'mensuel', termes: parseTermes('p0=1') as never,
    }, { dateEffet: null, motif: 'marché' }, 'a@v.fr');
});

test('acomptes : quantité × part du mois × prix révisé P1, facture et aperçu groupé identiques', async () => {
    const preview = (await previewBatchBilling('2025-11-05')).find(r => r.contractId === 'ac-k')!;
    assert.deepEqual([preview.echeances, preview.subtotal, preview.error], [2, 24000, undefined]);
    const inv = await bill('2025-11-05');
    // 1 200 × 12,5 % × 80 = 12 000 par mois, TVA 5,5 %.
    assert.deepEqual(inv.lineItems.map(l => [l.periodStartDate, l.total]), [['2025-10-01', 12000], ['2025-11-01', 12000]]);
    assert.deepEqual([inv.subtotal, inv.tax, inv.total], [24000, 1320, 25320]);
    assert.deepEqual(inv.lineItems[0].p1Acompte, { siteId: 'ac-s', usage: 'chauffage', mois: [{ mois: '2025-10', quantite: 150, prix: 80, montant: 12000 }] });
});

test('régularisation : réel importé − acomptes → avoir ; intéressement → facture ; ni double régularisation ni réel modifié après coup', async () => {
    await set('interests', 'ac-int', { serviceId: 'ac-svc', seasonLabel: '2025 (test)', endDate: '2025-11-30', interestAmount: 300 });
    const missing = await prepareP1Regularisation('ac-k', '2025-10', '2025-11');
    assert.match(missing.errors[0], /réel P1 du moteur non importé pour 10\/2025, 11\/2025/);

    const table = [['Site', 'Mois', 'Montant P1 HT'], ['SIT-02201', '10/2025', '11000'], ['SIT-02201', '2025-11', '12 500']];
    const report = await applyImport('p1reel', table, { by: 'import@v.fr' });
    assert.deepEqual([report.created, report.errors.length], [2, 0]);
    assert.ok((await planImport('p1reel', table)).items.every(i => i.action === 'unchanged'));

    const prep = await prepareP1Regularisation('ac-k', '2025-10', '2025-11');
    assert.deepEqual(prep.errors, []);
    assert.deepEqual(prep.detail.map(d => [d.reel, d.acomptes, d.ecart]), [[23500, 24000, -500]]);
    const out = await emitP1Regularisation('ac-k', '2025-10', '2025-11', '2025-12-02');
    assert.ok(out.creditNote && out.invoice);
    const cn = (await adminDb.collection('creditNotes').doc(out.creditNote!.id).get()).data()!;
    assert.deepEqual([cn.subtotal, cn.tax, cn.total, cn.lineItems.length], [-500, -27.5, -527.5, 1]);
    const inv = (await adminDb.collection('invoices').doc(out.invoice!.id).get()).data()!;
    assert.deepEqual([inv.subtotal, inv.lineItems[0].description], [300, 'Intéressement P1 — Site : Chaufferie acomptes — saison 2025 (test)']);
    // Les factures d'acompte ne sont pas annulées par l'avoir de régularisation.
    const acomptes = (await adminDb.collection('invoices').where('contractId', '==', 'ac-k').get()).docs.filter(d => d.get('lineItems')[0].p1Acompte);
    assert.ok(acomptes.every(d => d.get('status') !== 'cancelled'));

    await assert.rejects(emitP1Regularisation('ac-k', '2025-10', '2025-11', '2025-12-02'), /10\/2025, 11\/2025 déjà régularisé/);
    const change = await planImport('p1reel', [['Site', 'Mois', 'Montant P1 HT'], ['SIT-02201', '2025-10', '10000']]);
    assert.match(change.items[0].messages[0], /Mois déjà régularisé/);

    // Décembre : seul le nouvel acompte se facture (octobre et novembre ne reviennent pas).
    const dec = await bill('2025-12-05');
    assert.deepEqual(dec.lineItems.map(l => [l.periodStartDate, l.total]), [['2025-12-01', 12000]]);
});

test('ECS : acompte au m³ à sa TVA, réel par usage, régularisation une ligne par usage', async () => {
    await set('vatRates', 'ac-20', { code: 'TVA20A', rate: 20 });
    await set('services', 'ac-ecs', {
        siteId: 'ac-s', contractId: 'ac-k', activityId: 'ac-p1', type: 'P1', p1Type: 'ECS', price: 0, startDate: '2026-01-01', endDate: '2026-09-30',
        isActive: true, vatRateId: 'ac-20', scheduleId: 'ac-mens', billingTermId: 'ac-echoir', p1Mode: 'acompte',
    });
    await assert.rejects(prepareContractInvoice('ac-k', '2026-01-05', { isProforma: false }), /volume annuel des acomptes ECS \(site\) non renseigné/);
    await addP1Version({ scope: 'site', id: 'ac-s' }, 'quantiteAcompteEcs', origine(2400), 'a@v.fr');
    await addP1Version({ scope: 'site', id: 'ac-s' }, 'prixBaseEcs', origine(6.5), 'a@v.fr');
    await addP1Version({ scope: 'contract', id: 'ac-k' }, 'repartitionAcomptesEcs', origine(Array(12).fill(8.3333).join(';')), 'a@v.fr');
    await assert.rejects(prepareContractInvoice('ac-k', '2026-01-05', { isProforma: false }), /aucune formule de révision P1 ECS en vigueur/);
    const f = await addP1Formule('ac-k', { nom: 'ECS fixe', usage: 'ecs', perimetre: { type: 'contrat' } }, 'a@v.fr');
    await addP1FormuleVersion('ac-k', f, {
        forme: 'A', mode: 'standard', baseEnergetique: 'PCS', unitePrix: 'EUR/m3', dateM0: '2025-01', m0Manquante: null, regimeKmol: 'variable',
        prixMoleculeNegocie: null, prixFixe: true, periodicite: 'mensuel', termes: parseTermes('p0=1') as never,
    }, { dateEffet: null, motif: 'marché' }, 'a@v.fr');

    const jan = await bill('2026-01-05');
    // Chauffage : 1 200 × 12,5 % × 80 = 12 000 (5,5 %) ; ECS : 2 400 × 8,3333 % × 6,5 = 199,9992 m³ → 1 299,99 (20 %).
    assert.deepEqual(jan.lineItems.map(l => [l.p1Acompte?.usage, l.total, l.vatRate]).sort(), [['chauffage', 12000, 5.5], ['ecs', 1299.99, 20]]);

    await applyImport('p1reel', [['Site', 'Mois', 'Montant P1 HT', 'Usage'], ['SIT-02201', '2026-01', '11800', 'chauffage'], ['SIT-02201', '2026-01', '1350', 'ECS']], { by: 'import@v.fr' });
    const prep = await prepareP1Regularisation('ac-k', '2026-01', '2026-01');
    assert.deepEqual(prep.errors, []);
    assert.deepEqual(prep.detail.map(d => [d.usage, d.reel, d.acomptes, d.ecart]), [['chauffage', 11800, 12000, -200], ['ecs', 1350, 1299.99, 50.01]]);
    const out = await emitP1Regularisation('ac-k', '2026-01', '2026-01', '2026-02-02');
    const cn = (await adminDb.collection('creditNotes').doc(out.creditNote!.id).get()).data()!;
    const inv = (await adminDb.collection('invoices').doc(out.invoice!.id).get()).data()!;
    assert.deepEqual([cn.subtotal, cn.tax, inv.subtotal, inv.tax], [-200, -11, 50.01, 10]);
});
