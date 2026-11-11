// Lecture des collections à périmètre par le serveur (émulateur) : tout pour un administrateur, le seul périmètre pour un
// utilisateur limité, dates converties comme les lectures du navigateur : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../src/lib/firebase-admin';
import { chargerDonnees } from '../src/services/donnees-admin';
import { COLLECTIONS_PERIMETRE } from '../src/lib/perimetre';
import type { SessionUser } from '../src/lib/auth/server';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const u = (id: string, agencyIds: string[], droits: Partial<SessionUser> = {}): SessionUser =>
    ({ uid: id, email: `${id}@v.fr`, isAdmin: false, isContratheque: false, isAcheteur: false, profile: { id, name: id, email: `${id}@v.fr`, scope: { companyIds: ['*'], agencyIds, sectorIds: ['*'] } } as never, ...droits });
const lyon = u('dn-lyon', ['dn-ag-lyon']), admin = u('dn-adm', [], { isAdmin: true }), rien = u('dn-rien', []);
const miens = (r: Partial<Record<string, { id: string }[]>>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v!.filter(x => x.id.startsWith('dn-')).map(x => x.id).sort().join()]));

before(async () => {
    for (const [v, ag] of [['l', 'dn-ag-lyon'], ['p', 'dn-ag-paris']]) {
        await set('clients', `dn-c${v}`, { name: `Client ${v}`, companyId: 'dn-co', agencyId: ag, sectorId: `dn-se-${v}`, createdAt: Timestamp.fromDate(new Date('2026-01-02T03:04:05Z')) });
        await set('contracts', `dn-k${v}`, { clientId: `dn-c${v}`, periode: { debut: Timestamp.fromDate(new Date('2026-02-01T00:00:00Z')) }, jalons: [Timestamp.fromDate(new Date('2026-03-01T00:00:00Z'))] });
        await set('sites', `dn-s${v}`, { clientId: `dn-c${v}`, contractId: `dn-k${v}` });
        await set('sites', `dn-s${v}2`, { contractId: `dn-k${v}` });
        await set('services', `dn-p${v}`, { contractId: `dn-k${v}`, siteId: `dn-s${v}` });
        await set('services', `dn-p${v}2`, { siteId: `dn-s${v}2` });
        await set('meters', `dn-m${v}`, { siteId: `dn-s${v}2` });
        await set('meterReadings', `dn-r${v}`, { meterId: `dn-m${v}`, value: 12 });
        await set('invoices', `dn-f${v}`, { clientId: `dn-c${v}`, date: Timestamp.fromDate(new Date('2026-04-05T00:00:00Z')) });
        await set('creditNotes', `dn-a${v}`, { clientId: `dn-c${v}` });
        await set('contacts', `dn-t${v}`, { clientId: `dn-c${v}` });
    }
});

test('administrateur : tout, dates Firestore en chaînes ISO (y compris imbriquées)', async () => {
    const r = await chargerDonnees([...COLLECTIONS_PERIMETRE], admin);
    assert.deepEqual(miens(r), { clients: 'dn-cl,dn-cp', contracts: 'dn-kl,dn-kp', sites: 'dn-sl,dn-sl2,dn-sp,dn-sp2', services: 'dn-pl,dn-pl2,dn-pp,dn-pp2', meters: 'dn-ml,dn-mp', meterReadings: 'dn-rl,dn-rp', invoices: 'dn-fl,dn-fp', creditNotes: 'dn-al,dn-ap', contacts: 'dn-tl,dn-tp' });
    const k = r.contracts!.find(x => x.id === 'dn-kl')! as unknown as { periode: { debut: string }; jalons: string[] };
    assert.deepEqual([r.clients!.find(x => x.id === 'dn-cl')!.createdAt, k.periode.debut, k.jalons, r.invoices!.find(x => x.id === 'dn-fl')!.date], ['2026-01-02T03:04:05.000Z', '2026-02-01T00:00:00.000Z', ['2026-03-01T00:00:00.000Z'], '2026-04-05T00:00:00.000Z']);
    assert.equal(JSON.stringify(r).includes('_seconds'), false);
});

test('utilisateur limité à Lyon : seuls les objets de ses clients, quelle que soit la collection demandée ; sans périmètre : rien', async () => {
    assert.deepEqual(miens(await chargerDonnees([...COLLECTIONS_PERIMETRE], lyon)), { clients: 'dn-cl', contracts: 'dn-kl', sites: 'dn-sl,dn-sl2', services: 'dn-pl,dn-pl2', meters: 'dn-ml', meterReadings: 'dn-rl', invoices: 'dn-fl', creditNotes: 'dn-al', contacts: 'dn-tl' });
    // Une collection demandée seule est filtrée de la même façon (le serveur relit ce qu'il faut pour la rattacher au client).
    assert.deepEqual(miens(await chargerDonnees(['meterReadings'], lyon)), { meterReadings: 'dn-rl' });
    assert.deepEqual(miens(await chargerDonnees(['services', 'invoices'], lyon)), { services: 'dn-pl,dn-pl2', invoices: 'dn-fl' });
    assert.deepEqual(miens(await chargerDonnees([...COLLECTIONS_PERIMETRE], rien)), Object.fromEntries(COLLECTIONS_PERIMETRE.map(k => [k, ''])));
    assert.deepEqual(await chargerDonnees(['users' as never], lyon), {});
});
