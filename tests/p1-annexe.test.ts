// Annexe P1 d'une facture : contenu par mode de facturation, TVA par ligne ajustée au total : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afficher, annexesP1, nomSite } from '../src/lib/billing/p1-annexe';
import type { InvoiceLineItem } from '../src/lib/types';

const idx = (id: string, date: string, index: number) => ({ readingId: id, date, index });
const mois = (m: string, q: number, prix: number, extra: Record<string, unknown> = {}) => ({
    mois: m, debut: `${m}-01`, fin: `${m}-28`, jours: 28, joursMois: 28, methode: 'complet' as const, ratio: 1,
    compteurs: [{ meterId: 'g', code: 'CPT-GAZ', unit: 'm3', signe: 1 as const, qe: 0.0105, conversion: 0.0105, debut: idx('a', `${m}-01`, 1000), fin: idx('b', `${m}-28`, 2000), volume: 1000, quantite: q }],
    quantiteMois: q, quantite: q, prix: { prix, base: 80, coefficient: prix / 80, source: 'p1' as const, indices: [{ terme: 'Kmol', indice: 'PEG', ponderation: 1, valeur: 36.31, base: 30, ratio: 1.21, periode: m }] },
    coefGestion: null, prixApplique: prix, montant: Math.round(q * prix * 100) / 100, ...extra,
});
const ligne = (p: Partial<InvoiceLineItem>): InvoiceLineItem => ({ description: 'P1 — Site : Chaufferie A — du …', quantity: 1, unitPrice: 0, total: 0, vatRate: 20, activityCode: 'P1', ...p });

test('au compteur : une ligne par mois, sous-détail par compteur d\'une formule de NC, colonnes selon le cas, révision', () => {
    const simple = ligne({ total: 1800, siteId: 's', p1Releve: { siteId: 's', mois: '2026-01', volume: 21, prix: 0, montant: 1800, compteurs: [], usage: 'chauffage', unite: 'MWh', detail: [mois('2026-01', 10.5, 80), mois('2026-02', 10.5, 91.428571, { coefGestion: 1.05, prixApplique: 96, montant: 1008 })] } });
    const [a] = annexesP1([simple]);
    assert.deepEqual([a.type, a.titre, a.lignes.length, a.lignes.every(l => !l.detail)], ['compteur-chauffage', 'P1 chauffage au compteur', 2, true]);
    assert.match(a.formule, /× coefficient de conversion × PU de base × C\/C0 × coefficient de gestion/);
    assert.ok(a.colonnes.some(c => c.cle === 'coefGestion') && !a.colonnes.some(c => c.cle === 'prorata'));
    assert.deepEqual(a.lignes[0].valeurs, {
        site: 'Chaufferie A', mois: '01/2026', compteur: 'CPT-GAZ', indexDebut: 1000, dateDebut: '01/01/2026', indexFin: 2000, dateFin: '28/01/2026', conso: 1000, conversion: 0.0105,
        quantiteCompteur: 10.5, quantiteMois: 10.5, prorata: '', quantite: 10.5, prixBase: 80, coefficient: 1, coefGestion: null, prixApplique: 80, ht: 840, tauxTva: 20, tva: 168, ttc: 1008,
    });
    assert.deepEqual(a.totaux, { ht: 1848, tva: 369.6, ttc: 2217.6 });
    // Révision : janvier (coefficient 1 mais indices présents) et février.
    assert.deepEqual(a.revisions.map(r => [r.mois, r.sites, r.termes[0].indice, r.termes[0].base, r.termes[0].valeur]), [['2026-01', [], 'PEG', 30, 36.31], ['2026-02', [], 'PEG', 30, 36.31]]);

    // Formule de NC (gaz − ECS) et prorata : lignes de détail par compteur, puis total du mois.
    const m = mois('2026-03', 9, 80, { methode: 'jours', jours: 14, ratio: 0.5, quantiteMois: 18 });
    m.compteurs.push({ ...m.compteurs[0], meterId: 'e', code: 'CPT-ECS', signe: -1 as never, quantite: -1.5 });
    const nc = annexesP1([ligne({ total: 720, vatRate: 5.5, p1Releve: { siteId: 's', mois: '2026-03', volume: 9, prix: 80, montant: 720, compteurs: [], usage: 'chauffage', unite: 'MWh', detail: [m] } })])[0];
    assert.deepEqual(nc.lignes.map(l => [!!l.detail, l.valeurs.compteur, l.valeurs.ht ?? null]), [[true, 'CPT-GAZ', null], [true, '− CPT-ECS', null], [false, 'Total', 720]]);
    assert.equal(nc.lignes[2].valeurs.prorata, '  14/28 jours');
    assert.ok(nc.colonnes.some(c => c.cle === 'prorata') && nc.colonnes.some(c => c.cle === 'quantiteMois'));
});

