// Validation des documents de contrat (logique pure) : types, effets annoncés, résumés : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aucunUnitaire, ceUnitaire, detailsElement, effetsValidation, typeAvenant } from '../src/lib/validations';

test('effets annoncés avant validation, selon le type', () => {
    assert.match(effetsValidation({ type: 'resiliation', effet: '2026-12-31', donnees: {} })[0], /Résilié » au 31\/12\/2026/);
    assert.match(effetsValidation({ type: 'reconduction', effet: null, donnees: { newEndDate: '2031-06-30' } })[0], /fin du contrat passe au 30\/06\/2031/);
    assert.match(effetsValidation({ type: 'avenant', effet: null, donnees: { impactsDuration: false } })[0], /Aucun changement automatique/);
    assert.match(effetsValidation({ type: 'os', effet: null, donnees: { impactsDuration: true, newEndDate: '2030-01-31' } })[0], /31\/01\/2030/);
    assert.match(effetsValidation({ type: 'syndic', effet: null, donnees: { newRepresentative: 'Foncia' } })[0], /représenté par Foncia/);
    assert.match(effetsValidation({ type: 'be', effet: null, donnees: { newBe: 'BE Thermique', contactEmail: 'be@x.fr' } })[0], /BE Thermique \(be@x\.fr\)/);
    assert.equal(effetsValidation({ type: 'contrat', effet: null, donnees: {} }).length, 2);
});

test('résumés et nature des avenants', () => {
    assert.equal(detailsElement('syndic', { currentRepresentative: 'A', newRepresentative: 'B' }), 'A → B');
    assert.equal(detailsElement('reconduction', { duration: '1 an', newEndDate: '2027-12-31' }), 'durée 1 an · nouvelle fin 31/12/2027');
    assert.deepEqual([typeAvenant({ nature: 'os' }), typeAvenant({}), typeAvenant({ nature: 'avenant' })], ['os', 'avenant', 'avenant']);
});

test('libellés accordés', () => {
    assert.deepEqual(['contrat', 'avenant', 'reconduction', 'resiliation'].map(t => ceUnitaire(t as never)), ['le contrat', 'ce avenant', 'cette reconduction', 'cette résiliation']);
    assert.equal(aucunUnitaire('resiliation'), 'Aucune résiliation');
    assert.equal(aucunUnitaire('os'), 'Aucun ordre de service');
});
