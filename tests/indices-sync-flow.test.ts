// Synchronisation des indices (émulateur, sources simulées) : nouvelles valeurs, révisions, rejets, source en échec,
// retard, essai sans écriture, journal : npm run test:billing
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { dernieresSyncs, synchroniserIndices } from '../src/services/index-sync';
import type { IndexFetcher } from '../src/lib/indices/types';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const J = '2026-11-11';
const src = (code: string, valeurs: [string, number][], extra: Partial<IndexFetcher> = {}): IndexFetcher => ({ code, fetch: async () => valeurs.map(([period, value]) => ({ period, value, source: 'Source test' })), ...extra });
const valeursDe = async (code: string) => {
    const i = (await adminDb.collection('indices').where('code', '==', code).get()).docs[0];
    if (!i) return null;
    return Object.fromEntries((await adminDb.collection('indexValues').where('indexId', '==', i.id).get()).docs.map(d => [d.get('period'), d.get('value')]).sort());
};

test('premier passage : indice créé, valeurs enregistrées ; essai (dryRun) : rien n\'est écrit', async () => {
    const sources = [src('SYN-A', [['2026-08', 100], ['2026-09', 101.5]])];
    const essai = await synchroniserIndices({ fetchers: sources, dryRun: true, aujourdhui: J });
    assert.deepEqual([essai.dryRun, essai.nouvelles, essai.id, await valeursDe('SYN-A')], [true, 2, undefined, null]);
    const r = await synchroniserIndices({ fetchers: sources, aujourdhui: J, declencheur: 'planifie' });
    assert.deepEqual([r.nouvelles, r.modifiees, r.erreurs, r.sources[0].statut, r.sources[0].dernierePeriode, r.sources[0].retardMois], [2, 0, 0, 'ok', '2026-09', 0]);
    assert.deepEqual(await valeursDe('SYN-A'), { '2026-08': 100, '2026-09': 101.5 });
    const indice = (await adminDb.collection('indices').where('code', '==', 'SYN-A').get()).docs[0];
    assert.deepEqual([indice.get('active'), indice.get('label')], [true, 'Indice SYN-A (Auto)']);
    // Même passage une seconde fois : rien de nouveau, pas de doublon.
    const encore = await synchroniserIndices({ fetchers: sources, aujourdhui: J });
    assert.deepEqual([encore.nouvelles, encore.modifiees, Object.keys((await valeursDe('SYN-A'))!).length], [0, 0, 2]);
});

test('révision acceptée, valeur aberrante rejetée, source en échec ou vide : les autres continuent ; journal', async () => {
    const r = await synchroniserIndices({ aujourdhui: J, declencheur: 'planifie', delaiMs: 300, fetchers: [
        src('SYN-A', [['2026-09', 101.8], ['2026-10', 250], ['2026-11', 102.4]]),                        // révision de septembre, octobre aberrant
        { code: 'SYN-KO', fetch: async () => { throw new Error('Forbidden'); } },
        { code: 'SYN-LENT', fetch: () => new Promise(() => undefined) },
        src('SYN-VIDE', []),
        src('SYN-M', [['2026-09', 8.8], ['2026-10', 12.1]], { famille: 'marche' }),                      // +37,5 % : admis pour un prix de marché
    ] });
    const par = Object.fromEntries(r.sources.map(s => [s.code, s]));
    assert.deepEqual([par['SYN-A'].statut, par['SYN-A'].nouvelles, par['SYN-A'].modifiees, par['SYN-A'].rejetees.map(x => x.period)], ['alerte', 1, [{ period: '2026-09', avant: 101.5, apres: 101.8 }], ['2026-10']]);
    assert.match(par['SYN-A'].rejetees[0].motif, /variation de 145,6 % par rapport à 2026-09/);
    assert.deepEqual(await valeursDe('SYN-A'), { '2026-08': 100, '2026-09': 101.8, '2026-11': 102.4 });
    assert.deepEqual([par['SYN-KO'].statut, par['SYN-KO'].erreur, par['SYN-LENT'].statut, par['SYN-VIDE'].statut], ['erreur', 'Forbidden', 'erreur', 'erreur']);
    assert.match(String(par['SYN-LENT'].erreur), /sans réponse/);
    assert.match(String(par['SYN-VIDE'].erreur), /aucune valeur/);
    assert.deepEqual([par['SYN-M'].statut, par['SYN-M'].nouvelles, await valeursDe('SYN-M')], ['ok', 2, { '2026-09': 8.8, '2026-10': 12.1 }]);
    assert.deepEqual([r.nouvelles, r.modifiees, r.rejetees, r.erreurs], [3, 1, 1, 3]);
    // Journal : le dernier passage est relu tel quel.
    const [dernier] = await dernieresSyncs(1);
    assert.deepEqual([dernier.id, dernier.declencheur, dernier.erreurs, dernier.sources.length], [r.id, 'planifie', 3, 5]);
});

test('retard : indice dont la dernière valeur est trop ancienne signalé ; série arrêtée : pas d\'alerte', async () => {
    const r = await synchroniserIndices({ aujourdhui: J, fetchers: [
        src('SYN-RETARD', [['2025-11', 100], ['2025-12', 100.4], ['2026-01', 100.9]]),
        src('SYN-ARRET', [['2017-08', 105], ['2017-09', 106.2]], { arretee: true }),
    ] });
    const par = Object.fromEntries(r.sources.map(s => [s.code, s]));
    // Mensuel, dernière valeur janvier 2026 : attendue février, tolérance 4 mois → 5 mois de retard en novembre.
    assert.deepEqual([par['SYN-RETARD'].statut, par['SYN-RETARD'].retardMois, par['SYN-ARRET'].statut, par['SYN-ARRET'].retardMois, r.retards], ['alerte', 5, 'ok', null, 1]);
});
