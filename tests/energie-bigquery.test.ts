// Factures des fournisseurs lues dans BigQuery : requête unifiée, vues configurables, lecture des lignes (calcul pur) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VUES_DEFAUT, lireLignes, pdlNorme, requeteFactures, vueValide, vuesDe } from '../src/lib/energie/bigquery';

test('vues : celles par défaut, remplaçables ou retirables par l\'environnement, noms contrôlés', () => {
    assert.deepEqual(vuesDe({}), VUES_DEFAUT);
    const v = vuesDe({ ENERGIE_BQ_VUE_GAZ_HISTORIQUE: '', ENERGIE_BQ_VUE_RCU_ESKER: ' p-1.jeu.vue_rcu ' });
    assert.deepEqual([v.gazHistorique, v.rcuEsker, v.gazEsker], [undefined, 'p-1.jeu.vue_rcu', VUES_DEFAUT.gazEsker]);
    assert.deepEqual(['a-b.c.d', 'a.b', 'a.b.c; DROP', 'a.b.`c`'].map(vueValide), [true, false, false, false]);
    assert.throws(() => vuesDe({ ENERGIE_BQ_VUE_GAZ_ESKER: 'x.y.z` UNION ALL SELECT' }), /Nom de vue BigQuery invalide/);
});

test('requête : une seule lecture des vues, paramètres nommés, Esker avant l\'historique, lecture seule', () => {
    const sql = requeteFactures(VUES_DEFAUT);
    for (const vue of Object.values(VUES_DEFAUT)) assert.ok(sql.includes(`\`${vue}\``), vue);
    assert.equal(sql.split('UNION ALL').length, 5);
    assert.match(sql, /UPPER\(pdl_norme\) IN UNNEST\(@pdls\)/);
    // Colonnes lues en JSON : une colonne absente d'une vue ne fait pas échouer la requête.
    assert.match(sql, /SELECT TO_JSON\(t\) j FROM/);
    assert.match(sql, /JSON_VALUE\(j, '\$\.MONTANT_STOCKAGE_CAPACITE_TDN'\)/);
    assert.match(sql, /date >= @depuis/);
    assert.match(sql, /PARTITION BY energie, fournisseur_norme, numero, pdl_norme ORDER BY IF\(source = 'Historique', 1, 0\)/);
    assert.match(sql, /SAFE\.PARSE_DATE\('%d\/%m\/%Y'/);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|TRUNCATE)\b/i);
    assert.equal(requeteFactures({ gazEsker: 'a.b.c' }).includes('UNION ALL'), false);
    assert.throws(() => requeteFactures({}), /Aucune vue/);
});

test('lignes : identifiant stable, PCE sans zéros de tête, montants arrondis, composantes absentes laissées vides', () => {
    const [f, g] = lireLignes([
        { energie: 'GAZ', source: 'Esker', fournisseur: 'GAZ_EUROPEEN', fournisseur_norme: 'GAZ EUROPEEN', numero: 'F-1', pdl: ' 00123456 ', date: '2026-10-05', debut: '2026-09-01', fin: '2026-09-30', mwh: '29.4', ht: '1840.604',
            consommation: '900.126', acheminement: '300', taxes: '250.5', abonnement: '390', ttc: '2208.72', pdf: 'https://x/f1.pdf', contrat: 'K1', type: 'Facture' },
        { energie: 'ELEC', source: 'Historique', fournisseur: 'EDF', fournisseur_norme: 'EDF', numero: 'E-9', pdl: '30002310560856', date: '2026-03-10', debut: null, fin: null, mwh: '0', ht: '-58.07',
            consommation: null, acheminement: '0', taxes: '0', abonnement: null, ttc: null, pdf: null, contrat: null, type: null },
        { energie: 'GAZ', numero: null, pdl: '1', ht: '5' }, { energie: 'GAZ', numero: 'X', pdl: '1', ht: null },
    ]);
    assert.deepEqual([f.id, f.fournisseur, f.pdl, f.montantHT, f.quantite, f.consommation, f.acheminement, f.taxes, f.abonnement, f.pdf],
        ['bq:GAZ|GAZ EUROPEEN|F-1|123456', 'GAZ EUROPEEN', '123456', 1840.6, 29.4, 900.13, 300, 250.5, 390, 'https://x/f1.pdf']);
    assert.deepEqual([g.id, g.montantHT, g.quantite, g.consommation, g.debut, g.pdf], ['bq:ELEC|EDF|E-9|30002310560856', -58.07, null, null, null, null]);
    assert.deepEqual([pdlNorme(' 0012 34 '), pdlNorme('gi025062'), pdlNorme(null)], ['1234', 'GI025062', '']);
});
