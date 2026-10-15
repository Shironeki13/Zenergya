// Tests de la logique de facturation électronique (RFE) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEInvoicing, initialEInvoicingState, sirenOf, luhnValid, canTransition, canRecompute } from '../src/lib/einvoicing';

// SIRET valides (clé de Luhn) : 732 829 320 00074, 552 100 554 00025
const B2B = { clientType: 'private' as const, typologyId: 't', siret: '73282932000074', useChorus: false };

test('B2B par défaut : plateforme agréée, adressage sur le SIREN du client', () => {
    const r = resolveEInvoicing({ client: B2B, company: { einvoicingStartDate: '2026-09-01' }, documentDate: '2026-10-15' });
    assert.equal(r.regime, 'b2b');
    assert.equal(r.regimeSource, 'default');
    assert.equal(r.channel, 'pa');
    assert.equal(r.address, '732829320');
    assert.equal(r.addressSource, 'siren');
    assert.equal(r.inScope, true);
    assert.deepEqual(r.blocking, []);
    assert.equal(initialEInvoicingState(r).status, 'to_send');
});

test('adresse : contrat prioritaire sur client, client prioritaire sur SIREN', () => {
    const client = { ...B2B, einvoicingAddress: '732829320_73282932000074' };
    const fromClient = resolveEInvoicing({ client });
    assert.equal(fromClient.address, '732829320_73282932000074');
    assert.equal(fromClient.addressSource, 'client');

    const fromContract = resolveEInvoicing({ client, contract: { einvoicingAddress: '732829320_SERVICE-CHAUFFAGE' } });
    assert.equal(fromContract.address, '732829320_SERVICE-CHAUFFAGE');
    assert.equal(fromContract.addressSource, 'contract');
});

test('typologie « Particulier » : e-reporting, aucune facture électronique', () => {
    const r = resolveEInvoicing({ client: { ...B2B, siret: '' }, typology: { einvoicingRegime: 'b2c' } });
    assert.equal(r.regime, 'b2c');
    assert.equal(r.regimeSource, 'typology');
    assert.equal(r.channel, 'ereporting');
    assert.equal(r.address, undefined);
    assert.deepEqual(r.blocking, []);
    assert.equal(initialEInvoicingState(r).status, 'not_applicable');
});

test('client public : Chorus Pro, même si la typologie dit autre chose', () => {
    const r = resolveEInvoicing({ client: { ...B2B, clientType: 'public', useChorus: true }, typology: { einvoicingRegime: 'b2c' } });
    assert.equal(r.regime, 'b2g');
    assert.equal(r.channel, 'chorus');
    assert.equal(initialEInvoicingState(r).status, 'to_send');

    const noSiret = resolveEInvoicing({ client: { ...B2B, clientType: 'public', siret: '' } });
    assert.match(noSiret.blocking[0], /SIRET/);
    assert.match(noSiret.warnings.join(' '), /Chorus non activé/);
});

test('réglage manuel sur la fiche client prioritaire sur tout le reste', () => {
    const r = resolveEInvoicing({ client: { ...B2B, clientType: 'public', einvoicingRegime: 'international' } });
    assert.equal(r.regime, 'international');
    assert.equal(r.regimeSource, 'client');
    assert.equal(r.channel, 'ereporting');
});

test('B2B sans SIRET ni adresse : bloquant', () => {
    const r = resolveEInvoicing({ client: { ...B2B, siret: '' } });
    assert.equal(r.blocking.length, 1);
    assert.match(r.blocking[0], /Adresse électronique de facturation manquante/);
    assert.equal(initialEInvoicingState(r).blocking?.length, 1);
});

test('adresse incohérente avec le SIREN et SIRET erroné : avertissements', () => {
    const r = resolveEInvoicing({ client: { ...B2B, siret: '73282932000075', einvoicingAddress: '552100554' } });
    assert.match(r.warnings.join(' '), /clé de contrôle/);
    assert.match(r.warnings.join(' '), /ne correspond pas au SIREN/);
});

