// Rappels programmés : passage quotidien, une seule fois par palier, compte rendu (émulateur) : npm run test:billing
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { dernierPassageRappels, lancerRappels } from '../src/services/notifications-rappels';
import { journalNotifications, modifierReglagesNotifications, reglagesNotifications } from '../src/services/notifications-admin';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const reglages = adminDb.collection('notificationsReglages').doc('reglages');
/** Notifications des contrats de ce test, « événement:contrat », triées. */
const duTest = async () => (await journalNotifications(500)).filter(n => n.contractId.startsWith('nr-') || n.cle.startsWith('attente/2026-1')).map(n => `${n.evenement}:${n.contractId || 'recap'}`).sort();   // récapitulatifs des jours de ce test seulement

before(async () => {
    await reglages.set({ mode: 'simulation', expediteur: 'contratheque@interne.test', domaines: ['interne.test'], urlApplication: 'https://zen.interne.test' });
    await set('roles', 'nr-r-ctq', { name: 'Contrathèque NR', isContratheque: true });
    await set('roles', 'nr-r-adv', { name: 'ADV NR' });
    await set('users', 'nr-ctq', { name: 'Contrathèque', email: 'nr-ctq@interne.test', roleId: 'nr-r-ctq' });
    await set('users', 'nr-chef', { name: 'Cheffe', email: 'nr-chef@interne.test', roleId: 'nr-r-adv' });
    await set('users', 'nr-resp', { name: 'Responsable', email: 'nr-resp@interne.test', roleId: 'nr-r-adv', managerId: 'nr-chef' });
    const k = (id: string, endDate: string, plus: object = {}) => set('contracts', id, { contractNumber: `CTN-${id}`, clientId: 'nr-c', clientName: 'Client NR', status: 'Actif', validationStatus: 'validated', billingManagerId: 'nr-resp', startDate: '2024-01-01', endDate, renewal: true, tacitRenewal: true, renewalDuration: '1 an', noticePeriod: '3 mois', baseAmountP2: 4800, ...plus });
    await k('nr-preavis', '2027-03-31');                                   // préavis le 31/12/2026
    await k('nr-depasse', '2026-10-31');                                   // échéance dépassée
    await k('nr-loin', '2030-12-31');                                      // rien
    await k('nr-resilie', '2026-12-31', { status: 'Résilié' });            // rien
    await k('nr-sans-resp', '2027-03-15', { billingManagerId: null });     // préavis le 15/12/2026, personne à prévenir côté responsable
    await set('amendments', 'nr-doc', { contractId: 'nr-loin', validationStatus: 'pending_validation', createdAt: '2026-11-10T09:00:00Z', createdBy: 'nr-adv@interne.test', description: 'Ajout d\'un site', effectiveDate: '2026-12-01', documentUrl: 'https://x/a.pdf' });
    await set('amendments', 'nr-doc-recent', { contractId: 'nr-loin', validationStatus: 'pending_validation', createdAt: '2026-11-22T09:00:00Z', createdBy: 'nr-adv@interne.test', description: 'Récent', documentUrl: 'https://x/b.pdf' });
});
after(async () => { await reglages.delete(); });

