// Périmètre côté serveur (émulateur) : client de chaque objet, garde d'un utilisateur limité à une agence, listes
// filtrées, affectations des commandes et des heures : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { PerimetreError, clientDe, exigerPerimetreTotal, gardePerimetre, objetP1 } from '../src/lib/auth/perimetre-server';
import { ciblesDuPerimetre } from '../src/lib/auth/perimetre-cibles';
import type { SessionUser } from '../src/lib/auth/server';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const u = (id: string, scope: { companyIds: string[]; agencyIds: string[]; sectorIds: string[] }, droits: Partial<SessionUser> = {}): SessionUser =>
    ({ uid: id, email: `${id}@v.fr`, isAdmin: false, isContratheque: false, isAcheteur: false, profile: { id, name: id, email: `${id}@v.fr`, scope } as never, ...droits });
const lyon = u('pm-lyon', { companyIds: ['*'], agencyIds: ['pm-ag-lyon'], sectorIds: ['*'] });
const tout = u('pm-tout', { companyIds: ['*'], agencyIds: ['*'], sectorIds: ['*'] });
const rien = u('pm-rien', { companyIds: [], agencyIds: [], sectorIds: [] });
const admin = u('pm-adm', { companyIds: [], agencyIds: [], sectorIds: [] }, { isAdmin: true });

before(async () => {
    for (const [v, ag] of [['l', 'pm-ag-lyon'], ['p', 'pm-ag-paris']]) {
        await set('clients', `pm-c${v}`, { name: `Client ${v}`, companyId: 'pm-co', agencyId: ag, sectorId: `pm-se-${v}` });
        await set('contracts', `pm-k${v}`, { clientId: `pm-c${v}`, contractNumber: `K${v}` });
        await set('sites', `pm-s${v}`, { clientId: `pm-c${v}`, contractId: `pm-k${v}` });
        await set('sites', `pm-s${v}2`, { contractId: `pm-k${v}` });               // site sans client : suit son contrat
        await set('meters', `pm-m${v}`, { siteId: `pm-s${v}2` });
        await set('meterReadings', `pm-r${v}`, { meterId: `pm-m${v}` });
        await set('services', `pm-p${v}`, { contractId: `pm-k${v}`, siteId: `pm-s${v}` });
        await set('invoices', `pm-f${v}`, { clientId: `pm-c${v}` });
        await set('creditNotes', `pm-a${v}`, { clientId: `pm-c${v}` });
        await set('quotes', `pm-d${v}`, { clientId: `pm-c${v}` });
        await set('projects', `pm-x${v}`, { clientId: `pm-c${v}` });
        await set('projectSituations', `pm-t${v}`, { projectId: `pm-x${v}` });
    }
});

test('client de chaque objet : contrat, site (ou son contrat), compteur, relevé, prestation, facture, avoir, devis, affaire, situation', async () => {
    const types = ['client', 'contrat', 'site', 'compteur', 'releve', 'prestation', 'facture', 'avoir', 'devis', 'affaire', 'situation'] as const;
    const ids = ['pm-cl', 'pm-kl', 'pm-sl2', 'pm-ml', 'pm-rl', 'pm-pl', 'pm-fl', 'pm-al', 'pm-dl', 'pm-xl', 'pm-tl'];
    assert.deepEqual(await Promise.all(types.map((t, i) => clientDe(t, ids[i]))), ids.map(() => 'pm-cl'));
    assert.deepEqual([await clientDe('contrat', 'inconnu'), await clientDe('compteur', ''), await clientDe('situation', 'inconnue')], [null, null, null]);
    assert.deepEqual([objetP1({ scope: 'site', id: 's' }), objetP1({ scope: 'poste', id: 's' }), objetP1({ scope: 'meter', id: 'm' }), objetP1({ scope: 'contract', id: 'k' })], [['site', 's'], ['site', 's'], ['compteur', 'm'], ['contrat', 'k']]);
});

test('utilisateur limité à l\'agence de Lyon : voit Lyon, refuse Paris (et l\'inconnu) ; administrateur et périmètre complet : tout', async () => {
    const g = gardePerimetre(lyon);
    assert.equal(g.tout, false);
    for (const [t, id] of [['contrat', 'pm-kl'], ['compteur', 'pm-ml'], ['facture', 'pm-fl'], ['situation', 'pm-tl']] as const) await g.exiger(t, id);
    for (const [t, id] of [['client', 'pm-cp'], ['contrat', 'pm-kp'], ['site', 'pm-sp2'], ['releve', 'pm-rp'], ['devis', 'pm-dp'], ['affaire', 'pm-xp'], ['avoir', 'pm-ap'], ['contrat', 'inconnu']] as const)
        await assert.rejects(g.exiger(t, id), PerimetreError);
    await assert.rejects(g.exiger('contrat', 'pm-kp'), /Ce contrat est hors de votre périmètre/);
    assert.throws(() => g.exigerRattachement({ companyId: 'pm-co', agencyId: 'pm-ag-paris', sectorId: 'pm-se-p' }, 'Ce client'), /Ce client est hors/);
    g.exigerRattachement({ companyId: 'pm-co', agencyId: 'pm-ag-lyon', sectorId: 'x' });
    for (const user of [admin, tout]) { const t = gardePerimetre(user); assert.equal(t.tout, true); await t.exiger('contrat', 'pm-kp'); assert.equal(await t.clients(), null); }
    await assert.rejects(gardePerimetre(rien).exiger('contrat', 'pm-kl'), PerimetreError);
    assert.throws(() => exigerPerimetreTotal(lyon, 'Import'), /réservé aux utilisateurs dont le périmètre couvre/);
    exigerPerimetreTotal(admin, 'Import');
});

test('listes : clients, contrats, sites (dont ceux sans client), affaires du périmètre ; affectations des commandes et des heures', async () => {
    const g = gardePerimetre(lyon);
    const miens = (s: Set<string> | null) => [...s!].filter(x => x.startsWith('pm-')).sort();
    assert.deepEqual(miens(await g.clients()), ['pm-cl']);
    assert.deepEqual([miens(await g.ids('contracts')), miens(await g.ids('sites')), miens(await g.ids('projects')), miens(await g.ids('quotes'))], [['pm-kl'], ['pm-sl', 'pm-sl2'], ['pm-xl'], ['pm-dl']]);
    assert.deepEqual((await g.filtrer([{ c: 'pm-cl' }, { c: 'pm-cp' }, { c: null }], x => x.c)).map(x => x.c), ['pm-cl']);
    const cible = await ciblesDuPerimetre(lyon);
    assert.deepEqual([cible!({ type: 'affaire', projectId: 'pm-xl' }), cible!({ type: 'affaire', projectId: 'pm-xp' }), cible!({ type: 'contrat', contractId: 'pm-kl', activityCode: 'P2' }), cible!({ type: 'contrat', contractId: 'pm-kp' })], [true, false, true, false]);
    assert.equal(await ciblesDuPerimetre(admin), null);
});
