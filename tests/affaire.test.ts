// Affaires de travaux : budget prévu par nature, code analytique : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetAffaire, budgetDevis, codeAnalytiqueAffaire, segmentAffaire } from '../src/lib/projects/affaire';
import type { QuoteLine, QuotePricing } from '../src/lib/quotes/types';

const pricing: QuotePricing = { coefficient: 1.4, laborRate: 70, laborCost: 45, defaultVatRate: 20 };
const l = (p: Partial<QuoteLine>): QuoteLine => ({ id: Math.random().toString(36).slice(2), kind: 'FOURNITURE', label: 'x', quantity: 1, vatRate: 20, ...p });

test('budget d\'un devis : déboursé par nature, ouvrages ventilés par composant, options et titres exclus', () => {
    const b = budgetDevis({ pricing, lines: [
        l({ kind: 'TITRE', label: 'Chaufferie' }),
        l({ kind: 'FOURNITURE', quantity: 2, unitCost: 500 }),                       // 1 000 → vente 1 400
        l({ kind: 'MAIN_OEUVRE', quantity: 10 }),                                    // 10 h × 45 = 450 → vente 700
        l({ kind: 'SOUS_TRAITANCE', quantity: 1, unitCost: 800 }),                   // 800 → 1 120
        l({ kind: 'OUVRAGE', quantity: 3, components: [                              // par unité : 100 + 2 h × 45 = 190
            { kind: 'FOURNITURE', label: 'vanne', quantity: 1, unitCost: 100 }, { kind: 'MAIN_OEUVRE', label: 'pose', quantity: 2 }] }),
        l({ kind: 'DIVERS', quantity: 1, unitCost: 50, optional: true }),            // option : non comptée
    ] });
    assert.deepEqual(b.parNature, { FOURNITURE: 1300, MAIN_OEUVRE: 720, SOUS_TRAITANCE: 800, DIVERS: 0 });
    assert.deepEqual([b.cout, b.heures], [2820, 16]);
    // Ouvrage : (100 × 1,4 + 2 × 70) × 3 = 840.
    assert.deepEqual([b.vente, b.marge], [1400 + 700 + 1120 + 840, 4060 - 2820]);
    assert.equal(b.tauxMarge, Math.round((1240 / 4060) * 10000) / 10000);
});

test('budget d\'une affaire : somme de ses devis (devis complémentaire)', () => {
    const d1 = budgetDevis({ pricing, lines: [l({ quantity: 1, unitCost: 1000 })] });
    const d2 = budgetDevis({ pricing, lines: [l({ kind: 'MAIN_OEUVRE', quantity: 4 })] });
    const a = budgetAffaire([d1, d2]);
    assert.deepEqual([a.vente, a.cout, a.parNature.FOURNITURE, a.parNature.MAIN_OEUVRE, a.heures, a.marge], [1400 + 280, 1180, 1000, 180, 4, 500]);
    assert.deepEqual(budgetAffaire([]).vente, 0);
});

test('code analytique d\'une affaire : code du client + affaire', () => {
    assert.equal(segmentAffaire('ZEN-AFF2026-0007'), 'AFF20260007');
    assert.equal(codeAnalytiqueAffaire('ZEN-LYO-LN-CLI00012', 'ZEN-AFF2026-0007'), 'ZEN-LYO-LN-CLI00012-AFF20260007');
});
