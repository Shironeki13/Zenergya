// Tests des calculs de devis : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    addDays, computeLines, computeQuoteTotals, quoteIssues, quoteNumber, resolvePricing, unitPriceOf,
} from '../src/lib/quotes/pricing';
import type { QuoteLine, QuotePricing } from '../src/lib/quotes/types';

const PRICING: QuotePricing = { coefficient: 1.35, laborRate: 58, laborCost: 36.5, defaultVatRate: 20 };
const line = (l: Partial<QuoteLine> & Pick<QuoteLine, 'kind'>): QuoteLine =>
    ({ id: Math.random().toString(36), label: 'x', quantity: 1, vatRate: 20, ...l });

test('prix unitaire : coefficient du devis, de la ligne, prix imposé, main-d\'œuvre', () => {
    assert.equal(unitPriceOf(line({ kind: 'FOURNITURE', unitCost: 100 }), PRICING), 135);
    assert.equal(unitPriceOf(line({ kind: 'FOURNITURE', unitCost: 100, coefficient: 1.1 }), PRICING), 110);
    assert.equal(unitPriceOf(line({ kind: 'FOURNITURE', unitCost: 100, unitPriceOverride: 150 }), PRICING), 150);
    assert.equal(unitPriceOf(line({ kind: 'MAIN_OEUVRE', quantity: 3 }), PRICING), 58);
    assert.equal(unitPriceOf(line({ kind: 'TITRE' }), PRICING), null);
    // Paramètre manquant : non calculable, jamais 0 en silence.
    assert.equal(unitPriceOf(line({ kind: 'FOURNITURE', unitCost: 100 }), { ...PRICING, coefficient: null }), null);
    assert.equal(unitPriceOf(line({ kind: 'MAIN_OEUVRE' }), { ...PRICING, laborRate: null }), null);
});

test('totaux : remise, TVA par taux, options exclues, marge et coefficient effectif', () => {
    const lines = [
        line({ kind: 'TITRE', label: 'Chaufferie', level: 0 }),
        line({ kind: 'FOURNITURE', unitCost: 1000, quantity: 2 }),          // 2 × 1350 = 2700, coût 2000
        line({ kind: 'MAIN_OEUVRE', quantity: 8 }),                           // 8 × 58 = 464, coût 292
        line({ kind: 'SOUS_TRAITANCE', unitCost: 400, discountPct: 10 }),    // 540 × 0,9 = 486, coût 400
        line({ kind: 'SOUS_TOTAL', label: '' }),
        line({ kind: 'FOURNITURE', unitCost: 100, vatRate: 10 }),            // 135 à 10 %, coût 100
        line({ kind: 'FOURNITURE', unitCost: 500, optional: true }),         // option : 675, non comptée
    ];
    const t = computeQuoteTotals(lines, PRICING);
    assert.equal(t.totalHT, 3785);
    assert.deepEqual(t.vat, [{ rate: 20, base: 3650, amount: 730 }, { rate: 10, base: 135, amount: 13.5 }]);
    assert.equal(t.totalVAT, 743.5);
    assert.equal(t.totalTTC, 4528.5);
    assert.equal(t.totalCost, 2792);
    assert.equal(t.margin, 993);
    assert.equal(t.marginRate, 0.2624);   // 993 / 3785 = 0,26235
    assert.equal(t.effectiveCoefficient, 1.3557);
    assert.equal(t.laborHours, 8);
    assert.equal(t.optionsHT, 675);

    const computed = computeLines(lines, PRICING);
    assert.equal(computed[0].groupHT, 3785);   // le titre regroupe tout ce qui suit (hors option)
    assert.equal(computed[4].groupHT, 3650);   // le sous-total : depuis le titre
});

test('arrondis au centime ligne par ligne', () => {
    const t = computeQuoteTotals([line({ kind: 'FOURNITURE', unitCost: 10.01, quantity: 3 })], PRICING);
    // 10,01 × 1,35 = 13,5135 → 13,51 ; 3 × 13,51 = 40,53
    assert.equal(t.totalHT, 40.53);
    assert.equal(t.totalVAT, 8.11);
});

test('anomalies : devis vide, libellé, quantité, paramètre manquant', () => {
    assert.deepEqual(quoteIssues([], PRICING), ['Aucune ligne chiffrée.']);
    const issues = quoteIssues([
        line({ kind: 'FOURNITURE', label: '', unitCost: 10 }),
        line({ kind: 'MAIN_OEUVRE', quantity: 0 }),
    ], { ...PRICING, laborRate: null });
    assert.ok(issues.some(i => i.includes('libellé vide')));
    assert.ok(issues.some(i => i.includes('quantité nulle')));
    assert.ok(issues.some(i => i.includes('taux horaire')));
});

test('paramètres de prix : client prioritaire sur la société, rien d\'inventé', () => {
    const p = resolvePricing({ quoteCoefficient: 1.25 }, { quoteCoefficient: 1.4, quoteLaborRate: 55, quoteLaborCost: 35 });
    assert.equal(p.coefficient, 1.25);
    assert.equal(p.sources?.coefficient, 'client');
    assert.equal(p.laborRate, 55);
    assert.equal(p.sources?.laborRate, 'company');
    assert.equal(p.laborCost, 35);
    assert.equal(p.defaultVatRate, 20);
    const vide = resolvePricing(null, null);
    assert.equal(vide.coefficient, null);
    assert.equal(vide.laborRate, null);
});

test('numéro et validité', () => {
    assert.equal(quoteNumber('VEF', 2026, 7), 'VEF-DEV2026-0007');
    assert.equal(addDays('2026-11-04', 30), '2026-12-04');
    assert.equal(addDays('2026-12-15', 30), '2027-01-14');
});
