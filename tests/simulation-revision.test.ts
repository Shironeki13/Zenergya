// Simulation de révision (calcul pur) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BillingInput } from '../src/lib/billing/contract-billing';
import { moisSuivants } from '../src/lib/billing/previsionnel';
import { dernieresValeurs, prolonger, simulerContrat } from '../src/lib/billing/simulation-revision';
import type { Index, IndexValue, RevisionRule } from '../src/lib/types';

const indices: Index[] = [{ id: 'icht', code: 'ICHT', label: '', unit: '', active: true }];
// Publié jusqu'en septembre 2026 : 100 en janvier 2025, 120 de janvier à septembre 2026.
const values: IndexValue[] = [
    { id: 'a', indexId: 'icht', period: '2025-01', value: 100 }, { id: 'b', indexId: 'icht', period: '2025-12', value: 110 },
    ...['01', '02', '03', '04', '05', '06', '07', '08', '09'].map(m => ({ id: `c${m}`, indexId: 'icht', period: `2026-${m}`, value: 120 })),
];
const rule: RevisionRule = { id: 'r', code: 'AB', name: 'A+B', type: 'PONDERE_A_B', nbMonths: 1, lagMonths: 1, paramA: 0.15, paramB: 0.85, indices: [{ indexId: 'icht', coefficient: 1 }] };
// P2 de 12 000 €/an, trimestriel à échoir, révisé chaque 1er janvier (indice de décembre) ; P3 ferme.
const input: BillingInput = {
    contract: { id: 'k', siteIds: ['s1'], activityIds: ['p2', 'p3'], startDate: '2025-01-01', endDate: '2030-12-31', billingSchedule: 'Trimestriel' } as BillingInput['contract'],
    sites: [{ id: 's1', name: 'Alpha', amountsSource: 'services' }],
    services: [
        { id: 'a', siteId: 's1', contractId: 'k', activityId: 'p2', price: 12000, startDate: '2025-01-01', vatRateId: 'v', billingTermId: 'e', revisionRuleId: 'r', initialIndexValues: [{ indexId: 'icht', value: 100, period: '2025-01' }] },
        { id: 'b', siteId: 's1', contractId: 'k', activityId: 'p3', price: 4000, startDate: '2025-01-01', vatRateId: 'v', billingTermId: 'e' },
    ],
    activities: [{ id: 'p2', code: 'P2', label: 'Conduite', vatRateId: 'v' }, { id: 'p3', code: 'P3', label: 'Garantie', vatRateId: 'v' }],
    vatRates: [{ id: 'v', code: 'TVA20', rate: 20 }], schedules: [], terms: [{ id: 'e', name: 'À échoir' }], revisionRules: [rule], indices, indexValues: values,
};
// Facturé jusqu'au 31/12/2026, au coefficient de la révision du 01/01/2026 (indice de décembre 2025 : 110).
const factures = [{ status: 'due', lineItems: [{ itemKey: 'svc:a', periodEndDate: '2026-12-31', revision: { date: '2026-01-01', coefficient: 1.085, rule: 'AB', indices: [] } }, { itemKey: 'svc:b', periodEndDate: '2026-12-31' }] }];
const mois = moisSuivants('2026-11-24', 12);

test('indices prolongés : dernière valeur connue, majorée de l\'hypothèse, sans toucher aux valeurs publiées', () => {
    assert.deepEqual(dernieresValeurs(values).get('icht'), { period: '2026-09', value: 120 });
    const p = prolonger(values, '2026-12', { icht: 5 });
    assert.deepEqual(p.filter(v => v.period >= '2026-09').map(v => [v.period, v.value]), [['2026-09', 120], ['2026-10', 126], ['2026-11', 126], ['2026-12', 126]]);
    assert.equal(prolonger(values, '2026-12').at(-1)!.value, 120);
});

test('simulation : indices constants contre hypothèse, par mois ; révision à venir détaillée ; P3 ferme ignoré', () => {
    const s = simulerContrat('k', input, factures, '2026-11-24', mois, { icht: 5 });
    assert.deepEqual(s.nonSimulables, []);
    assert.deepEqual(s.indices, ['icht']);
    // Révision du 01/01/2027 sur l'indice de décembre 2026 : 120 constant (0,15 + 0,85 × 1,2 = 1,17), 126 simulé (1,221).
    assert.deepEqual(s.revisions, [{ contractId: 'k', cle: 'svc:a', activite: 'P2', site: 'Alpha', date: '2027-01-01', avant: 1.085, constant: 1.17, simule: 1.221, annuel: 12000, indices: ['icht'] }]);
    assert.deepEqual(s.lignes.map(l => [l.mois, l.activite, l.base, l.simule]).sort(), [
        ['2027-01', 'P2', 3510, 3663], ['2027-04', 'P2', 3510, 3663], ['2027-07', 'P2', 3510, 3663], ['2027-10', 'P2', 3510, 3663],
    ]);
    // Sans hypothèse : les deux scénarios sont identiques.
    assert.ok(simulerContrat('k', input, factures, '2026-11-24', mois, {}).lignes.every(l => l.base === l.simule));
});

test('révision déjà facturée : coefficient figé, insensible à l\'hypothèse ; valeur de base manquante : non simulable', () => {
    const figee = [{ status: 'due', lineItems: [{ itemKey: 'svc:a', periodEndDate: '2027-03-31', revision: { date: '2027-01-01', coefficient: 1.2, rule: 'AB', indices: [] } }] }];
    const s = simulerContrat('k', input, figee, '2026-11-24', mois, { icht: 50 });
    assert.deepEqual(s.revisions, []);
    assert.ok(s.lignes.length > 0 && s.lignes.every(l => l.base === l.simule && l.base === 3600));
    const sansBase = { ...input, services: [{ ...input.services[0], initialIndexValues: [] }, input.services[1]] };
    assert.match(simulerContrat('k', sansBase, factures, '2026-11-24', mois, {}).nonSimulables[0], /P2 sur le site Alpha : valeur de base \(I0\) de l'indice ICHT non renseignée/);
});
