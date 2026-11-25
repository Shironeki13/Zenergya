// Marge P1 : ventes au client face aux factures du fournisseur, par mois (calcul pur) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { douzeMois, margeP1, repartirParMois } from '../src/lib/energie/marge';

test('répartition par mois au prorata des jours, sans perdre un centime', () => {
    assert.deepEqual([...repartirParMois('2026-01-01', '2026-03-31', 900)], [['2026-01', 310], ['2026-02', 280], ['2026-03', 310]]);
    assert.deepEqual([...repartirParMois('2026-01-16', '2026-02-15', 100)], [['2026-01', 51.61], ['2026-02', 48.39]]);
    assert.deepEqual([...repartirParMois('2026-05-10', '2026-05-10', 42)], [['2026-05', 42]]);
    assert.equal([...repartirParMois('2026-01-01', '2026-12-31', 1000).values()].reduce((a, b) => a + b, 0).toFixed(2), '1000.00');
    assert.deepEqual([...repartirParMois('2026-03-01', '2026-02-01', 10)], []);
    assert.deepEqual(douzeMois('2026-11-25'), { de: '2025-12', a: '2026-11' });
});

test('marge : calculée sur les mois où ventes et achats sont connus ; les autres sont à part', () => {
    const m = margeP1(
        [{ debut: '2026-01-01', fin: '2026-01-31', montantHT: 5000 }, { debut: '2026-02-01', fin: '2026-02-28', montantHT: 4000 }, { debut: '2026-03-01', fin: '2026-03-31', montantHT: 3000 }],
        [{ date: '2026-02-10', debut: '2026-01-01', fin: '2026-01-31', montantHT: 3800, quantite: 80 }, { date: '2026-03-05', debut: '2026-02-01', fin: '2026-02-28', montantHT: 3300 }, { date: '2026-06-02', montantHT: 250 }],
        '2026-01', '2026-12');
    assert.deepEqual(m.mois.map(l => [l.mois, l.ventes, l.achats, l.complet, l.marge]), [
        ['2026-01', 5000, 3800, true, 1200], ['2026-02', 4000, 3300, true, 700], ['2026-03', 3000, 0, false, null], ['2026-06', 0, 250, false, null],
    ]);
    assert.deepEqual([m.ventes, m.achats, m.marge, m.taux, m.moisComplets, m.ventesSansAchat, m.achatsSansVente], [9000, 7100, 1900, 21.1, 2, 3000, 250]);
    assert.equal(m.mois[0].quantite, 80);
});

test('fenêtre : hors période ignoré ; avoir du fournisseur en négatif ; aucune donnée', () => {
    const m = margeP1([{ debut: '2025-10-01', fin: '2026-03-31', montantHT: 1820 }], [{ date: '2026-01-15', montantHT: 500 }, { date: '2026-01-20', montantHT: -100 }], '2026-01', '2026-02');
    assert.deepEqual(m.mois.map(l => [l.mois, l.ventes, l.achats, l.marge]), [['2026-01', 310, 400, -90], ['2026-02', 280, 0, null]]);
    assert.deepEqual([m.marge, m.taux], [-90, -29]);
    assert.deepEqual(margeP1([], [], '2026-01', '2026-12'), { mois: [], ventes: 0, achats: 0, marge: 0, taux: null, moisComplets: 0, ventesSansAchat: 0, achatsSansVente: 0 });
});
