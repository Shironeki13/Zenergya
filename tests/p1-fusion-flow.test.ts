// Paramétrage P1 dans les imports Sites, Compteurs, Contrats ; reprise à la validation d'un contrat (émulateur) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { applyImport, planImport } from '../src/services/imports-admin';
import { getP1Contract, getP1Meter, getP1Reel } from '../src/services/p1-admin';
import { repriseP1Contrat } from '../src/services/p1-reprise-admin';
import { valeurAu, type P1ContractDoc, type P1MeterDoc, type P1SiteDoc } from '../src/lib/p1/stockage';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const p1 = async <T>(id: string) => (await adminDb.collection('p1Parametrage').doc(id).get()).data() as T;
const run = (entity: 'sites' | 'meters' | 'contracts', table: unknown[][]) => applyImport(entity, table, { fileName: 'test', by: 'adv@v.fr' });

before(async () => {
    await set('weatherStations', 'fu-st', { code: 'FU-BRON', name: 'Bron', isActive: true });
    await set('clients', 'fu-c', { name: 'Client fusion', externalCode: 'CLI-90901' });
    await set('contracts', 'fu-k', { contractNumber: 'CTN-90901', clientId: 'fu-c', clientName: 'Client fusion', siteIds: ['fu-s'], status: 'Actif', startDate: '2025-01-01', endDate: '2030-12-31' });
    await set('sites', 'fu-s', { code: 'SIT-90901', name: 'Site fusion', clientId: 'fu-c', contractId: 'fu-k', address: '1 rue' });
    await set('meters', 'fu-m', { code: 'CPT-90901', name: 'Gaz', siteId: 'fu-s', unit: 'm3' });
    await set('p1Reel', 'fu-s_2026-01', { siteId: 'fu-s', mois: '2026-01', usage: null, montantHt: 1200 });
});

