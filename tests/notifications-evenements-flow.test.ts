// Notifications déclenchées par la vie d'un contrat : dépôt, validation, refus, résiliation (émulateur) : npm run test:billing
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { ecrire } from '../src/services/ecritures-admin';
import { traiterValidation } from '../src/services/validations-admin';
import { journalNotifications, type Notification } from '../src/services/notifications-admin';
import { CHAMPS_VALIDATION, valeursDocument, type TypeValidation } from '../src/lib/validations';
import type { SessionUser } from '../src/lib/auth/server';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const reglages = adminDb.collection('notificationsReglages').doc('reglages');
const adv = { uid: 'ne-adv', email: 'ne-adv@interne.test', isAdmin: true, isContratheque: false, profile: { scope: { companyIds: ['*'], agencyIds: ['*'], sectorIds: ['*'] } } } as unknown as SessionUser;
const ctq = { uid: 'ne-ctq', email: 'ne-ctq@interne.test', isAdmin: false, isContratheque: true, profile: {} } as unknown as SessionUser;
const net = (x: string) => x.replace(/[  ]/g, ' ');
/** Notifications du journal pour un contrat, de la plus ancienne à la plus récente. */
const duContrat = async (id: string): Promise<Notification[]> => (await journalNotifications(500)).filter(n => n.contractId === id).sort((a, b) => a.creeLe.localeCompare(b.creeLe));
const valider = async (type: TypeValidation, id: string) => {
    const d = (await adminDb.collection(type === 'avenant' || type === 'os' ? 'amendments' : type === 'resiliation' ? 'terminations' : 'contracts').doc(id).get()).data()!;
    const valeurs = valeursDocument(type, d);
    await traiterValidation(type, id, { decision: 'valider', controles: CHAMPS_VALIDATION[type].filter(c => c.cle in valeurs).map(c => c.cle) }, ctq);
};

before(async () => {
    await reglages.set({ mode: 'simulation', expediteur: 'contratheque@interne.test', domaines: ['interne.test'], urlApplication: 'https://zen.interne.test' });
    await set('roles', 'ne-r-ctq', { name: 'Contrathèque NE', isContratheque: true });
    await set('roles', 'ne-r-adv', { name: 'ADV NE' });
    await set('users', 'ne-ctq', { name: 'Contrathèque', email: 'ne-ctq@interne.test', roleId: 'ne-r-ctq' });
    await set('users', 'ne-chef', { name: 'Cheffe', email: 'ne-chef@interne.test', roleId: 'ne-r-adv' });
    await set('users', 'ne-resp', { name: 'Responsable', email: 'ne-resp@interne.test', roleId: 'ne-r-adv', managerId: 'ne-chef' });
    await set('clients', 'ne-c', { name: 'Copropriété Événements' });
    await set('contracts', 'ne-k', { contractNumber: 'CTN-09101', clientId: 'ne-c', clientName: 'Copropriété Événements', status: 'Actif', validationStatus: 'validated', billingManagerId: 'ne-resp', baseAmountP1: 80000, baseAmountP2: 4800, startDate: '2024-10-01', endDate: '2027-09-30' });
});
after(async () => { await reglages.delete(); });

