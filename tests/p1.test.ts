// Paramétrage P1 daté : contrôles, versions, valeur en vigueur, reste à faire (calcul pur) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    addVersion, formatFormuleNc, parseFormuleNc, resteAFaire, retireVersion, validateParam, valeurAu,
    type P1ContractDoc, type P1MeterDoc, type P1SiteDoc, type P1Version,
} from '../src/lib/p1/stockage';

const v = (valeur: unknown, dateEffet: string | null, extra: Partial<P1Version<unknown>> = {}): P1Version<unknown> =>
    ({ id: `${dateEffet}`, valeur, dateEffet, motif: 'm', saisiLe: '2025-01-01T00:00:00Z', saisiPar: 'a', ...extra });

test('contrôles : listes, nombres, station, formule de NC (compteurs du site, signes), intéressement', () => {
    assert.deepEqual(validateParam('site', 'typeMarche', 'mci'), { value: 'MCI' });
    assert.match((validateParam('site', 'typeMarche', 'MF') as { error: string }).error, /« MF » inconnu/);
    assert.deepEqual(validateParam('site', 'periodeReference', 'saison de chauffe'), { value: 'saison_de_chauffe' });
    assert.deepEqual(validateParam('meter', 'qe', '11,63'), { value: 11.63 });
    assert.match((validateParam('meter', 'qe', '0') as { error: string }).error, /strictement positif/);
    assert.match((validateParam('meter', 'qe', '') as { error: string }).error, /inconnue ne se saisit pas/);
    assert.deepEqual(validateParam('contract', 'fraisGestionAnnuels', '0'), { value: 0 });
    assert.deepEqual(validateParam('site', 'stationMeteo', 'lyon-bron', { stationCodes: ['LYON-BRON'] }), { value: 'LYON-BRON' });
    assert.match((validateParam('site', 'stationMeteo', 'X', { stationCodes: ['LYON-BRON'] }) as { error: string }).error, /inconnue/);

    assert.deepEqual(parseFormuleNc('CPT-00012 + CPT-00013 - CPT-00020'), [
        { codeCompteur: 'CPT-00012', signe: 1 }, { codeCompteur: 'CPT-00013', signe: 1 }, { codeCompteur: 'CPT-00020', signe: -1 },
    ]);
    assert.deepEqual(parseFormuleNc('+CPT-1 -CPT-2'), [{ codeCompteur: 'CPT-1', signe: 1 }, { codeCompteur: 'CPT-2', signe: -1 }]);
    assert.match(parseFormuleNc('CPT-1 CPT-2') as string, /signe manquant/);
    assert.equal(formatFormuleNc(parseFormuleNc('CPT-1 - CPT-2') as never), 'CPT-1 - CPT-2');
    const ctx = { siteMeterCodes: ['CPT-1', 'CPT-2'] };
    assert.ok('value' in validateParam('poste', 'formuleNc', 'cpt-1 - CPT-2', ctx));
    assert.match((validateParam('poste', 'formuleNc', '- CPT-1', ctx) as { error: string }).error, /au moins un compteur en entrée/);
    assert.match((validateParam('poste', 'formuleNc', 'CPT-1 + CPT-9', ctx) as { error: string }).error, /absent\(s\) du site : CPT-9/);
    assert.match((validateParam('poste', 'formuleNc', 'CPT-1 + CPT-1', ctx) as { error: string }).error, /deux fois/);

    assert.ok('value' in validateParam('contract', 'interessement', [{ marche: 'MCI', repartition: 'contrat', plafondPct: 50, plafonne: true }]));
    assert.match((validateParam('contract', 'interessement', [{ marche: 'MC', repartition: 'contrat', plafondPct: null, plafonne: false }]) as { error: string }).error, /MC n'a pas d'intéressement/);
    assert.match((validateParam('contract', 'interessement', [{ marche: 'MTI', repartition: 'contrat', plafondPct: null, plafonne: true }]) as { error: string }).error, /plafonné sans plafond/);
});

test('versions : ajout sans écrasement, retrait tracé, valeur en vigueur à une date', () => {
    const a = addVersion(undefined, { valeur: 'MCI', dateEffet: null, motif: 'contrat d\'origine' }, 'x@v.fr', 'T1', 'v1') as P1Version<unknown>[];
    const b = addVersion(a, { valeur: 'MTI', dateEffet: '2026-07-01', motif: 'avenant n°2' }, 'x@v.fr', 'T2', 'v2') as P1Version<unknown>[];
    assert.match((addVersion(b, { valeur: 'MC', dateEffet: '2026-07-01', motif: 'x' }, 'x', 'T3', 'v3') as { error: string }).error, /existe déjà au 01\/07\/2026 : retirez-la/);
    assert.match((addVersion(b, { valeur: 'MC', dateEffet: '2026-08-01', motif: ' ' }, 'x', 'T3', 'v3') as { error: string }).error, /Motif obligatoire/);
    const params = { typeMarche: b };
    assert.equal(valeurAu(params, 'typeMarche', '2026-06-30'), 'MCI');
    assert.equal(valeurAu(params, 'typeMarche', '2026-07-01'), 'MTI');
    const retired = retireVersion(b, 'v2', 'saisie erronée', 'y@v.fr', 'T4') as P1Version<unknown>[];
    assert.deepEqual([retired[1].retireLe, retired[1].retirePar, retired[1].motifRetrait, retired.length], ['T4', 'y@v.fr', 'saisie erronée', 2]);
    assert.equal(valeurAu({ typeMarche: retired }, 'typeMarche', '2026-08-01'), 'MCI');
    assert.ok(Array.isArray(addVersion(retired, { valeur: 'MC', dateEffet: '2026-07-01', motif: 'remplace' }, 'x', 'T5', 'v5')));
    assert.match((retireVersion(retired, 'v2', 'encore', 'y', 'T6') as { error: string }).error, /déjà retirée/);
});

