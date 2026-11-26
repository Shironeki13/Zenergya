import test from 'node:test';
import assert from 'node:assert/strict';
import { activiteEnergie, normaliserLignes, partAnnee, synthese, VIDE } from '../src/lib/budgets/budget';

test('prorata sur l\'année civile, bornes incluses', () => {
    assert.equal(partAnnee('2026-01-01', '2026-12-31', 1000, 2026), 1000);
    assert.equal(Math.round(partAnnee('2025-12-01', '2026-01-31', 620, 2026)), 310);
    assert.equal(partAnnee('2025-01-01', '2025-12-31', 1000, 2026), 0);
    assert.equal(partAnnee('2026-03-01', '2026-02-01', 1000, 2026), 0);
    assert.equal(Math.round(partAnnee('2026-10-01', '2027-03-31', 1820, 2026) * 100) / 100, 920);
});

test('saisie : activités du contrat, montants positifs, virgule acceptée, lignes vides retirées', () => {
    assert.deepEqual(normaliserLignes([{ activite: 'P2', ca: '12 000,5', achats: 3000 }, { activite: 'P3', ca: 0 }], ['P2', 'P3']),
        [{ activite: 'P2', ca: 12000.5, energie: 0, achats: 3000, mainOeuvre: 0, sousTraitance: 0 }]);
    assert.throws(() => normaliserLignes([{ activite: 'X', ca: 1 }], ['P2']), /hors du contrat/);
    assert.throws(() => normaliserLignes([{ activite: 'P2', ca: -1 }], ['P2']), /montant invalide/);
    assert.throws(() => normaliserLignes([{ activite: 'P2' }, { activite: 'P2' }], ['P2']), /deux fois/);
    assert.throws(() => normaliserLignes('x', ['P2']), /illisible/);
});

test('atterrissage : CA réalisé + reste ; dépenses au plus grand du budget et du réalisé ; écarts et alertes', () => {
    const s = synthese({
        activites: ['P1', 'P2'],
        budget: [{ activite: 'P1', ca: 100000, energie: 70000, achats: 0, mainOeuvre: 0, sousTraitance: 0 }, { activite: 'P2', ca: 20000, energie: 0, achats: 4000, mainOeuvre: 6000, sousTraitance: 0 }],
        initial: [{ activite: 'P1', ca: 100000, energie: 65000, achats: 0, mainOeuvre: 0, sousTraitance: 0 }],
        realise: { P1: { ...VIDE, ca: 60000, energie: 82000 }, P2: { ...VIDE, ca: 15000, achats: 1000, mainOeuvre: 2500 } },
        resteCA: { P1: 35000, P2: 5000 },
    });
    const [p1, p2] = s.lignes;
    assert.deepEqual([p1.atterrissage.ca, p1.atterrissage.energie, p1.marge.budget, p1.marge.atterrissage, p1.ecartMarge], [95000, 82000, 30000, 13000, -17000]);
    assert.deepEqual(p1.alertes, ['Énergie : réalisé au-delà du budget (+12 000 €)', 'Marge en dérive par rapport au budget']);
    assert.deepEqual([p1.budgetInitial?.energie, p1.marge.initial], [65000, 35000]);
    // P2 : sous le budget, atterrissage = budget pour les dépenses (une économie n'est constatée qu'en fin d'année).
    assert.deepEqual([p2.atterrissage.ca, p2.atterrissage.achats, p2.atterrissage.mainOeuvre, p2.ecartMarge, p2.alertes], [20000, 4000, 6000, 0, []]);
    assert.equal(p2.budgetInitial?.ca, 0);
    assert.deepEqual([s.total.budget.ca, s.total.atterrissage.ca, s.total.marge.atterrissage, s.total.ecartMarge], [120000, 115000, 23000, -17000]);
});

test('sans budget : dépenses sans budget non signalées ; réalisé non affecté conservé ; énergie sur le P1 chauffage', () => {
    const s = synthese({ activites: ['P2'], budget: [], initial: null, realise: { '—': { ...VIDE, achats: 500 } }, resteCA: {} });
    assert.deepEqual(s.lignes.map(l => [l.activite, l.realise.achats, l.alertes.length]), [['P2', 0, 0], ['—', 500, 0]]);
    assert.equal(s.total.budgetInitial, null);
    assert.equal(activiteEnergie([{ code: 'P1E', type: 'P1' }, { code: 'P1', type: 'P1' }, { code: 'P2', type: 'P2' }]), 'P1');
    assert.equal(activiteEnergie([{ code: 'P1E', type: 'P1' }, { code: 'P1C', type: 'P1' }]), 'P1C');
    assert.equal(activiteEnergie([{ code: 'P2', type: 'P2' }]), null);
});
