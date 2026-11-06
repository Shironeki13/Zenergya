// Validation des documents de contrat au serveur (émulateur) : file par type, effets, refus : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { fileValidation, traiterValidation } from '../src/services/validations-admin';
import type { SessionUser } from '../src/lib/auth/server';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const get = async (c: string, id: string) => (await adminDb.collection(c).doc(id).get()).data()!;
const admin = { uid: 'adm', email: 'admin@v.fr', isAdmin: true, profile: {} } as unknown as SessionUser;
const piece = { documentUrl: 'https://storage.example/doc.pdf', documentName: 'signe.pdf', validationStatus: 'pending_validation', createdAt: '2026-11-01T10:00:00Z', createdBy: 'adv@v.fr' };

before(async () => {
    await set('clients', 'va-c', { name: 'Client validation', representedBy: 'Ancien syndic' });
    await set('contracts', 'va-k', { contractNumber: 'CTN-95001', clientId: 'va-c', clientName: 'Client validation', status: 'Actif', validationStatus: 'validated', endDate: new Date('2027-12-31'), siteIds: [] });
    await set('contracts', 'va-new', { contractNumber: 'CTN-95002', clientId: 'va-c', clientName: 'Client validation', status: 'Brouillon', validationStatus: 'pending_validation', siteIds: [], requesterEmail: 'adv@v.fr', documents: [{ name: 'contrat.pdf', type: 'Contrat signé', url: 'https://storage.example/c.pdf' }] });
    await set('amendments', 'va-av', { ...piece, contractId: 'va-k', description: 'Ajout bâtiment B', impactsDuration: true, newEndDate: '2028-06-30', effectiveDate: '2026-12-01' });
    await set('amendments', 'va-os', { ...piece, contractId: 'va-k', nature: 'os', description: 'OS n°3', impactsDuration: false, effectiveDate: '2026-11-15' });
    await set('renewals', 'va-re', { ...piece, contractId: 'va-k', duration: '1 an', newEndDate: '2029-06-30' });
    await set('trusteeChanges', 'va-sy', { ...piece, contractId: 'va-k', currentRepresentative: 'Ancien syndic', newRepresentative: 'Foncia Lyon', effectiveDate: '2026-11-01' });
    await set('beChanges', 'va-be', { ...piece, contractId: 'va-k', newBe: 'BE Thermique', contactEmail: 'be@x.fr', effectiveDate: '2026-11-01' });
    await set('terminations', 'va-te', { ...piece, contractId: 'va-k', reason: 'Vente', effectiveDate: '2027-03-31' });
    await set('terminations', 'va-sans', { ...piece, documentUrl: '', contractId: 'va-k', reason: 'Sans pièce', effectiveDate: '2027-03-31' });
    await set('terminations', 'va-ancien', { contractId: 'va-k', reason: 'Antérieur à la validation', effectiveDate: '2020-01-01' });
});

test('file d\'attente : chaque type, contrat et client, pièce ; documents antérieurs exclus', async () => {
    const f = (await fileValidation()).filter(e => e.contractId.startsWith('va-'));
    const parType = Object.fromEntries(['contrat', 'avenant', 'os', 'reconduction', 'resiliation', 'syndic', 'be'].map(t => [t, f.filter(e => e.type === t).map(e => e.id).sort()]));
    assert.deepEqual(parType, { contrat: ['va-new'], avenant: ['va-av'], os: ['va-os'], reconduction: ['va-re'], resiliation: ['va-sans', 'va-te'], syndic: ['va-sy'], be: ['va-be'] });
    const av = f.find(e => e.id === 'va-av')!;
    assert.deepEqual([av.contractNumber, av.clientName, av.documentName, av.demandePar], ['CTN-95001', 'Client validation', 'signe.pdf', 'adv@v.fr']);
    assert.equal(f.find(e => e.id === 'va-new')!.documentName, 'contrat.pdf');
});

test('validation : effets sur le contrat et le client ; trace ; pas deux fois', async () => {
    await traiterValidation('avenant', 'va-av', 'valider', '', admin);
    assert.equal((await get('contracts', 'va-k')).endDate.toDate().toISOString().slice(0, 10), '2028-06-30');
    await traiterValidation('os', 'va-os', 'valider', '', admin);
    await traiterValidation('reconduction', 'va-re', 'valider', '', admin);
    assert.equal((await get('contracts', 'va-k')).endDate.toDate().toISOString().slice(0, 10), '2029-06-30');
    await traiterValidation('syndic', 'va-sy', 'valider', '', admin);
    await traiterValidation('be', 'va-be', 'valider', '', admin);
    const c = await get('clients', 'va-c');
    assert.deepEqual([c.representedBy, c.isBe, c.beName, c.beEmail], ['Foncia Lyon', true, 'BE Thermique', 'be@x.fr']);
    await traiterValidation('resiliation', 'va-te', 'valider', '', admin);
    const k = await get('contracts', 'va-k');
    assert.deepEqual([k.status, k.terminationDate.slice(0, 10)], ['Résilié', '2027-03-31']);
    const te = await get('terminations', 'va-te');
    assert.deepEqual([te.validationStatus, te.validatedBy], ['validated', 'admin@v.fr']);
    await assert.rejects(traiterValidation('resiliation', 'va-te', 'valider', '', admin), /n'est plus en attente/);
    await traiterValidation('contrat', 'va-new', 'valider', '', admin);
    assert.deepEqual([(await get('contracts', 'va-new')).status, (await get('contracts', 'va-new')).validationStatus], ['Actif', 'validated']);
});

test('refus : motif obligatoire, enregistré ; pièce absente : validation refusée', async () => {
    await assert.rejects(traiterValidation('resiliation', 'va-sans', 'valider', '', admin), /Pièce justificative absente/);
    await assert.rejects(traiterValidation('resiliation', 'va-sans', 'refuser', '  ', admin), /Motif du refus obligatoire/);
    await traiterValidation('resiliation', 'va-sans', 'refuser', 'Pièce manquante', admin);
    assert.deepEqual([(await get('terminations', 'va-sans')).validationStatus, (await get('terminations', 'va-sans')).refusalReason], ['refused', 'Pièce manquante']);
    assert.equal((await get('contracts', 'va-k')).status, 'Résilié');
});
