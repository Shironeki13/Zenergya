// Paramétrage P1 daté : service, reste à faire, import des versions (émulateur) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { addP1Poste, addP1Version, getP1Site, retireP1Version } from '../src/services/p1-admin';
import { applyImport, planImport } from '../src/services/imports-admin';
import type { P1SiteDoc } from '../src/lib/p1/stockage';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const HEADER = ['Élément', 'Poste', 'Paramètre', 'Valeur', "Date d'effet", 'Motif'];

before(async () => {
    await set('weatherStations', 'p1-ws', { code: 'NANTES-P1', name: 'Nantes', isActive: true });
    await set('contracts', 'p1-k', { contractNumber: 'CTN-04401', clientId: 'x', siteIds: ['p1-s'] });
    await set('sites', 'p1-s', { code: 'SIT-04401', name: 'Chaufferie P1', clientId: 'x', contractId: 'p1-k' });
    await set('meters', 'p1-m1', { code: 'CPT-04401', siteId: 'p1-s', name: 'Gaz', unit: 'm3' });
    await set('meters', 'p1-m2', { code: 'CPT-04402', siteId: 'p1-s', name: 'ECS', unit: 'm3' });
    await set('meters', 'p1-autre', { code: 'CPT-04499', siteId: 'ailleurs', name: 'Autre', unit: 'm3' });
});

