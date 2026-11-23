// Notifications par mail : journal, simulation, destinataires par rôle, domaines internes, unicité (émulateur) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { annuaireContrat, journalNotifications, modifierReglagesNotifications, notifier, notifierSansBloquer, reglagesNotifications } from '../src/services/notifications-admin';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const reglages = (data: object) => adminDb.collection('notificationsReglages').doc('reglages').set(data);
const contexte = { contrat: { id: 'nt-k', numero: 'CTN-09001', client: 'Copropriété Notifiée' }, document: { nature: 'avenant' as const, resume: 'Ajout d\'un site', deposePar: 'nt-adv@interne.test', deposeLe: '2026-11-20' } };

before(async () => {
    await set('roles', 'nt-r-ctq', { name: 'Contrathèque NT', isContratheque: true });
    await set('roles', 'nt-r-adv', { name: 'ADV NT' });
    await set('users', 'nt-ctq', { name: 'Contrathèque', email: 'nt-ctq@interne.test', roleId: 'nt-r-ctq' });
    await set('users', 'nt-ctq-ext', { name: 'Prestataire', email: 'nt-presta@externe.test', roleId: 'nt-r-ctq' });
    await set('users', 'nt-chef', { name: 'Cheffe', email: 'nt-chef@interne.test', roleId: 'nt-r-adv' });
    await set('users', 'nt-resp', { name: 'Responsable', email: 'nt-resp@interne.test', roleId: 'nt-r-adv', managerId: 'nt-chef' });
    await set('contracts', 'nt-k', { contractNumber: 'CTN-09001', clientId: 'nt-c', clientName: 'Copropriété Notifiée', billingManagerId: 'nt-resp' });
    await set('contracts', 'nt-k2', { contractNumber: 'CTN-09002', clientId: 'nt-c', clientName: 'Sans responsable' });
});

test('réglages : simulation par défaut ; annuaire du contrat : contrathèque, responsable de facturation et son N+1', async () => {
    await adminDb.collection('notificationsReglages').doc('reglages').delete();
    const r = await reglagesNotifications();
    assert.deepEqual([r.mode, r.regles], ['simulation', {}]);
    const a = await annuaireContrat('nt-k', 'nt-adv@interne.test');
    assert.deepEqual([a.deposant, a.responsable_facturation, a.n1_responsable], [['nt-adv@interne.test'], ['nt-resp@interne.test'], ['nt-chef@interne.test']]);
    assert.ok(a.contratheque!.includes('nt-ctq@interne.test') && a.contratheque!.includes('nt-presta@externe.test'));
    const sans = await annuaireContrat('nt-k2');
    assert.deepEqual([sans.deposant, sans.responsable_facturation, sans.n1_responsable], [[], [], []]);
});

test('simulation : le mail est journalisé « simulé », aux seules adresses internes ; une clé n\'est notifiée qu\'une fois', async () => {
    await reglages({ mode: 'simulation', expediteur: 'contratheque@interne.test', domaines: ['interne.test'], urlApplication: 'https://zen.interne.test' });
    const n = await notifier({ evenement: 'document_depose', cle: 'amendments/nt-a1', contexte, deposant: 'nt-adv@interne.test' });
    assert.ok(n);
    assert.deepEqual([n.statut, n.mode, n.expediteur, n.contractId, n.contrat], ['simule', 'simulation', 'contratheque@interne.test', 'nt-k', 'CTN-09001 — Copropriété Notifiée']);
    assert.ok(n.destinataires.includes('nt-ctq@interne.test') && !n.destinataires.some(d => d.endsWith('externe.test')));
    assert.deepEqual(n.ecartes.filter(e => e.adresse === 'nt-presta@externe.test'), [{ adresse: 'nt-presta@externe.test', motif: 'domaine externe.test hors des domaines internes' }]);
    assert.match(n.texte, /Vie du contrat : https:\/\/zen\.interne\.test\/contracts\/nt-k\?onglet=historique/);
    // Rejouée (double clic, nouvelle tentative) : rien de plus au journal.
    assert.equal(await notifier({ evenement: 'document_depose', cle: 'amendments/nt-a1', contexte }), null);
    assert.equal((await journalNotifications(500)).filter(x => x.cle === 'amendments/nt-a1').length, 1);
    // Un autre événement sur le même document est une autre notification : validé → déposant et responsable.
    const valide = await notifier({ evenement: 'document_valide', cle: 'amendments/nt-a1', contexte: { ...contexte, document: { ...contexte.document, decidePar: 'nt-ctq@interne.test' } }, deposant: 'nt-adv@interne.test' });
    assert.deepEqual(valide!.destinataires, ['nt-adv@interne.test', 'nt-resp@interne.test']);
});

