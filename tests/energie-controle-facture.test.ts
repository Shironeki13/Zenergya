// Contrôle d'une facture du fournisseur face au contrat de fourniture (calcul pur) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlerFactureFournisseur, memeFournisseur } from '../src/lib/energie/controle-facture';
import type { PeriodeFourniture } from '../src/lib/energie/fournitures';

const per = (id: string, debut: string, fin: string, fournisseur: string, prixMolecule?: number): PeriodeFourniture => ({ id, debut, fin, fournisseur, numeroContrat: `K-${id}`, titulaire: 'VEF', tacite: '', ...(prixMolecule && { prixMolecule }) });
const P = [per('a', '2024-01-01', '2025-12-31', 'EDF', 30), per('b', '2026-01-01', '2026-12-31', 'ENDESA', 25)];
const f = (plus: object) => ({ fournisseur: 'ENDESA', date: '2026-03-10', montantHT: 5000, ...plus });

test('même fournisseur à une variante de nom près', () => {
    assert.deepEqual([memeFournisseur('Gaz du Sud', 'Autre Gaz'), memeFournisseur('GAZ DE BORDEAUX', 'GAZ EUROPEEN'), memeFournisseur('TOTAL ENERGIES', 'Total'), memeFournisseur('Gaz', 'GAZ')], [false, false, true, true]);
    assert.deepEqual([memeFournisseur('EDF', 'EDF Entreprises'), memeFournisseur('UNIPER/GAZELENERGIE', 'Uniper'), memeFournisseur('Gaz du Sud (démo)', 'GAZ DU SUD'), memeFournisseur('ENI', 'ENGIE'), memeFournisseur('', 'EDF')], [true, true, true, false, false]);
});

test('facture dans son contrat : période retrouvée, prix moyen comparé à la molécule', () => {
    const c = controlerFactureFournisseur(f({ debut: '2026-02-01', fin: '2026-02-28', quantite: 100 }), P);
    assert.deepEqual([c.periode?.id, c.periode?.numeroContrat, c.prixMoyen], ['b', 'K-b', 50]);
    assert.deepEqual(c.alertes, [{ gravite: 'info', texte: 'Prix moyen de 50,00 €/MWh toutes composantes, pour une molécule à 25,00 €/MWh au contrat.' }]);
    assert.deepEqual(controlerFactureFournisseur(f({}), P).alertes, []);
});

test('alertes : hors contrat, fournisseur différent, à cheval, partielle, prix sous la molécule, non rattachée', () => {
    const t = (plus: object, p: PeriodeFourniture[] | null = P) => controlerFactureFournisseur(f(plus), p).alertes.map(a => `${a.gravite}:${a.texte.slice(0, 30)}`);
    assert.deepEqual(t({ date: '2027-02-10' }), ['attention:Aucun contrat fournisseur de c']);
    assert.deepEqual(t({ fournisseur: 'ENI' }), ['attention:Fournisseur de la facture (ENI']);
    assert.deepEqual(t({ fournisseur: 'EDF', debut: '2025-12-01', fin: '2026-01-31' }), ['info:La consommation est à cheval s']);
    assert.deepEqual(t({ debut: '2026-12-01', fin: '2027-01-31' }), ['attention:Le contrat fournisseur ne couv']);
    assert.deepEqual(t({ quantite: 400 }), ['attention:Prix moyen de 12,50 €/MWh, inf']);
    assert.deepEqual(t({}, null), ['info:Facture non rattachée à un poi']);
    assert.deepEqual(t({}, []), ['attention:Aucun contrat fournisseur de c']);
});
