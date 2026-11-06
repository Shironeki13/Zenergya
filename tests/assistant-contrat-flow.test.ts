// Assistant de création de contrat : écriture au serveur (émulateur) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { creerContratAssistant } from '../src/services/contrat-assistant-admin';
import { brouillonVide, type Brouillon } from '../src/lib/contracts/assistant';
import type { SessionUser } from '../src/lib/auth/server';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const adv = { uid: 'u-as', email: 'adv@v.fr', isAdmin: false, profile: {} } as unknown as SessionUser;

before(async () => {
    await set('activities', 'as-p2', { code: 'P2AS', label: 'Maintenance', type: 'P2' });
    await set('schedules', 'as-sm', { name: 'Mensuel' });
    await set('terms', 'as-te', { name: 'À échoir' });
    await set('vatRates', 'as-v', { code: 'TVA20AS', rate: 20 });
    await set('clients', 'as-c', { name: 'Client assistant', siret: '41111111111111', postalCode: '69003' });
    await set('sites', 'as-libre', { code: 'SIT-90001', name: 'Site libre', clientId: 'as-c' });
    await set('sites', 'as-pris', { code: 'SIT-90002', name: 'Site pris', clientId: 'as-c', contractId: 'autre' });
    await set('users', 'as-u', { name: 'Durand', email: 'adv@v.fr' });
});

const base = (): Brouillon => {
    const b = brouillonVide('as-c');
    b.contrat = { ...b.contrat, label: 'Maintenance', startDate: '2026-01-01', endDate: '2028-12-31', activityIds: ['as-p2'], scheduleId: 'as-sm', termId: 'as-te', vatRateId: 'as-v', billingManagerId: 'as-u' };
    b.sites = { existants: ['as-libre'], nouveaux: [{ cle: 'n1', name: 'Chaufferie neuve', address: '2 rue', postalCode: '69003', city: 'Lyon' }] };
    b.prestations = { saisir: true, lignes: [{ site: 'n1', activityId: 'as-p2', montant: '12 000,50', scheduleId: 'as-sm', termId: 'as-te', vatRateId: 'as-v', startDate: '2026-01-01' }] };
    return b;
};

test('client existant : contrat en attente de validation, site existant rattaché, nouveau site codé, prestation et montants', async () => {
    const r = await creerContratAssistant(base(), adv);
    assert.match(r.contractNumber, /^CTN-\d{5}$/);
    const k = (await adminDb.collection('contracts').doc(r.contractId).get()).data()!;
    assert.deepEqual([k.status, k.validationStatus, k.clientName, k.name, k.billingSchedule, k.billingManagerId, k.createdBy, k.siteIds.length],
        ['Brouillon', 'pending_validation', 'Client assistant', 'Client assistant - Maintenance', 'Mensuel', 'as-u', 'adv@v.fr', 2]);
    assert.equal(k.startDate.toDate().toISOString().slice(0, 10), '2026-01-01');
    assert.equal((await adminDb.collection('sites').doc('as-libre').get()).get('contractId'), r.contractId);
    const neuf = (await adminDb.collection('sites').doc(r.siteIds[1]).get()).data()!;
    assert.match(neuf.code, /^SIT-\d{5}$/);
    assert.deepEqual([neuf.contractId, neuf.clientId], [r.contractId, 'as-c']);
    const svc = (await adminDb.collection('services').where('contractId', '==', r.contractId).get()).docs.map(d => d.data());
    assert.deepEqual(svc.map(s => [s.siteId, s.price, s.type, s.vatRateId, s.billingTermId, s.startDate]), [[r.siteIds[1], 12000.5, 'P2', 'as-v', 'as-te', '2026-01-01']]);
    assert.deepEqual((await adminDb.collection('sites').doc(r.siteIds[1]).get()).get('amounts'), [{ activityId: 'as-p2', amount: 12000.5 }]);
});

test('nouveau client (avec contact de facturation) ; refus : SIRET déjà connu, site d\'un autre contrat, brouillon incomplet', async () => {
    const b = base();
    b.client = { mode: 'nouveau', clientId: '', nouveau: { ...b.client.nouveau, name: 'Nouveau syndicat', clientType: 'private', typologyId: 't', companyId: 'co', agencyId: 'ag', sectorId: 'se', address: '3 rue', postalCode: '69001', city: 'Lyon', siret: '', representedBy: '', contactFacturation: { name: 'Compta', email: 'compta@ns.fr', phone: '' } } };
    b.sites.existants = [];
    const r = await creerContratAssistant(b, adv);
    const c = (await adminDb.collection('clients').doc(r.clientId).get()).data()!;
    assert.match(c.externalCode, /^CLI-\d{5}$/);
    assert.deepEqual([c.name, c.relation, c.useChorus], ['Nouveau syndicat', 'client', false]);
    const ct = (await adminDb.collection('contacts').where('clientId', '==', r.clientId).get()).docs.map(d => d.data());
    assert.deepEqual(ct.map(x => [x.type, x.email]), [['facturation', 'compta@ns.fr']]);

    const doublon = structuredClone(b);
    doublon.client.nouveau.siret = '41111111111111';
    await assert.rejects(creerContratAssistant(doublon, adv), /déjà le SIRET 41111111111111 : Client assistant/);
    const pris = base(); pris.sites.existants = ['as-pris'];
    await assert.rejects(creerContratAssistant(pris, adv), /Site pris est déjà rattaché à un contrat/);
    const incomplet = base(); incomplet.contrat.label = '';
    await assert.rejects(creerContratAssistant(incomplet, adv), /Contrat : Libellé du contrat obligatoire/);
});
