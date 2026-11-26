import test from 'node:test';
import assert from 'node:assert/strict';
import { encoursParInterlocuteur, interlocuteurPaiement, releveRelance, type ClientEncours, type FactureEncours } from '../src/lib/billing/encours';
import type { Tiers } from '../src/lib/billing/adressage';

const TIERS: Tiers[] = [
    { id: 't1', name: 'Cabinet Durand', quality: 'syndic', address: '12 rue A', postalCode: '69002', city: 'Lyon', email: 'compta@durand.example', phone: '04 00 00 00 00' },
    { id: 't2', name: 'Trésorerie', quality: 'comptable public', email: 'tresor@example.com' },
];
const CLIENTS: ClientEncours[] = [
    { id: 'c1', name: 'SDC A', representedBy: 'cabinet durand' },
    { id: 'c2', name: 'SDC B', representedBy: 'Cabinet Durand' },
    { id: 'c3', name: 'Ministère', payer: 'Trésorerie', representedBy: 'Mandataire X' },
    { id: 'c4', name: 'SCI Seule', payer: 'sci seule' },
];
const f = (id: string, clientId: string, echeance: string, total: number): FactureEncours => ({ id, numero: `F-${id}`, clientId, date: '2026-09-01', echeance, total });

test('interlocuteur : le payeur prime sur le représentant, sinon le client lui-même', () => {
    assert.deepEqual(interlocuteurPaiement(CLIENTS[0], TIERS), { cle: 'tiers:cabinetdurand', role: 'representant', name: 'Cabinet Durand', tiers: TIERS[0] });
    assert.equal(interlocuteurPaiement(CLIENTS[2], TIERS).role, 'payeur');
    assert.equal(interlocuteurPaiement(CLIENTS[2], TIERS).name, 'Trésorerie');
    // Payeur identique au client, ou tiers sans fiche : pas de confusion.
    assert.deepEqual(interlocuteurPaiement(CLIENTS[3], TIERS), { cle: 'client:c4', role: 'client', name: 'SCI Seule' });
    assert.deepEqual(interlocuteurPaiement({ id: 'c5', name: 'SDC C', representedBy: 'Syndic Inconnu' }, TIERS), { cle: 'tiers:syndicinconnu', role: 'representant', name: 'Syndic Inconnu' });
});

test('encours : un syndic commun à deux copropriétés n\'a qu\'une ligne ; échu et retard calculés à la date', () => {
    const r = encoursParInterlocuteur([f('1', 'c1', '2026-10-01', 1000), f('2', 'c2', '2026-12-15', 500.1), f('3', 'c2', '2026-11-20', 200.2), f('4', 'c3', '2026-11-25', 300), f('5', 'c4', '2026-12-31', 50), f('6', 'cx', '', 10)],
        CLIENTS, TIERS, { c4: { name: 'Compta', email: 'sci@example.com' } }, '2026-11-26');
    assert.deepEqual(r.map(i => [i.name, i.role, i.factures.length, i.encours, i.echu, i.retardMax]), [
        ['Cabinet Durand', 'representant', 3, 1700.3, 1200.2, 56],
        ['Trésorerie', 'payeur', 1, 300, 300, 1],
        ['SCI Seule', 'client', 1, 50, 0, 0],
        ['Client inconnu', 'client', 1, 10, 0, 0],
    ]);
    const durand = r[0];
    assert.deepEqual(durand.clients.map(c => c.name), ['SDC A', 'SDC B']);
    assert.deepEqual(durand.factures.map(x => [x.numero, x.joursRetard]), [['F-1', 56], ['F-3', 6], ['F-2', 0]]);
    assert.deepEqual([durand.email, durand.phone, durand.adresse, durand.quality], ['compta@durand.example', '04 00 00 00 00', '12 rue A, 69002 Lyon', 'syndic']);
    // Client interlocuteur : son contact de facturation ; tiers sans adresse : pas d'adresse.
    assert.equal(r[2].email, 'sci@example.com');
    assert.equal(r[1].adresse, undefined);
});

test('relevé de relance : une ligne par facture, le client précisé quand il y en a plusieurs', () => {
    const [durand, tresor] = encoursParInterlocuteur([f('1', 'c1', '2026-10-01', 1000), f('2', 'c2', '2026-12-15', 500.1), f('4', 'c3', '2026-11-25', 300)], CLIENTS, TIERS, {}, '2026-11-26');
    assert.equal(releveRelance(durand, 'Zenergya'), [
        'Relevé des factures à régler — Cabinet Durand', '',
        '- Facture n° F-1 du 01/09/2026 (SDC A) : 1 000,00 € TTC, échéance 01/10/2026, échue depuis 56 jours',
        '- Facture n° F-2 du 01/09/2026 (SDC B) : 500,10 € TTC, échéance 15/12/2026',
        '', 'Total à régler : 1 500,10 € TTC, dont 1 000,00 € échus.', 'Zenergya',
    ].join('\n'));
    assert.match(releveRelance(tresor, ''), /- Facture n° F-4 du 01\/09\/2026 : 300,00 € TTC, échéance 25\/11\/2026, échue depuis 1 jour\n/);
});
