// Facturation manuelle : échéances dues à cocher (calcul pur) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueInvoiceLines, type BillingInput } from '../src/lib/billing/contract-billing';
import { basculer, cochable, controleSelection, echeancesDues, lienBlocage, lignesRetenues } from '../src/lib/billing/selection';

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

test("blocage : l'échéance bloquée est listée sans montant, ni elle ni les suivantes de la prestation ne se cochent ; le reste se facture", () => {
    const sansTva = { ...input(), activities: [{ id: 'p2', code: 'P2', label: 'Conduite', vatRateId: 'tva20' }, { id: 'p3', code: 'P3', label: 'Garantie totale' }] };
    const due = dueInvoiceLines(sansTva, [], '2026-04-01');
    assert.deepEqual(due.bloquees?.map(b => [b.key, b.start, b.nature]), [['site:s1:p3', '2026-01-01', 'tva'], ['site:s1:p3', '2026-04-01', 'tva']]);
    const dues = echeancesDues(due);
    const p3 = dues.filter(e => e.activite === 'P3');
    assert.deepEqual(p3.map(e => [e.montant, e.lignes.length, e.blocage?.nature, e.blocage?.siteId]), [[0, 0, 'tva', 's1'], [0, 0, 'tva', 's1']]);
    assert.match(p3[0].blocage!.message, /TVA non renseignée : P3 sur le site Alpha/);
    assert.deepEqual(lienBlocage(p3[0].blocage!, 'k'), { href: '/sites/s1', libelle: 'Renseigner la TVA de la prestation' });
    assert.equal(cochable(dues, p3[0]), false);
    assert.deepEqual(basculer(dues, [], p3[1].id, true), []);
    const p2 = dues.filter(e => e.activite === 'P2').map(e => e.id);
    assert.deepEqual(controleSelection(dues, p2), []);
    assert.match(controleSelection(dues, [...p2, p3[0].id])[0], /bloquée/);
    assert.equal(lignesRetenues(dues, p2).reduce((a, l) => a + l.total, 0), 1800);
});

test('blocage en milieu de prestation : les échéances suivantes ne sont pas cochables', () => {
    const ordre = [{ id: 'a1', cles: ['a'], debut: '2026-01-01' }, { id: 'a2', cles: ['a'], debut: '2026-02-01', blocage: {} }, { id: 'a3', cles: ['a'], debut: '2026-03-01' }, { id: 'b1', cles: ['b'], debut: '2026-03-01' }];
    assert.deepEqual(ordre.map(e => cochable(ordre, e)), [true, false, false, true]);
    assert.deepEqual(basculer(ordre, ['a1'], 'a3', true), ['a1']);
    assert.deepEqual(basculer(ordre, ['a1'], 'b1', true), ['a1', 'b1']);
});
