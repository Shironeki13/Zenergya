// Lectures nommées par le serveur (émulateur) : fiches et éléments d'un objet, contrôlés par le périmètre : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../src/lib/firebase-admin';
import { LECTURES, lire } from '../src/services/lectures-admin';
import { PerimetreError } from '../src/lib/auth/perimetre-server';
import type { SessionUser } from '../src/lib/auth/server';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const u = (id: string, agencyIds: string[], droits: Partial<SessionUser> = {}): SessionUser =>
    ({ uid: id, email: `${id}@v.fr`, isAdmin: false, isContratheque: false, isAcheteur: false, profile: { id, name: id, email: `${id}@v.fr`, scope: { companyIds: ['*'], agencyIds, sectorIds: ['*'] } } as never, ...droits });
const lyon = u('lc-lyon', ['lc-ag-lyon']), admin = u('lc-adm', [], { isAdmin: true });
const ids = (l: unknown) => (l as { id: string }[]).map(x => x.id).filter(x => x.startsWith('lc-')).sort().join();
const PARENTS: Record<string, string> = { client: 'c', contrat: 'k', facture: 'f', devis: 'd', affaire: 'x' };

before(async () => {
    for (const [v, ag] of [['l', 'lc-ag-lyon'], ['p', 'lc-ag-paris']]) {
        await set('clients', `lc-c${v}`, { name: `Client ${v}`, companyId: 'lc-co', agencyId: ag, sectorId: `lc-se-${v}` });
        await set('contracts', `lc-k${v}`, { clientId: `lc-c${v}` });
        await set('sites', `lc-s${v}`, { clientId: `lc-c${v}`, contractId: `lc-k${v}` });
        await set('services', `lc-p${v}`, { contractId: `lc-k${v}`, siteId: `lc-s${v}` });
        await set('contacts', `lc-t${v}`, { clientId: `lc-c${v}` });
        await set('invoices', `lc-f${v}`, { clientId: `lc-c${v}`, contractId: `lc-k${v}`, quoteId: `lc-d${v}`, projectId: `lc-x${v}`, invoiceNumber: 'B' });
        await set('invoices', `lc-f${v}2`, { clientId: `lc-c${v}`, contractId: `lc-k${v}`, quoteId: `lc-d${v}`, invoiceNumber: 'A' });
        await set('meters', `lc-m${v}`, { siteId: `lc-s${v}` });
        await set('meterReadings', `lc-r${v}`, { contractId: `lc-k${v}`, meterId: `lc-m${v}` });
        for (const coll of ['amendments', 'terminations', 'renewals', 'trusteeChanges', 'beChanges']) await set(coll, `lc-e${v}-${coll}`, { contractId: `lc-k${v}` });
        await set('interests', `lc-i${v}`, { serviceId: `lc-p${v}` });
        await set('service_settlements', `lc-g${v}`, { serviceId: `lc-p${v}` });
        await set('quotes', `lc-d${v}`, { clientId: `lc-c${v}` });
        await set('quoteVersions', `lc-v${v}2`, { quoteId: `lc-d${v}`, version: 2 });
        await set('quoteVersions', `lc-v${v}1`, { quoteId: `lc-d${v}`, version: 1 });
        await set('projects', `lc-x${v}`, { clientId: `lc-c${v}` });
        await set('projectSituations', `lc-n${v}2`, { projectId: `lc-x${v}`, number: 2 });
        await set('projectSituations', `lc-n${v}1`, { projectId: `lc-x${v}`, number: 1 });
    }
});

test('fiches : dans le périmètre, lues ; hors périmètre, refusées ; inexistantes : null', async () => {
    for (const [nom, c] of Object.entries(PARENTS)) {
        assert.equal(((await lire(nom, { id: `lc-${c}l` }, lyon)) as { id: string }).id, `lc-${c}l`);
        await assert.rejects(lire(nom, { id: `lc-${c}p` }, lyon), PerimetreError);
        assert.equal(((await lire(nom, { id: `lc-${c}p` }, admin)) as { id: string }).id, `lc-${c}p`);
        assert.equal(await lire(nom, { id: 'lc-inconnu' }, lyon), null);
    }
});

