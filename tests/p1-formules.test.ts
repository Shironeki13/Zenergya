// Barème de partage et formules de révision P1, comme le moteur P1 (calcul pur) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBareme, parseBareme, partage, quantiteRegularisation, validateBareme } from '../src/lib/p1/bareme';
import {
    coefficientRevision, controleM0, formatTermes, parseTermes, prixExercice, prixRevise, serieAt, validateFormule,
    type FormuleVersion, type PrixMois, type SerieValues,
} from '../src/lib/p1/formules';
import { baremeAu, formuleAu, type P1ContractDoc, type P1Formule, type P1SiteDoc } from '../src/lib/p1/stockage';
import type { TermeRevision } from '../src/lib/p1/parametrage';

test('barème : saisie en texte, contrôles, partage par tranches (RG-53), régularisation selon le marché (RG-54)', () => {
    const tranches = parseBareme('économie 0-10 % 50 % ; eco 10-100% 70% ; dépassement 0-100 % 30 %');
    assert.ok(Array.isArray(tranches));
    assert.deepEqual(tranches[1], { sens: 'economie', borneBasse: 0.1, borneHaute: 1, partClient: 0.7 });
    assert.equal(formatBareme(tranches), 'économie 0-10 % 50 % ; économie 10-100 % 70 % ; dépassement 0-100 % 30 %');
    assert.match(parseBareme('économie de 0 à 10') as string, /illisible/);
    assert.match(validateBareme(parseBareme('économie 0-10 % 50 % ; économie 15-100 % 70 %') as never).errors[0], /trou ou chevauchement/);
    assert.deepEqual(validateBareme(parseBareme('économie 0-100 % 50 %') as never), { errors: [], warnings: ['aucune tranche pour le sens dépassement : partage nul (100 % exploitant)'] });

    // N'B 1 000 MWh, économie de 150 : 100 MWh à 50 % (50) + 50 MWh à 70 % (35) = 85 pour le client.
    const eco = partage(150, 1000, tranches);
    assert.deepEqual([eco.client, eco.exploitant, eco.detail.map(d => d.quantite)], [85, 65, [100, 50]]);
    assert.equal(quantiteRegularisation('MCI', 150, eco.client), 65);    // l'écart est chez le client : on lui facture la part exploitant
    assert.equal(quantiteRegularisation('MTI', 150, eco.client), -85);   // l'écart est chez l'exploitant : on reverse la part client
    // Dépassement de 150 à 30 % : 45 pour le client.
    const dep = partage(-150, 1000, tranches);
    assert.equal(dep.client, 45);
    assert.equal(quantiteRegularisation('MCI', -150, 45), -105);
    assert.equal(quantiteRegularisation('MTI', -150, 45), 45);
    assert.equal(quantiteRegularisation('MC', 150, 0), 0);
    assert.match(partage(-10, 1000, parseBareme('économie 0-100 % 50 %') as never).alerte!, /partage nul/);
});

const series: SerieValues = new Map([
    ['PEGMA', [{ period: '2025-01', value: 20 }, { period: '2025-03', value: 25 }]],
    ['ATRD', [{ period: '2025-01', value: 4 }, { period: '2025-03', value: 5 }]],
    ['CL', [{ period: '2025-01', value: 2 }, { period: '2025-03', value: 3 }]],
    ['PR', [{ period: '2025-01', value: 4 }, { period: '2025-03', value: 4 }]],
]);
const version = (patch: Partial<FormuleVersion> = {}): FormuleVersion => ({
    forme: 'A', mode: 'standard', baseEnergetique: 'PCS', unitePrix: 'EUR/MWh', dateM0: '2025-01', m0Manquante: null,
    regimeKmol: 'variable', prixMoleculeNegocie: null, prixFixe: false, periodicite: 'mensuel',
    termes: parseTermes('p0=0,15 ; Kmol=0,6*PEGMA@20 ; TVD=0,25*ATRD@4') as TermeRevision[], ...patch,
});

