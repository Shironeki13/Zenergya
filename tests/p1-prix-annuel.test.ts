// Prix annuel d'une formule P1 (site facturé au DJU) : C/C0 de l'exercice, dû et régularisation : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exerciceDe, prixAnnuel, type PartieFacturee } from '../src/lib/billing/p1-prix-annuel';
import { regularisationP1, type RegulDocument } from '../src/lib/billing/p1-regularisation';
import { parseTermes, type FormuleVersion, type SerieValues } from '../src/lib/p1/formules';

const version = (plus: Partial<FormuleVersion> = {}): FormuleVersion => ({
    forme: 'B', mode: 'standard', baseEnergetique: 'PCS', unitePrix: 'EUR/MWh', dateM0: '2024-12', m0Manquante: null, regimeKmol: 'variable', prixMoleculeNegocie: null,
    prixFixe: false, periodicite: 'annuel_dju', termes: parseTermes('Kmol=1*PEG@20') as never, ...plus,
});
// C/C0 : janvier 1,0 ; février 1,2 ; mars 1,5 ; décembre 2,0.
const series: SerieValues = new Map([['PEG', [{ period: '2025-01', value: 20 }, { period: '2025-02', value: 24 }, { period: '2025-03', value: 30 }, { period: '2025-12', value: 40 }]]]);
// Base 12 000 €, 1 500 DJU contractuels : 8 € par DJU au coefficient 1. Chaque mois facturé au prix du mois.
const partie = (mois: string, debut: string, fin: string, dju: number, c: number): PartieFacturee => ({ mois, debut, fin, dju, base: 12000, djuReference: 1500, montant: Math.round(8 * c * dju * 100) / 100 });
const parties = [partie('2025-01', '2025-01-01', '2025-01-31', 300, 1), partie('2025-02', '2025-02-01', '2025-02-28', 200, 1.2), partie('2025-03', '2025-03-01', '2025-03-10', 100, 1.5)];
const ex2025 = exerciceDe('2025-03', 'annee_civile');

test('exercice : année civile ou saison de chauffe (juillet → juin)', () => {
    assert.deepEqual(ex2025, { libelle: '2025', debut: '2025-01', fin: '2025-12' });
    assert.deepEqual(exerciceDe('2025-03', 'saison_de_chauffe'), { libelle: '2024-2025', debut: '2024-07', fin: '2025-06' });
    assert.deepEqual(exerciceDe('2025-07', 'saison_de_chauffe'), { libelle: '2025-2026', debut: '2025-07', fin: '2026-06' });
});

test('prix annuel : C/C0 pondéré par les DJU, par les jours, ou du mois de clôture ; dû recalculé mois par mois', () => {
    // Pondéré par les DJU : (1 × 300 + 1,2 × 200 + 1,5 × 100) / 600 = 1,15.
    const dju = prixAnnuel({ exercice: ex2025, version: version(), series, parties });
    assert.ok(typeof dju !== 'string');
    assert.deepEqual([+dju.coefficient.toFixed(10), dju.dju, dju.facture, dju.du], [1.15, 600, 2400 + 1920 + 1200, 8 * 1.15 * 600]);
    assert.deepEqual(dju.mois.map(m => [m.mois, m.dju, m.facture, m.du]), [['2025-01', 300, 2400, 2760], ['2025-02', 200, 1920, 1840], ['2025-03', 100, 1200, 920]]);
    // Pondéré par les jours facturés : (1 × 31 + 1,2 × 28 + 1,5 × 10) / 69.
    const temps = prixAnnuel({ exercice: ex2025, version: version({ periodicite: 'annuel_temps' }), series, parties });
    assert.ok(typeof temps !== 'string');
    assert.equal(+temps.coefficient.toFixed(10), +((31 + 1.2 * 28 + 15) / 69).toFixed(10));
    // Mois de clôture (décembre : 2,0), arrondi comme la formule.
    const cloture = prixAnnuel({ exercice: ex2025, version: version({ periodicite: 'annuel_cloture', arrondiCoefficient: 5 }), series, parties });
    assert.ok(typeof cloture !== 'string');
    assert.deepEqual([cloture.coefficient, cloture.du], [2, 8 * 2 * 600]);
    // Deux parties dans le même mois (bases différentes) : chacune garde sa base.
    const deux = prixAnnuel({ exercice: ex2025, version: version(), series, parties: [parties[0], { ...parties[0], base: 6000, montant: 1200 }] });
    assert.ok(typeof deux !== 'string');
    assert.deepEqual([deux.coefficient, deux.mois[0].facture, deux.mois[0].du, deux.mois[0].dju], [1, 3600, 3600, 600]);
});

