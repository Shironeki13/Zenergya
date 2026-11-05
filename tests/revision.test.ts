// Révision des prix : dates, indices datés, coefficient, application à la facturation (calcul pur) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    addMonthsToPeriod, parseAnchor, revisionAt, revisionConfig, revisionDatesWithin, revisionInForce, revisionText, type RevisionConfig,
} from '../src/lib/billing/revision';
import { dueInvoiceLines, type BillingInput } from '../src/lib/billing/contract-billing';
import type { Index, IndexValue, RevisionRule } from '../src/lib/types';

const rule: RevisionRule = {
    id: 'r', code: 'P2-AB', name: 'P2', type: 'PONDERE_A_B', nbMonths: 3, lagMonths: 1, paramA: 0.15, paramB: 0.85,
    indices: [{ indexId: 'ichte', coefficient: 0.6 }, { indexId: 'fsd2', coefficient: 0.4 }],
};
const indices: Index[] = [
    { id: 'ichte', code: 'ICHT-E', label: '', unit: '', active: true },
    { id: 'fsd2', code: 'FSD2', label: '', unit: '', active: true },
    { id: 'calc', code: 'CALC', label: '', unit: '', active: true, type: 'calculated', formula: 'ICHT-E * 2' },
];
const months = (from: string, n: number) => Array.from({ length: n }, (_, i) => addMonthsToPeriod(from, i));
const values: IndexValue[] = [
    ...months('2025-01', 24).map((period, i) => ({ id: `e${i}`, indexId: 'ichte', period, value: 100 + i })),
    ...months('2025-01', 24).map((period, i) => ({ id: `f${i}`, indexId: 'fsd2', period, value: 200 + 2 * i })),
];
const base = [{ indexId: 'ichte', value: 100, period: '2025-01' }, { indexId: 'fsd2', value: 200, period: '2025-01' }];
const config = (patch: Partial<RevisionConfig> = {}): RevisionConfig => ({ rule, base, months: 12, anchor: '2025-07-01', start: '2025-07-01', fromStart: false, ...patch });

test('dates de révision : anniversaire, prix de base la première année sauf « dès le début », coupures', () => {
    assert.equal(parseAnchor('01/01'), '01-01');
    assert.equal(parseAnchor('07-01'), '07-01');
    assert.equal(parseAnchor('31/02'), null);
    assert.equal(revisionInForce(config(), '2025-08-10'), null);
    assert.equal(revisionInForce(config(), '2026-06-30'), null);
    assert.equal(revisionInForce(config(), '2026-07-01'), '2026-07-01');
    assert.equal(revisionInForce(config({ fromStart: true }), '2025-08-10'), '2025-07-01');
    const janvier = config({ anchor: '2025-01-01' });
    assert.equal(revisionInForce(janvier, '2025-12-31'), null);
    assert.equal(revisionInForce(janvier, '2026-01-01'), '2026-01-01');
    assert.equal(revisionInForce(config({ months: 3 }), '2025-11-15'), '2025-10-01');
    assert.deepEqual(revisionDatesWithin(janvier, '2025-10-01', '2026-03-31'), ['2026-01-01']);
    assert.deepEqual(revisionDatesWithin(janvier, '2026-01-01', '2026-03-31'), []);
    const cfg = revisionConfig({ revisionRuleId: 'r', revisionAnchor: '01/01', revisionMonths: 6 }, '2025-07-01', [rule]);
    assert.deepEqual(cfg && !('error' in cfg) && [cfg.anchor, cfg.months], ['2025-01-01', 6]);
    assert.equal(revisionConfig({}, '2025-07-01', [rule]), null, 'sans règle : prix ferme');
    assert.match((revisionConfig({ revisionRuleId: 'r', revisionMonths: 5 }, '2025-07-01', [rule]) as { error: string }).error, /1, 3, 6 ou 12/);
});

