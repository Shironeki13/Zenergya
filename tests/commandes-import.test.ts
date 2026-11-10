// Import de commandes : en-têtes, regroupement par référence, contrôles de forme : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireImportCommandes } from '../src/lib/commandes-import';

const E = ['Référence *', 'Date *', 'Fournisseur *', 'Objet *', 'Demandeur (email)', 'État', 'Désignation *', 'Nature *', 'Quantité *', 'Prix unitaire HT *', 'Affaire', 'Contrat', 'Activité', 'Livraison souhaitée'];

test('lignes regroupées par référence ; en-tête repris de la première ligne ; nombres et natures lus', () => {
    const r = lireImportCommandes([E,
        ['BC-101', '03/11/2026', 'FRN-00001', 'Chaudières', 'Tech@V.fr', 'Validée', 'Chaudière 300 kW', 'Fournitures', '2', '22 400,50 €', 'ZEN-AFF2026-0003', '', '', '2026-11-20'],
        ['bc-101', '', '', '', '', '', 'Pose', 'sous-traitance', '1', '1200', 'ZEN-AFF2026-0003', '', '', ''],
        [], ['BC-102', '2026-11-04', 'Négoce', 'Pièces', '', '', 'Gicleurs', 'FOURNITURE', '4', '86', '', 'CTN-00001', 'P2', ''],
    ]);
    assert.equal(r.erreur, undefined);
    assert.deepEqual(r.commandes.map(c => [c.reference, c.ligne, c.date, c.fournisseur, c.demandeur, c.etat, c.livraison, c.lignes.length, c.totalHT, c.erreurs.length]), [
        ['BC-101', 2, '2026-11-03', 'FRN-00001', 'tech@v.fr', 'validee', '2026-11-20', 2, 46001, 0], ['BC-102', 5, '2026-11-04', 'Négoce', '', 'brouillon', '', 1, 344, 0]]);
    assert.deepEqual(r.commandes[0].lignes.map(l => [l.ligne, l.nature, l.quantity, l.unitPrice, l.erreurs.length]), [[2, 'FOURNITURE', 2, 22400.5, 0], [3, 'SOUS_TRAITANCE', 1, 1200, 0]]);
});

test('erreurs : en-tête incohérent, ligne incomplète, état ou nature inconnus ; fichier refusé sans référence ou sans colonne', () => {
    const r = lireImportCommandes([E,
        ['A', 'hier', '', 'Objet', '', 'en cours', 'x', 'Énergie', '0', 'abc', 'AFF', 'CTN', '', '31/02/2026'],
        ['A', '2026-11-04', 'Autre fournisseur', 'Objet', '', '', '', 'Divers', '1', '10', '', 'CTN-1', '', ''],
    ]);
    const c = r.commandes[0];
    assert.match(c.erreurs.join(' | '), /date illisible.*fournisseur manquant.*état inconnu : « en cours ».*date de livraison illisible.*ligne 3 : date, fournisseur différent/);
    assert.match(c.lignes[0].erreurs.join(' | '), /nature inconnue : « Énergie ».*quantité strictement positive.*prix unitaire HT invalide.*pas les deux/);
    assert.match(c.lignes[1].erreurs.join(' | '), /désignation manquante.*activité du contrat/);
    assert.match(String(lireImportCommandes([E, ['', '2026-11-04', 'F', 'O', '', '', 'x', 'Divers', '1', '1', 'A', '', '', '']]).erreur), /Référence manquante \(ligne 2\)/);
    assert.match(String(lireImportCommandes([['Référence', 'Date'], ['A', '2026-11-04']]).erreur), /Colonne\(s\) manquante\(s\) : Fournisseur, Objet, Désignation, Nature, Quantité, Prix unitaire HT/);
    assert.match(String(lireImportCommandes([E]).erreur), /Aucune ligne/);
});
