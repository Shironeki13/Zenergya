// Prévisionnel de facturation (calcul pur) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BillingInput } from '../src/lib/billing/contract-billing';
import { croiser, derniersCoefficients, finDeMois, moisSuivants, previsionContrat } from '../src/lib/billing/previsionnel';

const input: BillingInput = {
    contract: { id: 'k', siteIds: ['s1'], activityIds: ['p2', 'p3'], startDate: '2026-01-01', endDate: '2027-03-31', billingSchedule: 'Trimestriel' } as BillingInput['contract'],
    sites: [{ id: 's1', name: 'Alpha', amounts: [{ activityId: 'p2', amount: 1200 }, { activityId: 'p3', amount: 400 }] }],
    services: [],
    activities: [{ id: 'p2', code: 'P2', label: 'Conduite', vatRateId: 'v' }, { id: 'p3', code: 'P3', label: 'Garantie totale', vatRateId: 'v' }],
    vatRates: [{ id: 'v', code: 'TVA20', rate: 20 }], schedules: [], terms: [],
};

test('repères : mois suivants, fin de mois', () => {
    assert.deepEqual(moisSuivants('2026-11-24', 3), ['2026-11', '2026-12', '2027-01']);
    assert.deepEqual(['2026-02', '2028-02', '2026-12'].map(finDeMois), ['2026-02-28', '2028-02-29', '2026-12-31']);
});

test('prévision : échéances rangées au mois où elles deviennent facturables, retard à part, fin de contrat respectée', () => {
    // P2 et P3 facturés jusqu'au 30/06/2026 (à échoir) : le T3 est en retard au 24/11, le T4 aussi, puis T1 2027.
    const factures = [{ status: 'due', lineItems: [{ itemKey: 'site:s1:p2', periodEndDate: '2026-06-30' }, { itemKey: 'site:s1:p3', periodEndDate: '2026-06-30' }] }];
    const p = previsionContrat('k', input, factures, '2026-11-24', moisSuivants('2026-11-24', 12));
    assert.deepEqual(p.erreurs, []);
    assert.deepEqual(p.lignes.map(l => [l.mois, l.activite, l.montant, l.nature]).sort(), [
        ['2027-01', 'P2', 300, 'forfait'], ['2027-01', 'P3', 100, 'forfait'], ['retard', 'P2', 600, 'forfait'], ['retard', 'P3', 200, 'forfait'],
    ]);
});

test('révision : le dernier coefficient facturé est reconduit', () => {
    const factures = [{ status: 'due', lineItems: [{ itemKey: 'site:s1:p2', periodEndDate: '2026-12-31', revision: { date: '2026-01-01', coefficient: 1.05, rule: 'R', indices: [] } }, { itemKey: 'site:s1:p3', periodEndDate: '2026-12-31' }] }];
    assert.equal(derniersCoefficients(factures).get('site:s1:p2'), 1.05);
    const p = previsionContrat('k', input, factures, '2026-11-24', moisSuivants('2026-11-24', 12));
    assert.deepEqual(p.lignes.map(l => [l.mois, l.activite, l.montant]).sort(), [['2027-01', 'P2', 315], ['2027-01', 'P3', 100]]);
});

test('tableau croisé par agence ou activité, tri par montant, totaux', () => {
    const mois = ['2026-11', '2026-12'];
    const l = [
        { mois: '2026-11', agence: 'Lyon', activite: 'P2', montant: 100, estime: 0 }, { mois: '2026-12', agence: 'Lyon', activite: 'P3', montant: 50, estime: 0 },
        { mois: '2026-12', agence: 'Paris', activite: 'P2', montant: 500, estime: 500 }, { mois: 'retard', agence: 'Paris', activite: 'P2', montant: 70, estime: 0 },
        { mois: '2027-05', agence: 'Paris', activite: 'P2', montant: 999, estime: 0 },
    ];
    const a = croiser(l, 'agence', mois);
    assert.deepEqual(a.lignes.map(r => [r.cle, r.parMois, r.retard, r.total, r.estime]), [['Paris', [0, 500], 70, 500, 500], ['Lyon', [100, 50], 0, 150, 0]]);
    assert.deepEqual([a.totaux, a.retard, a.total, a.estime], [[100, 550], 70, 650, 500]);
    assert.deepEqual(croiser(l, 'activite', mois).lignes.map(r => [r.cle, r.total]), [['P2', 600], ['P3', 50]]);
});

test('P1 variable : estimé sur les mois à venir d\'après son montant annuel, non chiffré quand il est déjà exigible', () => {
    const p1: BillingInput = {
        ...input, contract: { ...input.contract, activityIds: ['p1'], billingSchedule: 'Mensuel' } as BillingInput['contract'],
        sites: [{ id: 's1', name: 'Alpha', amountsSource: 'services' }],
        services: [{ id: 'a', siteId: 's1', contractId: 'k', activityId: 'p1', price: 12000, startDate: '2026-01-01', vatRateId: 'v', scheduleId: 'm', billingTermId: 'e', p1Mode: 'dju', p1Type: 'CHAUFFAGE' }],
        activities: [{ id: 'p1', code: 'P1', label: 'Chaleur', vatRateId: 'v' }], schedules: [{ id: 'm', name: 'Mensuel' }], terms: [{ id: 'e', name: 'Terme échu' }],
    };
    const p = previsionContrat('k', p1, [], '2026-11-24', moisSuivants('2026-11-24', 3));
    assert.deepEqual(p.erreurs, []);
    // À terme échu : octobre devient exigible le 1er novembre, novembre le 1er décembre, décembre le 1er janvier.
    // Les mois de janvier à septembre, déjà exigibles avant novembre, ne sont pas chiffrés.
    assert.deepEqual(p.lignes.map(l => [l.mois, l.montant, l.nature]).sort(), [['2026-11', 1000, 'estime'], ['2026-12', 1000, 'estime'], ['2027-01', 1000, 'estime']]);
});
