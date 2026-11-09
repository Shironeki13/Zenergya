// Validation des documents de contrat au serveur (émulateur) : file par type, contrôle par la contrathèque, corrections
// tracées, effets, refus : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { fileValidation, traiterValidation, type DecisionValidation } from '../src/services/validations-admin';
import { afficherValeur, champsAControler, valeursDocument, COLLECTION_VALIDATION, type TypeValidation } from '../src/lib/validations';
import type { SessionUser } from '../src/lib/auth/server';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const get = async (c: string, id: string) => (await adminDb.collection(c).doc(id).get()).data()!;
const ctq = { uid: 'ctq', email: 'contratheque@v.fr', isAdmin: false, isContratheque: true, profile: {} } as unknown as SessionUser;
const adminSeul = { uid: 'adm', email: 'admin@v.fr', isAdmin: true, isContratheque: false, profile: {} } as unknown as SessionUser;
const piece = { documentUrl: 'https://storage.example/doc.pdf', documentName: 'signe.pdf', validationStatus: 'pending_validation', createdAt: '2026-11-01T10:00:00Z', createdBy: 'adv@v.fr' };

/** Tous les champs à contrôler du document (après corrections éventuelles), cochés. */
async function tout(type: TypeValidation, id: string, corrections: Record<string, unknown> = {}) {
    const d = await get(COLLECTION_VALIDATION[type], id);
    return champsAControler(type, { ...valeursDocument(type, d), ...(corrections as Record<string, never>) }).map(c => c.cle);
}
const valider = async (type: TypeValidation, id: string, extra: Partial<DecisionValidation> = {}) =>
    traiterValidation(type, id, { decision: 'valider', controles: await tout(type, id, extra.corrections), ...extra }, ctq);

