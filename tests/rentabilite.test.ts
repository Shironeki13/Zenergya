// Rentabilité d'une affaire : prévu, engagé, réel, facturé par nature ; coût et marge à terminaison ; alertes : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rentabilite } from '../src/lib/projects/rentabilite';
import type { Commande, LigneCommande } from '../src/lib/commandes';
import type { BudgetDevis } from '../src/lib/projects/affaire';

const budget: BudgetDevis = { vente: 10000, cout: 7000, parNature: { FOURNITURE: 3000, MAIN_OEUVRE: 2000, SOUS_TRAITANCE: 1500, DIVERS: 500 }, heures: 50, marge: 3000, tauxMarge: 0.3 };
const ligne = (nature: LigneCommande['nature'], total: number, projectId = 'A'): LigneCommande => ({ id: `${nature}${total}`, label: 'x', quantity: 1, unitPrice: total, total, nature, cible: { type: 'affaire', projectId } });
const cmd = (status: Commande['status'], lines: LigneCommande[], factures: number[] = []) => ({ status, lines, totalHT: lines.reduce((t, l) => t + l.total, 0), factures: factures.map((m, i) => ({ id: String(i), numero: String(i), date: '2026-01-01', montantHT: m, saisiPar: 'a', saisiLe: '' })) });

test('affaire dans son budget : engagé, réel, reste à engager ; la marge à terminaison reste la marge prévue', () => {
    const r = rentabilite({
        projectId: 'A', budget, facture: 4000,
        commandes: [
            cmd('recue', [ligne('FOURNITURE', 2500)], [2400]),                       // engagé 2 500, réel 2 400
            cmd('a_valider', [ligne('SOUS_TRAITANCE', 1400)]),                       // en validation : pas engagé
            cmd('validee', [ligne('DIVERS', 200), ligne('DIVERS', 300, 'B')], [250]),   // seule la ligne de l'affaire A : 200, réel 250 × 200/500 = 100
            cmd('annulee', [ligne('FOURNITURE', 9999)]), cmd('brouillon', [ligne('FOURNITURE', 9999)]), cmd('refusee', [ligne('FOURNITURE', 9999)]),
        ],
        heures: [{ hours: 20, cost: 800 }, { hours: 10.5, cost: 441 }],
    });
    assert.deepEqual(r.lignes.map(l => [l.nature, l.prevu, l.engage, l.reel, l.enValidation, l.reste, l.depassement]), [
        ['FOURNITURE', 3000, 2500, 2400, 0, 500, false], ['MAIN_OEUVRE', 2000, 1241, 1241, 0, 759, false],
        ['SOUS_TRAITANCE', 1500, 0, 0, 1400, 1500, false], ['DIVERS', 500, 200, 100, 0, 300, false]]);
    assert.deepEqual(r.total, { prevu: 7000, engage: 3941, reel: 3741, enValidation: 1400, reste: 3059, depassement: false });
    assert.deepEqual([r.heuresPrevues, r.heuresReelles, r.vente, r.facture, r.resteAFacturer], [50, 30.5, 10000, 4000, 6000]);
    assert.deepEqual([r.margePrevue, r.tauxMargePrevue, r.coutATerminaison, r.margeATerminaison, r.ecartMarge, r.resultatADate], [3000, 0.3, 7000, 3000, 0, 259]);
    assert.deepEqual(r.alertes, []);
});

test('dépassements : la marge à terminaison baisse du dépassement de chaque nature ; alertes', () => {
    const r = rentabilite({
        projectId: 'A', budget, facture: 10000,
        commandes: [cmd('soldee', [ligne('FOURNITURE', 3400)], [3450]), cmd('passee', [ligne('SOUS_TRAITANCE', 1000)])],
        heures: [{ hours: 60, cost: 2520 }],
    });
    // Fournitures +400, main-d'œuvre +520 ; sous-traitance et divers : budget supposé consommé.
    assert.deepEqual([r.coutATerminaison, r.margeATerminaison, r.tauxMargeATerminaison, r.ecartMarge], [7920, 2080, 0.208, -920]);
    assert.deepEqual([r.total.engage, r.total.reel, r.total.reste, r.total.depassement, r.resultatADate], [6920, 5970, 80, false, 4030]);
    assert.equal(r.alertes.length, 3);
    assert.match(r.alertes.join(' | ').replace(/[\u202f\u00a0]/g, ' '), /Fournitures : 3 400,00 € engagés pour 3 000,00 € prévus \(dépassement de 400,00 €\).*Main-d'œuvre : 2 520,00 €.*Fournitures : factures fournisseurs \(3 450,00 €\) supérieures aux commandes/);
    // Plus d'heures que prévu, sans dépasser le coût prévu (coût horaire plus bas) : alerte sur les heures.
    const h = rentabilite({ projectId: 'A', budget, facture: 0, commandes: [], heures: [{ hours: 55, cost: 1900 }] });
    assert.match(h.alertes.join(), /Heures : 55 h saisies pour 50 h prévues/);
    // Marge négative.
    const n = rentabilite({ projectId: 'A', budget, facture: 0, commandes: [cmd('validee', [ligne('FOURNITURE', 7000)])], heures: [] });
    assert.deepEqual([n.margeATerminaison, n.tauxMargeATerminaison], [-1000, -0.1]);
    assert.match(n.alertes.join(), /Marge à terminaison négative/);
});

test('affaire antérieure sans budget : pas de prévu ni d\'alerte de dépassement, la vente est le montant du marché', () => {
    const r = rentabilite({ projectId: 'A', vente: 5000, facture: 1000, commandes: [cmd('validee', [ligne('FOURNITURE', 1200)])], heures: [{ hours: 4, cost: 168 }] });
    assert.deepEqual([r.vente, r.total.prevu, r.total.engage, r.coutATerminaison, r.margeATerminaison, r.margePrevue], [5000, 0, 1368, 1368, 3632, 5000]);
    assert.deepEqual(r.alertes, []);
});
