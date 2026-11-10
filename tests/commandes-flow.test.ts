// Commandes d'achat de bout en bout (émulateur) : fournisseurs, seuils, soumission (numéro, analytique figée), circuit
// de validation N+1 / N+2 / achats, réception, facture fournisseur, annulation, engagé d'une affaire : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import {
    ajouterFactureFournisseur, annulerCommande, avancerCommande, deciderCommande, listCommandes, saveCommande, saveFournisseur, setSeuils, seuilsDe, soumettreCommande,
} from '../src/services/commandes-admin';
import { engagements } from '../src/lib/commandes';
import type { SessionUser } from '../src/lib/auth/server';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const u = (id: string, name: string, droits: Partial<SessionUser> = {}): SessionUser => ({ uid: id, email: `${id}@v.fr`, isAdmin: false, isContratheque: false, isAcheteur: false, profile: { id, name, email: `${id}@v.fr` } as never, ...droits });
const tech = u('cm-tech', 'Technicien'), chef = u('cm-chef', 'Chef'), dir = u('cm-dir', 'Directrice'), acheteuse = u('cm-ach', 'Acheteuse', { isAcheteur: true }), admin = u('cm-adm', 'Admin', { isAdmin: true });
let frn = '';
const ligne = (label: string, quantity: number, unitPrice: number, nature: 'FOURNITURE' | 'SOUS_TRAITANCE' | 'DIVERS' = 'FOURNITURE') => ({ label, quantity, unitPrice, nature, cible: { type: 'affaire' as const, projectId: 'cm-aff' } });
const brouillon = (lines: ReturnType<typeof ligne>[], par = tech) => saveCommande({ companyId: 'cm-co', supplierId: frn, title: 'Matériel chaufferie', date: '2026-11-10', lines }, par);

before(async () => {
    await set('companies', 'cm-co', { code: 'CMD', name: 'Société commandes' });
    await set('agencies', 'cm-ag', { name: 'Lyon', code: 'LYO', companyId: 'cm-co' });
    await set('sectors', 'cm-se', { name: 'Nord', code: 'LN', agencyId: 'cm-ag' });
    await set('clients', 'cm-cli', { name: 'Client commandes', externalCode: 'CLI-06001', companyId: 'cm-co', agencyId: 'cm-ag', sectorId: 'cm-se' });
    await set('projects', 'cm-aff', { code: 'CMD-AFF2026-0001', companyId: 'cm-co', clientId: 'cm-cli', clientName: 'Client commandes', title: 'Rénovation', status: 'en_cours', mode: 'P5', billing: 'direct', lines: [], quoteId: 'q' });
    await set('users', 'cm-tech', { name: 'Technicien', email: 'cm-tech@v.fr', managerId: 'cm-chef' });
    await set('users', 'cm-chef', { name: 'Chef', email: 'cm-chef@v.fr', managerId: 'cm-dir' });
    await set('users', 'cm-dir', { name: 'Directrice', email: 'cm-dir@v.fr' });
    await set('users', 'cm-ach', { name: 'Acheteuse', email: 'cm-ach@v.fr' });
    await setSeuils('cm-co', { auto: 500, n2: 5000, achats: 10000 });
});

test('fournisseurs : code attribué, doublon refusé ; seuils de la société', async () => {
    const f = await saveFournisseur({ name: 'Chauffage Pro', siret: '732 829 320 00074' }, 'a@v.fr');
    frn = f.id;
    assert.match(f.code, /^FRN-\d{5}$/);
    await assert.rejects(saveFournisseur({ name: 'chauffage pro' }, 'a@v.fr'), /déjà enregistré/);
    await assert.rejects(saveFournisseur({ name: 'X', siret: '123' }, 'a@v.fr'), /14 chiffres/);
    assert.deepEqual(await seuilsDe('cm-co'), { auto: 500, n2: 5000, achats: 10000 });
    await assert.rejects(setSeuils('cm-co', { auto: 1000, n2: 10, achats: 0 }), /N\+2/);
});

test('sous le seuil : autovalidée à la soumission, numéro, analytique de l\'affaire figée sur la ligne ; contrôles de saisie', async () => {
    await assert.rejects(brouillon([]), /Au moins une ligne/);
    await assert.rejects(saveCommande({ companyId: 'cm-co', supplierId: frn, title: 'x', date: '2026-11-10', lines: [{ label: 'a', quantity: 1, unitPrice: 1, nature: 'FOURNITURE', cible: { type: 'affaire', projectId: '' } }] }, tech), /affectation analytique/);
    const c = await brouillon([ligne('Vanne', 2, 120.5)]);
    assert.deepEqual([c.status, c.totalHT, c.number], ['brouillon', 241, undefined]);
    await assert.rejects(soumettreCommande(c.id, chef), /Seul le demandeur/);
    const s = await soumettreCommande(c.id, tech);
    assert.match(s.number!, /^CMD-CMD2026-\d{4}$/);
    assert.deepEqual([s.status, s.autoValidee, s.etapes], ['validee', true, []]);
    assert.deepEqual([s.lines[0].analytique!.code, s.lines[0].analytique!.axes.affaire, s.lines[0].cible.libelle], ['CMD-LYO-LN-CLI06001-AFF20260001', 'AFF20260001', 'CMD-AFF2026-0001 — Rénovation']);
    await assert.rejects(saveCommande({ id: c.id, companyId: 'cm-co', supplierId: frn, title: 'x', date: '2026-11-10', lines: [ligne('a', 1, 1)] }, tech), /plus modifiable/);
});

