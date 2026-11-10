// Rentabilité d'une affaire de bout en bout (émulateur) : budget du devis, commandes validées et facturées par le
// fournisseur, heures saisies, factures émises → prévu / engagé / réel / facturé ; liste des affaires : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { ajouterFactureFournisseur, deciderCommande, saveCommande, saveFournisseur, soumettreCommande } from '../src/services/commandes-admin';
import { saveHeures } from '../src/services/heures-admin';
import { rentabiliteAffaire, rentabiliteAffaires } from '../src/services/rentabilite-admin';
import { suiviVentes } from '../src/services/analytique-admin';
import type { SessionUser } from '../src/lib/auth/server';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const u = (id: string, name: string): SessionUser => ({ uid: id, email: `${id}@v.fr`, isAdmin: false, isContratheque: false, isAcheteur: false, profile: { id, name, email: `${id}@v.fr` } as never });
const tech = u('rt-tech', 'Technicien'), chef = u('rt-chef', 'Chef');
const budget = { vente: 10000, cout: 7000, parNature: { FOURNITURE: 3000, MAIN_OEUVRE: 2000, SOUS_TRAITANCE: 1500, DIVERS: 500 }, heures: 50, marge: 3000, tauxMarge: 0.3 };
const A = { type: 'affaire' as const, projectId: 'rt-aff' };

before(async () => {
    await set('companies', 'rt-co', { code: 'RTB', name: 'Société rentabilité', quoteLaborCost: 40 });
    await set('agencies', 'rt-ag', { name: 'Lyon', code: 'LYO', companyId: 'rt-co' });
    await set('sectors', 'rt-se', { name: 'Nord', code: 'LN', agencyId: 'rt-ag' });
    await set('clients', 'rt-cli', { name: 'Client', externalCode: 'CLI-08001', companyId: 'rt-co', agencyId: 'rt-ag', sectorId: 'rt-se' });
    const projet = { companyId: 'rt-co', clientId: 'rt-cli', clientName: 'Client', title: 'Rénovation', status: 'en_cours', mode: 'P5', billing: 'direct', lines: [], quoteId: 'q', totalHT: 10000 };
    await set('projects', 'rt-aff', { ...projet, code: 'RTB-AFF2026-0001', budget });
    await set('projects', 'rt-vide', { ...projet, code: 'RTB-AFF2026-0002', billing: 'situations', budget });
    await set('users', 'rt-tech', { name: 'Technicien', email: 'rt-tech@v.fr', managerId: 'rt-chef' });
    await set('users', 'rt-chef', { name: 'Chef', email: 'rt-chef@v.fr' });
    // Factures de l'affaire : une émise, une annulée, une proforma ; sur l'autre affaire (par situations), une facture hors situation.
    await set('invoices', 'rt-f1', { projectId: 'rt-aff', status: 'due', subtotal: 3000 });
    await set('invoices', 'rt-f2', { projectId: 'rt-aff', status: 'cancelled', subtotal: 999 });
    await set('invoices', 'rt-f3', { projectId: 'rt-aff', status: 'proforma', subtotal: 999 });
    await set('invoices', 'rt-f4', { projectId: 'rt-vide', status: 'due', subtotal: 500 });
    await set('invoices', 'rt-f5', { projectId: 'rt-vide', status: 'due', subtotal: 2000, situation: { index: 1 } });
});