test('termes en texte : indice, panier, base contractuelle, terme inactif', () => {
    const t = parseTermes('p0=0,15 ; Kmol=0,6*PEGMA@20 ; CEE=0,1*(1*CL+0,5*PR+2*#1,5)@5! ; ~CPB=0,15*ATRD@4');
    assert.ok(Array.isArray(t));
    assert.deepEqual(t[2].panier, [{ coefficient: 1, serie: 'CL', valeurFixe: null }, { coefficient: 0.5, serie: 'PR', valeurFixe: null }, { coefficient: 2, serie: null, valeurFixe: 1.5 }]);
    assert.deepEqual([t[2].baseContractuelle, t[3].actif], [true, false]);
    assert.equal(formatTermes(t), 'p0=0,15 ; Kmol=0,6*PEGMA@20 ; CEE=0,1*(1*CL+0,5*PR+2*#1,5)@5! ; ~CPB=0,15*ATRD@4');
    assert.match(parseTermes('Kmol 0,6 PEGMA') as string, /illisible/);
});

test('contrôles de la formule (RG-24 à RG-42)', () => {
    const codes = ['PEGMA', 'ATRD', 'CL', 'PR'];
    assert.deepEqual(validateFormule(version(), codes), { errors: [], warnings: [] });
    assert.match(validateFormule(version({ termes: parseTermes('p0=0,2 ; Kmol=0,6*PEGMA@20') as never }), codes).errors[0], /80 % au lieu de 100 %/);
    assert.match(validateFormule(version({ termes: parseTermes('p0=0,4 ; Kmol=0,6*INCONNU@20') as never }), codes).errors[0], /indice « INCONNU » inconnu/);
    assert.match(validateFormule(version({ termes: parseTermes('p0=0,4 ; Kmol=0,6*PEGMA') as never }), codes).errors[0], /valeur de base M0 obligatoire/);
    assert.match(validateFormule(version({ forme: 'B', termes: parseTermes('p0=1 ; Kmol=1*PEGMA@20') as never }), codes).errors[0], /p0 a besoin de sa valeur/);
    assert.match(validateFormule(version({ regimeKmol: 'fixe' }), codes).errors[0], /prix négocié obligatoire/);
    assert.match(validateFormule(version({ dateM0: null }), codes).errors[0], /dites ce qui manque/);
    assert.deepEqual(validateFormule(version({ prixFixe: true, termes: [] }), codes).errors, []);
});

