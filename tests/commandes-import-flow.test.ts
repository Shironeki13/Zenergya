// Import de commandes de bout en bout (émulateur) : simulation, erreurs (rien n'est écrit), import en brouillon (circuit
// de validation normal) ou validée (hors circuit, achats ou administrateur), réimport sans doublon : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { deciderCommande, importerCommandes, listCommandes, saveFournisseur, soumettreCommande } from '../src/services/commandes-admin';
import type { SessionUser } from '../src/lib/auth/server';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const u = (id: string, name: string, droits: Partial<SessionUser> = {}): SessionUser => ({ uid: id, email: `${id}@v.fr`, isAdmin: false, isContratheque: false, isAcheteur: false, profile: { id, name, email: `${id}@v.fr` } as never, ...droits });
const tech = u('ci-tech', 'Technicien'), chef = u('ci-chef', 'Chef'), acheteuse = u('ci-ach', 'Acheteuse', { isAcheteur: true });
const E = ['Référence', 'Date', 'Fournisseur', 'Objet', 'Demandeur (email)', 'État', 'Désignation', 'Nature', 'Quantité', 'Prix unitaire HT', 'Affaire', 'Contrat', 'Activité'];
const miennes = async () => (await listCommandes()).filter(c => c.companyId === 'ci-co');
let codeFrn = '';

before(async () => {
    await set('companies', 'ci-co', { code: 'CIM', name: 'Société import' });
    await set('agencies', 'ci-ag', { name: 'Lyon', code: 'LYO', companyId: 'ci-co' });
    await set('sectors', 'ci-se', { name: 'Nord', code: 'LN', agencyId: 'ci-ag' });
    await set('clients', 'ci-cli', { name: 'Client import', externalCode: 'CLI-09001', companyId: 'ci-co', agencyId: 'ci-ag', sectorId: 'ci-se' });
    await set('activities', 'ci-p2', { code: 'P2', label: 'Conduite', type: 'P2' });
    await set('contracts', 'ci-ctr', { contractNumber: 'CTN-09001', clientId: 'ci-cli', clientName: 'Client import', companyId: 'ci-co', activityIds: ['ci-p2'], status: 'Actif' });
    const projet = { companyId: 'ci-co', clientId: 'ci-cli', clientName: 'Client import', title: 'Rénovation', mode: 'P5', billing: 'direct', lines: [], quoteId: 'q' };
    await set('projects', 'ci-aff', { ...projet, code: 'CIM-AFF2026-0001', status: 'en_cours' });
    await set('projects', 'ci-clos', { ...projet, code: 'CIM-AFF2026-0002', status: 'cloture' });
    await set('users', 'ci-tech', { name: 'Technicien', email: 'ci-tech@v.fr', managerId: 'ci-chef' });
    await set('users', 'ci-chef', { name: 'Chef', email: 'ci-chef@v.fr' });
    await set('users', 'ci-ach', { name: 'Acheteuse', email: 'ci-ach@v.fr' });
    codeFrn = (await saveFournisseur({ name: 'Négoce Import' }, 'a@v.fr')).code;
});