test('règles enregistrées : événement désactivé, adresses fixes ; mode messagerie : « à envoyer » ; arrêt : rien ; aucun destinataire : signalé', async () => {
    await reglages({ mode: 'messagerie', expediteur: 'contratheque@interne.test', domaines: ['interne.test'], regles: { document_refuse: { actif: false }, resiliation_validee: { roles: [], adresses: ['juridique@interne.test', 'avocat@cabinet.test'] } } });
    assert.equal(await notifier({ evenement: 'document_refuse', cle: 'amendments/nt-a2', contexte }), null);
    const res = await notifier({ evenement: 'resiliation_validee', cle: 'terminations/nt-t1', contexte: { contrat: contexte.contrat, document: { nature: 'resiliation', effet: '2027-03-31' } } });
    assert.deepEqual([res!.statut, res!.destinataires, res!.ecartes.map(e => e.adresse)], ['a_envoyer', ['juridique@interne.test'], ['avocat@cabinet.test']]);
    // Préavis d'un contrat sans responsable de facturation : journalisé, sans destinataire (visible, pas silencieux).
    const preavis = await notifier({ evenement: 'preavis', cle: 'contracts/nt-k2/preavis/60', contexte: { contrat: { id: 'nt-k2', numero: 'CTN-09002', client: 'Sans responsable' }, jours: 60, date: '2027-06-30' } });
    assert.deepEqual([preavis!.statut, preavis!.destinataires], ['sans_destinataire', []]);
    await reglages({ mode: 'arret', domaines: ['interne.test'] });
    assert.equal(await notifier({ evenement: 'document_depose', cle: 'amendments/nt-a3', contexte }), null);
    // Sans domaine interne paramétré : tout est écarté ; et une notification ne fait jamais échouer l'appelant.
    await reglages({ mode: 'simulation', domaines: [] });
    const rien = await notifier({ evenement: 'document_depose', cle: 'amendments/nt-a4', contexte });
    assert.deepEqual([rien!.statut, rien!.destinataires.length, rien!.ecartes.every(e => e.motif === 'aucun domaine interne paramétré')], ['sans_destinataire', 0, true]);
    await notifierSansBloquer({ evenement: 'document_depose', cle: 'x', contexte: { contrat: { id: '', numero: '', client: '' } } as never });   // identifiant de contrat vide : erreur interne absorbée
    await adminDb.collection('notificationsReglages').doc('reglages').delete();
});