before(async () => {
    await set('clients', 'va-c', { name: 'Client validation', representedBy: 'Ancien syndic' });
    await set('contracts', 'va-k', { contractNumber: 'CTN-95001', clientId: 'va-c', clientName: 'Client validation', status: 'Actif', validationStatus: 'validated', endDate: new Date('2027-12-31'), siteIds: [] });
    await set('contracts', 'va-new', { contractNumber: 'CTN-95002', clientId: 'va-c', clientName: 'Client validation', label: 'Chaufferie', status: 'Brouillon', validationStatus: 'pending_validation', siteIds: [], requesterEmail: 'adv@v.fr', startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2030-12-31T00:00:00Z'), tacitRenewal: false, baseAmountP2: 1200, documents: [{ name: 'contrat.pdf', type: 'Contrat signé', url: 'https://storage.example/c.pdf' }] });
    await set('contracts', 'va-nodoc', { contractNumber: 'CTN-95003', clientId: 'va-c', clientName: 'Client validation', label: 'Sans PDF', status: 'Brouillon', validationStatus: 'pending_validation', siteIds: [], startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2028-12-31T00:00:00Z'), tacitRenewal: true });
    await set('amendments', 'va-av', { ...piece, contractId: 'va-k', description: 'Ajout bâtiment B', signed: true, impactsDuration: true, newEndDate: '2028-06-30', effectiveDate: '2026-12-01', impactP1: 1500 });
    await set('amendments', 'va-os', { ...piece, contractId: 'va-k', nature: 'os', description: 'OS n°3', signed: true, impactsDuration: false, effectiveDate: '2026-11-15' });
    await set('renewals', 'va-re', { ...piece, contractId: 'va-k', duration: '1 an', newEndDate: '2029-06-30' });
    await set('trusteeChanges', 'va-sy', { ...piece, contractId: 'va-k', currentRepresentative: 'Ancien syndic', newRepresentative: 'Fonci Lyon', effectiveDate: '2026-11-01' });
    await set('beChanges', 'va-be', { ...piece, contractId: 'va-k', newBe: 'BE Thermique', contactEmail: 'be@x.fr', effectiveDate: '2026-11-01' });
    await set('terminations', 'va-te', { ...piece, contractId: 'va-k', reason: 'Vente', effectiveDate: '2027-03-31' });
    await set('terminations', 'va-sans', { ...piece, documentUrl: '', contractId: 'va-k', reason: 'Sans pièce', effectiveDate: '2027-03-31' });
    await set('terminations', 'va-ancien', { contractId: 'va-k', reason: 'Antérieur à la validation', effectiveDate: '2020-01-01' });
});

test('file d\'attente : chaque type, contrat et client, pièce, valeurs à contrôler ; documents antérieurs exclus', async () => {
    const f = (await fileValidation()).filter(e => e.contractId.startsWith('va-'));
    const parType = Object.fromEntries(['contrat', 'avenant', 'os', 'reconduction', 'resiliation', 'syndic', 'be'].map(t => [t, f.filter(e => e.type === t).map(e => e.id).sort()]));
    assert.deepEqual(parType, { contrat: ['va-new', 'va-nodoc'], avenant: ['va-av'], os: ['va-os'], reconduction: ['va-re'], resiliation: ['va-sans', 'va-te'], syndic: ['va-sy'], be: ['va-be'] });
    const av = f.find(e => e.id === 'va-av')!;
    assert.deepEqual([av.contractNumber, av.clientName, av.documentName, av.demandePar], ['CTN-95001', 'Client validation', 'signe.pdf', 'adv@v.fr']);
    assert.deepEqual([av.valeurs.newEndDate, av.valeurs.impactP1, av.valeurs.signed], ['2028-06-30', 1500, true]);
    const k = f.find(e => e.id === 'va-new')!;
    assert.deepEqual([k.documentName, k.valeurs.startDate, k.valeurs.endDate, k.valeurs.baseAmountP2], ['contrat.pdf', '2026-01-01', '2030-12-31', 1200]);
});

test('droit : seule la contrathèque valide ou refuse, même un administrateur ne le peut pas', async () => {
    await assert.rejects(traiterValidation('os', 'va-os', { decision: 'valider', controles: await tout('os', 'va-os') }, adminSeul), /contrathèque/);
    await assert.rejects(traiterValidation('os', 'va-os', { decision: 'refuser', motif: 'x' }, adminSeul), /contrathèque/);
});

test('contrôle : chaque valeur doit être cochée ; correction invalide ou champ figé refusés', async () => {
    const champs = await tout('avenant', 'va-av');
    await assert.rejects(traiterValidation('avenant', 'va-av', { decision: 'valider', controles: champs.slice(1) }, ctq), /Contrôle incomplet : Objet/);
    await assert.rejects(valider('avenant', 'va-av', { corrections: { newEndDate: '30/06/2028' } }), /date invalide/);
    await assert.rejects(valider('avenant', 'va-av', { corrections: { description: '' } }), /obligatoire/);
    await assert.rejects(valider('contrat', 'va-new', { corrections: { clientName: 'Autre' } }), /ne se corrige pas/);
    assert.equal((await get('amendments', 'va-av')).validationStatus, 'pending_validation');
});

test('corrections : appliquées, tracées (avant, après, auteur), effets calculés sur la valeur corrigée', async () => {
    await valider('avenant', 'va-av', { corrections: { newEndDate: '2028-09-30', impactP1: '1 450,50' } });
    const av = await get('amendments', 'va-av');
    assert.deepEqual([av.validationStatus, av.validatedBy, av.newEndDate, av.impactP1], ['validated', 'contratheque@v.fr', '2028-09-30', 1450.5]);
    const m = (n: number) => afficherValeur({ type: 'montant' }, n);
    assert.deepEqual(av.corrections.map((c: { champ: string; avant: string; apres: string; par: string }) => [c.champ, c.avant, c.apres, c.par]), [
        ['newEndDate', '30/06/2028', '30/09/2028', 'contratheque@v.fr'],
        ['impactP1', m(1500), m(1450.5), 'contratheque@v.fr'],
    ]);
    assert.ok(av.controledFields.includes('impactP1'));
    assert.equal((await get('contracts', 'va-k')).endDate.toDate().toISOString().slice(0, 10), '2028-09-30');
    // Syndic corrigé : le client reçoit la valeur corrigée.
    await valider('syndic', 'va-sy', { corrections: { newRepresentative: 'Foncia Lyon' } });
    assert.equal((await get('clients', 'va-c')).representedBy, 'Foncia Lyon');
});

test('validation sans correction : effets sur le contrat et le client ; pas deux fois', async () => {
    await valider('os', 'va-os');
    assert.equal((await get('amendments', 'va-os')).corrections, undefined);
    await valider('reconduction', 'va-re');
    assert.equal((await get('contracts', 'va-k')).endDate.toDate().toISOString().slice(0, 10), '2029-06-30');
    await valider('be', 'va-be');
    const c = await get('clients', 'va-c');
    assert.deepEqual([c.isBe, c.beName, c.beEmail], [true, 'BE Thermique', 'be@x.fr']);
    await valider('resiliation', 'va-te');
    const k = await get('contracts', 'va-k');
    assert.deepEqual([k.status, k.terminationDate.slice(0, 10)], ['Résilié', '2027-03-31']);
    await assert.rejects(valider('resiliation', 'va-te'), /n'est plus en attente/);
});

test('base marché : contrat signé obligatoire (joint par la contrathèque si absent) ; dates corrigées en Timestamp', async () => {
    await assert.rejects(valider('contrat', 'va-nodoc'), /Contrat signé absent/);
    await assert.rejects(valider('contrat', 'va-nodoc', { piece: { url: 'javascript:alert(1)', name: 'x.pdf' } }), /Pièce jointe invalide/);
    await valider('contrat', 'va-nodoc', { piece: { url: 'https://storage.example/signe.pdf', name: 'signé.pdf' }, corrections: { endDate: '2029-12-31' } });
    const k = await get('contracts', 'va-nodoc');
    assert.deepEqual([k.status, k.validationStatus, k.documents.map((d: { name: string }) => d.name), k.endDate.toDate().toISOString().slice(0, 10)], ['Actif', 'validated', ['signé.pdf'], '2029-12-31']);
    await valider('contrat', 'va-new');
    assert.deepEqual([(await get('contracts', 'va-new')).status, (await get('contracts', 'va-new')).validationStatus], ['Actif', 'validated']);
});

test('refus : motif obligatoire, enregistré ; pièce absente : validation refusée', async () => {
    await assert.rejects(valider('resiliation', 'va-sans'), /Pièce justificative absente/);
    await assert.rejects(traiterValidation('resiliation', 'va-sans', { decision: 'refuser', motif: '  ' }, ctq), /Motif du refus obligatoire/);
    await traiterValidation('resiliation', 'va-sans', { decision: 'refuser', motif: 'Pièce manquante' }, ctq);
    assert.deepEqual([(await get('terminations', 'va-sans')).validationStatus, (await get('terminations', 'va-sans')).refusalReason], ['refused', 'Pièce manquante']);
});
