// Tests de la lecture du répertoire des entreprises (API de l'État) : npm test
// Réponses reprises de l'API (novembre 2026), réduites aux champs lus, sans données personnelles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildSearchQuery, entrepriseToClientFields, invalidSearch, mapSearchResponse, sireneCheckIssues, streetAddress, toSireneCheck,
} from '../src/lib/entreprises';
import { resolveEInvoicing } from '../src/lib/einvoicing';

const LYON = {
    total_results: 1, page: 1, total_pages: 1,
    results: [{
        siren: '216901231', nom_complet: 'COMMUNE DE LYON', nom_raison_sociale: 'COMMUNE DE LYON', sigle: null,
        etat_administratif: 'A', date_fermeture: null, nature_juridique: '7210', activite_principale: '84.11Z',
        nombre_etablissements_ouverts: 412,
        siege: {
            siret: '21690123100011', etat_administratif: 'A', date_fermeture: null, est_siege: true,
            adresse: '1 PLACE DE LA COMEDIE 69001 LYON', code_postal: '69001', libelle_commune: 'LYON',
        },
        matching_etablissements: [{
            siret: '21690123100011', etat_administratif: 'A', date_fermeture: null, est_siege: true,
            adresse: '1 PLACE DE LA COMEDIE 69001 LYON', code_postal: '69001', libelle_commune: 'LYON',
        }],
        complements: { est_administration: true, collectivite_territoriale: { niveau: 'Commune' } },
    }],
};

const FERMEE = {
    total_results: 1, page: 1, total_pages: 1,
    results: [{
        siren: '348290214', nom_complet: 'BOULANGERIE EXEMPLE', etat_administratif: 'C', date_fermeture: '1999-09-10',
        nature_juridique: '5499',
        siege: { siret: '34829021400017', etat_administratif: 'F', date_fermeture: '1997-01-08', est_siege: true,
            adresse: '3 RUE EXEMPLE 69001 LYON', code_postal: '69001', libelle_commune: 'LYON' },
        matching_etablissements: [],
    }],
};

test('requête : SIRET nettoyé, entreprises actives par défaut, filtres de lieu', () => {
    const q = buildSearchQuery({ q: '216 901 231 00011', codePostal: '69001' });
    assert.equal(q.get('q'), '21690123100011');
    assert.equal(q.get('etat_administratif'), 'A');
    assert.equal(q.get('code_postal'), '69001');
    assert.equal(q.get('minimal'), 'true');
    assert.equal(buildSearchQuery({ q: 'mairie', inclureCessees: true }).get('etat_administratif'), null);
    assert.equal(invalidSearch({ q: 'ab' }) !== null, true);
    assert.equal(invalidSearch({ q: 'mairie', codePostal: '690' }) !== null, true);
    assert.equal(invalidSearch({ q: 'mairie', departement: '2A' }), null);
});

test('collectivité : entité publique, établissement du SIRET cherché, adresse découpée', () => {
    const [r] = mapSearchResponse(LYON, '21690123100011').results;
    assert.equal(r.nom, 'COMMUNE DE LYON');
    assert.equal(r.estPublic, true);
    assert.equal(r.collectivite, 'Commune');
    assert.equal(r.etablissement.siret, '21690123100011');
    assert.equal(r.etablissement.actif, true);
    assert.equal(streetAddress(r.etablissement), '1 PLACE DE LA COMEDIE');
    assert.deepEqual(entrepriseToClientFields(r), {
        name: 'COMMUNE DE LYON', address: '1 PLACE DE LA COMEDIE', postalCode: '69001', city: 'LYON',
        siret: '21690123100011', clientType: 'public', useChorus: true,
    });
});

test('entreprise cessée, établissement fermé : signalés', () => {
    const response = mapSearchResponse(FERMEE, '34829021400017');
    const [r] = response.results;
    assert.equal(r.entrepriseActive, false);
    assert.equal(r.etablissement.actif, false);
    assert.equal(r.estPublic, false);
    assert.equal(entrepriseToClientFields(r).clientType, 'private');

    const check = toSireneCheck('34829021400017', response, new Date('2026-11-04T10:00:00Z'));
    assert.equal(check.found, true);
    assert.equal(check.etablissementActif, false);
    const issues = sireneCheckIssues(check, 'private');
    assert.equal(issues.length, 2);
    assert.ok(issues[1].includes('1997-01-08'));
});

test('contrôle : SIRET introuvable, incohérence public / privé', () => {
    const absent = toSireneCheck('73282932000074', mapSearchResponse(LYON, '73282932000074'));
    assert.equal(absent.found, false);
    assert.equal(sireneCheckIssues(absent).length, 1);

    const lyon = toSireneCheck('21690123100011', mapSearchResponse(LYON, '21690123100011'));
    assert.deepEqual(sireneCheckIssues(lyon, 'public'), []);
    assert.ok(sireneCheckIssues(lyon, 'private')[0].includes('entité publique'));
});

test('facturation électronique : le contrôle du SIRET actuel remonte en avertissement', () => {
    const check = toSireneCheck('34829021400017', mapSearchResponse(FERMEE, '34829021400017'));
    const client = { clientType: 'private' as const, typologyId: 't', siret: '34829021400017', useChorus: false, sireneCheck: check };
    assert.ok(resolveEInvoicing({ client }).warnings.some(w => w.includes('Établissement fermé')));
    // Contrôle d'un autre SIRET (fiche modifiée depuis) : ignoré.
    assert.ok(!resolveEInvoicing({ client: { ...client, siret: '73282932000074' } }).warnings.some(w => w.includes('Établissement fermé')));
});
