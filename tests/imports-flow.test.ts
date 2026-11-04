// Imports en masse (émulateur Firestore) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { applyImport, planImport } from '../src/services/imports-admin';
import { csvTemplate, csvToTable } from '../src/lib/imports/engine';
import { IMPORT_ENTITIES } from '../src/lib/imports/definitions';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const get = async (c: string, field: string, value: unknown) =>
    (await adminDb.collection(c).where(field, '==', value).get()).docs.map(d => ({ id: d.id, ...d.data() }) as any);

before(async () => {
    await set('companies', 'im-co', { code: 'IMP', name: 'Veolia Import' });
    await set('agencies', 'im-ag', { name: 'Lyon', companyId: 'im-co' });
    await set('agencies', 'im-ag2', { name: 'Lyon', companyId: 'autre-societe' });
    await set('sectors', 'im-se', { name: 'Lyon Est', agencyId: 'im-ag' });
    await set('typologies', 'im-ty', { name: 'Copropriété' });
    await set('meterTypes', 'im-mt', { code: 'GAZ', label: 'Gaz', unit: 'kWh' });
    await set('clients', 'im-existing', {
        name: 'Ancien nom', externalCode: 'CLI-00700', siret: '88877766100016', clientType: 'private', address: '1 rue A',
        postalCode: '69001', city: 'Lyon', typologyId: 'im-ty', companyId: 'im-co', agencyId: 'im-ag', sectorId: 'im-se', isBe: false, useChorus: false,
    });
    await set('contracts', 'im-ctr', { contractNumber: 'CTN-00900', clientId: 'im-existing', siteIds: [] });
});

const CLIENT_HEADER = ['Code client', 'Raison sociale', 'Type', 'SIRET', 'Adresse', 'Code postal', 'Ville', 'Typologie', 'Société', 'Agence', 'Secteur', 'Coefficient devis'];

test('clients : création (code CLI attribué), mise à jour par SIRET, erreurs de rattachement, réimport sans effet', async () => {
    const table = [
        CLIENT_HEADER,
        ['', 'Nouveau client', 'Privé', '88877766100008', '2 rue B', '6000', 'Nice', 'copropriete', 'IMP', 'lyon', 'Lyon Est', '1,3'],
        ['', 'Nouveau nom', '', '88877766100016', '', '', '', '', '', '', '', ''],                          // même SIRET : mise à jour
        ['', 'Mauvaise agence', 'Public', '', '3 rue C', '69002', 'Lyon', 'Copropriété', 'IMP', 'Marseille', 'X', ''],
        ['CLI-99999', 'Code inconnu', '', '', '', '', '', '', '', '', '', ''],
    ];
    const plan = await planImport('clients', table);
    assert.deepEqual(plan.items.map(i => i.action), ['create', 'update', 'error', 'error']);
    assert.ok(plan.items[1].warnings[0].includes('SIRET'));
    const err = plan.items[2].messages.join(' ');
    assert.match(err, /Agence « Marseille » inconnue/);
    assert.match(err, /SIRET obligatoire pour un client public/);
    assert.match(plan.items[3].messages[0], /inconnu/);

    const report = await applyImport('clients', table, { fileName: 'clients.csv', by: 'admin@example.com' });
    assert.deepEqual([report.created, report.updated, report.errors.length], [1, 1, 2]);
    const [created] = await get('clients', 'siret', '88877766100008');
    assert.match(created.externalCode, /^CLI-\d{5}$/);
    assert.ok(Number(created.externalCode.slice(4)) > 700, 'au-delà du plus grand code existant');
    assert.equal(created.postalCode, '06000');
    assert.equal(created.agencyId, 'im-ag');          // agence de la bonne société
    assert.equal(created.quoteCoefficient, 1.3);
    assert.equal(created.relation, 'client');
    const updated = (await adminDb.collection('clients').doc('im-existing').get()).data()!;
    assert.equal(updated.name, 'Nouveau nom');
    assert.equal(updated.city, 'Lyon');               // cellule vide : valeur conservée

    const log = (await adminDb.collection('imports').doc(report.importId).get()).data()!;
    assert.deepEqual([log.entity, log.created, log.updated, log.rejected], ['clients', 1, 1, 2]);

    // Réimport des lignes valides : rien ne change.
    const again = await planImport('clients', [CLIENT_HEADER, ['CLI-00700', 'Nouveau nom', '', '', '', '', '', '', '', '', '', '']]);
    assert.equal(again.items[0].action, 'unchanged');
});

