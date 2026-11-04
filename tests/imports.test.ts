// Tests du moteur d'import : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IMPORT_ENTITIES, IMPORT_ENTITY_LIST } from '../src/lib/imports/definitions';
import { csvTemplate, csvToTable, mapHeaders, noticeRows, parseDateTime, parseTable, parseValue } from '../src/lib/imports/engine';
import { versionAtLeast } from '../src/lib/imports/xlsx';

const CLIENTS = IMPORT_ENTITIES.clients;
const field = (entity: typeof CLIENTS, key: string) => entity.fields.find(f => f.key === key)!;

test('valeurs : nombres, oui/non, listes, SIRET, email, code postal', () => {
    assert.deepEqual(parseValue(field(CLIENTS, 'quoteCoefficient'), '1,35'), { value: 1.35 });
    assert.ok(parseValue(field(CLIENTS, 'quoteCoefficient'), '-2').error);
    assert.deepEqual(parseValue(field(CLIENTS, 'useChorus'), 'Oui'), { value: true });
    assert.deepEqual(parseValue(field(CLIENTS, 'useChorus'), 'x'), { value: true });
    assert.ok(parseValue(field(CLIENTS, 'useChorus'), 'peut-être').error);
    assert.deepEqual(parseValue(field(CLIENTS, 'clientType'), 'privé'), { value: 'private' });
    assert.deepEqual(parseValue(field(CLIENTS, 'clientType'), 'PUBLIC'), { value: 'public' });
    assert.match(parseValue(field(CLIENTS, 'clientType'), 'mixte').error!, /Privé, Public/);
    assert.deepEqual(parseValue(field(CLIENTS, 'siret'), '732 829 320 00074'), { value: '73282932000074' });
    assert.match(parseValue(field(CLIENTS, 'siret'), '73282932000075').error!, /clé de contrôle/);
    assert.deepEqual(parseValue(field(CLIENTS, 'postalCode'), '6000'), { value: '06000' });   // 0 initial perdu par Excel
    assert.deepEqual(parseValue(IMPORT_ENTITIES.contacts.fields.find(f => f.key === 'email')!, 'Marie@Exemple.FR'), { value: 'marie@exemple.fr' });
    assert.deepEqual(parseValue(field(CLIENTS, 'name'), '   '), { value: null });   // vide : valeur conservée
});

test('en-têtes : libellés, sans accents ni astérisque, alias ; colonnes inconnues ignorées', () => {
    const { index, ignored, missing } = mapHeaders(CLIENTS, ['RAISON SOCIALE *', 'cp', 'Societe', 'Commentaire', 'Type']);
    assert.equal(index.get('name'), 0);
    assert.equal(index.get('postalCode'), 1);
    assert.equal(index.get('company'), 2);
    assert.deepEqual(ignored, ['Commentaire']);
    assert.ok(missing.includes('Adresse'));
});

test('fichier : lignes contrôlées, lignes vides ignorées, doublons de code et de SIRET signalés', () => {
    const table = [
        ['Code client', 'Raison sociale', 'SIRET', 'Type'],
        ['', 'Alpha', '73282932000074', 'Privé'],
        ['', '', '', ''],
        ['', 'Beta', '73282932000074', 'Public'],
        ['CLI-00001', 'Gamma', '', 'Mixte'],
        ['cli-00001', 'Delta', '', ''],
    ];
    const r = parseTable(CLIENTS, table);
    assert.deepEqual(r.fileErrors, []);
    assert.deepEqual(r.rows.map(x => x.line), [2, 4, 5, 6]);
    assert.deepEqual(r.rows[0].errors, []);
    assert.match(r.rows[1].errors[0], /déjà présent ligne 2/);
    assert.ok(r.rows[2].errors.some(e => e.includes('Type')));
    assert.match(r.rows[3].errors[0], /déjà présent ligne 5/);
    // Colonnes obligatoires absentes : signalées (fichier de mise à jour possible), pas bloquantes.
    const partial = parseTable(CLIENTS, [['Ville'], ['Lyon']]);
    assert.deepEqual(partial.fileErrors, []);
    assert.ok(partial.missingColumns.includes('Raison sociale'));
    assert.match(parseTable(CLIENTS, [['Commentaire'], ['x']]).fileErrors[0], /Aucune colonne reconnue/);
});