test('avenant : le dépôt prévient la contrathèque, la validation prévient le déposant et le responsable de facturation ; montants et impacts dans le mail', async () => {
    const a = await ecrire('createAmendment', [{ contractId: 'ne-k', validationStatus: 'pending_validation', documentUrl: 'https://x/o/a.pdf', description: 'Ajout du bâtiment C', effectiveDate: '2026-12-01', impactsDuration: false, impactsServices: true, impactP1: -2500, impactP2: 1200, signed: true, createdAt: '2026-11-20T09:00:00Z', createdBy: 'ne-adv@interne.test' }], adv) as { id: string };
    let journal = await duContrat('ne-k');
    assert.deepEqual(journal.map(n => [n.evenement, n.statut]), [['document_depose', 'simule']]);
    assert.ok(journal[0].destinataires.includes('ne-ctq@interne.test'));
    assert.equal(journal[0].sujet, '[Contrathèque] Un avenant est à valider — CTN-09101 — Copropriété Événements');
    assert.match(net(journal[0].texte), /Un avenant a été déposé par ne-adv@interne\.test le 20\/11\/2026 sur le contrat CTN-09101 — Copropriété Événements\.\nObjet : Ajout du bâtiment C\nDate d'effet : 01\/12\/2026\nP1 : −2 500,00 € HT\/an\nP2 : \+1 200,00 € HT\/an\n/);
    assert.match(journal[0].texte, /https:\/\/zen\.interne\.test\/contracts\/ne-k\?onglet=historique/);

    await valider('avenant', a.id);
    journal = await duContrat('ne-k');
    assert.deepEqual(journal.map(n => n.evenement), ['document_depose', 'document_valide']);
    assert.deepEqual([journal[1].destinataires, journal[1].sujet], [['ne-adv@interne.test', 'ne-resp@interne.test'], '[Contrathèque] L\'avenant est validé — CTN-09101 — Copropriété Événements']);
    assert.match(journal[1].texte, /L'avenant du contrat .* a été validé par ne-ctq@interne\.test\./);
});

test('refus : le déposant reçoit le motif ; ordre de service reconnu comme tel', async () => {
    const os = await ecrire('createAmendment', [{ contractId: 'ne-k', nature: 'os', validationStatus: 'pending_validation', documentUrl: 'https://x/o/os.pdf', description: 'OS n°3', effectiveDate: '2026-12-05', impactsDuration: false, impactsServices: false, signed: false, createdAt: '2026-11-21T09:00:00Z', createdBy: 'ne-adv@interne.test' }], adv) as { id: string };
    await traiterValidation('os', os.id, { decision: 'refuser', motif: 'OS non signé par le client.' }, ctq);
    const journal = (await duContrat('ne-k')).slice(-2);
    assert.deepEqual(journal.map(n => [n.evenement, n.sujet]), [
        ['document_depose', '[Contrathèque] Un ordre de service est à valider — CTN-09101 — Copropriété Événements'],
        ['document_refuse', '[Contrathèque] L\'ordre de service est refusé — CTN-09101 — Copropriété Événements'],
    ]);
    assert.deepEqual(journal[1].destinataires, ['ne-adv@interne.test']);
    assert.match(journal[1].texte, /a été refusé par ne-ctq@interne\.test\.\nMotif : OS non signé par le client\nObjet : OS n°3\n/);
});

test('résiliation validée : mail de validation au déposant, et alerte « résiliation validée » au responsable et à son N+1', async () => {
    const r = await ecrire('createTermination', [{ contractId: 'ne-k', validationStatus: 'pending_validation', documentUrl: 'https://x/o/r.pdf', effectiveDate: '2027-03-31', reason: 'Vente de l\'immeuble', createdAt: '2026-11-22T09:00:00Z', createdBy: 'ne-adv@interne.test' }], adv) as { id: string };
    await valider('resiliation', r.id);
    const journal = (await duContrat('ne-k')).slice(-3);
    assert.deepEqual(journal.map(n => n.evenement).sort(), ['document_depose', 'document_valide', 'resiliation_validee']);
    const alerte = journal.find(n => n.evenement === 'resiliation_validee')!;
    assert.deepEqual([alerte.destinataires, alerte.sujet], [['ne-resp@interne.test', 'ne-chef@interne.test'], '[Contrats] Résiliation validée — CTN-09101 — Copropriété Événements']);
    assert.match(alerte.texte, /La résiliation du contrat .* est validée\.\nDate d'effet : 31\/03\/2027\nMotif : Vente de l'immeuble\n/);
    assert.equal(journal.find(n => n.evenement === 'document_valide')!.sujet, '[Contrathèque] La résiliation est validée — CTN-09101 — Copropriété Événements');
});

test('notification désactivée ou en arrêt : le dépôt et la validation se font quand même, sans mail', async () => {
    await reglages.set({ mode: 'arret', domaines: ['interne.test'] });
    const avant = (await duContrat('ne-k')).length;
    const a = await ecrire('createRenewal', [{ contractId: 'ne-k', validationStatus: 'pending_validation', documentUrl: 'https://x/o/re.pdf', newEndDate: '2028-09-30', duration: '1 an', createdAt: '2026-11-23T09:00:00Z', createdBy: 'ne-adv@interne.test' }], adv) as { id: string };
    assert.equal((await adminDb.collection('renewals').doc(a.id).get()).get('validationStatus'), 'pending_validation');
    assert.equal((await duContrat('ne-k')).length, avant);
    await reglages.set({ mode: 'simulation', expediteur: 'contratheque@interne.test', domaines: ['interne.test'], urlApplication: 'https://zen.interne.test' });
});