test('éléments d\'un objet : ceux du parent demandé, triés ; parent hors périmètre : refus ; parent inexistant : liste vide', async () => {
    const attendu: Record<string, [string, string]> = {
        contactsDuClient: ['c', 'lc-tl'], facturesDuClient: ['c', 'lc-fl,lc-fl2'], sitesDuClient: ['c', 'lc-sl'], contratsDuClient: ['c', 'lc-kl'], sitesDuContrat: ['k', 'lc-sl'], facturesDuContrat: ['k', 'lc-fl,lc-fl2'],
        relevesDuContrat: ['k', 'lc-rl'], relevesDuCompteur: ['m', 'lc-rl'], relevesDuSite: ['s', 'lc-rl'], prestationsDuContrat: ['k', 'lc-pl'], prestationsDuSite: ['s', 'lc-pl'], avenantsDuContrat: ['k', 'lc-el-amendments'], resiliationsDuContrat: ['k', 'lc-el-terminations'],
        reconductionsDuContrat: ['k', 'lc-el-renewals'], syndicsDuContrat: ['k', 'lc-el-trusteeChanges'], beDuContrat: ['k', 'lc-el-beChanges'], interetsDeLaPrestation: ['p', 'lc-il'],
        reglementsDeLaPrestation: ['p', 'lc-gl'], versionsDuDevis: ['d', 'lc-vl1,lc-vl2'], facturesDuDevis: ['d', 'lc-fl,lc-fl2'], situationsDeLAffaire: ['x', 'lc-nl1,lc-nl2'], facturesDeLAffaire: ['x', 'lc-fl'],
    };
    for (const [nom, [c, res]] of Object.entries(attendu)) {
        assert.equal(ids(await lire(nom, { id: `lc-${c}l` }, lyon)), res, nom);
        await assert.rejects(lire(nom, { id: `lc-${c}p` }, lyon), PerimetreError, nom);
        assert.deepEqual(await lire(nom, { id: 'lc-inconnu' }, lyon), [], nom);
    }
    // Tri : versions et situations par numéro, factures d'un devis par numéro de facture.
    assert.deepEqual((await lire('versionsDuDevis', { id: 'lc-dl' }, lyon) as { id: string }[]).map(x => x.id), ['lc-vl1', 'lc-vl2']);
    assert.deepEqual((await lire('facturesDuDevis', { id: 'lc-dl' }, lyon) as { id: string }[]).map(x => x.id), ['lc-fl2', 'lc-fl']);
    // Toutes les lectures nommées sont couvertes par ce test.
    assert.deepEqual(Object.keys(LECTURES).sort(), [...Object.keys(PARENTS), ...Object.keys(attendu), 'devisTous', 'affaires', 'facturesDePeriode', 'avoirsDePeriode', 'facturesImpayees', 'numeroDeFacture', 'rechercheFactures', 'syntheseFactures'].sort());
});

test('listes entières (devis, affaires) : réduites au périmètre ; lecture inconnue refusée', async () => {
    assert.deepEqual([ids(await lire('devisTous', {}, lyon)), ids(await lire('affaires', {}, lyon))], ['lc-dl', 'lc-xl']);
    assert.deepEqual([ids(await lire('devisTous', {}, admin)), ids(await lire('affaires', {}, admin))], ['lc-dl,lc-dp', 'lc-xl,lc-xp']);
    await assert.rejects(lire('users', {}, admin), /Lecture inconnue/);
    await assert.rejects(lire('constructor', {}, admin), /Lecture inconnue/);
});

