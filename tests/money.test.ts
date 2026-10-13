// Tests des arrondis monétaires : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundCents, sumCents, computeTotals } from '../src/lib/money';

test('roundCents arrondit au centime sans erreur de virgule flottante', () => {
    assert.equal(roundCents(1.005), 1.01);
    assert.equal(roundCents(-1.005), -1.01);
    assert.equal(roundCents(2.675), 2.68);
    assert.equal(roundCents(1234.5649), 1234.56);
    assert.equal(roundCents(10 / 3), 3.33);
    assert.equal(roundCents(0.1 + 0.2), 0.3);
    assert.equal(roundCents(-0.001), 0);
    assert.equal(Object.is(roundCents(-0.001), -0), false);
    assert.equal(roundCents(1e-9), 0);
    assert.throws(() => roundCents(NaN));
});

test('sumCents additionne en centimes entiers', () => {
    assert.equal(sumCents([0.1, 0.2]), 0.3);
    assert.equal(sumCents(Array(10).fill(0.1)), 1);
    assert.equal(sumCents([1000.333, 1000.333, 1000.333]), 3000.99);
});

test('computeTotals : TVA calculée sur le HT arrondi', () => {
    // 3 lignes mensuelles de 1000 €/an (1/12 = 83,333…) arrondies à 83,33
    const lines = [1000 / 12, 1000 / 12, 1000 / 12].map(roundCents);
    assert.deepEqual(computeTotals(lines, 0.1), { subtotal: 249.99, tax: 25, total: 274.99 });
    assert.deepEqual(computeTotals([100.05], 0.2), { subtotal: 100.05, tax: 20.01, total: 120.06 });
    assert.deepEqual(computeTotals([-100.05], 0.2), { subtotal: -100.05, tax: -20.01, total: -120.06 });
});