test('MTI au DJU, acomptes, décompte, régularisation : une annexe chacun, dans l\'ordre', () => {
    const lignes: InvoiceLineItem[] = [
        ligne({ total: 1032.22, description: 'P1 MTI au DJU — Site : Hôtel de Ville — …', p1Dju: { siteId: 's', base: 5583.54, djuReference: 2308, montant: 1032.22, mois: [{ mois: '2026-01', debut: '2026-01-01', fin: '2026-01-31', dju: 411.9, coefficient: 1.03587, revise: 5783.8215, montant: 1032.22 }] } }),
        ligne({ total: 1250.05, p1Acompte: { siteId: 's', usage: 'chauffage', mois: [{ mois: '2026-01', quantite: 14.571, prix: 85.79, montant: 1250.05 }] } }),
        ligne({ total: -805.27, description: 'Décompte P1 chauffage MTI — Site : Résidence — saison …', p1Regul: { siteId: 's', usage: 'chauffage', mois: ['2025-10', '2026-05'], reel: 59136.17, acomptes: 59941.44, decompte: [{ saison: '2025-2026', p1Base: 52224, quantite: 640, prixBase: 81.6, coefficient: 1.14709, dju: 2221.1, djuReference: 2250, du: 59136.17, mois: [{ mois: '2025-10', dju: 150, montant: 3993.7 }] }] } }),
        ligne({ total: -500, description: 'Régularisation chauffage — Site : Belvédère — du …', p1Regul: { siteId: 's', usage: 'chauffage', mois: ['2025-10', '2025-11'], reel: 23500, acomptes: 24000 } }),
        ligne({ total: 300, description: 'Conduite — Site : X', activityCode: 'P2' }),
    ];
    const a = annexesP1(lignes);
    assert.deepEqual(a.map(x => x.type), ['dju', 'acompte', 'decompte', 'regularisation']);
    assert.deepEqual([a[0].lignes[0].valeurs.site, a[0].lignes[0].valeurs.du, a[0].lignes[0].valeurs.au, a[0].lignes[0].valeurs.dju, a[0].lignes[0].valeurs.revise, a[0].lignes[0].valeurs.ht], ['Hôtel de Ville', '  01/01/2026', '31/01/2026', 411.9, 5783.82, 1032.22]);
    assert.deepEqual(a[0].references, [['DJU contractuels', '2 308']]);
    assert.deepEqual(a[2].lignes.map(l => [!!l.detail, l.valeurs.saison, l.valeurs.dju]), [[true, '10/2025', 150], [false, '2025-2026', 2221.1]]);
    assert.deepEqual([a[2].lignes[1].valeurs.site, a[2].lignes[1].valeurs.du, a[2].lignes[1].valeurs.acomptes, a[2].totaux], ['Résidence', 59136.17, 59941.44, { ht: -805.27, tva: -161.05, ttc: -966.32 }]);
    assert.deepEqual([a[3].lignes[0].valeurs.site, a[3].lignes[0].valeurs.reel, a[3].lignes[0].valeurs.ht], ['Belvédère', 23500, -500]);
    assert.deepEqual(annexesP1([lignes[4]]), []);   // pas de P1 détaillé : pas d'annexe
});

test('TVA : par ligne, dernière ligne ajustée pour retomber sur la TVA du total (plus de ±0,01 € à la main)', () => {
    // 3 lignes à 0,33 € HT à 20 % : 0,07 par ligne (0,21), TVA du total 0,99 × 20 % = 0,20 → dernière ligne à 0,06.
    const l = (n: number) => ligne({ total: 0.33, description: `P1 — Site : S${n} — …`, p1Acompte: { siteId: `s${n}`, usage: 'chauffage', mois: [{ mois: '2026-01', quantite: 1, prix: 0.33, montant: 0.33 }] } });
    const [a] = annexesP1([l(1), l(2), l(3)]);
    assert.deepEqual(a.lignes.map(x => x.valeurs.tva), [0.07, 0.07, 0.06]);
    assert.deepEqual(a.totaux, { ht: 0.99, tva: 0.2, ttc: 1.19 });
    assert.equal(a.lignes.reduce((s, x) => s + (x.valeurs.ttc as number), 0).toFixed(2), '1.19');
});

test('affichage et nom du site', () => {
    assert.deepEqual([afficher(1234.5, { format: 'eur' }), afficher(1.03587, { format: 'coef', decimales: 5 }), afficher(20, { format: 'pct' }), afficher(5.5, { format: 'pct' }), afficher(411.9, { format: 'nombre', decimales: 2 }), afficher(80, { format: 'prix', decimales: 4 }), afficher(null, { format: 'eur' })],
        ['1 234,50 €', '1,03587', '20 %', '5,5 %', '411,9', '80,00', '']);
    assert.equal(nomSite({ siteId: 'x', description: 'ECS — Site : Tilleuls - Bâtiment A — du 01/01' }), 'Tilleuls - Bâtiment A');
    assert.equal(nomSite({ siteId: 'x', description: '…' }, { x: 'Nom fourni' }), 'Nom fourni');
});
