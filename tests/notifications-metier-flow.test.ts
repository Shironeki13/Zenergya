// Notifications des commandes et des heures : valideur prévenu, décision annoncée, récapitulatif des heures (émulateur) : npm run test:billing
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { deciderCommande, saveCommande, saveFournisseur, setSeuils, soumettreCommande } from '../src/services/commandes-admin';
import { deciderHeures, saveHeures } from '../src/services/heures-admin';
import { lancerRappels } from '../src/services/notifications-rappels';
import { journalNotifications, modifierReglagesNotifications, type Notification } from '../src/services/notifications-admin';
import type { SessionUser } from '../src/lib/auth/server';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const reglages = adminDb.collection('notificationsReglages').doc('reglages');
const u = (id: string, name: string, droits: Partial<SessionUser> = {}): SessionUser => ({ uid: id, email: `${id}@interne.test`, isAdmin: false, isContratheque: false, isAcheteur: false, profile: { id, name, email: `${id}@interne.test` } as never, ...droits });
const tech = u('nm-tech', 'Technicien'), tech2 = u('nm-tech2', 'Technicienne'), chef = u('nm-chef', 'Chef'), dir = u('nm-dir', 'Directrice'), acheteuse = u('nm-ach', 'Acheteuse', { isAcheteur: true });
const net = (x: string) => x.replace(/[  ]/g, ' ');
let frn = '';
const journal = async (filtre: (n: Notification) => boolean) => (await journalNotifications(500)).filter(filtre).sort((a, b) => a.creeLe.localeCompare(b.creeLe));
const commande = async (prix: number) => saveCommande({ companyId: 'nm-co', supplierId: frn, title: 'Deux circulateurs', date: '2026-11-10', lines: [{ label: 'Circulateur', quantity: 1, unitPrice: prix, nature: 'FOURNITURE', cible: { type: 'affaire', projectId: 'nm-aff' } }] }, tech);

before(async () => {
    await reglages.set({ mode: 'simulation', expediteur: 'zenergya@interne.test', domaines: ['interne.test'], urlApplication: 'https://zen.interne.test' });
    await set('companies', 'nm-co', { code: 'NMC', name: 'Société NM', quoteLaborCost: 40 });
    await set('agencies', 'nm-ag', { name: 'Lyon', code: 'LYO', companyId: 'nm-co' });
    await set('sectors', 'nm-se', { name: 'Nord', code: 'LN', agencyId: 'nm-ag' });
    await set('clients', 'nm-cli', { name: 'Client NM', externalCode: 'CLI-09201', companyId: 'nm-co', agencyId: 'nm-ag', sectorId: 'nm-se' });
    await set('projects', 'nm-aff', { code: 'NMC-AFF2026-0001', companyId: 'nm-co', clientId: 'nm-cli', clientName: 'Client NM', title: 'Rénovation', status: 'en_cours', mode: 'P5', billing: 'direct', lines: [], quoteId: 'q' });
    await set('roles', 'nm-r-ach', { name: 'Achats NM', isAcheteur: true });
    await set('roles', 'nm-r-adm', { name: 'Admin NM', isAdmin: true });
    await set('users', 'nm-tech', { name: 'Technicien', email: 'nm-tech@interne.test', managerId: 'nm-chef' });
    await set('users', 'nm-tech2', { name: 'Technicienne', email: 'nm-tech2@interne.test', managerId: 'nm-chef' });
    await set('users', 'nm-orphelin', { name: 'Sans chef', email: 'nm-orphelin@interne.test' });
    await set('users', 'nm-chef', { name: 'Chef', email: 'nm-chef@interne.test', managerId: 'nm-dir' });
    await set('users', 'nm-dir', { name: 'Directrice', email: 'nm-dir@interne.test', validationLimit: 100000 });
    await set('users', 'nm-ach', { name: 'Acheteuse', email: 'nm-ach@interne.test', roleId: 'nm-r-ach' });
    await set('users', 'nm-adm', { name: 'Admin', email: 'nm-adm@interne.test', roleId: 'nm-r-adm' });
    await setSeuils('nm-co', { auto: 500, n2: 5000, achats: 10000 });
    frn = (await saveFournisseur({ name: 'Chauffage NM' }, 'a@interne.test')).id;
});
after(async () => { await reglages.delete(); });