test('affaire : commandes validées (engagé), facture fournisseur (réel), commande à valider, heures, facturé', async () => {
    const frn = (await saveFournisseur({ name: 'Fournisseur rentabilité' }, 'a@v.fr')).id;
    const cmd = async (lines: { label: string; quantity: number; unitPrice: number; nature: 'FOURNITURE' | 'SOUS_TRAITANCE' | 'DIVERS'; cible: typeof A }[]) =>
        soumettreCommande((await saveCommande({ companyId: 'rt-co', supplierId: frn, title: 'Achat', date: '2026-01-10', lines }, tech)).id, tech);
    const c1 = await cmd([{ label: 'Chaudière', quantity: 1, unitPrice: 3400, nature: 'FOURNITURE', cible: A }]);   // N+1
    await deciderCommande(c1.id, 'validee', '', chef);
    await ajouterFactureFournisseur(c1.id, { numero: 'F1', date: '2026-01-20', montantHT: 3380 }, tech);
    await cmd([{ label: 'Benne', quantity: 1, unitPrice: 120, nature: 'DIVERS', cible: A }]);                         // autovalidée
    await cmd([{ label: 'Fumisterie', quantity: 1, unitPrice: 1400, nature: 'SOUS_TRAITANCE', cible: A }]);           // à valider
    await saveCommande({ companyId: 'rt-co', supplierId: frn, title: 'Brouillon', date: '2026-01-10', lines: [{ label: 'x', quantity: 1, unitPrice: 9000, nature: 'FOURNITURE', cible: A }] }, tech);
    await saveHeures({ date: '2026-01-12', hours: 8, cible: A }, tech);
    await saveHeures({ date: '2026-01-13', hours: 7.5, cible: A }, tech);

    const { rentabilite: r, commandes, heures } = await rentabiliteAffaire('rt-aff');
    assert.deepEqual(r.lignes.map(l => [l.nature, l.prevu, l.engage, l.reel, l.enValidation, l.depassement]), [
        ['FOURNITURE', 3000, 3400, 3380, 0, true], ['MAIN_OEUVRE', 2000, 620, 620, 0, false], ['SOUS_TRAITANCE', 1500, 0, 0, 1400, false], ['DIVERS', 500, 120, 0, 0, false]]);
    assert.deepEqual([r.facture, r.resteAFacturer, r.heuresReelles, r.coutATerminaison, r.margeATerminaison, r.ecartMarge, r.resultatADate], [3000, 7000, 15.5, 7400, 2600, -400, -1000]);
    assert.equal(r.alertes.length, 1);
    assert.deepEqual(commandes.map(c => [c.title, c.status, c.montant, c.reel, c.engagee]), [['Achat', 'validee', 3400, 3380, true], ['Achat', 'validee', 120, 0, true], ['Achat', 'a_valider', 1400, 0, false]]);
    assert.deepEqual(heures, [{ userName: 'Technicien', heures: 15.5, cout: 620, du: '2026-01-12', au: '2026-01-13' }]);
    await assert.rejects(rentabiliteAffaire('inconnue'), /introuvable/);
});

test('liste : résumé de chaque affaire ; par situations, seules les factures de situation comptent', async () => {
    const l = await rentabiliteAffaires();
    assert.deepEqual([l['rt-aff'].engage, l['rt-aff'].reel, l['rt-aff'].enValidation, l['rt-aff'].facture, l['rt-aff'].margeATerminaison, l['rt-aff'].alertes.length], [4140, 4000, 1400, 3000, 2600, 1]);
    assert.deepEqual([l['rt-vide'].engage, l['rt-vide'].facture, l['rt-vide'].margePrevue, l['rt-vide'].margeATerminaison, l['rt-vide'].alertes], [0, 2000, 3000, 3000, []]);
});

test('suivi analytique : achats de la période = lignes des commandes engagées et heures, avec le code de l\'affaire', async () => {
    const s = await suiviVentes('2026-01-01', '2026-01-31');
    const miens = s.achats.filter(l => l.analytique?.axes.projectId === 'rt-aff');
    assert.deepEqual(miens.map(l => [l.document.replace(/\d{4}$/, 'n'), l.montant, l.analytique!.code]).sort(), [
        ['Heures — Technicien', 300, 'RTB-LYO-LN-CLI08001-AFF20260001'], ['Heures — Technicien', 320, 'RTB-LYO-LN-CLI08001-AFF20260001'],
        ['RTB-CMD2026-n', 120, 'RTB-LYO-LN-CLI08001-AFF20260001'], ['RTB-CMD2026-n', 3400, 'RTB-LYO-LN-CLI08001-AFF20260001']]);   // ni la commande à valider, ni le brouillon
    assert.ok(s.totalAchats >= 4140);
    assert.equal((await suiviVentes('2026-02-01', '2026-02-28')).achats.filter(l => l.analytique?.axes.projectId === 'rt-aff').length, 0);
});