test('paramétrage par l\'administrateur : modèles à balises par événement et par type de document, règles, réglages ; tout est contrôlé', async () => {
    const par = 'admin@interne.test';
    await modifierReglagesNotifications({ mode: 'simulation', domaines: ['@Interne.test', 'interne.test'], expediteur: 'Contratheque@interne.test', urlApplication: 'https://zen.interne.test/' }, par);
    let r = await reglagesNotifications();
    assert.deepEqual([r.mode, r.domaines, r.expediteur, r.urlApplication], ['simulation', ['interne.test'], 'contratheque@interne.test', 'https://zen.interne.test']);
    // Refus : envoi réel pas encore branché, domaine ou adresse invalides, boîte d'envoi externe.
    await assert.rejects(modifierReglagesNotifications({ mode: 'messagerie' as never }, par), /l'envoi réel n'est pas encore branché/);
    await assert.rejects(modifierReglagesNotifications({ domaines: ['pas un domaine'] }, par), /Domaine\(s\) invalide\(s\)/);
    await assert.rejects(modifierReglagesNotifications({ expediteur: 'x@externe.test' }, par), /doit appartenir à un domaine interne/);
    await assert.rejects(modifierReglagesNotifications({ urlApplication: 'zen.interne.test' }, par), /commence par https/);

    // Modèle propre à l'événement, puis à un type de document.
    await modifierReglagesNotifications({ modele: { evenement: 'document_depose', modele: { objet: 'À valider : <<Type de document>> sur <<Numéro du contrat>>', corps: 'Bonjour,\n\n<<Un document>> vous attend.\nObjet : <<Objet du document>>' } } }, par);
    await modifierReglagesNotifications({ modele: { evenement: 'document_depose', nature: 'resiliation', modele: { objet: 'Résiliation à valider en priorité — <<Client>>', corps: 'Effet demandé le <<Date d\'effet>>.\n<<Lien vers le contrat>>' } } }, par);
    await assert.rejects(modifierReglagesNotifications({ modele: { evenement: 'document_depose', modele: { objet: 'x', corps: '<<Balise inventée>>' } } }, par), /Balise\(s\) inconnue\(s\) : <<Balise inventée>>/);
    await assert.rejects(modifierReglagesNotifications({ modele: { evenement: 'preavis', nature: 'avenant', modele: { objet: 'x', corps: 'y' } } }, par), /pas de modèle par type de document/);
    const avenant = await notifier({ evenement: 'document_depose', cle: 'amendments/nt-m1', contexte });
    assert.deepEqual([avenant!.sujet, avenant!.texte], ['À valider : avenant sur CTN-09001', 'Bonjour,\n\nUn avenant vous attend.\nObjet : Ajout d\'un site']);
    const resiliation = await notifier({ evenement: 'document_depose', cle: 'terminations/nt-m2', contexte: { contrat: contexte.contrat, document: { nature: 'resiliation', effet: '2027-03-31' } } });
    assert.deepEqual([resiliation!.sujet, resiliation!.texte], ['Résiliation à valider en priorité — Copropriété Notifiée', 'Effet demandé le 31/03/2027.\nhttps://zen.interne.test/contracts/nt-k?onglet=historique']);
    // Retour au modèle hérité, puis au modèle d'origine : l'autre événement n'a jamais changé.
    await modifierReglagesNotifications({ modele: { evenement: 'document_depose', nature: 'resiliation', modele: null } }, par);
    await modifierReglagesNotifications({ modele: { evenement: 'document_depose', modele: null } }, par);
    r = await reglagesNotifications();
    assert.deepEqual(r.modeles, {});
    assert.match((await notifier({ evenement: 'document_depose', cle: 'amendments/nt-m3', contexte }))!.sujet, /^\[Contrathèque\] Un avenant est à valider/);

    // Règle : rôles et adresses fixes internes ; adresse externe ou rôle inconnu refusés ; retour à la règle d'origine.
    await modifierReglagesNotifications({ regle: { evenement: 'document_depose', regle: { actif: true, roles: ['contratheque', 'responsable_facturation'], adresses: [' Juridique@interne.test ', 'juridique@interne.test'] } } }, par);
    const n = await notifier({ evenement: 'document_depose', cle: 'amendments/nt-m4', contexte });
    assert.ok(n!.destinataires.includes('juridique@interne.test') && n!.destinataires.includes('nt-resp@interne.test') && n!.destinataires.filter(d => d === 'juridique@interne.test').length === 1);
    await assert.rejects(modifierReglagesNotifications({ regle: { evenement: 'document_depose', regle: { actif: true, roles: [], adresses: ['syndic@externe.test'] } } }, par), /hors des domaines internes \(interne\.test\) : syndic@externe\.test\. Les mails restent internes\./);
    await assert.rejects(modifierReglagesNotifications({ regle: { evenement: 'document_depose', regle: { actif: true, roles: ['client' as never], adresses: [] } } }, par), /Rôle de destinataire inconnu/);
    await modifierReglagesNotifications({ regle: { evenement: 'document_depose', regle: null } }, par);
    assert.deepEqual((await reglagesNotifications()).regles, {});
    await adminDb.collection('notificationsReglages').doc('reglages').delete();
});
