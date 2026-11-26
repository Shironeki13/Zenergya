import test from 'node:test';
import assert from 'node:assert/strict';
import { SEUILS_DEFAUT, analyserDerive, controleSeuils, nouveauxEnDerive, tauxBudget, unAnAvant } from '../src/lib/energie/derives';
import { margeP1 } from '../src/lib/energie/marge';

// Six mois de chauffe : ventes et achats mensuels (quantité en MWh).
const serie = (an: number, ventes: number, achat: number, mwh: number) => ({
    ventes: [1, 2, 3, 10, 11, 12].map(m => ({ debut: `${an}-${String(m).padStart(2, '0')}-01`, fin: `${an}-${String(m).padStart(2, '0')}-28`, montantHT: ventes })),
    achats: [1, 2, 3, 10, 11, 12].map(m => ({ date: `${an}-${String(m).padStart(2, '0')}-28`, debut: `${an}-${String(m).padStart(2, '0')}-01`, fin: `${an}-${String(m).padStart(2, '0')}-28`, montantHT: achat, quantite: mwh })),
});
const marge = (an: number, v: number, a: number, q: number) => { const s = serie(an, v, a, q); return margeP1(s.ventes, s.achats, `${an}-01`, `${an}-12`); };

test('prix d\'achat en hausse : marge sous le seuil, en baisse sur un an et sous le budget → dérive forte, cause le prix', () => {
    const a = analyserDerive(marge(2026, 1000, 950, 10), marge(2025, 1000, 700, 10), tauxBudget(6000, 4200));
    assert.deepEqual([a.taux, a.tauxN1, a.ecartN1, a.tauxBudget, a.ecartBudget], [5, 30, -25, 30, -25]);
    assert.deepEqual(a.motifs, ['Marge sous 10 % (5 %)', '-25 points par rapport à l\'an dernier', '-25 points par rapport au budget']);
    assert.equal(a.gravite, 'forte');
    assert.deepEqual([a.prixAchat.ecart, a.quantite.ecart, a.ventes.ecart], [35.7, 0, 0]);
    assert.equal(a.cause, "prix d'achat de l'énergie en hausse de 35,7 %");
});

test('consommation en hausse sans hausse des ventes ; ventes en baisse ; marge correcte : pas de dérive', () => {
    const conso = analyserDerive(marge(2026, 1000, 900, 13), marge(2025, 1000, 692.31, 10), null);
    assert.equal(conso.gravite, 'attention');   // marge à 10 % (pas sous le seuil), mais −20,8 points sur un an
    assert.match(conso.cause!, /consommation en hausse de 30 %/);
    const ventes = analyserDerive(marge(2026, 800, 700, 10), marge(2025, 1000, 700, 10), null);
    assert.equal(ventes.cause, 'P1 facturé en baisse de 20 %');
    assert.deepEqual(ventes.motifs, ['-17,5 points par rapport à l\'an dernier']);
    assert.equal(ventes.gravite, 'attention');
    const sain = analyserDerive(marge(2026, 1000, 700, 10), marge(2025, 1000, 700, 10), 30);
    assert.deepEqual([sain.gravite, sain.motifs, sain.cause], [null, [], null]);
});

test('trop peu de mois complets : pas de jugement ; marge négative : toujours forte ; pas d\'historique', () => {
    const court = margeP1([{ debut: '2026-01-01', fin: '2026-01-31', montantHT: 100 }], [{ date: '2026-01-31', montantHT: 150 }], '2026-01', '2026-12');
    assert.deepEqual([analyserDerive(court, null, null).taux, analyserDerive(court, null, null).gravite], [null, null]);
    const neg = analyserDerive(marge(2026, 1000, 1100, 10), null, null);
    assert.deepEqual([neg.gravite, neg.motifs, neg.cause], ['forte', ['Marge négative (-10 %)'], "pas d'historique sur l'an dernier pour comparer"]);
});

test('seuils, fenêtres et nouveaux sites en dérive', () => {
    assert.deepEqual(controleSeuils({}), SEUILS_DEFAUT);
    assert.deepEqual(controleSeuils({ tauxMin: 8.25, moisMin: 4.4 }), { ...SEUILS_DEFAUT, tauxMin: 8.3, moisMin: 4 });
    assert.throws(() => controleSeuils({ baisseN1: -1 }), /entre 0 et 100/);
    assert.throws(() => controleSeuils({ moisMin: 13 }), /entre 1 et 12/);
    assert.equal(unAnAvant('2026-03'), '2025-03');
    assert.deepEqual(nouveauxEnDerive(['a', 'b', 'c'], ['b']), ['a', 'c']);
    assert.equal(tauxBudget(0, 10), null);
});

test('mail récapitulatif : modèle valide, règle par défaut, exemple d\'aperçu', async () => {
    const { MODELES_DEFAUT, REGLES_DEFAUT, FAMILLE_EVENEMENT, contexteExemple } = await import('../src/lib/notifications/modeles');
    const { controlerModele, rendre } = await import('../src/lib/notifications/balises');
    assert.equal(FAMILLE_EVENEMENT.derive_p1, 'energie');
    assert.deepEqual(REGLES_DEFAUT.derive_p1.roles, ['acheteurs', 'administrateurs']);
    assert.deepEqual(controlerModele(MODELES_DEFAUT.derive_p1), []);
    const mail = rendre(MODELES_DEFAUT.derive_p1, contexteExemple('derive_p1'));
    assert.match(mail.sujet, /2 site\(s\) en dérive/);
    assert.match(mail.texte, /\[nouveau\] Copropriété Les Tilleuls, Tilleuls - Bâtiment A — marge 4,2/);
});
