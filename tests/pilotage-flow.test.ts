// Pilotage ADV : commentaires de suivi historisés (émulateur) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { ajouterCommentaire, historiqueCommentaires } from '../src/services/pilotage-admin';
import type { SessionUser } from '../src/lib/auth/server';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const adv = { uid: 'u-adv', email: 'adv@v.fr', isAdmin: false, profile: { firstName: 'Anne', name: 'Durand' } } as unknown as SessionUser;

before(async () => {
    await set('contracts', 'pl-k', { contractNumber: 'CTN-08081', clientId: 'pl-c', clientName: 'Client pilotage', siteIds: ['pl-s'], status: 'Actif' });
    await set('contracts', 'pl-autre', { contractNumber: 'CTN-08082', clientId: 'pl-c', siteIds: [] });
    await set('sites', 'pl-s', { name: 'Résidence Les Pins' });
    await set('activities', 'pl-p2', { code: 'P2', label: 'Maintenance' });
    await set('services', 'pl-svc', { contractId: 'pl-k', siteId: 'pl-s', activityId: 'pl-p2', label: 'Maintenance chaufferie' });
});

test('commentaires : contrat et prestation, auteur et cible, historique du plus récent au plus ancien', async () => {
    const a = await ajouterCommentaire({ contractId: 'pl-k', motif: 'attente_client', texte: '  Bon de commande demandé  ' }, adv);
    assert.deepEqual([a.texte, a.auteur, a.itemKey, a.cible, a.motif], ['Bon de commande demandé', 'Anne Durand', null, 'CTN-08081', 'attente_client']);
    const b = await ajouterCommentaire({ contractId: 'pl-k', itemKey: 'svc:pl-svc', motif: 'parametrage', texte: 'TVA à créer' }, adv);
    assert.equal(b.cible, 'Résidence Les Pins — Maintenance chaufferie');
    const c = await ajouterCommentaire({ contractId: 'pl-k', itemKey: 'site:pl-s:pl-p2', motif: 'resolu', texte: 'Montant validé' }, { ...adv, profile: {} } as unknown as SessionUser);
    assert.deepEqual([c.cible, c.auteur], ['Résidence Les Pins — P2', 'adv@v.fr']);
    const h = await historiqueCommentaires('pl-k');
    assert.deepEqual(h.map(x => x.id), [c.id, b.id, a.id]);
    assert.equal((await adminDb.collection('suiviCommentaires').doc(a.id).get()).get('auteurUid'), 'u-adv');
});

test('commentaires : refus (vide, motif, contrat, prestation ou site d\'un autre contrat)', async () => {
    await assert.rejects(ajouterCommentaire({ contractId: 'pl-k', motif: 'note', texte: '   ' }, adv), /vide/);
    await assert.rejects(ajouterCommentaire({ contractId: 'pl-k', motif: 'bof' as never, texte: 'x' }, adv), /Motif inconnu/);
    await assert.rejects(ajouterCommentaire({ contractId: 'pl-k', motif: 'note', texte: 'x'.repeat(2001) }, adv), /trop long/);
    await assert.rejects(ajouterCommentaire({ contractId: 'inconnu', motif: 'note', texte: 'x' }, adv), /Contrat introuvable/);
    await assert.rejects(ajouterCommentaire({ contractId: 'pl-autre', itemKey: 'svc:pl-svc', motif: 'note', texte: 'x' }, adv), /n'appartient pas au contrat/);
    await assert.rejects(ajouterCommentaire({ contractId: 'pl-autre', itemKey: 'site:pl-s:pl-p2', motif: 'note', texte: 'x' }, adv), /Ce site n'appartient pas/);
    await assert.rejects(ajouterCommentaire({ contractId: 'pl-k', itemKey: 'n/importe', motif: 'note', texte: 'x' }, adv), /Prestation inconnue/);
});
