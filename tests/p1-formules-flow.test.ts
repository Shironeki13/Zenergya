// Formules de révision P1 et barèmes : service, aperçu des prix, imports (émulateur) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { addP1Formule, addP1FormuleVersion, addP1Poste, addP1Version, getP1Site, previewPrixP1 } from '../src/services/p1-admin';
import { applyImport, planImport } from '../src/services/imports-admin';
import { parseTermes, type FormuleVersion } from '../src/lib/p1/formules';
import type { P1ContractDoc } from '../src/lib/p1/stockage';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const SITE = { scope: 'site' as const, id: 'fm-s' };
const origine = (valeur: unknown) => ({ valeur, dateEffet: null, motif: 'contrat d\'origine' });
const version = (patch: Partial<FormuleVersion> = {}): FormuleVersion => ({
    forme: 'A', mode: 'standard', baseEnergetique: 'PCS', unitePrix: 'EUR/MWh', dateM0: '2025-01', m0Manquante: null,
    regimeKmol: 'variable', prixMoleculeNegocie: null, prixFixe: false, periodicite: 'mensuel',
    termes: parseTermes('p0=0,15 ; Kmol=0,6*PEGFM@20 ; TVD=0,25*ATRDFM@4') as never, ...patch,
});

before(async () => {
    await set('weatherStations', 'fm-ws', { code: 'LILLE-FM', name: 'Lille', isActive: true });
    await set('indices', 'fm-peg', { code: 'PEGFM', label: 'PEG', unit: '', active: true });
    await set('indices', 'fm-atrd', { code: 'ATRDFM', label: 'ATRD', unit: '', active: true });
    for (const [period, peg, atrd] of [['2025-01', 20, 4], ['2025-02', 22, 4], ['2025-03', 25, 5]] as const) {
        await set('indexValues', `fm-peg-${period}`, { indexId: 'fm-peg', period, value: peg });
        await set('indexValues', `fm-atrd-${period}`, { indexId: 'fm-atrd', period, value: atrd });
    }
    await set('contracts', 'fm-k', { contractNumber: 'CTN-03301', clientId: 'x', siteIds: ['fm-s'] });
    await set('sites', 'fm-s', { code: 'SIT-03301', name: 'Chaufferie formules', clientId: 'x', contractId: 'fm-k' });
    await set('meters', 'fm-m', { code: 'CPT-03301', siteId: 'fm-s', name: 'Gaz', unit: 'MWh' });
});

test('formule refusée si fausse ; site calculable une fois formule, barème et paramètres saisis ; aperçu des prix', async () => {
    const id = await addP1Formule('fm-k', { nom: 'Gaz contrat', usage: 'chauffage', perimetre: { type: 'contrat' } }, 'a@v.fr');
    await assert.rejects(addP1FormuleVersion('fm-k', id, version({ termes: parseTermes('p0=0,2 ; Kmol=0,6*PEGFM@20') as never }), { dateEffet: null, motif: 'x' }, 'a@v.fr'), /80 % au lieu de 100 %/);
    await addP1FormuleVersion('fm-k', id, version(), { dateEffet: null, motif: 'marché d\'origine' }, 'a@v.fr');
    await assert.rejects(addP1Formule('fm-k', { nom: 'gaz CONTRAT', usage: 'chauffage', perimetre: { type: 'contrat' } }, 'a@v.fr'), /existe déjà/);

    await addP1Version(SITE, 'typeMarche', origine('MCI'), 'a@v.fr');
    await addP1Version(SITE, 'periodeReference', origine('saison_de_chauffe'), 'a@v.fr');
    await addP1Version(SITE, 'prixBase', origine(80), 'a@v.fr');
    await addP1Version(SITE, 'stationMeteo', origine('LILLE-FM'), 'a@v.fr');
    const posteId = await addP1Poste('fm-s', 'Chaufferie', 'a@v.fr');
    for (const [k, v] of [['formuleNc', 'CPT-03301'], ['cibleNb', 900], ['cibleNbUnite', 'MWh'], ['djuReference', 2300]] as const) {
        await addP1Version({ scope: 'poste', id: 'fm-s', posteId }, k, origine(v), 'a@v.fr');
    }
    let view = await getP1Site('fm-s', '2025-06-01');
    assert.deepEqual(view.reste.manque, ['Barème de partage MCI (contrat ou site)']);
    await assert.rejects(addP1Version({ scope: 'contract', id: 'fm-k' }, 'bareme:MCI', origine('économie 0-10 % 50 % ; économie 20-100 % 70 %'), 'a@v.fr'), /trou ou chevauchement/);
    await addP1Version({ scope: 'contract', id: 'fm-k' }, 'bareme:MCI', origine('économie 0-10 % 50 % ; économie 10-100 % 70 %'), 'a@v.fr');
    view = await getP1Site('fm-s', '2025-06-01');
    assert.deepEqual([view.reste.manque, view.reste.calculable], [[], true]);
    assert.deepEqual(view.reste.alertes, ['Barème MCI : aucune tranche pour le sens dépassement : partage nul (100 % exploitant)']);

    // Prix : 80 × coefficient du mois ; avril reporte mars (provisoire).
    const preview = await previewPrixP1('fm-s', 'chauffage', '2025-01');
    const byMonth = Object.fromEntries(preview.mois.map(m => [m.mois, m.retenu]));
    assert.equal((byMonth['2025-01'] as { prix: number }).prix, 80);
    assert.equal(+(byMonth['2025-03'] as { prix: number }).prix.toFixed(6), 97);   // 80 × 1,2125
    assert.equal((byMonth['2025-04'] as { provisoire: boolean }).provisoire, true);
    assert.equal(preview.formule, 'Gaz contrat');

    // Erreur M0 (base ≠ publication du mois M0) : le site redevient non calculable.
    await addP1FormuleVersion('fm-k', id, version({ termes: parseTermes('p0=0,15 ; Kmol=0,6*PEGFM@21 ; TVD=0,25*ATRDFM@4') as never }), { dateEffet: '2025-06-01', motif: 'avenant' }, 'a@v.fr');
    view = await getP1Site('fm-s', '2025-07-01');
    assert.match(view.reste.manque[0], /Formule « Gaz contrat » à corriger : coefficient de 0\.971429 au mois M0/);
});

