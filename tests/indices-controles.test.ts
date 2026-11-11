// Contrôles des indices récupérés automatiquement : valeurs plausibles, périodes, retard de publication : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGLES, controlerValeurs, frequenceMois, retardMois } from '../src/lib/indices/controles';

const J = '2026-11-11';

test('valeurs : acceptées si plausibles ; rejetées si illisibles, nulles, futures, en double ou en variation anormale', () => {
    const r = controlerValeurs(
        [{ period: '2026-09', value: 134.1 }, { period: '2026-10', value: 213 }, { period: '2026-08', value: 133.5 }, { period: '2026-08', value: 133.6 }, { period: '2027-01', value: 135 },
            { period: '2026-07', value: 0 }, { period: '2026/06', value: 130 }, { period: '2026-05', value: Number.NaN }],
        [{ period: '2026-06', value: 133 }], REGLES.statistique, J);
    assert.deepEqual(r.acceptees, [{ period: '2026-08', value: 133.5 }, { period: '2026-09', value: 134.1 }]);
    assert.deepEqual(r.rejetees.map(x => [x.period, x.motif.split(' :')[0].split(' (')[0]]), [
        ['2026-05', 'valeur illisible'], ['2026-07', 'valeur nulle ou négative'], ['2026-08', 'période reçue deux fois'],
        ['2026-10', 'variation de 58,8 % par rapport à 2026-09'], ['2026/06', 'période illisible'], ['2027-01', 'période dans le futur']]);
});

test('variation : comparée à la période précédente la plus proche ; plus large pour un prix de marché ; première valeur acceptée', () => {
    // 8,86 → 12 : +35 % — refusé pour un indice statistique, accepté pour un prix de marché.
    const lot = [{ period: '2026-10', value: 12 }], avant = [{ period: '2026-09', value: 8.86 }, { period: '2026-10', value: 8.9 }];
    assert.equal(controlerValeurs(lot, avant, REGLES.statistique, J).rejetees.length, 1);
    assert.equal(controlerValeurs(lot, avant, REGLES.marche, J).acceptees.length, 1);
    // Révision d'une valeur déjà enregistrée : comparée à la période d'avant, pas à elle-même.
    assert.deepEqual(controlerValeurs([{ period: '2026-10', value: 9.1 }], avant, REGLES.statistique, J).acceptees, [{ period: '2026-10', value: 9.1 }]);
    // Aucune valeur connue : la première est acceptée, les suivantes se contrôlent de proche en proche.
    const r = controlerValeurs([{ period: '2026-01', value: 100 }, { period: '2026-02', value: 104 }, { period: '2026-03', value: 180 }, { period: '2026-04', value: 106 }], [], REGLES.statistique, J);
    assert.deepEqual([r.acceptees.map(v => v.period), r.rejetees.map(v => v.period)], [['2026-01', '2026-02', '2026-04'], ['2026-03']]);
});

test('retard : selon la fréquence observée (mensuel, trimestriel) et la tolérance ; indice sans valeur : null', () => {
    assert.deepEqual([frequenceMois(['2026-06', '2026-07', '2026-08']), frequenceMois(['2025-07', '2025-10', '2026-01', '2026-04']), frequenceMois(['2026-08']), frequenceMois([])], [1, 3, 1, 1]);
    const mensuel = ['2026-04', '2026-05', '2026-06'];
    // Dernière valeur juin, prochaine attendue juillet, tolérance 4 mois : à jour jusqu'en novembre, en retard de 1 en décembre.
    assert.deepEqual([retardMois(mensuel, REGLES.statistique, '2026-11-11'), retardMois(mensuel, REGLES.statistique, '2026-12-01'), retardMois(mensuel, REGLES.marche, '2026-11-11')], [0, 1, 2]);
    assert.deepEqual([retardMois(['2025-01', '2025-04', '2025-07', '2025-10'], REGLES.statistique, '2026-11-11'), retardMois([], REGLES.statistique, J), retardMois(['2017-09'], REGLES.statistique, J)], [6, null, 105]);
});
