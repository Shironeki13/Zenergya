// Facturation des contrats (calcul pur) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    addMonths, contractInvoiceLines, dueDateFor, nextBillingPeriod, paymentTermRule, scheduleOf, vatTotals, type BillingInput,
} from '../src/lib/billing/contract-billing';

const contract = { startDate: '2025-07-01', endDate: '2026-08-15', billingSchedule: 'Trimestriel' };

test('périodes : échéancier, suite de la dernière facture, fin du contrat, mois courts', () => {
    assert.equal(addMonths('2025-01-31', 1), '2025-02-28');
    assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
    assert.deepEqual(scheduleOf('Trimestriel K'), { months: 3, label: 'Trimestriel' });
    assert.equal(scheduleOf('Variable'), null);
    assert.deepEqual(nextBillingPeriod(contract), { start: '2025-07-01', end: '2025-09-30', nominalEnd: '2025-09-30', months: 3, label: 'Trimestriel' });
    assert.equal(nextBillingPeriod(contract, '2025-09-30')!.start, '2025-10-01');
    const last = nextBillingPeriod(contract, '2026-06-30')!;
    assert.deepEqual([last.start, last.end, last.nominalEnd], ['2026-07-01', '2026-08-15', '2026-09-30']);
    assert.equal(nextBillingPeriod(contract, '2026-08-15'), null);
    assert.throws(() => nextBillingPeriod({ ...contract, billingSchedule: 'Variable' }), /Échéancier de facturation du contrat inconnu/);
    assert.throws(() => nextBillingPeriod({ ...contract, billingSchedule: undefined }), /non renseigné/);
});

const base: BillingInput = {
    contract: { id: 'k', siteIds: ['s1', 's2'], activityIds: ['p2', 'p3'] },
    sites: [
        { id: 's1', name: 'Manuel', amounts: [{ activityId: 'p2', amount: 1200 }, { activityId: 'p3', amount: 999 }, { activityId: 'hors', amount: 50 }] },
        { id: 's2', name: 'Prestations', amountsSource: 'services', amounts: [{ activityId: 'p2', amount: 1 }] },
    ],
    services: [
        { siteId: 's2', contractId: 'k', activityId: 'p2', price: 3650, startDate: '2025-08-01', endDate: '', vatRateId: 'tva10', label: 'Entretien' },
        { siteId: 's2', contractId: 'k', activityId: 'p2', price: 9999, startDate: '2025-07-01', endDate: '2025-07-31', isActive: false },
        { siteId: 's2', contractId: 'autre', activityId: 'p2', price: 5000, startDate: '2025-07-01' },
    ],
    activities: [{ id: 'p2', code: 'P2', label: 'Maintenance', vatRateId: 'tva20' }, { id: 'p3', code: 'P3', label: 'Gros entretien', vatRateId: 'tva20' }, { id: 'hors', code: 'X', label: 'Hors contrat' }],
    vatRates: [{ id: 'tva20', code: 'TVA20', rate: 20 }, { id: 'tva10', code: 'TVA10', rate: 10 }],
};

test('lignes : montant saisi ou prestation, TVA de la prestation sinon de l\'activité, prorata au jour près', () => {
    const period = nextBillingPeriod(contract)!;   // 01/07 → 30/09 : 92 jours
    const { lines, errors } = contractInvoiceLines(base, period);
    assert.deepEqual(errors, []);
    assert.deepEqual(lines.map(l => [l.siteId, l.activityCode, l.total, l.vatRate]), [
        ['s1', 'P2', 300, 20],           // 1 200 / 4
        ['s1', 'P3', 249.75, 20],        // 999 / 4
        ['s2', 'P2', 605.03, 10],        // 3 650 / 4 = 912,50 × 61 / 92 (prestation à partir du 01/08)
    ]);
    assert.match(lines[2].description, /Entretien.*prorata 61\/92 j/);
    assert.doesNotMatch(lines[0].description, /prorata/);

    // Dernière période raccourcie par la fin du contrat : 01/07 → 15/08, 46 jours sur 92.
    const short = contractInvoiceLines(base, nextBillingPeriod(contract, '2026-06-30')!);
    assert.equal(short.lines[0].total, 150);
    assert.match(short.lines[0].description, /prorata 46\/92 j/);

    const missing = contractInvoiceLines({ ...base, activities: base.activities.map(a => ({ ...a, vatRateId: undefined })) }, period);
    assert.equal(missing.errors.length, 2);
    assert.match(missing.errors[0], /TVA non renseignée : P2 sur le site Manuel/);
});

test('facturation globale : une ligne par activité et par taux ; totaux par taux', () => {
    const period = nextBillingPeriod(contract)!;
    const { lines } = contractInvoiceLines({ ...base, contract: { ...base.contract, invoicingType: 'global' } }, period);
    assert.deepEqual(lines.map(l => [l.activityCode, l.total, l.vatRate, l.siteId]), [['P2', 300, 20, undefined], ['P3', 249.75, 20, undefined], ['P2', 605.03, 10, undefined]]);
    const totals = vatTotals(lines);
    assert.deepEqual(totals.vatBreakdown, [{ rate: 20, base: 549.75, amount: 109.95 }, { rate: 10, base: 605.03, amount: 60.5 }]);
    assert.deepEqual([totals.subtotal, totals.tax, totals.total, totals.taxRate], [1154.78, 170.45, 1325.23, undefined]);
    assert.equal(vatTotals(lines.slice(0, 1)).taxRate, 0.2);
});

test('échéance : délai légal par défaut, jours, fin de mois, libellé lu, condition illisible refusée', () => {
    assert.equal(dueDateFor('2025-10-15'), '2025-11-14');
    assert.equal(dueDateFor('2025-10-15', { days: 45, endOfMonth: true }), '2025-11-30');
    assert.equal(dueDateFor('2025-01-20', { days: 30, endOfMonth: true }), '2025-02-28');
    assert.equal(dueDateFor('2025-10-15', { deadline: '60 jours net' }), '2025-12-14');
    assert.deepEqual(paymentTermRule({ deadline: '45 jours fin de mois' }), { days: 45, endOfMonth: true });
    assert.equal(dueDateFor('2025-10-15', { deadline: 'À réception' }), '2025-10-15');
    assert.throws(() => dueDateFor('2025-10-15', { code: 'SPECIAL', deadline: 'selon accord' }), /illisible/);
});
