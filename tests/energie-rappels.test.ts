// Rappel des fournitures d'énergie à renouveler (calcul pur) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rappelEnergie, type PointSuivi } from '../src/lib/energie/rappels';
import { FAMILLE_EVENEMENT, REGLES_DEFAUT, ROLES_FAMILLE, composer, contexteExemple } from '../src/lib/notifications/modeles';
import { BALISES, GROUPES_FAMILLE, controlerModele } from '../src/lib/notifications/balises';
import { MODELES_DEFAUT } from '../src/lib/notifications/modeles';

const pt = (pdl: string, jours: number, statut = 'a_renouveler'): PointSuivi => ({ pdl, client: 'Ville A', site: `Site ${pdl}`, fournisseur: 'EDF', numeroContrat: 'K1', fin: new Date(Date.parse('2026-11-25T00:00:00Z') + jours * 86_400_000).toISOString().slice(0, 10), jours, statut });

test('rappel : au premier passage, puis seulement quand un point franchit un seuil (180, 90, 30 jours)', () => {
    const points = [pt('b', 120), pt('a', 36), pt('c', 400, 'couvert')];
    assert.deepEqual(rappelEnergie(points, '2026-11-25', null)?.map(l => l.pdl), ['a', 'b']);
    // Hier : 37 et 121 jours, mêmes paliers (90 et 180) : rien de nouveau.
    assert.equal(rappelEnergie(points, '2026-11-25', '2026-11-24'), null);
    // Il y a une semaine : 43 et 127 jours, toujours les mêmes paliers.
    assert.equal(rappelEnergie(points, '2026-11-25', '2026-11-18'), null);
    // Un point passe sous 30 jours depuis hier : tous les points à renouveler sont listés.
    assert.deepEqual(rappelEnergie([pt('b', 120), pt('a', 30)], '2026-11-25', '2026-11-24')?.map(l => [l.pdl, l.jours]), [['a', 30], ['b', 120]]);
    // Un point entre dans les 180 jours.
    assert.deepEqual(rappelEnergie([pt('z', 180)], '2026-11-25', '2026-11-24')?.map(l => l.pdl), ['z']);
    assert.equal(rappelEnergie([pt('c', 400, 'couvert')], '2026-11-25', null), null);
    assert.equal(rappelEnergie([pt('b', 120)], '2026-11-25', '2026-11-25'), null);   // déjà passé aujourd'hui
});

test('mail : événement du domaine énergie, acheteurs et administrateurs, modèle par défaut valide', () => {
    assert.equal(FAMILLE_EVENEMENT.energie_a_renouveler, 'energie');
    assert.deepEqual(REGLES_DEFAUT.energie_a_renouveler.roles, ['acheteurs', 'administrateurs']);
    assert.deepEqual(ROLES_FAMILLE.energie, ['acheteurs', 'administrateurs']);
    assert.deepEqual(controlerModele(MODELES_DEFAUT.energie_a_renouveler), []);
    assert.deepEqual(GROUPES_FAMILLE.energie, ['Énergie']);
    assert.ok(BALISES.some(b => b.groupe === 'Énergie' && b.nom === 'Liste des points à renouveler'));
    const m = composer('energie_a_renouveler', contexteExemple('energie_a_renouveler', 'https://z.example'));
    assert.equal(m.sujet, '[Énergie] 3 point(s) de livraison à renouveler — première fin le 31/12/2026');
    assert.match(m.texte, /- 31\/12\/2026 \(38 jours\) — Copropriété Les Tilleuls, Tilleuls - Bâtiment A — PDL 21458100007919 — Gaz du Sud MULTISITES 2025\/2026/);
    assert.match(m.texte, /2 point\(s\) n'ont déjà plus de contrat en cours/);
    assert.match(m.texte, /https:\/\/z\.example\/purchases\/energie/);
    // Sans point « sans contrat » : la phrase disparaît (ligne dont la balise est vide).
    const sans = composer('energie_a_renouveler', { ...contexteExemple('energie_a_renouveler'), energie: { lignes: contexteExemple('energie_a_renouveler').energie!.lignes } });
    assert.doesNotMatch(sans.texte, /plus de contrat en cours/);
});
