// Heures de bout en bout (émulateur) : saisie par le technicien, par son responsable, coût horaire et analytique figés,
// plafond de la journée, affaire clôturée, import (simulation, erreurs, doublons) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { deleteHeures, importerHeures, listHeures, saveHeures } from '../src/services/heures-admin';
import { totalHeures } from '../src/lib/heures';
import type { SessionUser } from '../src/lib/auth/server';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const u = (id: string, name: string, droits: Partial<SessionUser> = {}): SessionUser => ({ uid: id, email: `${id}@v.fr`, isAdmin: false, isContratheque: false, isAcheteur: false, profile: { id, name, email: `${id}@v.fr` } as never, ...droits });
const tech = u('hr-tech', 'Technicien'), tech2 = u('hr-tech2', 'Technicienne'), chef = u('hr-chef', 'Chef'), autre = u('hr-autre', 'Autre'), admin = u('hr-adm', 'Admin', { isAdmin: true });
const AFF = { type: 'affaire' as const, projectId: 'hr-aff' };
const JOUR = '2026-01-12';

before(async () => {
    await set('companies', 'hr-co', { code: 'HRS', name: 'Société heures', quoteLaborCost: 42 });
    await set('agencies', 'hr-ag', { name: 'Lyon', code: 'LYO', companyId: 'hr-co' });
    await set('sectors', 'hr-se', { name: 'Nord', code: 'LN', agencyId: 'hr-ag' });
    await set('clients', 'hr-cli', { name: 'Client heures', externalCode: 'CLI-07001', companyId: 'hr-co', agencyId: 'hr-ag', sectorId: 'hr-se' });
    await set('activities', 'hr-p2', { code: 'P2', label: 'Conduite', type: 'P2' });
    await set('contracts', 'hr-ctr', { contractNumber: 'CTN-07001', clientId: 'hr-cli', clientName: 'Client heures', companyId: 'hr-co', activityIds: ['hr-p2'], status: 'Actif' });
    for (const [id, code, status] of [['hr-aff', 'HRS-AFF2026-0001', 'en_cours'], ['hr-aff2', 'HRS-AFF2026-0002', 'en_cours'], ['hr-clos', 'HRS-AFF2026-0003', 'cloture']])
        await set('projects', id, { code, companyId: 'hr-co', clientId: 'hr-cli', clientName: 'Client heures', title: 'Rénovation', status, mode: 'P5', billing: 'direct', lines: [], quoteId: 'q' });
    await set('users', 'hr-tech', { name: 'Technicien', email: 'hr-tech@v.fr', managerId: 'hr-chef' });
    await set('users', 'hr-tech2', { name: 'Technicienne', email: 'hr-tech2@v.fr', managerId: 'hr-chef', hourlyCost: 48.5 });
    await set('users', 'hr-chef', { name: 'Chef', email: 'hr-chef@v.fr' });
    await set('users', 'hr-autre', { name: 'Autre', email: 'hr-autre@v.fr' });
});