test('passage du 23/11/2026 : préavis, échéances, échéance dépassée et document en attente ; chacun à ses destinataires', async () => {
    const p = await lancerRappels({ declencheur: 'planifie', today: '2026-11-23', dernierPassage: null });
    assert.deepEqual(await duTest(), ['document_en_attente:recap', 'echeance:nr-preavis', 'echeance:nr-sans-resp', 'echeance_depassee:nr-depasse', 'preavis:nr-preavis', 'preavis:nr-sans-resp']);
    assert.deepEqual([p.declencheur, p.mode, p.erreurs], ['planifie', 'simulation', []]);
    assert.ok(p.dus >= 6 && p.composes >= 6 && p.contrats >= 4 && p.enAttente >= 2);
    const journal = (await journalNotifications(500)).filter(n => n.contractId.startsWith('nr-') || n.cle.startsWith('attente/2026-1'));
    const de = (e: string, k: string) => journal.find(n => n.evenement === e && n.contractId === k)!;
    assert.deepEqual(de('preavis', 'nr-preavis').destinataires, ['nr-resp@interne.test', 'nr-chef@interne.test']);
    assert.equal(de('preavis', 'nr-preavis').sujet, '[Contrats] Préavis dans 38 jours — CTN-nr-preavis — Client NR');
    // Un seul mail récapitulatif pour la contrathèque, quel que soit le nombre de documents ; le document récent (1 jour) n'y est pas.
    const recap = journal.filter(n => n.evenement === 'document_en_attente');
    assert.deepEqual([recap.length, recap[0].contrat, recap[0].cle], [1, 'Tous les contrats', 'attente/2026-11-23']);
    assert.ok(recap[0].destinataires.includes('nr-ctq@interne.test'));
    assert.match(recap[0].texte, /- CTN-nr-loin — Client NR : avenant déposé le 10\/11\/2026 par nr-adv@interne\.test, 13 jours d'attente — Ajout d'un site/);
    assert.ok(!recap[0].texte.includes('Récent') && recap[0].texte.includes('https://zen.interne.test/contracts/library'));
    assert.equal(de('echeance_depassee', 'nr-depasse').sujet, '[Contrats] Échéance dépassée depuis 23 jours — CTN-nr-depasse — Client NR');
    // Contrat sans responsable de facturation : le préavis n'a personne (signalé), l'échéance va à la contrathèque.
    assert.deepEqual([de('preavis', 'nr-sans-resp').statut, de('preavis', 'nr-sans-resp').destinataires], ['sans_destinataire', []]);
    assert.ok(de('echeance', 'nr-sans-resp').destinataires.includes('nr-ctq@interne.test'));
    assert.ok(p.sansDestinataire >= 1);
});

test('le même jour relancé : rien de nouveau ; le lendemain non plus ; un palier franchi : un nouveau rappel', async () => {
    const avant = (await duTest()).length;
    const encore = await lancerRappels({ declencheur: 'manuel', today: '2026-11-23', dernierPassage: '2026-11-23' });
    assert.equal((await duTest()).length, avant);
    assert.ok(encore.dus >= 5);
    assert.equal(Object.keys(encore.parEvenement).filter(e => e !== undefined).reduce((t, e) => t + (encore.parEvenement[e as never] ?? 0), 0), encore.composes);
    await lancerRappels({ declencheur: 'planifie', today: '2026-11-24', dernierPassage: '2026-11-23' });
    // Le 24/11 : le document passe à 14 jours (nouveau seuil) → un nouveau récapitulatif ; préavis et échéances n'ont pas changé de palier.
    assert.equal((await duTest()).filter(x => x.startsWith('document_en_attente')).length, 2);
    assert.equal((await duTest()).length, avant + 1);
    // Le 25/11 : aucun nouveau seuil → pas de mail.
    await lancerRappels({ declencheur: 'planifie', today: '2026-11-25', dernierPassage: '2026-11-24' });
    assert.equal((await duTest()).length, avant + 1);
    // Le 01/12 : la date limite de préavis du 31/12 est à 30 jours → palier 30.
    await lancerRappels({ declencheur: 'planifie', today: '2026-12-01', dernierPassage: '2026-11-25' });
    assert.equal((await duTest()).filter(x => x === 'preavis:nr-preavis').length, 2);
    const dernier = await dernierPassageRappels();
    assert.ok(dernier && dernier.declencheur === 'planifie' && dernier.dus >= 1);
});

test('réglages des rappels : paliers propres, contrôlés ; mode arrêt : passage tracé, rien de composé', async () => {
    await modifierReglagesNotifications({ rappels: { preavis: [30, 120, 120], echeance: [60], attenteJours: 3, depasseeJours: 15 } }, 'admin@interne.test');
    assert.deepEqual((await reglagesNotifications()).rappels, { preavis: [120, 30], echeance: [60], attenteJours: 3, depasseeJours: 15 });
    await assert.rejects(modifierReglagesNotifications({ rappels: { preavis: [0], echeance: [60], attenteJours: 3, depasseeJours: 15 } }, 'a@interne.test'), /Rappels de préavis/);
    await assert.rejects(modifierReglagesNotifications({ rappels: { preavis: [30], echeance: [60], attenteJours: 0, depasseeJours: 15 } }, 'a@interne.test'), /Rappel des documents en attente/);
    const avant = (await duTest()).length;
    await reglages.set({ mode: 'arret', domaines: ['interne.test'] });
    const p = await lancerRappels({ declencheur: 'planifie', today: '2027-01-15' });
    assert.deepEqual([p.mode, p.dus, p.composes, (await duTest()).length], ['arret', 0, 0, avant]);
});