test('circuit complet au-dessus du seuil achats : N+1, N+2, achats dans l\'ordre ; ni soi-même, ni dans le désordre', async () => {
    const c = await soumettreCommande((await brouillon([ligne('Chaudière', 1, 12000), ligne('Pose sous-traitée', 1, 3000, 'SOUS_TRAITANCE')])).id, tech);
    assert.deepEqual([c.status, c.etapes.map(e => [e.role, e.approverId ?? null])], ['a_valider', [['n1', 'cm-chef'], ['n2', 'cm-dir'], ['achats', null]]]);
    await assert.rejects(deciderCommande(c.id, 'validee', '', tech), /propre commande/);
    await assert.rejects(deciderCommande(c.id, 'validee', '', dir), /à valider par Chef/);
    await assert.rejects(deciderCommande(c.id, 'validee', '', acheteuse), /à valider par Chef/);
    assert.equal((await deciderCommande(c.id, 'validee', '', chef)).status, 'a_valider');
    assert.equal((await deciderCommande(c.id, 'validee', 'ok budget', dir)).status, 'a_valider');
    await assert.rejects(deciderCommande(c.id, 'validee', '', chef), /réservée aux achats/);
    const v = await deciderCommande(c.id, 'validee', '', acheteuse);
    assert.deepEqual([v.status, v.etapes.map(e => e.decision), !!v.validatedAt], ['validee', ['validee', 'validee', 'validee'], true]);
    // Suite : passée, reçue, facture fournisseur (réel), soldée.
    assert.equal((await avancerCommande(c.id, tech)).status, 'passee');
    assert.equal((await avancerCommande(c.id, tech)).status, 'recue');
    await assert.rejects(avancerCommande(c.id, tech), /Aucune étape suivante/);
    const f = await ajouterFactureFournisseur(c.id, { numero: 'FA-778', date: '2026-12-01', montantHT: 14500, solder: true }, acheteuse);
    assert.deepEqual([f.status, f.factures!.length], ['soldee', 1]);
    await assert.rejects(annulerCommande(c.id, 'x', tech), /ne s'annule plus/);
});

test('refus (motif obligatoire) puis correction et nouvelle soumission ; administrateur en secours ; annulation', async () => {
    const c = await soumettreCommande((await brouillon([ligne('Pompe', 1, 900)])).id, tech);
    await assert.rejects(deciderCommande(c.id, 'refusee', ' ', chef), /Motif du refus/);
    const r = await deciderCommande(c.id, 'refusee', 'Devis comparatif manquant', chef);
    assert.deepEqual([r.status, r.etapes[0].commentaire], ['refusee', 'Devis comparatif manquant']);
    // Refusée : modifiable, redevient brouillon, garde son numéro à la nouvelle soumission.
    const corrigee = await saveCommande({ id: c.id, companyId: 'cm-co', supplierId: frn, title: 'Pompe (devis joint)', date: '2026-11-11', lines: [ligne('Pompe', 1, 850)] }, tech);
    assert.equal(corrigee.status, 'brouillon');
    const s2 = await soumettreCommande(c.id, tech);
    assert.deepEqual([s2.number, s2.status], [c.number, 'a_valider']);
    const v = await deciderCommande(c.id, 'validee', '', admin);
    assert.deepEqual([v.status, v.etapes[0].secours, v.etapes[0].decidePar], ['validee', true, 'cm-adm']);
    await assert.rejects(annulerCommande(c.id, ' ', tech), /Motif/);
    assert.equal((await annulerCommande(c.id, 'Chantier reporté', tech)).status, 'annulee');
});

test('responsable manquant : soumission refusée ; engagé, réel et en validation de l\'affaire', async () => {
    const sansChef = await brouillon([ligne('Outillage', 1, 2000, 'DIVERS')], dir);
    await assert.rejects(soumettreCommande(sansChef.id, dir), /Responsable \(N\+1\) de Directrice non renseigné/);
    const enAttente = await soumettreCommande((await brouillon([ligne('Régulation', 1, 1800)])).id, tech);
    assert.equal(enAttente.status, 'a_valider');
    const e = engagements(await listCommandes(), l => l.cible.type === 'affaire' && l.cible.projectId === 'cm-aff');
    // Validées : 241 (auto) + 15 000 (soldée, facturée 14 500) ; annulée et brouillon exclus ; 1 800 en validation.
    assert.deepEqual(e.total, { engage: 15241, reel: 14500, enValidation: 1800 });
    assert.deepEqual([e.FOURNITURE.engage, e.SOUS_TRAITANCE.engage, e.SOUS_TRAITANCE.reel], [12241, 3000, 2900]);
});