test('service : versions datées, poste, retrait tracé, reste à faire selon le marché', async () => {
    await addP1Version({ scope: 'site', id: 'p1-s' }, 'typeMarche', { valeur: 'MCI', dateEffet: null, motif: 'contrat d\'origine' }, 'a@v.fr');
    await addP1Version({ scope: 'site', id: 'p1-s' }, 'typeMarche', { valeur: 'MTI', dateEffet: '2027-01-01', motif: 'avenant n°1' }, 'a@v.fr');
    await assert.rejects(addP1Version({ scope: 'site', id: 'p1-s' }, 'typeMarche', { valeur: 'MC', dateEffet: null, motif: 'x' }, 'a@v.fr'), /existe déjà comme valeur d'origine/);
    await assert.rejects(addP1Version({ scope: 'site', id: 'p1-s' }, 'stationMeteo', { valeur: 'INCONNUE', dateEffet: null, motif: 'x' }, 'a@v.fr'), /Station météo « INCONNUE » inconnue/);
    const posteId = await addP1Poste('p1-s', 'Chaufferie gaz', 'a@v.fr');
    await assert.rejects(addP1Poste('p1-s', 'chaufferie GAZ', 'a@v.fr'), /existe déjà/);
    await assert.rejects(addP1Version({ scope: 'poste', id: 'p1-s', posteId }, 'formuleNc', { valeur: 'CPT-04401 + CPT-04499', dateEffet: null, motif: 'x' }, 'a@v.fr'), /absent\(s\) du site : CPT-04499/);
    await addP1Version({ scope: 'poste', id: 'p1-s', posteId }, 'formuleNc', { valeur: 'CPT-04401 - CPT-04402', dateEffet: null, motif: 'plan de comptage' }, 'a@v.fr');

    const view = await getP1Site('p1-s', '2026-06-01');
    assert.equal(view.reste.typeMarche, 'MCI');
    assert.deepEqual(view.reste.manque, [
        'Période de référence', 'Prix de base chauffage', 'Formule de révision du prix (prestation P1)',
        'Coefficient QE du compteur CPT-04401', 'Coefficient QE du compteur CPT-04402', 'Station météo',
        'Cible NB du poste « Chaufferie gaz »', 'Unité de la cible du poste « Chaufferie gaz »', 'DJU de référence du poste « Chaufferie gaz »',
    ]);
    assert.equal((await getP1Site('p1-s', '2027-02-01')).reste.typeMarche, 'MTI');

    const avenant = (view.siteDoc!.params.typeMarche).find(x => x.dateEffet === '2027-01-01')!;
    await retireP1Version({ scope: 'site', id: 'p1-s' }, 'typeMarche', avenant.id, 'avenant annulé', 'b@v.fr');
    const after = await getP1Site('p1-s', '2027-02-01');
    assert.equal(after.reste.typeMarche, 'MCI');
    const stored = after.siteDoc!.params.typeMarche.find(x => x.id === avenant.id)!;
    assert.deepEqual([stored.retirePar, stored.motifRetrait, stored.saisiPar], ['b@v.fr', 'avenant annulé', 'a@v.fr']);
});

test('import : une ligne = une version ; identique inchangée ; autre valeur à la même date refusée ; poste créé', async () => {
    const table = [HEADER,
        ['SIT-04401', '', 'Période de référence (site)', 'saison de chauffe', '', 'contrat d\'origine'],
        ['SIT-04401', '', 'Station météo (site)', 'nantes-p1', '', 'contrat d\'origine'],
        ['SIT-04401', '', 'Prix de base chauffage (site)', '78,40', '2025-07-01', 'contrat d\'origine'],
        ['SIT-04401', 'Chaufferie gaz', 'Cible NB (poste)', '850', '', 'contrat d\'origine'],
        ['SIT-04401', 'Chaufferie gaz', 'unité de la cible (poste)', 'MWh', '', 'contrat d\'origine'],
        ['SIT-04401', 'Chaufferie gaz', 'DJU de référence (poste)', '2150', '', 'contrat d\'origine'],
        ['SIT-04401', 'Chaufferie bois', 'Formule de NC (poste)', 'CPT-04402', '', 'nouveau poste'],
        ['CPT-04401', '', 'Coefficient de conversion (QE) (compteur)', '11,2', '', 'PCS fournisseur'],
        ['CPT-04402', '', 'Usage (compteur)', 'ecs', '', 'plan de comptage'],
        ['CTN-04401', '', 'Régime du compte de prestation (contrat)', 'revise', '', 'avenant'],
        ['SIT-04401', '', 'Type de marché (site)', 'MCI', '', 'reprise'],                 // identique : inchangée
        ['CPT-04401', '', 'Coefficient de conversion (QE) (compteur)', '', '', 'x'],       // valeur vide : refusée
        ['SIT-04401', '', 'Cible NB (poste)', '10', '', 'x'],                                // poste manquant
    ];
    const plan = await planImport('p1', table);
    assert.deepEqual(plan.items.map(i => i.action), ['create', 'create', 'create', 'create', 'create', 'create', 'create', 'create', 'create', 'create', 'unchanged', 'error', 'error']);
    assert.match(plan.items[11].messages.join(), /Valeur obligatoire/);
    assert.match(plan.items[12].messages[0], /Poste obligatoire/);
    const conflict = await planImport('p1', [HEADER, ['SIT-04401', '', 'Type de marché (site)', 'MC', '', 'reprise']]);
    assert.match(conflict.items[0].messages[0], /Une autre valeur est déjà en vigueur comme valeur d'origine : retirez cette version/);
    const twice = await planImport('p1', [HEADER, ['SIT-04401', '', 'Prix de base ECS (site)', '3', '', 'a'], ['SIT-04401', '', 'Prix de base ECS (site)', '4', '', 'b']]);
    assert.match(twice.items[1].messages[0], /Même paramètre et même date d'effet que la ligne 2/);
    assert.match(plan.items[6].warnings[0], /Poste « Chaufferie bois » créé/);

    const report = await applyImport('p1', table, { fileName: 'p1.csv', by: 'import@v.fr' });
    assert.deepEqual([report.created, report.unchanged, report.errors.length], [10, 1, 2]);
    const doc = (await adminDb.collection('p1Parametrage').doc('site:p1-s').get()).data() as P1SiteDoc;
    assert.equal(doc.params.stationMeteo[0].valeur, 'NANTES-P1');
    assert.deepEqual(Object.values(doc.postes).map(p => p.designation).sort(), ['Chaufferie bois', 'Chaufferie gaz']);
    assert.equal(doc.params.prixBase[0].saisiPar, 'import@v.fr');

    const view = await getP1Site('p1-s', '2026-06-01');
    assert.deepEqual(view.reste.manque, ['Formule de révision du prix (prestation P1)', 'Coefficient QE du compteur CPT-04402', 'qECS du compteur CPT-04402', 'Cible NB du poste « Chaufferie bois »',
        'Unité de la cible du poste « Chaufferie bois »', 'DJU de référence du poste « Chaufferie bois »']);
    // Réimport : tout est inchangé.
    const again = await planImport('p1', table.slice(0, 11));
    assert.ok(again.items.every(i => i.action === 'unchanged'), JSON.stringify(again.items.map(i => [i.action, i.messages])));
});
