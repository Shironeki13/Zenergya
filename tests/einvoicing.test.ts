// Tests de la logique de facturation électronique (RFE) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEInvoicing, initialEInvoicingState, sirenOf, luhnValid, canTransition, canRecompute, legalCommitmentAt } from '../src/lib/einvoicing';

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

// --- Chorus Pro ---

const PUBLIC = { ...B2B, clientType: 'public' as const, siret: '55210055400025', useChorus: true };
const SOCIETE = { siret: '73282932000074' };

test('Chorus : cadre A1 par défaut, code service et marché repris du client', () => {
    const r = resolveEInvoicing({
        client: { ...PUBLIC, chorusServiceCode: 'SERV-01', chorusMarketNumber: 'M-2025-12' },
        contract: null, company: SOCIETE, documentDate: '2026-10-15',
    });
    assert.equal(r.channel, 'chorus');
    assert.deepEqual(r.chorus, {
        framework: 'A1', recipientSiret: '55210055400025',
        serviceCode: 'SERV-01', serviceCodeSource: 'client', marketNumber: 'M-2025-12',
    });
    assert.deepEqual(r.blocking, []);
    assert.deepEqual(initialEInvoicingState(r).chorus, r.chorus);
});

test('Chorus : le contrat prime sur le client (code service, marché)', () => {
    const r = resolveEInvoicing({
        client: { ...PUBLIC, chorusServiceCode: 'SERV-01', chorusMarketNumber: 'M-CLIENT' },
        contract: { chorus: { serviceCode: 'SERV-CHAUFF', marketNumber: 'M-CONTRAT' } },
        company: SOCIETE, documentDate: '2026-10-15',
    });
    assert.equal(r.chorus?.serviceCode, 'SERV-CHAUFF');
    assert.equal(r.chorus?.serviceCodeSource, 'contract');
    assert.equal(r.chorus?.marketNumber, 'M-CONTRAT');
});

test("Chorus : engagement juridique du contrat selon la date, repli sur celui du client", () => {
    const contract = { chorus: { legalCommitments: [
        { number: 'EJ-2025', startDate: '2025-01-01', endDate: '2025-12-31' },
        { number: 'EJ-2026', startDate: '2026-01-01' },
    ] } };
    const client = { ...PUBLIC, chorusLegalCommitmentNumber: 'EJ-CLIENT' };
    const in2025 = resolveEInvoicing({ client, contract, company: SOCIETE, documentDate: '2025-06-30' });
    assert.equal(in2025.chorus?.legalCommitment, 'EJ-2025');
    assert.equal(in2025.chorus?.legalCommitmentSource, 'contract');
    assert.equal(resolveEInvoicing({ client, contract, company: SOCIETE, documentDate: '2026-02-01' }).chorus?.legalCommitment, 'EJ-2026');
    const before = resolveEInvoicing({ client, contract, company: SOCIETE, documentDate: '2024-06-30' });
    assert.equal(before.chorus?.legalCommitment, 'EJ-CLIENT');
    assert.equal(before.chorus?.legalCommitmentSource, 'client');
    assert.ok(before.warnings.some(w => w.includes('Aucun engagement juridique du contrat')));
    assert.equal(legalCommitmentAt(contract.chorus.legalCommitments, '2025-12-31')?.number, 'EJ-2025');
});

test('Chorus : code service et engagement exigés par le destinataire', () => {
    const client = { ...PUBLIC, chorusServiceCodeRequired: true, chorusLegalCommitmentRequired: true };
    const facture = resolveEInvoicing({ client, contract: null, company: SOCIETE, documentDate: '2026-10-15' });
    assert.equal(facture.blocking.length, 2);
    // Aperçu au niveau du client (sans contrat) : le contrat peut encore les porter, simple avertissement.
    const apercu = resolveEInvoicing({ client });
    assert.deepEqual(apercu.blocking, []);
    assert.equal(apercu.warnings.filter(w => w.includes('exigé')).length, 2);
});

test('Chorus : A12 et A9 exigent un valideur au SIRET valide', () => {
    const sans = resolveEInvoicing({ client: PUBLIC, contract: { chorus: { framework: 'A12' } }, company: SOCIETE, documentDate: '2026-10-15' });
    assert.equal(sans.chorus?.framework, 'A12');
    assert.ok(sans.blocking.some(b => b.includes('mandataire')));

    const invalide = resolveEInvoicing({ client: PUBLIC, contract: { chorus: { framework: 'A9', validatorSiret: '12345678901234' } }, company: SOCIETE });
    assert.ok(invalide.blocking.some(b => b.includes('invalide')));

    const ok = resolveEInvoicing({
        client: PUBLIC,
        contract: { chorus: { framework: 'A12', validatorSiret: '552 100 554 00013', validatorServiceCode: 'MAND-01' } },
        company: SOCIETE, documentDate: '2026-10-15',
    });
    assert.deepEqual(ok.blocking, []);
    assert.equal(ok.chorus?.validatorSiret, '55210055400013');
    assert.equal(ok.chorus?.validatorServiceCode, 'MAND-01');

    const soiMeme = resolveEInvoicing({ client: PUBLIC, contract: { chorus: { framework: 'A12', validatorSiret: SOCIETE.siret } }, company: SOCIETE });
    assert.ok(soiMeme.warnings.some(w => w.includes('société émettrice elle-même')));
});

test('Chorus : SIRET de la société émettrice obligatoire ; rien de Chorus hors canal Chorus', () => {
    const r = resolveEInvoicing({ client: PUBLIC, contract: null, company: { siret: '' }, documentDate: '2026-10-15' });
    assert.ok(r.blocking.some(b => b.includes('société émettrice')));
    assert.ok(!resolveEInvoicing({ client: PUBLIC, company: { siret: '' } }).blocking.some(b => b.includes('société émettrice')));
    assert.equal(resolveEInvoicing({ client: B2B, contract: { chorus: { framework: 'A12' } } }).chorus, undefined);
});
