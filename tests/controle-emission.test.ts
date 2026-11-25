// Contrôle avant émission : écarts avec la dernière facturation du contrat (calcul pur) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlesEmission, precedentDe } from '../src/lib/billing/controle';
import type { EcheanceDue } from '../src/lib/billing/selection';

const e = (id: string, cle: string, debut: string, fin: string, montant: number, plus: Partial<EcheanceDue> = {}): EcheanceDue => ({
    id, cles: [cle], activite: 'P2', libelle: 'Conduite', site: 'Alpha', debut, fin, facturableLe: debut, montant, revise: false, prorata: false, lignes: [], ...plus,
});
const facture = (numero: string, date: string, lignes: [string, string, string, number][], plus: object = {}) => ({
    invoiceNumber: numero, date, status: 'due', subtotal: lignes.reduce((a, l) => a + l[3], 0),
    lineItems: lignes.map(([itemKey, periodStartDate, periodEndDate, total]) => ({ itemKey, periodStartDate, periodEndDate, total })), ...plus,
});

test('facturé précédemment : dernière ligne par prestation, lignes d\'une révision cumulées, proformas et annulées écartés', () => {
    const p = precedentDe([
        facture('F-1', '2026-01-02', [['a', '2026-01-01', '2026-03-31', 300]]),
        facture('F-2', '2026-04-02', [['a', '2026-04-01', '2026-04-30', 100], ['a', '2026-05-01', '2026-06-30', 210], ['b', '2026-04-01', '2026-06-30', 600]]),
        facture('F-3', '2026-07-02', [['a', '2026-07-01', '2026-09-30', 9999]], { cancelledByCreditNoteId: 'av' }),
        { status: 'proforma', date: '2026-07-03', lineItems: [{ itemKey: 'a', periodStartDate: '2026-07-01', periodEndDate: '2026-09-30', total: 1 }] },
    ]);
    assert.deepEqual(p.parCle.a, { montant: 310, jours: 91, fin: '2026-06-30', numero: 'F-2' });
    assert.deepEqual(p.derniere, { numero: 'F-2', date: '2026-04-02', totalHT: 910 });
    assert.equal(p.nombre, 2);
});

test('écart par prestation : au rythme journalier, seuils 20 % et 50 % ; une révision ordinaire ne déclenche rien', () => {
    const p = precedentDe([facture('F-1', '2026-01-02', [['a', '2026-01-01', '2026-03-31', 900]])]);   // 10 €/jour
    const un = (montant: number, fin = '2026-06-30') => controlesEmission([e('x', 'a', '2026-04-01', fin, montant)], ['x'], p, '2026-12-31').filter(a => a.id.startsWith('ecart'));
    assert.deepEqual(un(910), []);
    assert.deepEqual(un(955), []);                                   // +5 % : révision
    assert.deepEqual(un(300, '2026-04-30'), []);                     // prorata d'un mois : même rythme
    assert.equal(un(1200)[0].gravite, 'attention');                  // +32 %
    assert.equal(un(1820)[0].gravite, 'forte');                      // doublé
    assert.match(un(1800)[0].texte, /P2 Alpha : 1 800,00 € pour cette période, contre 900,00 € sur la facture F-1 \(\+100 %\)/);
    // Période d'une autre longueur : comparaison au rythme journalier.
    assert.match(un(600, '2026-04-30')[0].texte, /600,00 € pour cette période, contre 300,00 € au rythme de la facture F-1 \(\+100 %\)/);
    assert.equal(un(400)[0].gravite, 'forte');                       // −56 %
});

test('rattrapage, avance, première facture, total de la facture ; P1 saisonnier non comparé', () => {
    const p = precedentDe([facture('F-1', '2026-01-02', [['a', '2026-01-01', '2026-03-31', 900]])]);
    const trois = [e('1', 'a', '2026-04-01', '2026-06-30', 910), e('2', 'a', '2026-07-01', '2026-09-30', 920), e('3', 'a', '2026-10-01', '2026-12-31', 920, { facturableLe: '2026-10-01' })];
    const a = controlesEmission(trois, ['1', '2', '3'], p, '2026-08-15');
    assert.deepEqual(a.map(x => [x.id, x.gravite]), [['rattrapage', 'attention'], ['facture', 'attention'], ['avance', 'info']]);
    assert.match(a[0].texte, /jusqu'à 3\), depuis le 01\/04\/2026/);
    assert.deepEqual(controlesEmission(trois, ['1'], p, '2026-08-15'), []);
    assert.deepEqual(controlesEmission(trois, [], p, '2026-08-15'), []);
    assert.deepEqual(controlesEmission(trois, ['1'], precedentDe([]), '2026-08-15').map(x => x.id), ['premiere']);
    const p1 = e('c', 'a', '2026-04-01', '2026-04-30', 5000, { lignes: [{ p1Releve: {} } as never] });
    assert.deepEqual(controlesEmission([p1], ['c'], p, '2026-08-15'), []);
});