test('factures et avoirs par période : la période, plus les impayées et proformas de toute date ; périmètre ; numéros des factures annulées', async () => {
    const t = (jour: string) => Timestamp.fromDate(new Date(`${jour}T10:00:00Z`));
    const f = (id: string, v: string, date: unknown, status: string, plus: object = {}) => set('invoices', id, { clientId: `lc-c${v}`, date, status, invoiceNumber: id.toUpperCase(), ...plus });
    await f('lp-2024-payee', 'l', t('2024-03-10'), 'paid');
    await f('lp-2024-due', 'l', t('2024-05-10'), 'due');                       // ancienne mais impayée : toujours renvoyée
    await f('lp-2023-proforma', 'l', t('2023-01-10'), 'proforma');             // proforma : toujours renvoyé
    await f('lp-2026-payee', 'l', t('2026-02-10'), 'paid');
    await f('lp-2026-bord', 'l', t('2026-12-31'), 'paid');                     // dernier jour de la période : inclus
    await f('lp-2026-texte', 'l', '2026-06-01T00:00:00.000Z', 'paid');          // date en texte (ancienne écriture)
    await f('lp-2022-rejet', 'l', t('2022-01-10'), 'paid', { einvoicing: { status: 'rejected' } });
    await f('lp-2026-paris', 'p', t('2026-02-10'), 'paid');
    await set('creditNotes', 'lp-a-2026', { clientId: 'lc-cl', date: t('2026-03-01'), originalInvoiceIds: ['lp-2026-payee', 'facture-inconnue'] });
    await set('creditNotes', 'lp-a-2024', { clientId: 'lc-cl', date: t('2024-03-01'), originalInvoiceIds: [] });
    await set('creditNotes', 'lp-a-2021', { clientId: 'lc-cl', date: t('2021-03-01'), einvoicing: { status: 'to_send' } });
    await set('creditNotes', 'lp-a-paris', { clientId: 'lc-cp', date: t('2026-03-01') });
    const lp = (l: unknown) => (l as { id: string }[]).map(x => x.id).filter(x => x.startsWith('lp-')).sort();
    const P = { du: '2026-01-01', au: '2026-12-31' };

    assert.deepEqual(lp(await lire('facturesDePeriode', P, lyon)), ['lp-2023-proforma', 'lp-2024-due', 'lp-2026-bord', 'lp-2026-payee', 'lp-2026-texte']);
    assert.deepEqual(lp(await lire('facturesDePeriode', { ...P, einvoicing: '1' }, lyon)), ['lp-2022-rejet', 'lp-2023-proforma', 'lp-2024-due', 'lp-2026-bord', 'lp-2026-payee', 'lp-2026-texte']);
    assert.deepEqual(lp(await lire('facturesDePeriode', { du: '2024-01-01', au: '2024-12-31' }, lyon)), ['lp-2023-proforma', 'lp-2024-due', 'lp-2024-payee']);
    assert.ok(lp(await lire('facturesDePeriode', P, admin)).includes('lp-2026-paris'));
    assert.deepEqual(lp(await lire('facturesImpayees', {}, lyon)), ['lp-2024-due']);
    // Dates converties en texte ISO, comme toutes les lectures.
    const une = (await lire('facturesDePeriode', P, lyon) as { id: string; date: string }[]).find(x => x.id === 'lp-2026-payee')!;
    assert.equal(une.date, '2026-02-10T10:00:00.000Z');
    // Listes allégées : le détail des lignes n'est pas transmis, l'existence d'une annexe P1 est indiquée.
    await set('invoices', 'lp-2026-lignes', { clientId: 'lc-cl', date: t('2026-04-10'), status: 'paid', lineItems: [{ description: 'P2', total: 100 }, { description: 'P1', total: 50, p1: { mode: 'compteur' } }] });
    const lourde = (await lire('facturesDePeriode', P, lyon) as { id: string; lineItems: unknown[]; annexeP1: boolean }[]).find(x => x.id === 'lp-2026-lignes')!;
    assert.deepEqual([lourde.lineItems, typeof lourde.annexeP1, (await lire('facture', { id: 'lp-2026-lignes' }, lyon) as { lineItems: unknown[] }).lineItems.length], [[], 'boolean', 2]);

    const avoirs = await lire('avoirsDePeriode', P, lyon) as { id: string; originalInvoiceNumbers: string[] }[];
    assert.deepEqual(lp(avoirs), ['lp-a-2026']);
    assert.deepEqual(avoirs.find(x => x.id === 'lp-a-2026')!.originalInvoiceNumbers, ['LP-2026-PAYEE', 'facture-inconnue']);
    assert.deepEqual(lp(await lire('avoirsDePeriode', { ...P, einvoicing: '1' }, lyon)), ['lp-a-2021', 'lp-a-2026']);
    // Période invalide : refusée.
    await assert.rejects(lire('facturesDePeriode', { du: '2026-12-31', au: '2026-01-01' }, lyon), /Période/);
    await assert.rejects(lire('avoirsDePeriode', { du: 'hier', au: '2026-01-01' }, lyon), /Période/);
});

