// Validation des documents de contrat (logique pure) : types, effets annoncés, résumés : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afficherValeur, aucunUnitaire, ceUnitaire, champsAControler, controleComplet, detailsElement, effetsValidation, normaliserCorrection, typeAvenant, valeursDocument } from '../src/lib/validations';

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

test('contrôle : valeurs normalisées, champs à contrôler, corrections', () => {
    const v = valeursDocument('contrat', { clientName: 'C', label: 'L', startDate: { toDate: () => new Date('2025-12-31T23:00:00Z') }, endDate: '2030-12-31', tacitRenewal: false, baseAmountP1: '1200', baseAmountP2: 0 });
    assert.deepEqual([v.startDate, v.endDate, v.baseAmountP1, v.baseAmountP2, v.tacitRenewal, v.noticePeriod], ['2026-01-01', '2030-12-31', 1200, 0, false, null]);
    // Requis toujours ; facultatifs seulement s'ils sont renseignés.
    assert.deepEqual(champsAControler('contrat', v).map(c => c.cle), ['clientName', 'label', 'startDate', 'endDate', 'baseAmountP1', 'baseAmountP2', 'tacitRenewal']);
    assert.deepEqual(controleComplet('reconduction', { duration: '1 an', newEndDate: '2027-01-01' }, ['duration']).manquants.map(m => m.cle), ['newEndDate']);
    assert.equal(controleComplet('reconduction', { duration: '1 an', newEndDate: '2027-01-01' }, ['duration', 'newEndDate']).complet, true);
    assert.equal(normaliserCorrection('avenant', 'impactP1', '-1 250,5'), -1250.5);
    assert.equal(normaliserCorrection('avenant', 'newEndDate', ''), null);
    assert.equal(normaliserCorrection('syndic', 'contactEmail', ' a@b.fr '), 'a@b.fr');
    assert.throws(() => normaliserCorrection('syndic', 'contactEmail', 'pas-un-mail'), /e-mail invalide/);
    assert.throws(() => normaliserCorrection('resiliation', 'effectiveDate', '2027-13-45'), /date invalide/);
    assert.throws(() => normaliserCorrection('resiliation', 'reason', ' '), /obligatoire/);
    assert.throws(() => normaliserCorrection('contrat', 'clientName', 'X'), /ne se corrige pas/);
    assert.throws(() => normaliserCorrection('contrat', 'inconnu', 'X'), /Champ inconnu/);
    assert.deepEqual([afficherValeur({ type: 'booleen' }, false), afficherValeur({ type: 'date' }, '2027-06-30'), afficherValeur({ type: 'texte' }, null)], ['Non', '30/06/2027', '—']);
    assert.deepEqual(effetsValidation({ type: 'resiliation', effet: '2027-01-01', donnees: { effectiveDate: '2027-06-30' } }), ['Le contrat passe « Résilié » au 30/06/2027.']);
});