test('sites : client par code ou SIRET, contrat du client, n° de site, codes SIT ; contrat mis à jour', async () => {
    const table = [
        ['Code site', 'Client', 'Contrat', 'Nom du site', 'N° de site', 'Adresse', 'Code postal', 'Ville'],
        ['', 'CLI-00700', 'CTN-00900', 'Résidence A', '01', '1 rue A', '69001', 'Lyon'],
        ['', '88877766100016', '', 'Résidence B', '02', '2 rue B', '69001', 'Lyon'],
        ['', 'CLI-00700', '', 'Doublon', '02', '9 rue Z', '', ''],
        ['', 'CLI-00700', 'CTN-INCONNU', 'Résidence C', '', '3 rue C', '', ''],
    ];
    const plan = await planImport('sites', table);
    assert.deepEqual(plan.items.map(i => i.action), ['create', 'create', 'error', 'error']);
    assert.match(plan.items[2].messages[0], /ligne 3/);

    const report = await applyImport('sites', table, {});
    assert.equal(report.created, 2);
    const sites = await get('sites', 'clientId', 'im-existing');
    assert.ok(sites.every((s: any) => /^SIT-\d{5}$/.test(s.code)));
    const siteA = sites.find((s: any) => s.name === 'Résidence A');
    assert.equal(siteA.contractId, 'im-ctr');
    const contract = (await adminDb.collection('contracts').doc('im-ctr').get()).data()!;
    assert.deepEqual(contract.siteIds, [siteA.id]);

    // Retrouvé par client + n° de site : mise à jour.
    const upd = await planImport('sites', [['Client', 'N° de site', 'Ville'], ['CLI-00700', '02', 'Villeurbanne']]);
    assert.equal(upd.items[0].action, 'update');
});

test('contacts et compteurs : correspondance, types, codes CPT', async () => {
    const contacts = [
        ['Client', 'Type', 'Nom', 'Email'],
        ['CLI-00700', 'Principal', 'Marie Durand', 'Marie@Exemple.fr'],
        ['CLI-00700', 'technique', 'Paul Martin', ''],
        ['CLI-00700', 'Principal', 'Marie D.', 'marie@exemple.fr'],
    ];
    const cPlan = await planImport('contacts', contacts);
    assert.deepEqual(cPlan.items.map(i => i.action), ['create', 'create', 'error']);
    await applyImport('contacts', contacts, {});
    const again = await planImport('contacts', [['Client', 'Email', 'Téléphone'], ['CLI-00700', 'marie@exemple.fr', '0472000000']]);
    assert.equal(again.items[0].action, 'update');

    const [site] = (await get('sites', 'clientId', 'im-existing')).filter((s: any) => s.name === 'Résidence A');
    const meters = [
        ['Code compteur', 'Site', 'Nom', 'Type de compteur', 'PDL / PCE', 'Statut'],
        ['', site.code, 'Gaz chaufferie', 'gaz', 'GI123', ''],
        ['', site.code, 'Autre', 'Fioul', 'X1', ''],
        ['', 'SIT-99999', 'Perdu', 'GAZ', '', ''],
    ];
    const mReport = await applyImport('meters', meters, { by: 'admin@example.com' });
    assert.deepEqual([mReport.created, mReport.errors.length], [1, 2]);
    const [meter] = await get('meters', 'reference', 'GI123');
    assert.match(meter.code, /^CPT-\d{5}$/);
    assert.equal(meter.type, 'Gaz');
    assert.equal(meter.unit, 'kWh');
    assert.equal(meter.status, 'on');
    assert.equal(meter.siteId, site.id);
    // Même site + même PDL : mis à jour, pas recréé.
    const mAgain = await planImport('meters', [['Site', 'PDL / PCE', 'Emplacement'], [site.code, 'GI123', 'Sous-sol']]);
    assert.equal(mAgain.items[0].action, 'update');
});

test('modèle : la ligne d\'exemple du modèle CSV se contrôle sans erreur de format', async () => {
    const plan = await planImport('contacts', csvToTable(csvTemplate(IMPORT_ENTITIES.contacts)));
    // Le client d'exemple n'existe pas : seule erreur attendue.
    assert.deepEqual(plan.items[0].messages, ['Client « CLI-00012 » introuvable (code CLI-… ou SIRET).']);
});
