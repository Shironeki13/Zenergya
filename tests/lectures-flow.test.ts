// Lectures nommées par le serveur (émulateur) : fiches et éléments d'un objet, contrôlés par le périmètre : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
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
        contactsDuClient: ['c', 'lc-tl'], sitesDuClient: ['c', 'lc-sl'], contratsDuClient: ['c', 'lc-kl'], sitesDuContrat: ['k', 'lc-sl'], facturesDuContrat: ['k', 'lc-fl,lc-fl2'],
        relevesDuContrat: ['k', 'lc-rl'], relevesDuCompteur: ['m', 'lc-rl'], prestationsDuContrat: ['k', 'lc-pl'], prestationsDuSite: ['s', 'lc-pl'], avenantsDuContrat: ['k', 'lc-el-amendments'], resiliationsDuContrat: ['k', 'lc-el-terminations'],
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
    assert.deepEqual(Object.keys(LECTURES).sort(), [...Object.keys(PARENTS), ...Object.keys(attendu), 'devisTous', 'affaires'].sort());
});

test('listes entières (devis, affaires) : réduites au périmètre ; lecture inconnue refusée', async () => {
    assert.deepEqual([ids(await lire('devisTous', {}, lyon)), ids(await lire('affaires', {}, lyon))], ['lc-dl', 'lc-xl']);
    assert.deepEqual([ids(await lire('devisTous', {}, admin)), ids(await lire('affaires', {}, admin))], ['lc-dl,lc-dp', 'lc-xl,lc-xp']);
    await assert.rejects(lire('users', {}, admin), /Lecture inconnue/);
    await assert.rejects(lire('constructor', {}, admin), /Lecture inconnue/);
});