test('import Sites : colonnes P1 du site et du poste ; origine, inchangé, refus sans date, nouvelle version datée', async () => {
    const entetes = ['Code site', 'P1 · Type de marché', 'P1 · Prix de base chauffage', 'Station météo', 'P1 · Poste · Formule de NC', 'P1 · Poste · Cible NB', 'P1 · Date d\'effet', 'P1 · Motif'];
    const plan = await planImport('sites', [entetes, ['SIT-90901', 'MCI', '85', 'FU-BRON', 'CPT-90901', '850', '', 'contrat d\'origine']]);
    assert.deepEqual(plan.items.map(i => [i.action, i.messages]), [['update', []]]);
    assert.match(plan.items[0].warnings.join(' '), /Paramétrage P1 : P1 · Type de marché = MCI \(origine\).*poste « Chauffage » créé/);
    await run('sites', [entetes, ['SIT-90901', 'MCI', '85', 'FU-BRON', 'CPT-90901', '850', '', 'contrat d\'origine']]);
    let doc = await p1<P1SiteDoc>('site:fu-s');
    assert.deepEqual([valeurAu(doc.params, 'typeMarche', '2026-01-01'), valeurAu(doc.params, 'prixBase', '2026-01-01'), valeurAu(doc.params, 'stationMeteo', '2026-01-01')], ['MCI', 85, 'FU-BRON']);
    const poste = Object.values(doc.postes)[0];
    assert.deepEqual([poste.designation, valeurAu(poste.params, 'cibleNb', '2026-01-01'), doc.params.prixBase[0].motif, doc.params.prixBase[0].saisiPar], ['Chauffage', 850, 'contrat d\'origine', 'adv@v.fr']);

    // Réimport identique : inchangé ; autre prix sans date : refusé ; avec date : nouvelle version.
    assert.deepEqual((await planImport('sites', [['Code site', 'P1 · Prix de base chauffage'], ['SIT-90901', '85']])).items.map(i => i.action), ['unchanged']);
    const refus = await planImport('sites', [['Code site', 'P1 · Prix de base chauffage'], ['SIT-90901', '92']]);
    assert.match(refus.items[0].messages.join(' '), /valeur différente de celle en vigueur ; indiquez « P1 · Date d'effet »/);
    await run('sites', [['Code site', 'P1 · Prix de base chauffage', 'P1 · Date d\'effet', 'P1 · Motif'], ['SIT-90901', '92', '01/07/2026', 'avenant 2']]);
    doc = await p1<P1SiteDoc>('site:fu-s');
    assert.deepEqual([valeurAu(doc.params, 'prixBase', '2026-06-30'), valeurAu(doc.params, 'prixBase', '2026-07-01')], [85, 92]);
    const conflit = await planImport('sites', [['Code site', 'P1 · Prix de base chauffage', 'P1 · Date d\'effet'], ['SIT-90901', '95', '01/07/2026']]);
    assert.match(conflit.items[0].messages.join(' '), /une autre valeur est déjà en vigueur au 01\/07\/2026/);
    const invalide = await planImport('sites', [['Code site', 'P1 · Type de marché', 'P1 · Poste · Formule de NC'], ['SIT-90901', 'XX', 'CPT-99999']]);
    assert.equal(invalide.items[0].action, 'error');
    assert.equal(invalide.items[0].messages.length, 2);
});

test('import Sites : création avec P1 ; Compteurs et Contrats : colonnes P1', async () => {
    const r = await run('sites', [['Client', 'Nom du site', 'Adresse', 'P1 · Type de marché'], ['CLI-90901', 'Site neuf', '2 rue', 'PF']]);
    assert.deepEqual(r.errors, []);
    const id = r.results[0].id;
    assert.equal(valeurAu((await p1<P1SiteDoc>(`site:${id}`)).params, 'typeMarche', '2026-01-01'), 'PF');

    const rm = await run('meters', [['Code compteur', 'P1 · Usage', 'P1 · Énergie', 'P1 · Coefficient de conversion (QE)'], ['CPT-90901', 'entrant', 'gaz', '0,01142']]);
    assert.deepEqual(rm.errors, []);
    const m = await p1<P1MeterDoc>('meter:fu-m');
    assert.deepEqual(['usage', 'energie', 'qe'].map(k => valeurAu(m.params, k, '2026-01-01')), ['entrant', 'gaz', 0.01142]);

    const rc = await run('contracts', [['N° de contrat', 'P1 · Régime du compte de prestation', 'P1 · Répartition des acomptes P1'], ['CTN-90901', 'frais_gestion', '12,5;12,5;12,5;12,5;12,5;0;0;0;0;12,5;12,5;12,5']]);
    assert.deepEqual(rc.errors, []);
    const c = await p1<P1ContractDoc>('contract:fu-k');
    assert.equal(valeurAu(c.params, 'regimeCp', '2026-01-01'), 'frais_gestion');
    assert.equal((valeurAu(c.params, 'repartitionAcomptes', '2026-01-01') as number[])[0], 12.5);

    // Lectures des écrans compteur, contrat, réel P1 du site.
    assert.equal(valeurAu((await getP1Meter('fu-m')).doc!.params, 'usage', '2026-01-01'), 'entrant');
    const vc = await getP1Contract('fu-k');
    assert.deepEqual([vc.contract.code, vc.sites.map(s => s.code)], ['CTN-90901', ['SIT-90901']]);
    assert.deepEqual((await getP1Reel('fu-s')).map(l => [l.mois, l.montantHt]), [['2026-01', 1200]]);
});

test('validation d\'un contrat : valeurs P1 de la création reprises (site, puis contrat mono-site), sans écraser', async () => {
    await set('contracts', 'fu-k2', { contractNumber: 'CTN-90902', clientId: 'fu-c', siteIds: ['fu-s2'], activitiesDetails: [{ contractualNB: 640, contractualDJU: 2100 }] });
    await set('sites', 'fu-s2', { code: 'SIT-90902', name: 'Site assistant', clientId: 'fu-c', contractId: 'fu-k2', heatingWeatherStation: 'FU-BRON', heatingReferenceDju: 2200 });
    const r = await repriseP1Contrat('fu-k2', 'chef@v.fr');
    assert.equal(r.reprises.length, 2);
    const doc = await p1<P1SiteDoc>('site:fu-s2');
    const poste = Object.values(doc.postes)[0];
    // DJU : celui du site prime ; NB : celui du contrat (mono-site).
    assert.deepEqual([valeurAu(doc.params, 'stationMeteo', '2026-01-01'), valeurAu(poste.params, 'cibleNb', '2026-01-01'), valeurAu(poste.params, 'djuReference', '2026-01-01')], ['FU-BRON', 640, 2200]);
    assert.equal(doc.params.stationMeteo[0].motif, 'création du contrat CTN-90902');
    assert.deepEqual((await repriseP1Contrat('fu-k2', 'chef@v.fr')).reprises, []);
});
