// Facturation manuelle : file de travail (calcul pur) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileFacturation, libelleRetard, suivant } from '../src/lib/billing/file';

const l = (id: string, client: string, subtotal: number, dueSince?: string, error?: string) =>
    ({ contractId: id, contractNumber: `CTN-${id}`, clientName: client, periodStart: '2026-10-01', periodEnd: '2026-12-31', subtotal, dueSince, error });

test('file : le plus en retard d\'abord, puis le plus gros montant ; blocage signalé', () => {
    const file = fileFacturation([l('a', 'Alpha', 100, '2026-11-24'), l('b', 'Bêta', 500, '2026-10-01'), l('c', 'Gamma', 900, '2026-11-24'), l('d', 'Delta', 0, undefined, 'TVA non renseignée')], '2026-11-24');
    assert.deepEqual(file.map(c => [c.id, c.retard, c.montantHT, !!c.blocage]), [['b', 54, 500, false], ['c', 0, 900, false], ['a', 0, 100, false], ['d', 0, 0, true]]);
    assert.deepEqual([0, 1, 54].map(libelleRetard), ["facturable aujourd'hui", 'depuis hier', 'depuis 54 jours']);
});

test('contrat suivant : le suivant dans la file, retour au début en fin de file, null si seul', () => {
    const file = fileFacturation([l('a', 'A', 1, '2026-11-01'), l('b', 'B', 1, '2026-11-10'), l('c', 'C', 1, '2026-11-20')], '2026-11-24');
    assert.equal(suivant(file, 'a')?.id, 'b');
    assert.equal(suivant(file, 'c')?.id, 'a');
    assert.equal(suivant(file, null)?.id, 'a');
    assert.equal(suivant(file.slice(0, 1), 'a'), null);
});