test('imports : barème dans le paramétrage P1, formules (création, inchangée, conflit)', async () => {
    const p1 = await applyImport('p1', [
        ['Élément', 'Paramètre', 'Valeur', 'Motif'],
        ['SIT-03301', 'Barème de partage MCI (site)', 'économie 0-100 % 40 % ; dépassement 0-100 % 20 %', 'avenant site'],
        ['CTN-03301', 'Barème de partage MCI (contrat)', 'économie 0-100 % 99 %', 'x'],
    ], { by: 'import@v.fr' });
    assert.deepEqual([p1.created, p1.errors.length], [1, 1]);
    assert.match(p1.errors[0].messages[0], /autre valeur est déjà en vigueur/);

    const HEADER = ['Contrat', 'Formule', 'Usage', 'Périmètre', 'Motif', 'Forme', 'Périodicité de révision', 'Termes', 'Mois M0'];
    const table = [HEADER,
        ['CTN-03301', 'ECS bois', 'ECS', 'énergies : bois', 'origine', 'B', 'annuel temps', 'p0=1@10 ; Kmol=1*PEGFM@20', '01/2025'],
        ['CTN-03301', 'Gaz contrat', '', '', 'marché d\'origine', 'A', 'mensuel', 'p0=0,15 ; Kmol=0,6*PEGFM@20 ; TVD=0,25*ATRDFM@4', '2025-01-01 00:00'],
        ['CTN-03301', 'Gaz contrat', '', '', 'reprise', 'A', 'mensuel', 'p0=0,4 ; Kmol=0,6*PEGFM@20', '2025-01'],
        ['CTN-03301', 'Nouvelle', '', '', 'x', 'A', 'mensuel', 'p0=1', '2025-01'],
        ['CTN-03301', 'Fausse', 'Chauffage', 'contrat', 'x', 'A', 'mensuel', 'Kmol=0,6*INCONNU@20', '2025-01'],
    ];
    const plan = await planImport('p1formules', table);
    assert.deepEqual(plan.items.map(i => i.action), ['create', 'unchanged', 'error', 'error', 'error']);
    assert.match(plan.items[2].messages.join(), /Même formule et même date d'effet que la ligne 3/);
    assert.match(plan.items[3].messages.join(), /Usage obligatoire pour créer la formule/);
    assert.match(plan.items[4].messages.join(), /indice « INCONNU » inconnu/);
    const report = await applyImport('p1formules', table, { by: 'import@v.fr' });
    assert.equal(report.created, 1);
    const doc = (await adminDb.collection('p1Parametrage').doc('contract:fm-k').get()).data() as P1ContractDoc;
    const ecs = Object.values(doc.formules!).find(f => f.nom === 'ECS bois')!;
    assert.deepEqual([ecs.usage, ecs.perimetre, ecs.versions[0].valeur.forme, ecs.versions[0].valeur.dateM0, ecs.versions[0].saisiPar], ['ecs', { type: 'energies', energies: ['bois'] }, 'B', '2025-01', 'import@v.fr']);
});