test('commande : chaque valideur est prévenu à son tour (N+1, N+2, achats), puis le demandeur à la validation finale', async () => {
    const c = await soumettreCommande((await commande(15000)).id, tech);
    const duC = () => journal(n => n.contrat === `Commande ${c.number}`);
    let j = await duC();
    assert.deepEqual(j.map(n => [n.evenement, n.destinataires]), [['commande_a_valider', ['nm-chef@interne.test']]]);
    assert.equal(net(j[0].sujet), `[Achats] Commande à valider — ${c.number} — 15 000,00 €`);
    assert.match(net(j[0].texte), new RegExp(`La commande ${c.number} de Technicien attend votre validation \\(Responsable \\(N\\+1\\)\\)\\.\\nObjet : Deux circulateurs\\nFournisseur : Chauffage NM\\nMontant : 15 000,00 € HT\\n`));
    assert.ok(j[0].texte.includes(`https://zen.interne.test/purchases/${c.id}`));
    await deciderCommande(c.id, 'validee', '', chef);
    await deciderCommande(c.id, 'validee', 'Budget confirmé', dir);
    j = await duC();
    assert.deepEqual(j.map(n => [n.evenement, n.destinataires]), [['commande_a_valider', ['nm-chef@interne.test']], ['commande_a_valider', ['nm-dir@interne.test']], ['commande_a_valider', ['nm-ach@interne.test']]]);
    assert.match(j[2].texte, /attend votre validation \(Achats\)/);
    await deciderCommande(c.id, 'validee', '', acheteuse);
    j = await duC();
    assert.deepEqual([j.length, j[3].evenement, j[3].destinataires, j[3].sujet], [4, 'commande_validee', ['nm-tech@interne.test'], `[Achats] Votre commande ${c.number} est validée`]);
    assert.match(j[3].texte, /Dernière validation par Acheteuse\./);
});

test('commande refusée : le demandeur reçoit le motif ; resoumise, le valideur est prévenu de nouveau ; autovalidée : aucun mail', async () => {
    const c = await soumettreCommande((await commande(3000)).id, tech);
    const duC = () => journal(n => n.contrat === `Commande ${c.number}`);
    await deciderCommande(c.id, 'refusee', 'Devis fournisseur manquant.', chef);
    let j = await duC();
    assert.deepEqual(j.map(n => [n.evenement, n.destinataires]), [['commande_a_valider', ['nm-chef@interne.test']], ['commande_refusee', ['nm-tech@interne.test']]]);
    assert.match(j[1].texte, /a été refusée par Chef\.\nMotif : Devis fournisseur manquant\nObjet : Deux circulateurs\n/);
    // Corrigée puis resoumise : nouveau tour de validation, nouveau mail au valideur.
    await saveCommande({ id: c.id, companyId: 'nm-co', supplierId: frn, title: 'Deux circulateurs (devis joint)', date: '2026-11-12', lines: [{ label: 'Circulateur', quantity: 1, unitPrice: 3000, nature: 'FOURNITURE', cible: { type: 'affaire', projectId: 'nm-aff' } }] }, tech);
    await soumettreCommande(c.id, tech);
    j = await duC();
    assert.deepEqual(j.map(n => n.evenement), ['commande_a_valider', 'commande_refusee', 'commande_a_valider']);
    // Sous le seuil d'autovalidation : validée à la soumission, personne à prévenir.
    const petite = await soumettreCommande((await commande(200)).id, tech);
    assert.deepEqual([petite.status, (await journal(n => n.contrat === `Commande ${petite.number}`)).length], ['validee', 0]);
});

