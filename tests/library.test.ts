// Tests de la bibliothèque de prix : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { articleToLine, parseAmount, parseArticlesCsv, planImport, workToLine } from '../src/lib/library/insert';
import { computeQuoteTotals, unitPriceOf } from '../src/lib/quotes/pricing';
import type { PriceArticle, PriceWork } from '../src/lib/library/types';
import type { QuotePricing } from '../src/lib/quotes/types';

const PRICING: QuotePricing = { coefficient: 1.35, laborRate: 58, laborCost: 36.5, defaultVatRate: 20 };
const art = (a: Partial<PriceArticle> & Pick<PriceArticle, 'id' | 'code' | 'kind' | 'unitCost'>): PriceArticle =>
    ({ label: a.code, unit: 'u', active: true, createdAt: '', updatedAt: '', ...a });
const RAD = art({ id: 'r', code: 'RAD-600', kind: 'FOURNITURE', unitCost: 180, label: 'Radiateur 600 W' });
const KIT = art({ id: 'k', code: 'KIT-R', kind: 'FOURNITURE', unitCost: 25 });
const MO = art({ id: 'm', code: 'MO-PLOMB', kind: 'MAIN_OEUVRE', unitCost: null, unit: 'h' });
const ARTICLES = new Map([RAD, KIT, MO].map(a => [a.id, a]));
const WORK: PriceWork = {
    id: 'w', code: 'OUV-RAD', label: "Pose d'un radiateur", unit: 'u', active: true, createdAt: '', updatedAt: '',
    components: [{ articleId: 'r', quantity: 1 }, { articleId: 'k', quantity: 1 }, { articleId: 'm', quantity: 2 }],
};

test('insertion : article recopié (MO sans déboursé → coût horaire du devis), source mémorisée', () => {
    const l = articleToLine(RAD, { quantity: 4, vatRate: 10 });
    assert.equal(l.kind, 'FOURNITURE');
    assert.equal(l.unitCost, 180);
    assert.equal(l.vatRate, 10);
    assert.deepEqual(l.source, { type: 'article', id: 'r', code: 'RAD-600' });
    assert.equal(articleToLine(MO, { quantity: 3, vatRate: 20 }).unitCost, undefined);
});

test('insertion : ouvrage recopié en une ligne composée, chiffrée selon le devis', () => {
    const l = workToLine(WORK, ARTICLES, { quantity: 3, vatRate: 20 });
    assert.equal(l.kind, 'OUVRAGE');
    assert.equal(l.components?.length, 3);
    assert.equal(unitPriceOf(l, PRICING), 392.75);
    assert.equal(computeQuoteTotals([l], PRICING).totalHT, 1178.25);
    // Recopie : modifier l'article ensuite ne change pas la ligne.
    RAD.unitCost = 999;
    assert.equal(l.components?.[0].unitCost, 180);
    RAD.unitCost = 180;
    assert.throws(() => workToLine({ ...WORK, components: [{ articleId: 'x', quantity: 1 }] }, ARTICLES, { quantity: 1, vatRate: 20 }), /introuvable/);
});

test('montants : formats français et anglais', () => {
    assert.equal(parseAmount('1 234,50 €'), 1234.5);
    assert.equal(parseAmount('1.234,50'), 1234.5);
    assert.equal(parseAmount('1234.5'), 1234.5);
    assert.equal(parseAmount(''), null);
    assert.ok(Number.isNaN(parseAmount('abc') as number));
});

test('import CSV : en-têtes souples, séparateur détecté, erreurs par ligne', () => {
    const csv = [
        'Code;Libellé;Unité;Déboursé;Nature;Famille;Fournisseur;Réf fournisseur',
        'RAD-600;Radiateur 600 W;u;180,00;Fourniture;Chauffage;Frans;F-123',
        'MO-PLOMB;Plombier;h;;MO;;;',
        'KIT-R;Kit raccordement;u;25;;Chauffage;;',
        ';Sans code;u;10;;;;',
        'BAD;Prix faux;u;abc;;;;',
        'RAD-600;Doublon;u;10;;;;',
        'X;Nature inconnue;u;5;Matériau;;;',
    ].join('\n');
    const r = parseArticlesCsv(csv);
    assert.deepEqual(r.rows.map(a => a.code), ['RAD-600', 'MO-PLOMB', 'KIT-R']);
    assert.equal(r.rows[0].unitCost, 180);
    assert.equal(r.rows[0].supplierRef, 'F-123');
    assert.equal(r.rows[1].kind, 'MAIN_OEUVRE');
    assert.equal(r.rows[1].unitCost, null);
    assert.equal(r.rows[2].kind, 'FOURNITURE');
    assert.deepEqual(r.errors.map(e => e.line), [5, 6, 7, 8]);
    assert.ok(parseArticlesCsv('a,b\n1,2').errors[0].message.includes('introuvable'));
});

test('import : création, mise à jour par code (changement de déboursé signalé), inchangés', () => {
    const { rows } = parseArticlesCsv('code,libelle,unite,debourse\nRAD-600,Radiateur 600 W,u,185\nKIT-R,KIT-R,u,25\nNEW,Nouveau,m,3.5');
    const plan = planImport(rows, [RAD, KIT]);
    assert.deepEqual(plan.creates.map(c => c.code), ['NEW']);
    assert.equal(plan.updates.length, 1);
    assert.equal(plan.updates[0].costChange, true);
    assert.equal(plan.unchanged, 1);
});

test('import : une colonne facultative vide ne remplace pas la valeur existante (import rejouable)', () => {
    const existing = { ...RAD, family: 'Chauffage', supplier: 'Frans', unitCost: 180 };
    const { rows } = parseArticlesCsv('code,libelle,unite,debourse\nRAD-600,Radiateur 600 W,u,180');
    assert.equal(planImport(rows, [existing]).unchanged, 1);
});