const site = (params: Record<string, unknown>, postes: Record<string, Record<string, unknown>> = {}): P1SiteDoc => ({
    kind: 'site', siteId: 's', codeSite: 'SIT-1',
    params: Object.fromEntries(Object.entries(params).map(([k, x]) => [k, [v(x, null)]])),
    postes: Object.fromEntries(Object.entries(postes).map(([d, p]) => [d, {
        id: d, designation: d, saisiLe: 'T', saisiPar: 'a', params: Object.fromEntries(Object.entries(p).map(([k, x]) => [k, [v(x, null)]])),
    }])),
});
const meter = (code: string, params: Record<string, unknown>): P1MeterDoc => ({
    kind: 'meter', meterId: code, codeCompteur: code, siteId: 's', params: Object.fromEntries(Object.entries(params).map(([k, x]) => [k, [v(x, null)]])),
});
const contract = (params: Record<string, unknown>): P1ContractDoc => ({
    kind: 'contract', contractId: 'k', codeContrat: 'CTN-1', params: Object.fromEntries(Object.entries(params).map(([k, x]) => [k, [v(x, null)]])),
});

test('reste à faire : selon le type de marché ; QE et qECS des compteurs de la formule ; calculable', () => {
    const date = '2026-01-15';
    assert.deepEqual(resteAFaire({ site: null, meters: [], contract: null, hasP1Revision: false, date }).manque, ['Type de marché']);
    const pf = resteAFaire({ site: site({ typeMarche: 'PF' }), meters: [], contract: null, hasP1Revision: false, date });
    assert.deepEqual([pf.suivi, pf.calculable, pf.manque], [false, false, []]);

    const mci = resteAFaire({ site: site({ typeMarche: 'MCI' }), meters: [{ code: 'CPT-1', unit: 'm3', doc: null }], contract: null, hasP1Revision: false, date });
    assert.deepEqual(mci.manque, ['Période de référence', 'Prix de base chauffage', 'Formule de révision du prix (prestation P1)', 'Poste de consommation avec sa formule de NC', 'Station météo']);
    assert.deepEqual(mci.aVenir, ['Barème de partage par tranches']);

    const complet = resteAFaire({
        site: site({ typeMarche: 'MCI', periodeReference: 'saison_de_chauffe', prixBase: 85, stationMeteo: 'LYON' },
            { Chaufferie: { formuleNc: [{ codeCompteur: 'CPT-1', signe: 1 }, { codeCompteur: 'CPT-2', signe: -1 }], cibleNb: 800, cibleNbUnite: 'MWh', djuReference: 2200 } }),
        meters: [{ code: 'CPT-1', unit: 'm3', doc: meter('CPT-1', { qe: 11.2 }) }, { code: 'CPT-2', unit: 'm3', doc: meter('CPT-2', { usage: 'ecs' }) }],
        contract: null, hasP1Revision: true, date,
    });
    assert.deepEqual(complet.manque, ['Coefficient QE du compteur CPT-2', 'qECS du compteur CPT-2']);

    const cp = resteAFaire({
        site: site({ typeMarche: 'CP', periodeReference: 'annee_civile' }, { Gaz: { formuleNc: [{ codeCompteur: 'CPT-1', signe: 1 }] } }),
        meters: [{ code: 'CPT-1', unit: 'MWh', doc: null }], contract: contract({ regimeCp: 'coefficient' }), hasP1Revision: false, date,
    });
    assert.deepEqual(cp.manque, ['Coefficient de gestion (contrat)']);
    const revise = resteAFaire({
        site: site({ typeMarche: 'CP', periodeReference: 'annee_civile' }, { Gaz: { formuleNc: [{ codeCompteur: 'CPT-1', signe: 1 }] } }),
        meters: [{ code: 'CPT-1', unit: 'MWh', doc: null }], contract: contract({ regimeCp: 'revise' }), hasP1Revision: true, date,
    });
    assert.deepEqual([revise.manque, revise.calculable], [['Prix de base chauffage'], false]);
});