test('coefficient : forme A, forme B, panier, report d\'indice, contrôle à M0', () => {
    // Forme A en mars : 0,15 + 0,6 × 25/20 + 0,25 × 5/4 = 0,15 + 0,75 + 0,3125 = 1,2125.
    const a = coefficientRevision(version(), '2025-03', series);
    assert.ok('coefficient' in a);
    assert.equal(+a.coefficient.toFixed(10), 1.2125);
    // Forme B : (10 + 25 + 5) / (10 + 20 + 4) = 40/34.
    const b = coefficientRevision(version({ forme: 'B', termes: parseTermes('p0=1@10 ; Kmol=1*PEGMA@20 ; TVD=1*ATRD@4') as never }), '2025-03', series);
    assert.ok('coefficient' in b);
    assert.equal(+b.coefficient.toFixed(10), +(40 / 34).toFixed(10));
    // Panier : CEE suit 1 × CL + 0,5 × PR = 3 + 2 = 5 en mars, base 4 → ratio 1,25.
    const panier = coefficientRevision(version({ termes: parseTermes('p0=0,5 ; CEE=0,5*(1*CL+0,5*PR)@4') as never }), '2025-03', series);
    assert.ok('coefficient' in panier);
    assert.equal(panier.coefficient, 0.5 + 0.5 * 1.25);
    // Avril : pas de publication, report de mars (provisoire) ; au-delà du seuil : alerte.
    const avril = coefficientRevision(version(), '2025-04', series);
    assert.ok('coefficient' in avril && avril.provisoire && avril.alertes.length === 0);
    const tard = coefficientRevision(version(), '2025-08', series);
    assert.ok('coefficient' in tard && /reporté de 5 mois/.test(tard.alertes[0]));
    assert.match((coefficientRevision(version(), '2024-12', series) as { causes: string[] }).causes[0], /aucune valeur de l'indice PEGMA/);
    assert.equal(serieAt(series, 'pegma', '2025-02')!.period, '2025-01');
    // M0 : coefficient 1 ; base différente de la publication : erreur, sauf base contractuelle.
    assert.deepEqual(controleM0(version(), series), {});
    assert.match(controleM0(version({ termes: parseTermes('p0=0,4 ; Kmol=0,6*PEGMA@21') as never }), series).error!, /au lieu de 1/);
    assert.match(controleM0(version({ termes: parseTermes('p0=0,4 ; Kmol=0,6*PEGMA@21!') as never }), series).warning!, /contractuelles \(Kmol\)/);
});

test('prix : prix de base du site × coefficient ; prix fixe ; périodicité de l\'exercice (RG-44)', () => {
    assert.deepEqual(prixRevise(version(), null, '2025-03', series), { causes: ['prix de base du site non renseigné'] });
    assert.equal((prixRevise(version({ prixFixe: true }), 80, '2025-03', series) as { prix: number }).prix, 80);
    assert.equal(+(prixRevise(version(), 80, '2025-03', series) as { prix: number }).prix.toFixed(6), 97);   // 80 × 1,2125
    const ok = (prix: number): PrixMois => ({ prix, coefficient: prix / 80, provisoire: false, alertes: [], lignes: [] });
    const mensuels = { '2025-01': ok(80), '2025-02': ok(88), '2025-03': ok(96) };
    const mois = ['2025-01', '2025-02', '2025-03'];
    // Prorata des jours : (80 × 31 + 88 × 28 + 96 × 31) / 90.
    assert.equal(+(prixExercice(mensuels, mois, 'annuel_temps')['2025-02'] as { prix: number }).prix.toFixed(6), +((80 * 31 + 88 * 28 + 96 * 31) / 90).toFixed(6));
    assert.equal((prixExercice(mensuels, mois, 'annuel_cloture')['2025-01'] as { prix: number }).prix, 96);
    assert.equal((prixExercice(mensuels, mois, 'annuel_dju', { '2025-01': 400, '2025-02': 300, '2025-03': 100 })['2025-03'] as { prix: number }).prix, (80 * 400 + 88 * 300 + 96 * 100) / 800);
    assert.equal((prixExercice(mensuels, mois, 'mensuel')['2025-02'] as { prix: number }).prix, 88);
    assert.ok('causes' in prixExercice({ ...mensuels, '2025-02': { causes: ['x'] } }, mois, 'annuel_temps')['2025-01']);
});

test('formule la plus précise, barème du site prioritaire', () => {
    const f = (id: string, perimetre: P1Formule['perimetre']): P1Formule => ({
        id, nom: id, usage: 'chauffage', perimetre, saisiLe: 'T', saisiPar: 'a',
        versions: [{ id: `${id}v`, valeur: version(), dateEffet: null, motif: 'm', saisiLe: 'T', saisiPar: 'a' }],
    });
    const contract: P1ContractDoc = { kind: 'contract', contractId: 'k', codeContrat: 'CTN-1', params: {}, formules: { a: f('contrat', { type: 'contrat' }), b: f('gaz', { type: 'energies', energies: ['gaz'] }), c: f('site', { type: 'sites', siteIds: ['s2'] }) } };
    assert.equal(formuleAu(contract, 's1', [], 'chauffage', '2026-01-01')!.formule.nom, 'contrat');
    assert.equal(formuleAu(contract, 's1', ['gaz'], 'chauffage', '2026-01-01')!.formule.nom, 'gaz');
    assert.equal(formuleAu(contract, 's2', ['gaz'], 'chauffage', '2026-01-01')!.formule.nom, 'site');
    assert.equal(formuleAu(contract, 's1', ['gaz'], 'ecs', '2026-01-01'), null);

    const v = (x: unknown) => [{ id: 'v', valeur: x, dateEffet: null, motif: 'm', saisiLe: 'T', saisiPar: 'a' }];
    const site: P1SiteDoc = { kind: 'site', siteId: 's', codeSite: 'SIT-1', postes: {}, params: { 'bareme:MCI': v([{ sens: 'economie', borneBasse: 0, borneHaute: 1, partClient: 0.4 }]) } };
    const k: P1ContractDoc = { ...contract, params: { 'bareme:MCI': v([{ sens: 'economie', borneBasse: 0, borneHaute: 1, partClient: 0.5 }]) } };
    assert.deepEqual([baremeAu(site, k, 'MCI', '2026-01-01')!.source, baremeAu(null, k, 'MCI', '2026-01-01')!.tranches[0].partClient], ['site', 0.5]);
});
