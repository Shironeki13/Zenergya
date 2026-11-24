import test from 'node:test';
import assert from 'node:assert/strict';
import { conditionsPaiement, identiteLegale, lieuxExecution, manquesSociete, mentionEscompte, mentionPenalites, natureOperation, tvaDepuisSiren } from '../src/lib/billing/mentions';

test('identité légale : forme, capital et RCS, seulement ce qui est renseigné', () => {
    assert.equal(identiteLegale({ legalForm: 'SAS', shareCapital: 1000000, rcsCity: 'Lyon', siret: '90000000000013' }), 'SAS au capital de 1 000 000 € · RCS Lyon 900 000 000');
    assert.equal(identiteLegale({ legalForm: 'SA', rcsCity: 'Paris' }), 'SA · RCS Paris');
    assert.equal(identiteLegale({}), '');
    assert.deepEqual(manquesSociete({ legalForm: 'SAS', shareCapital: 10, rcsCity: 'Lyon', siret: '90000000000013', vatNumber: 'FR00900000000', address: '1 rue A' }), []);
    assert.deepEqual(manquesSociete({ siret: '90000000000013', address: '1 rue A' }), ['forme juridique', 'capital social', "ville d'immatriculation au RCS", 'numéro de TVA intracommunautaire']);
});

test('paiement : libellé du paramétrage sinon délai par défaut ; pénalités et escompte de la société', () => {
    assert.equal(conditionsPaiement({ deadline: '45 jours fin de mois' }), 'Conditions de paiement : 45 jours fin de mois.');
    assert.equal(conditionsPaiement(null), 'Conditions de paiement : 30 jours à compter de la date de facture.');
    assert.match(mentionPenalites({}), /pénalités de 1,5 % par mois .* 40 €/);
    assert.match(mentionPenalites({ latePenaltyRate: "trois fois le taux d'intérêt légal" }), /pénalités de trois fois le taux d'intérêt légal ainsi/);
    assert.equal(mentionEscompte({}), "Pas d'escompte pour paiement anticipé.");
    assert.equal(mentionEscompte({ earlyPaymentDiscount: 'Escompte de 1 % sous 8 jours.' }), 'Escompte de 1 % sous 8 jours.');
});

test("nature de l'opération : P1 = biens par défaut, réglage de l'activité prioritaire, mixte", () => {
    const activites = [{ code: 'P1', type: 'P1' }, { code: 'P2', type: 'P2' }, { code: 'P3', type: 'P3' }];
    assert.equal(natureOperation([{ activityCode: 'P2' }, { activityCode: 'P3' }], activites), 'Prestation de services');
    assert.equal(natureOperation([{ activityCode: 'P1' }], activites), 'Livraison de biens');
    assert.equal(natureOperation([{ activityCode: 'P1' }, { activityCode: 'P2' }], activites), 'Livraison de biens et prestation de services');
    assert.equal(natureOperation([{ activityCode: 'P1' }], [{ code: 'P1', type: 'P1', operationNature: 'services' }]), 'Prestation de services');
    assert.equal(natureOperation([{ activityCode: 'TRAVAUX' }, {}], activites), 'Prestation de services');
});

test("lieux d'exécution : sites dont l'adresse diffère de la facturation, sans doublon", () => {
    const client = { address: '12 rue de la Paix', postalCode: '69001', city: 'Lyon' };
    assert.deepEqual(lieuxExecution([
        { name: 'Siège', address: '12, rue de la paix', postalCode: '69001', city: 'LYON' },
        { name: 'Résidence A', address: '5 rue B', postalCode: '69007', city: 'Lyon' },
        { name: 'Résidence A', address: '5 rue B', postalCode: '69007', city: 'Lyon' },
        { name: 'Sans adresse', address: '' },
    ], client), ['Résidence A — 5 rue B, 69007 Lyon']);
});

test('TVA intracommunautaire déduite du SIREN', () => {
    assert.equal(tvaDepuisSiren('404833048'), 'FR83404833048');
    assert.equal(tvaDepuisSiren('40483304800022'), 'FR83404833048');
    assert.equal(tvaDepuisSiren('123'), null);
});
