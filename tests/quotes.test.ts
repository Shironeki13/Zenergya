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

import { availableActions, effectiveStatus } from '../src/lib/quotes/lifecycle';

test('cycle de vie : expiration déduite, actions possibles par statut', () => {
    const sent = { status: 'envoye' as const, validUntil: '2026-11-30' };
    assert.equal(effectiveStatus(sent, '2026-11-30'), 'envoye');
    assert.equal(effectiveStatus(sent, '2026-12-01'), 'expire');
    assert.deepEqual(availableActions({ status: 'brouillon', validUntil: '2026-11-30' }, '2026-11-04'), ['send', 'cancel']);
    assert.deepEqual(availableActions(sent, '2026-11-04'), ['accept', 'refuse', 'newVersion', 'cancel']);
    assert.deepEqual(availableActions(sent, '2026-12-01'), ['accept', 'newVersion', 'cancel']);
    assert.deepEqual(availableActions({ status: 'refuse', validUntil: '2026-11-30' }), ['newVersion']);
    assert.deepEqual(availableActions({ status: 'accepte', validUntil: '2026-11-30' }), []);
    assert.deepEqual(availableActions({ status: 'annule', validUntil: '2026-11-30' }), []);
});

import { allowedBillingKinds, billingSummary, buildQuoteInvoice } from '../src/lib/quotes/billing';
import { sumCents } from '../src/lib/money';

// Devis multi-taux : 3650 HT à 20 % (TVA 730) + 135 HT à 10 % (TVA 13,50) = 4528,50 TTC
const MULTI = (() => {
    const lines = [
        line({ kind: 'FOURNITURE', unitCost: 1000, quantity: 2 }),
        line({ kind: 'MAIN_OEUVRE', quantity: 8 }),
        line({ kind: 'SOUS_TRAITANCE', unitCost: 400, discountPct: 10 }),
        line({ kind: 'FOURNITURE', unitCost: 100, vatRate: 10 }),
        line({ kind: 'FOURNITURE', unitCost: 500, optional: true }),
    ];
    return { number: 'VEF-DEV2026-0001', version: 1, mode: 'P5' as const, status: 'accepte' as const, lines, pricing: PRICING, totals: computeQuoteTotals(lines, PRICING) };
})();
const asInvoice = (id: string, draft: ReturnType<typeof buildQuoteInvoice>, kind: 'acompte' | 'solde' | 'totale', percent?: number) => ({
    id, invoiceNumber: `F-${id}`, date: '2026-11-04', status: 'due' as const,
    subtotal: draft.subtotal, tax: draft.tax, total: draft.total, vatBreakdown: draft.vatBreakdown,
    quote: { id: 'q', number: MULTI.number, version: 1, billingKind: kind, ...(percent && { percent }) },
});

test('facturation : totalité = détail du devis, options exclues, TVA par taux', () => {
    const f = buildQuoteInvoice(MULTI, { kind: 'totale' }, []);
    assert.equal(f.lineItems.length, 4);
    assert.equal(f.subtotal, MULTI.totals.totalHT);
    assert.equal(f.tax, MULTI.totals.totalVAT);
    assert.equal(f.total, MULTI.totals.totalTTC);
    assert.deepEqual(f.vatBreakdown, MULTI.totals.vat);
});

test('facturation : acomptes puis solde, somme exactement égale au devis', () => {
    const a1 = buildQuoteInvoice(MULTI, { kind: 'acompte', percent: 30 }, []);
    assert.deepEqual(a1.vatBreakdown, [{ rate: 20, base: 1095, amount: 219 }, { rate: 10, base: 40.5, amount: 4.05 }]);
    assert.equal(a1.lineItems.length, 2);
    const inv1 = asInvoice('a1', a1, 'acompte', 30);

    const a2 = buildQuoteInvoice(MULTI, { kind: 'acompte', percent: 33.33 }, [inv1]);
    const inv2 = asInvoice('a2', a2, 'acompte', 33.33);
    assert.equal(billingSummary(MULTI, [inv1, inv2]).depositPercent, 63.33);
    assert.throws(() => buildQuoteInvoice(MULTI, { kind: 'acompte', percent: 40 }, [inv1, inv2]), /rester un solde/);
    assert.throws(() => buildQuoteInvoice(MULTI, { kind: 'totale' }, [inv1]), /facturez le solde/);

    const s = buildQuoteInvoice(MULTI, { kind: 'solde' }, [inv1, inv2]);
    assert.equal(s.deposits.length, 2);
    assert.equal(s.lineItems.filter(l => l.total < 0).length, 4);   // 2 acomptes × 2 taux
    // Lignes et ventilation cohérentes : somme des lignes = base ventilée.
    assert.equal(sumCents(s.lineItems.map(l => l.total)), s.subtotal);
    // Somme des trois factures = devis, au centime.
    assert.equal(sumCents([a1.subtotal, a2.subtotal, s.subtotal]), MULTI.totals.totalHT);
    assert.equal(sumCents([a1.tax, a2.tax, s.tax]), MULTI.totals.totalVAT);
    assert.equal(sumCents([a1.total, a2.total, s.total]), MULTI.totals.totalTTC);

    const done = billingSummary(MULTI, [inv1, inv2, asInvoice('s', s, 'solde')]);
    assert.equal(done.complete, true);
    assert.equal(done.remainingTTC, 0);
    assert.deepEqual(allowedBillingKinds(done), []);
});

test('facturation : un acompte annulé par avoir ne compte plus ; devis non accepté refusé', () => {
    const a1 = buildQuoteInvoice(MULTI, { kind: 'acompte', percent: 30 }, []);
    const cancelled = { ...asInvoice('a1', a1, 'acompte', 30), status: 'cancelled' as const };
    assert.deepEqual(allowedBillingKinds(billingSummary(MULTI, [cancelled])), ['totale', 'acompte']);
    assert.throws(() => buildQuoteInvoice({ ...MULTI, status: 'envoye' }, { kind: 'totale' }, []), /accepté/);
    assert.throws(() => buildQuoteInvoice(MULTI, { kind: 'acompte', percent: 0 }, []), /entre 0 et 100/);
});

import { creditNoteAmounts } from '../src/lib/credit-notes';

test("avoir d'une facture de solde : la déduction d'acompte redevient positive, l'avoir annule exactement la facture", () => {
    const a1 = buildQuoteInvoice(MULTI, { kind: 'acompte', percent: 30 }, []);
    const s = buildQuoteInvoice(MULTI, { kind: 'solde' }, [asInvoice('a1', a1, 'acompte', 30)]);
    const solde = { invoiceNumber: 'F-S', lineItems: s.lineItems, tax: s.tax, vatBreakdown: s.vatBreakdown };
    const avoir = creditNoteAmounts([solde]);
    assert.equal(avoir.subtotal, -s.subtotal);
    assert.equal(avoir.tax, -s.tax);
    assert.equal(avoir.total, -s.total);
    assert.ok(avoir.lineItems.some(l => l.total > 0), 'déductions redevenues positives');
    assert.deepEqual(avoir.vatBreakdown, s.vatBreakdown.map(v => ({ rate: v.rate, base: -v.base, amount: -v.amount })));
    // Factures ordinaires (lignes positives, TVA unique) : inchangé par rapport à l'ancien calcul.
    const simple = creditNoteAmounts([{ invoiceNumber: 'F1', lineItems: [{ description: 'P2', quantity: 1, unitPrice: 100, total: 100, activityCode: 'P2' }], tax: 10 }]);
    assert.deepEqual([simple.subtotal, simple.tax, simple.total, simple.vatBreakdown], [-100, -10, -110, []]);
});