test("avant la date d'entrée en vigueur : non concernée ; date absente : signalée", () => {
    const before = resolveEInvoicing({ client: B2B, company: { einvoicingStartDate: '2027-09-01' }, documentDate: '2026-10-15' });
    assert.equal(before.inScope, false);
    assert.equal(initialEInvoicingState(before).status, 'not_applicable');

    const after = resolveEInvoicing({ client: B2B, company: { einvoicingStartDate: '2027-09-01' }, documentDate: '2027-09-01' });
    assert.equal(after.inScope, true);

    const missing = resolveEInvoicing({ client: B2B, company: {} });
    assert.equal(missing.inScope, true);
    assert.match(missing.warnings.join(' '), /non paramétrée/);
});

test('outils : SIREN, Luhn, transitions', () => {
    assert.equal(sirenOf('732 829 320 00074'), '732829320');
    assert.equal(sirenOf('123'), undefined);
    assert.equal(luhnValid('732829320'), true);
    assert.equal(luhnValid('732829321'), false);
    assert.equal(canTransition('to_send', 'sent'), true);
    assert.equal(canTransition('not_applicable', 'sent'), false);
    assert.equal(canTransition('sent', 'to_send'), false);
    assert.equal(canRecompute({ status: 'sent' } as any), false);
    assert.equal(canRecompute(undefined), true);
});

test('tableau de bord : proformas exclus, état figé prioritaire, documents antérieurs calculés', async () => {
    const { buildEInvoicingRows } = await import('../src/lib/einvoicing');
    const base = { contractId: 'k', clientName: 'X', dueDate: '2026-11-01', lineItems: [], subtotal: 100, tax: 10, total: 110 };
    const rows = buildEInvoicingRows({
        invoices: [
            { ...base, id: 'a', invoiceNumber: 'A-1', clientId: 'pro', date: '2026-10-01', status: 'due' },
            { ...base, id: 'b', clientId: 'pro', date: '2026-10-02', status: 'proforma' },
            { ...base, id: 'c', invoiceNumber: 'A-2', clientId: 'nosiret', date: '2026-10-03', status: 'due' },
            { ...base, id: 'd', invoiceNumber: 'A-3', clientId: 'pro', date: '2026-10-04', status: 'paid',
              einvoicing: { regime: 'b2b', channel: 'pa', status: 'sent', computedAt: '2026-10-04' } },
        ] as any,
        creditNotes: [{ ...base, id: 'e', creditNoteNumber: 'AV-1', clientId: 'part', date: '2026-10-05', originalInvoiceIds: [], status: 'finalized', reason: '' }] as any,
        clients: [
            { id: 'pro', name: 'Pro', clientType: 'private', typologyId: 't', siret: '73282932000074' },
            { id: 'nosiret', name: 'Sans', clientType: 'private', typologyId: 't' },
            { id: 'part', name: 'Part', clientType: 'private', typologyId: 'tp' },
        ] as any,
        contracts: [],
        typologies: [{ id: 'tp', name: 'Particulier', einvoicingRegime: 'b2c' }],
        companies: [],
    });
    assert.deepEqual(rows.map(r => r.number), ['AV-1', 'A-3', 'A-2', 'A-1']);
    const byNumber = Object.fromEntries(rows.map(r => [r.number, r]));
    assert.equal(byNumber['A-1'].frozen, false);
    assert.equal(byNumber['A-1'].state.status, 'to_send');
    assert.equal(byNumber['A-2'].blocked, true);
    assert.equal(byNumber['A-3'].frozen, true);
    assert.equal(byNumber['A-3'].state.status, 'sent');
    assert.equal(byNumber['AV-1'].kind, 'creditNote');
    assert.equal(byNumber['AV-1'].state.channel, 'ereporting');
});
