// ECS au relevé de bout en bout : relevés importés, factures mensuelles, relevés figés (émulateur) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../src/lib/firebase-admin';
import { prepareContractInvoice, previewBatchBilling } from '../src/services/contract-billing-admin';
import { createInvoice } from '../src/services/firestore-admin';
import { addP1Formule, addP1FormuleVersion, addP1Version } from '../src/services/p1-admin';
import { applyImport, planImport } from '../src/services/imports-admin';
import { parseTermes } from '../src/lib/p1/formules';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const paris = (day: string) => Timestamp.fromDate(new Date(`${day}T00:00:00+02:00`));
const origine = (valeur: unknown) => ({ valeur, dateEffet: null, motif: 'contrat d\'origine' });
const READINGS = ['Compteur', 'Date du relevé', 'Index'];
const bill = async (date: string) => {
    const p = await prepareContractInvoice('rl-k', date, { isProforma: false });
    const { invoiceNumber } = await createInvoice(p.invoice, p.company, { contractId: 'rl-k', billingVersion: p.billingVersion });
    return { ...p.invoice, invoiceNumber };
};

before(async () => {
    await set('companies', 'rl-co', { code: 'RELV', name: 'Veolia Relevés' });
    await set('vatRates', 'rl-20', { code: 'TVA20R2', rate: 20 });
    await set('activities', 'rl-p1', { code: 'P1R', label: 'Eau chaude', type: 'P1' });
    await set('schedules', 'rl-mens', { name: 'Mensuel R' });
    await set('terms', 'rl-echu', { name: 'Échu R' });
    await set('clients', 'rl-cli', { name: 'Résidence au relevé', companyId: 'rl-co' });
    await set('contracts', 'rl-k', {
        contractNumber: 'CTN-01101', clientId: 'rl-cli', clientName: 'Résidence au relevé', companyId: 'rl-co', status: 'Actif',
        startDate: paris('2025-10-01'), endDate: paris('2026-09-30'), billingSchedule: 'Mensuel R', siteIds: ['rl-s'], activityIds: ['rl-p1'],
    });
    await set('sites', 'rl-s', { code: 'SIT-01101', name: 'Résidence ECS', clientId: 'rl-cli', contractId: 'rl-k', amountsSource: 'services' });
    await set('meters', 'rl-m', { code: 'CPT-01101', name: 'ECS', siteId: 'rl-s', unit: 'm3', status: 'on' });
    await set('services', 'rl-svc', {
        siteId: 'rl-s', contractId: 'rl-k', activityId: 'rl-p1', type: 'P1', p1Type: 'ECS', price: 0, startDate: '2025-10-01', endDate: '2026-09-30',
        isActive: true, vatRateId: 'rl-20', scheduleId: 'rl-mens', billingTermId: 'rl-echu', p1Mode: 'releve', p1PrixSource: 'p1', coefficientPrix: 1.1,
    });
    await addP1Version({ scope: 'meter', id: 'rl-m' }, 'usage', origine('ecs'), 'a@v.fr');
    await addP1Version({ scope: 'site', id: 'rl-s' }, 'prixBaseEcs', origine(6.5), 'a@v.fr');
    const f = await addP1Formule('rl-k', { nom: 'ECS', usage: 'ecs', perimetre: { type: 'contrat' } }, 'a@v.fr');
    await addP1FormuleVersion('rl-k', f, {
        forme: 'A', mode: 'standard', baseEnergetique: 'PCS', unitePrix: 'EUR/m3', dateM0: '2025-01', m0Manquante: null, regimeKmol: 'variable',
        prixMoleculeNegocie: null, prixFixe: true, periodicite: 'mensuel', termes: parseTermes('p0=1') as never,
    }, { dateEffet: null, motif: 'marché' }, 'a@v.fr');
    await applyImport('readings', [READINGS, ['CPT-01101', '30/09/2025', '1000'], ['CPT-01101', '31/10/2025', '1040']], { by: 'import@v.fr' });
});

test('octobre puis novembre : volume relevé × prix ECS × coefficient ; relevé facturé figé', async () => {
    await assert.rejects(prepareContractInvoice('rl-k', '2025-10-20', { isProforma: false }), /Rien à facturer au 20\/10\/2025 : prochaine échéance facturable le 01\/11\/2025/);
    const row = (await previewBatchBilling('2025-11-03')).find(r => r.contractId === 'rl-k')!;
    assert.deepEqual([row.subtotal, row.error], [286, undefined]);
    const oct = await bill('2025-11-03');
    assert.deepEqual(oct.lineItems.map(l => [l.p1Releve!.volume, l.p1Releve!.prix, l.total, l.vatRate]), [[40, 7.15, 286, 20]]);

    // Le relevé du 31/10 est facturé : son index ne change plus (import ou API).
    const change = await planImport('readings', [READINGS, ['CPT-01101', '31/10/2025', '1045']]);
    assert.match(change.items[0].messages[0], new RegExp(`Relevé repris dans la facture ${oct.invoiceNumber} \\(ECS au relevé\\) : index non modifiable`));

    await assert.rejects(prepareContractInvoice('rl-k', '2025-12-02', { isProforma: false }), /aucun relevé du compteur CPT-01101 en 11\/2025/);
    await applyImport('readings', [READINGS, ['CPT-01101', '30/11/2025', '1100']], { by: 'import@v.fr' });
    const nov = await bill('2025-12-02');
    // 1 100 − 1 040 = 60 m³ × 7,15 = 429 €.
    assert.deepEqual(nov.lineItems.map(l => [l.periodStartDate, l.p1Releve!.compteurs[0].debut.index, l.p1Releve!.compteurs[0].fin.index, l.total]), [['2025-11-01', 1040, 1100, 429]]);
});
