// Pilotage ADV : commentaires de suivi historisés (émulateur) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { ajouterCommentaire, definirResponsable, historiqueCommentaires, suiviFacturation } from '../src/services/pilotage-admin';
import { applyImport, planImport } from '../src/services/imports-admin';
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
    await set('clients', 'pl-c', { name: 'Client pilotage', companyId: 'pl-co', agencyId: 'pl-ag', sectorId: 'pl-se' });
    await set('users', 'pl-u', { firstName: 'Anne', name: 'Durand', email: 'Anne.Durand@v.fr' });
    await adminDb.collection('contracts').doc('pl-k').update({ externalRef: 'PL-K' });
    const hier = new Date(Date.now() - 86_400_000);
    await set('invoices', 'pl-f1', { contractId: 'pl-k', clientId: 'pl-c', invoiceNumber: 'PL-0001', status: 'due', date: hier, subtotal: 150, lineItems: [
        { total: 100, activityCode: 'P2', itemKey: 'svc:pl-svc' }, { total: 50, activityCode: 'P2', siteId: 'pl-s' },
    ] });
    await set('invoices', 'pl-pro', { contractId: 'pl-k', clientId: 'pl-c', status: 'proforma', date: hier, lineItems: [{ total: 70, activityCode: 'P2' }] });
    await set('creditNotes', 'pl-a1', { contractId: 'pl-k', clientId: 'pl-c', companyId: 'pl-co2', date: hier, lineItems: [{ total: -30, activityCode: 'P2', siteId: 'pl-s' }] });
});

test('responsable facturation : affectation, retrait, import par e-mail ; lignes émises rattachées', async () => {
    await definirResponsable('pl-k', 'pl-u', 'chef@v.fr');
    assert.deepEqual([(await adminDb.collection('contracts').doc('pl-k').get()).get('billingManagerId'), (await adminDb.collection('contracts').doc('pl-k').get()).get('billingManagerUpdatedBy')], ['pl-u', 'chef@v.fr']);
    await assert.rejects(definirResponsable('pl-k', 'inconnu', 'chef@v.fr'), /Utilisateur introuvable/);
    await definirResponsable('pl-k', null, 'chef@v.fr');
    assert.equal((await adminDb.collection('contracts').doc('pl-k').get()).get('billingManagerId'), null);

    const table = [['Réf. externe', 'Responsable facturation'], ['PL-K', 'anne.durand@v.fr']];
    const plan = await planImport('contracts', table);
    assert.deepEqual(plan.items.map(i => [i.action, i.messages]), [['update', []]]);
    await applyImport('contracts', table, { fileName: 'test', by: 'admin@v.fr' });
    assert.equal((await adminDb.collection('contracts').doc('pl-k').get()).get('billingManagerId'), 'pl-u');
    const inconnu = await planImport('contracts', [['Réf. externe', 'Responsable facturation'], ['PL-K', 'personne@v.fr']]);
    assert.match(inconnu.items[0].messages.join(' '), /aucun utilisateur avec cet e-mail/);

    const s = await suiviFacturation(30);
    const emis = s.emis.filter(l => l.doc.endsWith(':pl-f1') || l.doc.endsWith(':pl-a1') || l.doc.endsWith(':pl-pro'));
    assert.deepEqual(emis.map(l => [l.doc, l.ht, l.company, l.agency, l.sector, l.manager, l.activity, l.site, l.client]), [
        ['F:pl-f1', 100, 'pl-co', 'pl-ag', 'pl-se', 'pl-u', 'pl-p2', 'pl-s', 'pl-c'],
        ['F:pl-f1', 50, 'pl-co', 'pl-ag', 'pl-se', 'pl-u', 'pl-p2', 'pl-s', 'pl-c'],
        ['A:pl-a1', 30, 'pl-co2', 'pl-ag', 'pl-se', 'pl-u', 'pl-p2', 'pl-s', 'pl-c'],
    ]);
    assert.ok(s.options.manager.some(o => o.id === 'pl-u' && o.label === 'Anne Durand'));
    assert.ok(s.options.site.some(o => o.id === 'pl-s' && o.label === 'Résidence Les Pins'));
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