test('lectures ciblées : numéro d\'une facture, recherche par début de numéro, synthèse du tableau de bord ; périmètre', async () => {
    const t = (jour: string) => Timestamp.fromDate(new Date(`${jour}T10:00:00Z`));
    const f = (id: string, v: string, numero: string | null, plus: object) => set('invoices', id, { clientId: `lc-c${v}`, clientName: `Client ${v}`, ...(numero && { invoiceNumber: numero }), ...plus });
    await f('lt-1', 'l', 'LCT-2601-0001', { date: t('2026-01-15'), status: 'paid', subtotal: 1000, total: 1200, contractId: 'lc-kl', periodEndDate: t('2026-01-31') });
    await f('lt-2', 'l', 'LCT-2602-0002', { date: t('2026-02-15'), status: 'due', subtotal: 500.55, total: 600.66, contractId: 'lc-kl', periodEndDate: t('2026-02-28') });
    await f('lt-3', 'l', null, { date: t('2026-03-15'), status: 'proforma', subtotal: 9999, total: 9999, contractId: 'lc-kl', periodEndDate: t('2026-03-31') });
    await f('lt-4', 'p', 'LCT-2602-0003', { date: t('2026-02-20'), status: 'paid', subtotal: 7000, total: 8400, contractId: 'lc-kp', periodEndDate: t('2026-02-28') });

    assert.deepEqual(await lire('numeroDeFacture', { id: 'lt-1' }, lyon), { id: 'lt-1', invoiceNumber: 'LCT-2601-0001' });
    assert.deepEqual([await lire('numeroDeFacture', { id: 'lt-3' }, lyon), await lire('numeroDeFacture', { id: 'inconnue' }, lyon)], [{ id: 'lt-3', invoiceNumber: null }, null]);
    await assert.rejects(lire('numeroDeFacture', { id: 'lt-4' }, lyon), PerimetreError);

    const numeros = async (q: string, user = lyon) => (await lire('rechercheFactures', { q }, user) as { invoiceNumber: string }[]).map(x => x.invoiceNumber).sort();
    assert.deepEqual([await numeros('lct-26'), await numeros('LCT-2602'), await numeros('LC'), await numeros('ZZZ')], [['LCT-2601-0001', 'LCT-2602-0002'], ['LCT-2602-0002'], [], []]);
    assert.deepEqual(await numeros('LCT-2602', admin), ['LCT-2602-0002', 'LCT-2602-0003']);
    // Les résultats ne portent que le nécessaire à l'affichage.
    assert.deepEqual(Object.keys((await lire('rechercheFactures', { q: 'LCT-2601' }, lyon) as object[])[0]).sort(), ['clientId', 'clientName', 'id', 'invoiceNumber', 'status']);

    type Synthese = { totalFactureHT: number; parMois: Record<string, number>; dernierePeriode: Record<string, string>; recentes: { id: string }[]; nombre: number };
    const avant = await lire('syntheseFactures', {}, lyon) as Synthese;
    await f('lt-5', 'l', 'LCT-2604-0005', { date: t('2026-04-10'), status: 'paid', subtotal: 100.1, total: 120, contractId: 'lc-kl', periodEndDate: t('2026-04-30') });
    const apres = await lire('syntheseFactures', {}, lyon) as Synthese;
    // Une facture de plus dans le périmètre : total, mois, dernière période du contrat et factures récentes suivent.
    assert.equal(Math.round((apres.totalFactureHT - avant.totalFactureHT) * 100) / 100, 100.1);
    assert.deepEqual([apres.nombre - avant.nombre, apres.parMois['2026-04'] - (avant.parMois['2026-04'] ?? 0), apres.dernierePeriode['lc-kl'].slice(0, 10), apres.recentes.length <= 5], [1, 100.1, '2026-04-30', true]);
    // Le proforma ne compte ni dans le total ni dans le mois ; la facture de Paris n'est pas dans la synthèse de Lyon.
    assert.equal(avant.parMois['2026-03'], undefined);
    assert.equal((await lire('syntheseFactures', {}, admin) as Synthese).dernierePeriode['lc-kp'].slice(0, 10), '2026-02-28');
    assert.equal(apres.dernierePeriode['lc-kp'], undefined);
    assert.equal(JSON.stringify(apres).includes('lineItems'), false);
});