test('saisie : coût de la société ou de l\'utilisateur figé, analytique de l\'affaire ou du contrat ; contrôles', async () => {
    const s = await saveHeures({ date: JOUR, hours: 7.5, cible: AFF, comment: ' Dépose ' }, tech);
    assert.deepEqual([s.userId, s.userName, s.hours, s.rate, s.cost, s.source, s.comment, s.companyId], ['hr-tech', 'Technicien', 7.5, 42, 315, 'saisie', 'Dépose', 'hr-co']);
    assert.deepEqual([s.analytique.code, s.cible.libelle], ['HRS-LYO-LN-CLI07001-AFF20260001', 'HRS-AFF2026-0001 — Rénovation']);
    const k = await saveHeures({ date: JOUR, hours: 2, cible: { type: 'contrat', contractId: 'hr-ctr', activityCode: 'P2' } }, tech2);
    assert.deepEqual([k.rate, k.cost, k.analytique.axes.activite], [48.5, 97, 'P2']);
    await assert.rejects(saveHeures({ date: JOUR, hours: 7.4, cible: AFF }, tech), /quart d'heure/);
    await assert.rejects(saveHeures({ date: '2999-01-01', hours: 1, cible: AFF }, tech), /à l'avance/);
    await assert.rejects(saveHeures({ date: JOUR, hours: 1, cible: { type: 'contrat', contractId: 'hr-ctr' } }, tech), /Affectation obligatoire/);
    await assert.rejects(saveHeures({ date: JOUR, hours: 1, cible: { type: 'affaire', projectId: 'hr-clos' } }, tech), /clôturée/);
    await assert.rejects(saveHeures({ date: JOUR, hours: 17, cible: AFF }, tech), /Plus de 24 h/);
    // Coût horaire manquant : message qui dit où le renseigner.
    await adminDb.collection('companies').doc('hr-co').update({ quoteLaborCost: null });
    await assert.rejects(saveHeures({ date: JOUR, hours: 1, cible: AFF }, tech), /Coût horaire non renseigné/);
    await adminDb.collection('companies').doc('hr-co').update({ quoteLaborCost: 44 });
});

test('pour un autre : son responsable ou un administrateur, pas un collègue ; modification (taux gardé) et suppression', async () => {
    await assert.rejects(saveHeures({ userId: 'hr-tech', date: '2026-01-13', hours: 4, cible: AFF }, autre), /réservées/);
    const s = await saveHeures({ userId: 'hr-tech', date: '2026-01-13', hours: 4, cible: AFF }, chef);
    assert.deepEqual([s.userId, s.rate, s.createdBy], ['hr-tech', 44, 'hr-chef@v.fr']);   // nouveau taux de la société pour les nouvelles saisies
    const premiere = (await listHeures({ userId: 'hr-tech', from: JOUR, to: JOUR }))[0];
    const m = await saveHeures({ id: premiere.id, date: JOUR, hours: 8, cible: AFF }, tech);
    assert.deepEqual([m.hours, m.rate, m.cost, m.updatedBy], [8, 42, 336, 'hr-tech@v.fr']);   // même affectation : le taux figé est gardé
    const d = await saveHeures({ id: premiere.id, date: JOUR, hours: 8, cible: { type: 'affaire', projectId: 'hr-aff2' } }, admin);
    assert.deepEqual([d.rate, d.cost, d.analytique.axes.affaire], [44, 352, 'AFF20260002']);   // autre affaire : revalorisée
    await assert.rejects(deleteHeures(s.id, autre), /réservées/);
    await deleteHeures(s.id, tech);
    assert.deepEqual(totalHeures(await listHeures({ userId: 'hr-tech' })), { heures: 8, cout: 352 });
    assert.equal((await listHeures({ projectId: 'hr-aff2' })).length, 1);
});

test('import : simulation, lignes en erreur (rien n\'est écrit), puis import et réimport sans doublon', async () => {
    const entetes = ['Date', 'Technicien (email)', 'Affaire', 'Contrat', 'Activité', 'Heures', 'Commentaire'];
    const bon = [['14/01/2026', 'hr-tech@v.fr', 'hrs-aff2026-0001', '', '', '7,5', 'Pose'], ['2026-01-14', 'hr-tech2@v.fr', '', 'CTN-07001', 'p2', '3', '']];
    const mauvais = [['2026-01-15', 'inconnu@v.fr', 'HRS-AFF2026-0001', '', '', '2', ''], ['2026-01-15', 'hr-tech@v.fr', 'HRS-AFF2026-0003', '', '', '2', ''], ['2026-01-15', 'hr-tech@v.fr', '', 'CTN-07001', 'P3', '2', ''], ['2026-01-15', 'hr-tech@v.fr', 'X', '', '', '2', '']];
    const simu = await importerHeures([entetes, ...bon, ...mauvais], admin);
    assert.deepEqual([simu.applique, simu.aCreer, simu.erreurs, simu.heures, simu.cout], [false, 2, 4, 10.5, 475.5]);   // 7,5 × 44 + 3 × 48,5
    assert.match(simu.lignes.filter(l => l.etat === 'erreur').map(l => l.messages.join()).join(' | '), /utilisateur inconnu.*clôturée.*activité P3 absente.*affaire inconnue/);
    await assert.rejects(importerHeures([entetes, ...bon, ...mauvais], admin, true), /4 ligne\(s\) en erreur : rien n'a été importé/);
    assert.equal((await listHeures({ from: '2026-01-14', to: '2026-01-15' })).length, 0);
    // Le chef importe pour son équipe ; un collègue ne le peut pas.
    assert.equal((await importerHeures([entetes, ...bon], autre)).erreurs, 2);
    const r = await importerHeures([entetes, ...bon], chef, true);
    assert.deepEqual([r.applique, r.aCreer, r.doublons], [true, 2, 0]);
    const lues = await listHeures({ from: '2026-01-14', to: '2026-01-14' });
    assert.deepEqual(lues.map(s => [s.userName, s.hours, s.cost, s.source, s.analytique.code]).sort(), [['Technicien', 7.5, 330, 'import', 'HRS-LYO-LN-CLI07001-AFF20260001'], ['Technicienne', 3, 145.5, 'import', 'HRS-LYO-LN-CLI07001-CTN07001-P2']]);
    const encore = await importerHeures([entetes, ...bon, ['2026-01-14', 'hr-tech@v.fr', 'HRS-AFF2026-0002', '', '', '17', '']], admin, false);
    assert.deepEqual([encore.aCreer, encore.doublons, encore.erreurs], [0, 2, 1]);   // 7,5 + 17 > 24
});