test('modèles : le CSV relu redonne ses colonnes ; notice complète ; toutes les entités', () => {
    for (const entity of IMPORT_ENTITY_LIST) {
        const table = csvToTable(csvTemplate(entity));
        assert.deepEqual(table[0], entity.fields.map(f => f.label));
        const { index, ignored } = mapHeaders(entity, table[0]);
        assert.equal(index.size, entity.fields.length, entity.key);
        assert.deepEqual(ignored, []);
        assert.equal(noticeRows(entity).length, entity.fields.length + 1);
        // La ligne d'exemple est valide.
        assert.deepEqual(parseTable(entity, table).rows.flatMap(r => r.errors), [], entity.key);
    }
});

test('version de SheetJS : lecture réservée aux versions corrigées', () => {
    assert.equal(versionAtLeast('0.18.5', '0.19.3'), false);
    assert.equal(versionAtLeast('0.19.3', '0.19.3'), true);
    assert.equal(versionAtLeast('0.20.3', '0.19.3'), true);
    assert.equal(versionAtLeast('1.0.0', '0.19.3'), true);
});

import { buildOpenApi } from '../src/lib/api/openapi';
import { API_RESOURCES } from '../src/lib/api/scopes';

test('OpenAPI : chemins et schémas générés depuis la description des imports', () => {
    const spec = buildOpenApi('https://zenergya.example/api/v1') as any;
    assert.equal(spec.openapi, '3.1.0');
    for (const r of API_RESOURCES) {
        assert.ok(spec.paths[`/${r}`].get && spec.paths[`/${r}`].post && spec.paths[`/${r}/{ref}`].get, r);
        const schema = spec.components.schemas[r[0].toUpperCase() + r.slice(1)];
        for (const f of IMPORT_ENTITIES[r].fields) assert.ok(schema.properties[f.key], `${r}.${f.key}`);
    }
    assert.deepEqual(spec.components.schemas.Clients.properties.clientType.enum, ['private', 'public']);
    assert.equal(spec.components.schemas.Clients.properties.siret.pattern, '^\\d{14}$');
    assert.equal(spec.components.securitySchemes.apiKey.scheme, 'bearer');
});

test('dates des relevés : heure de Paris par défaut (hiver, été), formats français et ISO, dates impossibles refusées', () => {
    assert.equal(parseDateTime('2025-01-31'), '2025-01-30T23:00:00.000Z');
    assert.equal(parseDateTime('2025-07-01'), '2025-06-30T22:00:00.000Z');
    assert.equal(parseDateTime('31/01/2025 08:30'), '2025-01-31T07:30:00.000Z');
    assert.equal(parseDateTime('1.7.2025'), '2025-06-30T22:00:00.000Z');
    assert.equal(parseDateTime('2025-01-31 08:30'), '2025-01-31T07:30:00.000Z');
    assert.equal(parseDateTime('2025-01-31T08:30:00+01:00'), '2025-01-31T07:30:00.000Z');
    assert.equal(parseDateTime('2025-01-31T08:30:00+0200'), '2025-01-31T06:30:00.000Z');
    assert.equal(parseDateTime('2024-12-31T23:00:00.000Z'), '2024-12-31T23:00:00.000Z');   // relu tel quel depuis l'API
    for (const bad of ['2025-02-30', '31/02/2025', '2025-1-3', '2025-01-31 25:00', 'demain', '45658']) assert.equal(parseDateTime(bad), null, bad);

    const READINGS = IMPORT_ENTITIES.readings;
    assert.deepEqual(parseValue(READINGS.fields.find(f => f.key === 'value')!, '0'), { value: 0 });   // index nul accepté
    assert.match(parseValue(READINGS.fields.find(f => f.key === 'value')!, '-5').error!, /positif ou nul/);
    assert.match(parseValue(READINGS.fields.find(f => f.key === 'date')!, '30/02/2025').error!, /date invalide/);
    assert.deepEqual(parseValue(READINGS.fields.find(f => f.key === 'type')!, 'télérelève'), { value: 'AUTO' });
});

test('correction d\'un contrat : sites existants mis à jour en place, nouveaux créés, retirés listés', async () => {
    const { planSiteSync } = await import('../src/lib/contracts/site-sync');
    const plan = planSiteSync(['s1', 's2', 's3'], [{ id: 's2', name: 'B' }, { name: 'Nouveau' }, { id: 'inconnu', name: 'X' }, { id: 's2', name: 'B bis' }]);
    assert.deepEqual(plan.update, [{ id: 's2', values: { name: 'B' } }]);
    assert.deepEqual(plan.create, [{ name: 'Nouveau' }, { name: 'X' }, { name: 'B bis' }]);
    assert.deepEqual(plan.remove, ['s1', 's3']);
});
