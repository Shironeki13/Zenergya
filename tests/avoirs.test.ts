import test from 'node:test';
import assert from 'node:assert/strict';
import { controleDemande, destinationAvoir, libelleMotif, natureAvoir, refusAnnulation, texteMotif, type FactureAAnnuler } from '../src/lib/billing/avoirs';

const f = (patch: object = {}): FactureAAnnuler => ({ id: 'f', invoiceNumber: 'F-1', status: 'due', ...patch });

test('nature : interne seulement si la plateforme a rejeté la facture', () => {
    assert.equal(natureAvoir(f({ einvoicing: { status: 'rejected', channel: 'pa' } })), 'interne');
    for (const e of [undefined, { status: 'sent', channel: 'pa' }, { status: 'to_send', channel: 'chorus' }, { status: 'not_applicable', channel: 'ereporting' }]) assert.equal(natureAvoir(f({ einvoicing: e })), 'standard');
    assert.equal(destinationAvoir(f({ einvoicing: { status: 'rejected' } })), 'Interne : non transmis (facture rejetée par la plateforme)');
    assert.equal(destinationAvoir(f({ einvoicing: { status: 'sent', channel: 'pa' } })), 'À transmettre par la plateforme agréée');
    assert.equal(destinationAvoir(f({ einvoicing: { status: 'sent', channel: 'chorus' } })), 'À transmettre sur Chorus Pro');
    assert.equal(destinationAvoir(f()), 'Envoyé au client');
});

test('factures annulables : ni proforma, ni déjà annulée, ni sans numéro', () => {
    assert.equal(refusAnnulation(f()), null);
    assert.equal(refusAnnulation(f({ status: 'paid' })), null);
    assert.match(refusAnnulation(f({ status: 'proforma' }))!, /proforma/);
    assert.match(refusAnnulation(f({ status: 'cancelled' }))!, /déjà annulée/);
    assert.match(refusAnnulation(f({ cancelledByCreditNoteId: 'a' }))!, /déjà annulée/);
    assert.match(refusAnnulation(f({ invoiceNumber: '' }))!, /sans numéro/);
});

test('motif : typé, commentaire obligatoire pour « autre », au plus 200 factures', () => {
    assert.deepEqual(controleDemande([f()], 'doublon'), []);
    assert.deepEqual(controleDemande([f()], ''), ['Choisissez un motif.']);
    assert.deepEqual(controleDemande([f()], 'autre', '  '), ['Précisez le motif dans le commentaire.']);
    assert.deepEqual(controleDemande([], 'doublon'), ['Aucune facture sélectionnée.']);
    assert.deepEqual(controleDemande(Array.from({ length: 201 }, (_, i) => f({ id: String(i) })), 'doublon'), ['Au plus 200 factures à la fois.']);
    assert.equal(texteMotif('erreur_periode', ' trimestre facturé deux fois '), 'Erreur de période facturée — trimestre facturé deux fois');
    assert.equal(texteMotif('autre', 'accord client'), 'Autre motif — accord client');
    assert.equal(libelleMotif('inconnu'), '');
});