test('coefficient : indices des mois précédant la révision, moyenne, a + b × Σ, arrondi ; données manquantes bloquantes', () => {
    // Révision du 01/07/2026, décalage 1, moyenne 3 : avril à juin 2026 (rangs 15 à 17).
    const r = revisionAt(config(), '2026-07-01', indices, values);
    assert.ok(!('error' in r));
    assert.deepEqual(r.indices.map(i => [i.code, i.periods, i.value]), [['ICHT-E', ['2026-04', '2026-05', '2026-06'], 116], ['FSD2', ['2026-04', '2026-05', '2026-06'], 232]]);
    // 0,15 + 0,85 × (0,6 × 1,16 + 0,4 × 1,16) = 1,136
    assert.equal(r.coefficient, 1.136);
    assert.match(revisionText(r), /révision P2-AB du 01\/07\/2026 ×1,1360 \(ICHT-E moy\. 2026-04→2026-06 : 116 \/ base 2025-01 : 100/);
    assert.equal((revisionAt(config({ rule: { ...rule, lagMonths: 3, nbMonths: 1 } }), '2026-07-01', indices, values) as { indices: { periods: string[] }[] }).indices[0].periods[0], '2026-04');
    assert.equal((revisionAt(config({ rule: { ...rule, type: 'PONDERE_SIMPLE', decimals: 2 } }), '2026-07-01', indices, values) as { coefficient: number }).coefficient, 1.16);
    assert.equal((revisionAt(config({ rule: { ...rule, type: 'FIXE' } }), '2026-07-01', indices, []) as { coefficient: number }).coefficient, 1);
    assert.match((revisionAt(config(), '2027-07-01', indices, values) as { error: string }).error, /ICHT-E sans valeur pour 2027-04, 2027-05, 2027-06/);
    assert.match((revisionAt(config({ base: base.slice(1) }), '2026-07-01', indices, values) as { error: string }).error, /valeur de base \(I0\) de l'indice ICHT-E/);
    // Indice calculé : valeur obtenue par sa formule.
    const calc = revisionAt(config({ rule: { ...rule, type: 'MONO_MOIS', nbMonths: 1, indices: [{ indexId: 'calc', coefficient: 1 }] }, base: [{ indexId: 'calc', value: 200, period: '2025-01' }] }), '2026-07-01', indices, values);
    assert.equal((calc as { coefficient: number }).coefficient, 1.17);
});

const input: BillingInput = {
    contract: { id: 'k', siteIds: ['s'], activityIds: ['p2'], startDate: '2025-07-01', endDate: '2027-06-30', billingSchedule: 'Trimestriel' },
    sites: [{ id: 's', name: 'Site', amountsSource: 'services' }],
    services: [{
        id: 'a', siteId: 's', contractId: 'k', activityId: 'p2', price: 4000, startDate: '2025-07-01', vatRateId: 'v', billingTermId: 'echoir',
        revisionRuleId: 'r', initialIndexValues: base, revisionAnchor: '01-01',
    }],
    activities: [{ id: 'p2', code: 'P2', label: 'Maintenance' }],
    vatRates: [{ id: 'v', code: 'TVA20', rate: 20 }],
    schedules: [], terms: [{ id: 'echoir', name: 'À échoir' }],
    revisionRules: [rule], indices, indexValues: values,
};

test('facturation : prix de base avant la première révision, coefficient ensuite, imprimé sur la ligne', () => {
    const due = dueInvoiceLines(input, [], '2026-01-01');
    assert.deepEqual(due.errors, []);
    assert.deepEqual(due.lines.map(l => [l.periodStartDate, l.baseAmount ?? null, l.total, l.revision?.coefficient ?? null]), [
        ['2025-07-01', null, 1000, null],
        ['2025-10-01', null, 1000, null],
        // Révision du 01/01/2026 : indices d'oct. à déc. 2025 (moyennes 110 et 220) → 0,15 + 0,85 × 1,10 = 1,085.
        ['2026-01-01', 1000, 1085, 1.085],
    ]);
    assert.match(due.lines[2].description, /révision P2-AB du 01\/01\/2026 ×1,0850/);
});

test('échéance coupée à la date de révision ; coefficient déjà facturé réutilisé ; indice manquant bloquant', () => {
    // Révision au 01/02 : le trimestre de janvier à mars est coupé au 01/02 (31 jours au prix de base, 59 révisés).
    const feb: BillingInput = { ...input, services: [{ ...input.services[0], revisionAnchor: '02-01' }] };
    const due = dueInvoiceLines(feb, [{ lineItems: [{ itemKey: 'svc:a', periodEndDate: '2025-12-31' }] }], '2026-01-01');
    assert.deepEqual(due.lines.map(l => [l.periodStartDate, l.periodEndDate, l.total, l.revision?.date ?? null]), [
        ['2026-01-01', '2026-01-31', 344.44, null],                    // 1 000 × 31/90
        ['2026-02-01', '2026-03-31', 716.85, '2026-02-01'],            // 1 000 × 59/90 × 1,0935 (nov. 2025 à janv. 2026 : 111 / 222)
    ]);
    // Une révision déjà facturée garde son coefficient, même si les indices ont été corrigés depuis.
    const frozen = { date: '2026-01-01', coefficient: 1.05, rule: 'P2-AB', indices: [] };
    const again = dueInvoiceLines(input, [{ lineItems: [{ itemKey: 'svc:a', periodEndDate: '2026-03-31', revision: frozen }] }], '2026-04-01');
    assert.equal(again.lines[0].revision!.coefficient, 1.05);
    assert.equal(again.lines[0].total, 1050);
    const missing = dueInvoiceLines({ ...input, indexValues: values.filter(v => v.period !== '2025-10') }, [], '2026-01-01');
    assert.match(missing.errors[0], /Révision impossible : P2 sur le site Site, indice ICHT-E sans valeur pour 2025-10/);
});