test('simulation et erreurs : rien n\'est écrit tant qu\'une commande est en erreur', async () => {
    const table = [E,
        ['BC-1', '2026-01-10', codeFrn, 'Chaudière', 'ci-tech@v.fr', 'validée', 'Chaudière', 'Fournitures', '1', '8000', 'cim-aff2026-0001', '', ''],
        ['BC-1', '', '', '', '', '', 'Pose', 'Sous-traitance', '1', '1500,50', 'CIM-AFF2026-0001', '', ''],
        ['BC-2', '2026-01-11', 'négoce import', 'Pièces', '', '', 'Gicleurs', 'Fournitures', '4', '86', '', 'CTN-09001', 'P2'],
        ['BC-3', '2026-01-11', 'Inconnu SA', 'X', 'personne@v.fr', '', 'x', 'Divers', '1', '10', 'CIM-AFF2026-9999', '', ''],
        ['BC-4', '2026-01-11', codeFrn, 'Sur affaire close', '', '', 'x', 'Divers', '1', '10', 'CIM-AFF2026-0002', '', ''],
        ['BC-5', '2026-01-11', codeFrn, 'Mauvaise activité', '', '', 'x', 'Divers', '1', '10', '', 'CTN-09001', 'P9'],
    ];
    const s = await importerCommandes(table, 'ci-co', acheteuse);
    assert.deepEqual(s.commandes.map(c => [c.reference, c.etat, c.resultat, c.lignes, c.totalHT]), [
        ['BC-1', 'a_creer', 'validee', 2, 9500.5], ['BC-2', 'a_creer', 'brouillon', 1, 344], ['BC-3', 'erreur', null, 1, 10], ['BC-4', 'erreur', null, 1, 10], ['BC-5', 'erreur', null, 1, 10]]);
    assert.deepEqual([s.applique, s.aCreer, s.erreurs, s.totalHT, s.commandes[1].demandeur, s.commandes[0].fournisseur], [false, 2, 3, 9844.5, 'Acheteuse', 'Négoce Import']);
    assert.match(s.commandes.filter(c => c.etat === 'erreur').map(c => c.messages.join(' ; ')).join(' | '), /demandeur inconnu.*fournisseur inconnu : Inconnu SA.*affaire inconnue.*\| .*clôturée.* \| .*activité P9 absente/);
    await assert.rejects(importerCommandes(table, 'ci-co', acheteuse, true), /3 commande\(s\) en erreur : rien n'a été importé/);
    assert.equal((await miennes()).length, 0);
    // Un technicien n'importe ni pour un autre, ni une commande déjà validée.
    const t = await importerCommandes([E, table[1], ['BC-9', '2026-01-10', codeFrn, 'Autre', 'ci-chef@v.fr', '', 'x', 'Divers', '1', '10', 'CIM-AFF2026-0001', '', '']], 'ci-co', tech);
    assert.match(t.commandes[0].messages.join(), /état « validée » : réservé/);
    assert.match(t.commandes[1].messages.join(), /autre demandeur/);
    await assert.rejects(importerCommandes([['Référence']], 'ci-co', tech), /Colonne\(s\) manquante\(s\)/);
});

test('import : « validée » entre validée sans circuit, « brouillon » suit le circuit ; réimport sans doublon', async () => {
    const table = [E,
        ['BC-1', '2026-01-10', codeFrn, 'Chaudière', 'ci-tech@v.fr', 'validée', 'Chaudière', 'Fournitures', '1', '8000', 'CIM-AFF2026-0001', '', ''],
        ['BC-1', '', '', '', '', '', 'Pose', 'Sous-traitance', '1', '1500,50', 'CIM-AFF2026-0001', '', ''],
        ['BC-2', '2026-01-11', codeFrn, 'Pièces', 'ci-tech@v.fr', '', 'Gicleurs', 'Fournitures', '10', '86', '', 'CTN-09001', 'P2'],
    ];
    const r = await importerCommandes(table, 'ci-co', acheteuse, true);
    assert.deepEqual([r.applique, r.aCreer, r.doublons, r.erreurs], [true, 2, 0, 0]);
    const [validee, brouillon] = (await miennes()).sort((a, b) => a.externalRef!.localeCompare(b.externalRef!));
    assert.match(validee.number!, /^CIM-CMD2026-\d{4}$/);
    assert.deepEqual([validee.status, validee.importee, validee.autoValidee, validee.etapes, validee.requesterId, validee.importedBy, validee.totalHT, validee.lines.length], ['validee', true, false, [], 'ci-tech', 'ci-ach@v.fr', 9500.5, 2]);
    assert.deepEqual(validee.lines.map(l => [l.nature, l.analytique!.code]), [['FOURNITURE', 'CIM-LYO-LN-CLI09001-AFF20260001'], ['SOUS_TRAITANCE', 'CIM-LYO-LN-CLI09001-AFF20260001']]);
    assert.deepEqual([brouillon.status, brouillon.number, brouillon.requesterId, brouillon.totalHT, brouillon.externalRef], ['brouillon', undefined, 'ci-tech', 860, 'BC-2']);
    // Le brouillon importé suit le circuit : soumis par son demandeur, validé par son N+1.
    const soumise = await soumettreCommande(brouillon.id, tech);
    assert.deepEqual([soumise.status, soumise.etapes.map(e => e.approverId), soumise.lines[0].analytique!.code], ['a_valider', ['ci-chef'], 'CIM-LYO-LN-CLI09001-CTN09001-P2']);
    assert.equal((await deciderCommande(brouillon.id, 'validee', '', chef)).status, 'validee');
    // Réimport du même fichier, avec une nouvelle commande.
    const encore = await importerCommandes([...table, ['BC-6', '2026-01-12', codeFrn, 'Benne', 'ci-tech@v.fr', '', 'Benne', 'Divers', '1', '120', 'CIM-AFF2026-0001', '', '']], 'ci-co', acheteuse, true);
    assert.deepEqual([encore.aCreer, encore.doublons, encore.commandes.map(c => c.etat)], [1, 2, ['doublon', 'doublon', 'a_creer']]);
    assert.equal((await miennes()).length, 3);
});
