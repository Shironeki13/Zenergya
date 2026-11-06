// Tableau commun des listes : recherche, filtres à facettes, tri : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliquerTable, NON_RENSEIGNE, type FiltreTable } from '../src/components/data-table/logique';

type L = { nom: string; ville?: string; statut: string; montant?: number; date?: string; tags?: string[] };
const rows: L[] = [
    { nom: 'Résidence Élysée', ville: 'Lyon', statut: 'Actif', montant: 1200, date: '2026-03-01', tags: ['P1', 'P2'] },
    { nom: 'Les Pins 10', ville: 'Bron', statut: 'Résilié', montant: 50, date: '2025-01-01', tags: ['P2'] },
    { nom: 'Les Pins 2', statut: 'Actif', montant: 300, tags: [] },
    { nom: 'Bellecour', ville: 'Lyon', statut: 'Actif' },
];
const filtres: FiltreTable<L>[] = [
    { id: 'statut', label: 'Statut', valeur: r => r.statut },
    { id: 'ville', label: 'Ville', valeur: r => r.ville },
    { id: 'tags', label: 'Activités', valeur: r => r.tags },
];
const colonnes = [{ id: 'nom', tri: (r: L) => r.nom }, { id: 'montant', tri: (r: L) => r.montant }, { id: 'date', tri: (r: L) => (r.date ? new Date(r.date) : null) }];
const run = (o: Partial<Parameters<typeof appliquerTable<L>>[1]>) => appliquerTable(rows, { recherche: r => [r.nom, r.ville], q: '', filtres, valeurs: {}, colonnes, tri: null, ...o });

test('recherche : tous les mots, accents et casse ignorés', () => {
    assert.deepEqual(run({ q: 'elysee' }).lignes.map(r => r.nom), ['Résidence Élysée']);
    assert.deepEqual(run({ q: 'pins lyon' }).lignes, []);
    assert.deepEqual(run({ q: 'LES pins' }).lignes.map(r => r.nom), ['Les Pins 10', 'Les Pins 2']);
});

test('filtres : choix multiples (ou), filtres cumulés (et), non renseigné, valeurs multiples ; effectifs à facettes', () => {
    assert.deepEqual(run({ valeurs: { statut: ['Actif'], ville: ['Lyon'] } }).lignes.map(r => r.nom), ['Résidence Élysée', 'Bellecour']);
    assert.deepEqual(run({ valeurs: { ville: [NON_RENSEIGNE] } }).lignes.map(r => r.nom), ['Les Pins 2']);
    assert.deepEqual(run({ valeurs: { tags: ['P2'] } }).lignes.map(r => r.nom), ['Résidence Élysée', 'Les Pins 10']);
    const { effectifs } = run({ valeurs: { statut: ['Actif'] } });
    // Effectifs d'un filtre : calculés avec les autres filtres, pas avec lui-même.
    assert.deepEqual(effectifs.statut.compte, { Actif: 3, 'Résilié': 1 });
    assert.deepEqual(effectifs.ville.compte, { Lyon: 2, [NON_RENSEIGNE]: 1 });
    assert.deepEqual(effectifs.ville.options.map(o => o.label), ['Bron', 'Lyon', 'Non renseigné']);
});

test('tri : texte avec nombres dans l\'ordre, nombres, dates ; vides en dernier dans les deux sens', () => {
    assert.deepEqual(run({ tri: { id: 'nom', sens: 'asc' } }).lignes.map(r => r.nom), ['Bellecour', 'Les Pins 2', 'Les Pins 10', 'Résidence Élysée']);
    assert.deepEqual(run({ tri: { id: 'montant', sens: 'desc' } }).lignes.map(r => r.montant), [1200, 300, 50, undefined]);
    assert.deepEqual(run({ tri: { id: 'date', sens: 'asc' } }).lignes.map(r => r.date), ['2025-01-01', '2026-03-01', undefined, undefined]);
    assert.deepEqual(run({ tri: { id: 'date', sens: 'desc' } }).lignes.map(r => r.date), ['2026-03-01', '2025-01-01', undefined, undefined]);
});