test('prix annuel : refus (prix mensuel, rien de facturé, indice absent)', () => {
    assert.match(prixAnnuel({ exercice: ex2025, version: version({ periodicite: 'mensuel' }), series, parties }) as string, /prix mensuel/);
    assert.match(prixAnnuel({ exercice: exerciceDe('2026-02', 'annee_civile'), version: version(), series, parties }) as string, /aucune facture au DJU sur l'exercice 2026/);
    assert.match(prixAnnuel({ exercice: ex2025, version: version(), series: new Map(), parties }) as string, /01\/2025 : aucune valeur de l'indice PEG/);
});

test('régularisation : les mois facturés au DJU se comparent au dû de l\'exercice ; sans prix annuel ils ne comptent pas', () => {
    const pa = prixAnnuel({ exercice: ex2025, version: version(), series, parties });
    assert.ok(typeof pa !== 'string');
    const documents: RegulDocument[] = [{ id: 'f1', kind: 'invoice', status: 'due', lineItems: parties.map(p => ({ vatRate: 20, p1Dju: { siteId: 's', base: p.base, djuReference: p.djuReference, montant: p.montant, mois: [{ mois: p.mois, debut: p.debut, fin: p.fin, dju: p.dju, coefficient: 1, revise: p.base, montant: p.montant }] } })) }];
    const mois = ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12'];
    const site = { id: 's', name: 'Mairie', activityCode: 'P1' };
    const r = regularisationP1({ mois, sites: [{ ...site, prixAnnuel: [pa] }], reel: new Map([['s', new Map(pa.mois.map(m => [`chauffage|${m.mois}`, m.du]))]]), documents, interests: [] });
    assert.deepEqual(r.errors, []);
    // Pondéré par les DJU, le dû de l'exercice égale ici le facturé : écart nul, aucune ligne émise ; le détail le montre.
    assert.deepEqual([r.lines.length, r.acompteInvoiceIds], [0, ['f1']]);
    assert.deepEqual(r.detail, [{ siteId: 's', site: 'Mairie', usage: 'chauffage', reel: 5520, acomptes: 5520, ecart: 0 }]);
    // Au mois de clôture (C/C0 = 2) : dû 9 600 − facturé 5 520 = 4 080 à facturer.
    const cl = prixAnnuel({ exercice: ex2025, version: version({ periodicite: 'annuel_cloture' }), series, parties });
    assert.ok(typeof cl !== 'string');
    const rc = regularisationP1({ mois, sites: [{ ...site, prixAnnuel: [cl] }], reel: new Map([['s', new Map(cl.mois.map(m => [`chauffage|${m.mois}`, m.du]))]]), documents, interests: [] });
    assert.equal(rc.lines[0].total, 4080);
    assert.match(rc.lines[0].description.replace(/[  ]/g, ' '), /^Régularisation P1 chauffage au prix annuel — Site : Mairie — exercice 2025 : C\/C0 annuel 2 \(mois de clôture de l'exercice\), 600,00 DJU : dû 9 600,00 € − facturé au prix du mois 5 520,00 €$/);
    assert.deepEqual((rc.lines[0].p1Regul as { mois: string[]; prixAnnuel: unknown[] }).mois, ['2025-01', '2025-02', '2025-03']);
    // Site au DJU à prix mensuel : ses factures ne sont pas des acomptes, rien à régulariser.
    assert.deepEqual(regularisationP1({ mois, sites: [site], reel: new Map(), documents, interests: [] }).lines, []);
});