test('heures refusées : un mail par salarié, avec ses saisies et le motif', async () => {
    const a = await saveHeures({ date: '2026-11-17', hours: 7.5, cible: { type: 'affaire', projectId: 'nm-aff' } }, tech);
    const b = await saveHeures({ date: '2026-11-18', hours: 4, cible: { type: 'affaire', projectId: 'nm-aff' } }, tech);
    const c = await saveHeures({ date: '2026-11-18', hours: 6, cible: { type: 'affaire', projectId: 'nm-aff' } }, tech2);
    await deciderHeures([a.id, b.id, c.id], 'refusee', 'Affectation erronée.', chef);
    const j = await journal(n => n.evenement === 'heures_refusees' && n.cle.startsWith('heures/refus/nm-'));   // celles de ce test seulement
    assert.deepEqual(j.map(n => [n.contrat, n.destinataires]).sort(), [['Heures de Technicien', ['nm-tech@interne.test']], ['Heures de Technicienne', ['nm-tech2@interne.test']]]);
    const duTech = j.find(n => n.contrat === 'Heures de Technicien')!;
    assert.equal(duTech.sujet, '[Heures] 2 saisie(s) d\'heures refusée(s)');
    assert.match(net(duTech.texte), /2 de vos saisies d'heures \(11,5 h\) ont été refusées par Chef\.\nMotif : Affectation erronée\n\n- 17\/11\/2026 — Technicien : 7,5 h — .*\n- 18\/11\/2026 — Technicien : 4 h — /);
    assert.ok(duTech.texte.includes('https://zen.interne.test/timesheets'));
});

test('heures à valider : un seul mail récapitulatif par responsable, le jour où il y a du nouveau ; salarié sans responsable : les administrateurs', async () => {
    await saveHeures({ date: '2026-11-19', hours: 8, cible: { type: 'affaire', projectId: 'nm-aff' } }, tech);
    await saveHeures({ date: '2026-11-19', hours: 5, cible: { type: 'affaire', projectId: 'nm-aff' } }, tech2);
    await saveHeures({ date: '2026-11-19', hours: 3, cible: { type: 'affaire', projectId: 'nm-aff' } }, u('nm-orphelin', 'Sans chef'));
    // Jour fictif, propre à ce test : les passages des autres tests ne s'y mêlent pas.
    const today = '2031-05-10', demain = '2031-05-11';
    await lancerRappels({ declencheur: 'planifie', today, dernierPassage: null });
    const recap = await journal(n => n.evenement === 'heures_a_valider' && (n.cle.includes('/nm-chef/') || n.cle.includes('/sans-responsable/')));
    const duChef = recap.find(n => n.cle.includes('/nm-chef/'))!;
    assert.deepEqual([duChef.destinataires, net(duChef.sujet)], [['nm-chef@interne.test'], '[Heures] 2 saisie(s) à valider — 13 h']);
    assert.match(net(duChef.texte), /2 saisie\(s\) d'heures de votre équipe attendent votre validation, soit 13 h :\n\n- 19\/11\/2026 — Technicien : 8 h — .*\n- 19\/11\/2026 — Technicienne : 5 h — /);
    // Salarié sans responsable : ce sont les administrateurs qui valident, le récapitulatif leur est adressé.
    const orphelin = recap.find(n => n.cle.includes('/sans-responsable/'))!;
    assert.ok(orphelin.texte.includes('Sans chef') && orphelin.destinataires.includes('nm-adm@interne.test') && orphelin.statut === 'simule');
    // Relancé le même jour : rien de plus. Le lendemain sans nouvelle saisie : rien non plus.
    const avant = (await journal(n => n.evenement === 'heures_a_valider' && n.cle.includes('/nm-chef/'))).length;
    await lancerRappels({ declencheur: 'manuel', today, dernierPassage: today });
    await lancerRappels({ declencheur: 'planifie', today: demain, dernierPassage: demain });
    assert.equal((await journal(n => n.evenement === 'heures_a_valider' && n.cle.includes('/nm-chef/'))).length, avant);
});

test('règles : seuls les rôles du domaine sont acceptés (pas de « contrathèque » sur une commande)', async () => {
    await assert.rejects(modifierReglagesNotifications({ regle: { evenement: 'commande_a_valider', regle: { actif: true, roles: ['contratheque'], adresses: [] } } }, 'a@interne.test'), /Rôle sans objet pour cet événement : contratheque/);
    await modifierReglagesNotifications({ regle: { evenement: 'heures_a_valider', regle: { actif: true, roles: ['valideur', 'administrateurs'], adresses: [] } } }, 'a@interne.test');
    await modifierReglagesNotifications({ regle: { evenement: 'heures_a_valider', regle: null } }, 'a@interne.test');
});
