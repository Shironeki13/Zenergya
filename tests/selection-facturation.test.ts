// Facturation manuelle : échéances dues à cocher (calcul pur) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueInvoiceLines, type BillingInput } from '../src/lib/billing/contract-billing';
import { basculer, controleSelection, echeancesDues, lignesRetenues } from '../src/lib/billing/selection';

const input = (global = false): BillingInput => ({
    contract: { id: 'k', siteIds: ['s1', 's2'], activityIds: ['p2', 'p3'], startDate: '2026-01-01', endDate: '2027-12-31', billingSchedule: 'Trimestriel', ...(global && { invoicingType: 'global' }) } as BillingInput['contract'],
    sites: [
        { id: 's1', name: 'Alpha', amounts: [{ activityId: 'p2', amount: 1200 }, { activityId: 'p3', amount: 400 }] },
        { id: 's2', name: 'Bêta', amounts: [{ activityId: 'p2', amount: 2400 }] },
    ],
    services: [],
    activities: [{ id: 'p2', code: 'P2', label: 'Conduite', vatRateId: 'tva20' }, { id: 'p3', code: 'P3', label: 'Garantie totale', vatRateId: 'tva20' }],
    vatRates: [{ id: 'tva20', code: 'TVA20', rate: 20 }],
    schedules: [], terms: [],
});

test('échéances dues : une par élément et par période, montants et lignes rattachées', () => {
    const due = dueInvoiceLines(input(), [], '2026-04-01');
    const dues = echeancesDues(due);
    assert.deepEqual(dues.map(e => [e.activite, e.site, e.debut, e.fin, e.montant]), [
        ['P2', 'Alpha', '2026-01-01', '2026-03-31', 300], ['P3', 'Alpha', '2026-01-01', '2026-03-31', 100], ['P2', 'Bêta', '2026-01-01', '2026-03-31', 600],
        ['P2', 'Alpha', '2026-04-01', '2026-06-30', 300], ['P3', 'Alpha', '2026-04-01', '2026-06-30', 100], ['P2', 'Bêta', '2026-04-01', '2026-06-30', 600],
    ]);
    assert.equal(new Set(dues.map(e => e.id)).size, 6);
    assert.equal(dues.flatMap(e => e.lignes).length, due.lines.length);
    assert.equal(lignesRetenues(dues, [dues[0].id, dues[2].id]).reduce((a, l) => a + l.total, 0), 900);
});

test("ordre : cocher entraîne les plus anciennes du même élément, décocher les plus récentes ; sélection trouée refusée", () => {
    const dues = echeancesDues(dueInvoiceLines(input(), [], '2026-04-01'));
    const [a1, , b1, a2, , b2] = dues.map(e => e.id);
    assert.deepEqual(basculer(dues, [], a2, true), [a1, a2]);
    assert.deepEqual(basculer(dues, [a1, a2, b1, b2], a1, false), [b1, b2]);
    assert.deepEqual(basculer(dues, [a1, a2], b1, true), [a1, b1, a2]);
    assert.deepEqual(controleSelection(dues, [a1, b1]), []);
    assert.match(controleSelection(dues, [a2])[0], /plus ancienne/);
    assert.match(controleSelection(dues, [])[0], /Aucune échéance/);
    assert.match(controleSelection(dues, ['inconnue'])[0], /ont changé/);
});

test('facturation globale : une échéance par activité et période, tous sites confondus', () => {
    const dues = echeancesDues(dueInvoiceLines(input(true), [], '2026-01-01'));
    assert.deepEqual(dues.map(e => [e.activite, e.site, e.montant, e.cles.length]), [['P2', '2 sites', 900, 2], ['P3', 'Alpha', 100, 1]]);
});
