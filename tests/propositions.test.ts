import test from 'node:test';
import assert from 'node:assert/strict';
import { brouillonVide } from '../src/lib/contracts/assistant';
import { brouillonProposition, controlesProposition, preuvesDe, resumeProposition, type RefsProposition } from '../src/lib/contracts/propositions';
import type { Client, ExtractContractInfoOutput } from '../src/lib/types';

const refs: RefsProposition = {
    clients: [{ id: 'c1', name: 'Copropriété Les Tilleuls', siret: '41111111111111', postalCode: '69004' } as Client],
    sites: [{ id: 's1', name: 'Tilleuls - Bâtiment A', address: '4 allée des Tilleuls', postalCode: '69004', clientId: 'c1', contractId: null }, { id: 's2', name: 'Tilleuls - Bâtiment B', address: '6 allée des Tilleuls', postalCode: '69004', clientId: 'c1', contractId: 'k1' }],
    contrats: [{ id: 'k1', contractNumber: 'CTN-00001', label: 'Chaufferie', clientId: 'c1', status: 'Actif', startDate: '2024-07-01', endDate: '2029-06-30' }],
    activities: [{ id: 'a1', code: 'P1', vatRateId: 'tva55' }, { id: 'a2', code: 'P2', vatRateId: 'tva20' }],
    typologies: [{ id: 't1', name: 'Copropriété' }], schedules: [{ id: 'trim', name: 'Trimestriel' }, { id: 'mens', name: 'Mensuel' }], terms: [{ id: 'echoir', name: 'À échoir' }, { id: 'echu', name: 'Terme échu' }],
};
const lecture = (client: ExtractContractInfoOutput['client'], sites: ExtractContractInfoOutput['sites']): ExtractContractInfoOutput => ({
    client, contrat: { label: 'Exploitation', startDate: '2027-01-01', endDate: '2031-12-31' }, sites,
    activitiesDetails: [{ activityId: 'a1', amount: 48500, scheduleId: 'trim', termId: 'echu' }, { activityId: 'a2', amount: 7900 }, { activityId: 'inconnue', amount: 1 }],
    preuves: [{ champ: 'client.name', extrait: 'Entre la copropriété…', page: 1, confiance: 'haute' }, { champ: 'activitiesDetails[a1].amount', extrait: '48 500 € HT', page: 4, confiance: 'moyenne' }, { champ: 'client.name', extrait: 'ci-après', confiance: 'basse' }],
});

test('nouveau client, deux sites : prestations par site, montant sur le premier site et à répartir ; rythme lu ou repris', () => {
    const x = lecture({ isBe: false, name: 'Résidence Les Érables', address: '12 rue des Érables', postalCode: '69008', city: 'Lyon', typologyName: 'Copropriété' }, [{ name: 'Bâtiment A', address: '12 rue des Érables', postalCode: '69008', city: 'Lyon', billingSchedule: 'Trimestriel', term: 'Échu' }, { name: 'Bâtiment B', address: '14 rue des Érables', postalCode: '69008', city: 'Lyon' }]);
    const { brouillon: b, remarques } = brouillonProposition(brouillonVide(), x, refs);
    assert.deepEqual([b.client.mode, b.client.nouveau.typologyId, b.contrat.activityIds, b.contrat.scheduleId, b.contrat.termId], ['nouveau', 't1', ['a1', 'a2'], 'trim', 'echu']);
    assert.deepEqual(b.prestations.lignes.map(l => [l.site, l.activityId, l.montant, l.scheduleId, l.termId, l.vatRateId, l.startDate]), [
        ['pdf-0', 'a1', '48500', 'trim', 'echu', 'tva55', '2027-01-01'], ['pdf-1', 'a1', '', 'trim', 'echu', 'tva55', '2027-01-01'],
        ['pdf-0', 'a2', '7900', 'trim', 'echu', 'tva20', '2027-01-01'], ['pdf-1', 'a2', '', 'trim', 'echu', 'tva20', '2027-01-01'],
    ]);
    assert.equal(remarques.length, 2);
    assert.match(remarques[0].texte, /P1 : montant de 48 500 € HT lu pour le contrat entier, porté sur le premier site — à répartir entre les 2 sites/);
    assert.ok(b.lusDansPdf.includes('prestations'));
    assert.deepEqual(resumeProposition(b, refs), { client: 'Résidence Les Érables', clientExistant: false, contrat: 'Exploitation', sites: 2, prestations: 2, montant: 56400 });
    const alertes = controlesProposition(b, refs, remarques);
    assert.ok(alertes.some(a => a.gravite === 'info' && /Nouveau client proposé : Résidence Les Érables/.test(a.texte)));
    assert.ok(alertes.some(a => a.gravite === 'bloquant'), 'société, agence, secteur à choisir');
});

test('client reconnu : site libre repris, site déjà sous contrat signalé, contrat actif qui se recouvre signalé', () => {
    const x = lecture({ isBe: false, name: 'Copropriété Les Tilleuls', siret: '41111111111111', postalCode: '69004' }, [{ name: 'Tilleuls - Bâtiment A', address: '4 allée des Tilleuls', postalCode: '69004' }, { name: 'Bât. B', address: '6, allée des Tilleuls', postalCode: '69004' }]);
    const { brouillon: b, remarques } = brouillonProposition(brouillonVide(), x, refs);
    assert.deepEqual([b.client.mode, b.client.clientId, b.sites.existants, b.sites.nouveaux.map(s => s.name)], ['existant', 'c1', ['s1'], ['Bât. B']]);
    assert.match(remarques.find(r => /déjà et est rattaché/.test(r.texte))!.texte, /« Tilleuls - Bâtiment B » existe déjà et est rattaché au contrat CTN-00001/);
    const alertes = controlesProposition(b, refs, remarques);
    assert.ok(alertes.some(a => a.gravite === 'info' && /Client reconnu : Copropriété Les Tilleuls/.test(a.texte)));
    assert.ok(alertes.some(a => a.gravite === 'attention' && /déjà le contrat actif CTN-00001 \(« Chaufferie »\)/.test(a.texte) && a.lien === '/contracts/k1'));
});

test('justificatifs d\'un champ, du plus sûr au moins sûr', () => {
    const x = lecture({ isBe: false, name: 'X' }, []);
    assert.deepEqual(preuvesDe(x.preuves as never, 'client.name').map(p => p.confiance), ['haute', 'basse']);
    assert.deepEqual(preuvesDe(x.preuves as never, 'activitiesDetails[a1]').map(p => p.extrait), ['48 500 € HT']);
    assert.deepEqual(preuvesDe(undefined, 'client.name'), []);
});
