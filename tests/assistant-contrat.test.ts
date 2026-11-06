// Assistant de création de contrat (logique pure) : contrôles par étape, doublons, PDF, prestations : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brouillonFinal, brouillonVide, depuisExtraction, doublonsClient, erreursEtape, lignesPrestations, type Brouillon } from '../src/lib/contracts/assistant';
import type { Client, ExtractContractInfoOutput } from '../src/lib/types';

const clients = [
    { id: 'c1', name: 'Résidence Les Pins', siret: '40000000000001', postalCode: '69003', city: 'Lyon' },
    { id: 'c2', name: 'Office Public', postalCode: '38000' },
] as Client[];
const complet = (): Brouillon => {
    const b = brouillonVide('c1');
    b.contrat = { ...b.contrat, label: 'Chauffage', startDate: '2026-01-01', endDate: '2029-12-31', activityIds: ['p2'], scheduleId: 'sm', termId: 'echoir', vatRateId: 'v20' };
    b.sites.nouveaux = [{ cle: 'n1', name: 'Chaufferie', address: '1 rue', postalCode: '69003', city: 'Lyon' }];
    return b;
};

test('contrôles par étape : client, contrat, sites, prestations', () => {
    const b = brouillonVide();
    assert.deepEqual(erreursEtape('client', b), ['Choisissez le client.']);
    b.client.mode = 'nouveau';
    b.client.nouveau = { ...b.client.nouveau, name: 'X', clientType: 'public', postalCode: '690', siret: '123' };
    const e = erreursEtape('client', b);
    assert.ok(e.includes('Typologie obligatoire.') && e.includes('Code postal : 5 chiffres.') && e.includes('SIRET : 14 chiffres.'), e.join(' | '));
    b.contrat = { ...b.contrat, label: 'L', startDate: '2026-05-01', endDate: '2026-04-01' };
    assert.deepEqual(erreursEtape('contrat', b), ['La date de fin doit être après la date de début.', 'Au moins une activité.']);
    assert.deepEqual(erreursEtape('sites', b), ['Au moins un site (sinon rien n\'est facturé).']);
    const c = complet();
    assert.deepEqual(['client', 'contrat', 'sites', 'prestations'].map(x => erreursEtape(x as never, c)), [[], [], [], []]);
    c.prestations.lignes = [{ site: 'n1', activityId: 'p2', montant: 'douze', scheduleId: '', termId: 'echoir', vatRateId: 'v20', startDate: '2026-01-01' }];
    assert.equal(erreursEtape('prestations', c).length, 2);
});

test('prestations : site × activité, valeurs du contrat par défaut, saisies gardées, lignes caduques écartées', () => {
    const b = complet();
    b.sites.existants = ['s9'];
    b.contrat.activityIds = ['p1', 'p2'];
    assert.deepEqual(lignesPrestations(b).map(l => `${l.site}/${l.activityId}/${l.scheduleId}/${l.startDate}`), ['s9/p1/sm/2026-01-01', 's9/p2/sm/2026-01-01', 'n1/p1/sm/2026-01-01', 'n1/p2/sm/2026-01-01']);
    b.prestations.lignes = [{ site: 'n1', activityId: 'p2', montant: '12000', scheduleId: 'sm', termId: 'echoir', vatRateId: 'v20', startDate: '2026-02-01' },
        { site: 'n1', activityId: 'p3', montant: '500', scheduleId: 'sm', termId: 'echoir', vatRateId: 'v20', startDate: '2026-01-01' }];
    const final = brouillonFinal(b).prestations.lignes;
    assert.equal(final.find(l => l.site === 'n1' && l.activityId === 'p2')!.montant, '12000');
    assert.equal(final.some(l => l.activityId === 'p3'), false);
    assert.deepEqual(brouillonFinal({ ...b, prestations: { ...b.prestations, saisir: false } }).prestations.lignes, []);
});

test('doublons de client : même SIRET, ou même nom au même code postal (accents et casse ignorés)', () => {
    assert.deepEqual(doublonsClient({ name: 'Autre', siret: '400 000 000 00001', postalCode: '' }, clients).map(c => c.id), ['c1']);
    assert.deepEqual(doublonsClient({ name: 'résidence les PINS', siret: '', postalCode: '69003' }, clients).map(c => c.id), ['c1']);
    assert.deepEqual(doublonsClient({ name: 'Résidence Les Pins', siret: '', postalCode: '13001' }, clients), []);
});

test('lecture d\'un PDF : champs repris et signalés, client connu proposé, sites, marché public', () => {
    const x = {
        client: { name: 'Office Public', postalCode: '38000', city: 'Grenoble', clientType: 'public', typologyName: 'bailleur', contactFacturation: { email: 'compta@op.fr' } },
        contrat: { objet: 'Exploitation chauffage', startDate: '2026-07-01', endDate: '2031-06-30', tacitRenewal: false, endDateTexte: 'x' },
        sites: [{ name: 'Groupe A', address: '1 av. Alsace', postalCode: '38000', city: 'Grenoble' }, {}],
        activityIds: ['p1', 'p1'],
    } as unknown as ExtractContractInfoOutput;
    const b = depuisExtraction({ ...brouillonVide(), source: 'pdf-public' }, x, { typologies: [{ id: 'ty2', name: 'Bailleur social' }], clients });
    assert.deepEqual([b.client.mode, b.client.clientId], ['existant', 'c2']);
    assert.deepEqual([b.client.nouveau.typologyId, b.client.nouveau.contactFacturation.email], ['ty2', 'compta@op.fr']);
    assert.deepEqual([b.contrat.label, b.contrat.startDate, b.contrat.tacitRenewal, b.contrat.activityIds, b.contrat.marketType], ['Exploitation chauffage', '2026-07-01', false, ['p1'], 'Marché Public']);
    assert.deepEqual(b.sites.nouveaux.map(s => s.name), ['Groupe A']);
    assert.ok(['client.name', 'contrat.startDate', 'contrat.activityIds', 'sites'].every(k => b.lusDansPdf.includes(k)));
});
