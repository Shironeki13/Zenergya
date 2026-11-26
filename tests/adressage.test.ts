import test from 'node:test';
import assert from 'node:assert/strict';
import { adressageClient, adresseEnvoi, cleTiers, libellePartie, manquesAdressage, trouverTiers, type Tiers } from '../src/lib/billing/adressage';

const TIERS: Tiers[] = [
    { id: 't1', name: 'Cabinet Durand', quality: 'syndic', address: '12 rue de la République', postalCode: '69002', city: 'Lyon', siret: '11111111111111' },
    { id: 't2', name: 'Syndic Sans Adresse' },
    { id: 't3', name: "Direction des finances de l'État", quality: 'payeur', address: '1 quai A', postalCode: '75001', city: 'Paris', siret: '22222222222222' },
];
const copro = { name: 'SDC Voltaire', address: '140 bd Voltaire', postalCode: '75011', city: 'Paris' };

test('le tiers est reconnu par son nom, sans tenir compte de la casse, des accents et de la ponctuation', () => {
    assert.equal(trouverTiers(TIERS, '  cabinet  DURAND. ')?.id, 't1');
    assert.equal(trouverTiers(TIERS, "direction des finances de l'etat")?.id, 't3');
    assert.equal(trouverTiers(TIERS, 'Cabinet Durant'), undefined);
    assert.equal(trouverTiers(TIERS, ''), undefined);
    assert.equal(cleTiers(null), '');
});

test('copropriété représentée par un syndic connu : la facture part à l\'adresse du syndic', () => {
    const a = adressageClient({ ...copro, representedBy: 'cabinet durand' }, TIERS);
    assert.deepEqual(a, { representative: { name: 'Cabinet Durand', quality: 'syndic', address: '12 rue de la République', postalCode: '69002', city: 'Lyon' } });
    assert.deepEqual(adresseEnvoi(copro, a), { address: '12 rue de la République', postalCode: '69002', city: 'Lyon' });
    assert.equal(libellePartie(a.representative!), 'Cabinet Durand (syndic)');
    assert.deepEqual(manquesAdressage({ representedBy: 'Cabinet Durand' }, TIERS), []);
});

test('représentant sans adresse connue : il est cité, la facture reste à l\'adresse du client', () => {
    for (const nom of ['Syndic Inconnu', 'Syndic Sans Adresse']) {
        const a = adressageClient({ ...copro, representedBy: nom }, TIERS);
        assert.deepEqual(a, { representative: { name: nom } });
        assert.deepEqual(adresseEnvoi(copro, a), { address: '140 bd Voltaire', postalCode: '75011', city: 'Paris' });
        assert.equal(manquesAdressage({ representedBy: nom }, TIERS).length, 1);
    }
});

test('payeur distinct : cité avec son adresse et son SIRET, sans changer l\'adresse du facturé', () => {
    const ministere = { name: 'Ministère Exemple', address: '3 rue B', postalCode: '75007', city: 'Paris' };
    const a = adressageClient({ ...ministere, payer: "Direction des finances de l'État" }, TIERS);
    assert.equal(a.representative, undefined);
    assert.deepEqual(a.payer, { name: "Direction des finances de l'État", quality: 'payeur', address: '1 quai A', postalCode: '75001', city: 'Paris', siret: '22222222222222' });
    assert.deepEqual(adresseEnvoi(ministere, a), { address: '3 rue B', postalCode: '75007', city: 'Paris' });
});

test('sans représentant ni payeur, ou payeur identique au client : adressage inchangé', () => {
    assert.deepEqual(adressageClient(copro, TIERS), {});
    assert.deepEqual(adressageClient({ ...copro, representedBy: '  ', payer: 'sdc voltaire' }, TIERS), {});
    assert.deepEqual(adressageClient(null, TIERS), {});
});
