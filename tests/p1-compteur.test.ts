// Facturation P1 au compteur (chauffage, ECS) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversion, factureAuCompteur, moisCouverts, type CompteurFacture, type ContexteCompteur } from '../src/lib/billing/p1-compteur';
import { dueInvoiceLines, type BillingInput } from '../src/lib/billing/contract-billing';
import { controleChangement, correctionChangements, lireChangement, resoudreDoublons, texteDoublon } from '../src/lib/releves';
import { texteCompteur } from '../src/lib/billing/p1-compteur';

// Gaz en m³, QE 0,0105 MWh/m³ ; relevés de fin de mois.
const gaz: CompteurFacture = {
    id: 'g', code: 'CPT-GAZ', unit: 'm3', signe: 1, qe: 0.0105, readings: [
        { id: 'g8', date: '2025-08-31', value: 96000 }, { id: 'g9', date: '2025-09-30', value: 100000 }, { id: 'g10', date: '2025-10-31', value: 110000 },
        { id: 'g11', date: '2025-11-30', value: 125000 }, { id: 'g12', date: '2025-12-31', value: 145000 },
        { id: 'g12b', date: '2025-12-15', value: 135000 },
    ],
};
// ECS déduite (formule de NC : gaz − ECS), en MWh.
const ecs: CompteurFacture = { id: 'e', code: 'CPT-ECS-MWH', unit: 'MWh', signe: -1, qe: null, readings: [
    { id: 'e9', date: '2025-09-30', value: 50 }, { id: 'e10', date: '2025-10-31', value: 55 }, { id: 'e11', date: '2025-11-30', value: 61 }, { id: 'e12', date: '2025-12-31', value: 68 },
] };
const ctx = (p: Partial<ContexteCompteur> = {}): ContexteCompteur => ({
    siteId: 's', usage: 'chauffage', debut: '2025-10-01', fin: '2025-10-31', methode: 'releve_jours',
    compteurs: () => [gaz], prix: () => ({ prix: 80, base: 75, coefficient: 1.0666667, source: 'p1' }), coefGestion: () => null,
    dejaFacture: new Map(), ...p,
});

test('conversions : MWh, kWh, QE ; ECS au m³ ; QE inconnu refusé (jamais 1 par défaut)', () => {
    assert.deepEqual([conversion({ code: 'a', unit: 'MWh', qe: null }, 'chauffage'), conversion({ code: 'a', unit: 'kWh', qe: null }, 'chauffage'), conversion({ code: 'a', unit: 'm³', qe: 0.0105 }, 'chauffage')], [1, 0.001, 0.0105]);
    assert.match(String(conversion({ code: 'CPT-X', unit: 'm3', qe: null }, 'chauffage')), /QE\) du compteur CPT-X \(m3\) non renseigné/);
    assert.equal(conversion({ code: 'a', unit: 'm3', qe: null }, 'ecs'), 1);
    assert.match(String(conversion({ code: 'CPT-E', unit: 'kWh', qe: null }, 'ecs')), /ECS au m³ est attendu/);
    assert.deepEqual(moisCouverts('2025-11-15', '2026-01-10'), ['2025-11', '2025-12', '2026-01']);
});

test('chauffage mensuel : (index M − index M-1) × QE × prix ; coefficient de gestion', () => {
    const r = factureAuCompteur(ctx());
    assert.ok(typeof r !== 'string');
    // 110 000 − 100 000 = 10 000 m³ × 0,0105 = 105 MWh × 80 € = 8 400 €.
    assert.deepEqual([r.unite, r.quantite, r.montant, r.detail[0].methode], ['MWh', 105, 8400, 'complet']);
    const avecCoef = factureAuCompteur(ctx({ coefGestion: () => 1.05 }));
    assert.ok(typeof avecCoef !== 'string');
    assert.deepEqual([avecCoef.detail[0].prixApplique, avecCoef.montant], [84, 8820]);
    assert.match(String(factureAuCompteur(ctx({ coefGestion: () => 'coefficient de gestion du contrat non renseigné' }))), /coefficient de gestion du contrat/);
});

test('trimestriel : 3 mois détaillés, enchaînés (index de fin du mois = index de départ du suivant) ; formule de NC gaz − ECS', () => {
    const r = factureAuCompteur(ctx({ fin: '2025-12-31', compteurs: () => [gaz, ecs], prix: m => ({ prix: m === '2025-12' ? 82 : 80, base: 75, coefficient: null, source: 'p1' }) }));
    assert.ok(typeof r !== 'string');
    // Octobre : 105 − 5 = 100 MWh ; novembre : 157,5 − 6 = 151,5 ; décembre : 210 − 7 = 203 (au relevé du 31/12, pas du 15/12).
    assert.deepEqual(r.detail.map(m => [m.mois, m.quantite, m.prixApplique, m.montant]), [['2025-10', 100, 80, 8000], ['2025-11', 151.5, 80, 12120], ['2025-12', 203, 82, 16646]]);
    assert.deepEqual(r.detail[1].compteurs.map(c => [c.code, c.debut.readingId, c.fin.readingId, c.quantite]), [['CPT-GAZ', 'g10', 'g11', 157.5], ['CPT-ECS-MWH', 'e10', 'e11', -6]]);
    assert.equal(r.montant, 36766);
});

test('déjà facturé : repart du dernier relevé facturé ; relevé manquant ou index en baisse bloquent', () => {
    const r = factureAuCompteur(ctx({ debut: '2025-11-01', fin: '2025-11-30', dejaFacture: new Map([['g', { readingId: 'g10', date: '2025-10-31', index: 110000 }]]) }));
    assert.ok(typeof r !== 'string');
    assert.equal(r.quantite, 157.5);
    assert.match(String(factureAuCompteur(ctx({ debut: '2026-01-01', fin: '2026-01-31' }))), /aucun relevé du compteur CPT-GAZ en 01\/2026/);
    const baisse = { ...gaz, readings: [gaz.readings[1], { id: 'x', date: '2025-10-31', value: 90000 }] };
    assert.match(String(factureAuCompteur(ctx({ compteurs: () => [baisse] }))), /en baisse \(100000 → 90000\)/);
    assert.match(String(factureAuCompteur(ctx({ compteurs: () => [ecs] }))), /quantité négative/);
});

test('mois partiel : relevé à la date s\'il existe, sinon jours ou DJU, selon la méthode', () => {
    // Fin de contrat le 15/12 : relevé du 15/12 → consommation réelle du 01/12 au 15/12.
    const releve = factureAuCompteur(ctx({ debut: '2025-12-01', fin: '2025-12-15', dejaFacture: new Map([['g', { readingId: 'g11', date: '2025-11-30', index: 125000 }]]) }));
    assert.ok(typeof releve !== 'string');
    assert.deepEqual([releve.detail[0].methode, releve.detail[0].compteurs[0].fin.readingId, releve.quantite], ['releve', 'g12b', 105]);
    // Sans relevé à la date (fin le 10/12) : mois complet (20 000 m³ = 210 MWh) × 10/31.
    const jours = factureAuCompteur(ctx({ debut: '2025-12-01', fin: '2025-12-10', dejaFacture: new Map([['g', { readingId: 'g11', date: '2025-11-30', index: 125000 }]]) }));
    assert.ok(typeof jours !== 'string');
    assert.deepEqual([jours.detail[0].methode, jours.detail[0].quantiteMois, jours.detail[0].ratio, jours.quantite], ['jours', 210, 0.322581, 67.741935]);
    // Méthode « jours » imposée : même avec le relevé du 15/12.
    const imposee = factureAuCompteur(ctx({ methode: 'jours', debut: '2025-12-01', fin: '2025-12-15', dejaFacture: new Map([['g', { readingId: 'g11', date: '2025-11-30', index: 125000 }]]) }));
    assert.ok(typeof imposee !== 'string');
    assert.deepEqual([imposee.detail[0].methode, imposee.quantite], ['jours', 101.612903]);
    // DJU : 200 DJU sur le mois, 120 sur la partie couverte.
    const dju = factureAuCompteur(ctx({ methode: 'dju', debut: '2025-12-01', fin: '2025-12-15', dju: (d, f) => (f === '2025-12-31' ? 200 : 120), dejaFacture: new Map([['g', { readingId: 'g11', date: '2025-11-30', index: 125000 }]]) }));
    assert.ok(typeof dju !== 'string');
    assert.deepEqual([dju.detail[0].methode, dju.detail[0].dju, dju.quantite], ['dju', { couverts: 120, mois: 200 }, 126]);
    assert.match(String(factureAuCompteur(ctx({ methode: 'dju', debut: '2025-12-01', fin: '2025-12-10' }))), /DJU de la station du site indisponibles/);
});

// --- Dans le moteur de facturation : prestation P1 chauffage au compteur, trimestrielle ---
const input = (svc: Record<string, unknown> = {}, patch: Partial<BillingInput> = {}): BillingInput => ({
    contract: { id: 'k', siteIds: ['s'], activityIds: ['p1'], startDate: '2025-10-01', endDate: '2026-09-30' },
    sites: [{ id: 's', name: 'Chaufferie', contractId: 'k' }],
    services: [{ id: 'c', siteId: 's', contractId: 'k', activityId: 'p1', price: 0, startDate: '2025-10-01', vatRateId: 'v', billingTermId: 'echu', scheduleId: 'trim', p1Mode: 'releve', p1Type: 'CHAUFFAGE', ...svc }],
    activities: [{ id: 'p1', code: 'P1', label: 'Fourniture de chaleur' }], vatRates: [{ id: 'v', code: 'TVA5,5', rate: 5.5 }],
    schedules: [{ id: 'trim', name: 'Trimestriel' }, { id: 'mens', name: 'Mensuel' }], terms: [{ id: 'echu', name: 'Terme échu' }],
    p1: { quantite: () => 0, repartition: () => [], prix: () => 80, prixDetail: () => ({ prix: 80, base: 75, coefficient: 1.066667, source: 'p1' }) },
    releves: { meters: () => [gaz, ecs], coefContrat: () => 1.02 },
    ...patch,
});

test('moteur : trimestre facturé le lendemain de sa fin, une ligne avec ses 3 mois ; coefficient du contrat ; relevés figés', () => {
    assert.match(dueInvoiceLines(input(), [], '2025-12-31').errors[0] ?? 'Rien', /Rien/);   // pas encore échu
    const r = dueInvoiceLines(input({ p1CoefGestion: 'contrat' }), [], '2026-01-01');
    assert.deepEqual(r.errors, []);
    assert.equal(r.lines.length, 1);
    const l = r.lines[0];
    assert.deepEqual([l.periodStartDate, l.periodEndDate, l.p1Releve!.usage, l.p1Releve!.unite, l.p1Releve!.detail!.length], ['2025-10-01', '2025-12-31', 'chauffage', 'MWh', 3]);
    // (100 + 151,5 + 203) MWh × 80 × 1,02 = 37 087,20 €.
    assert.deepEqual([l.p1Releve!.volume, l.total], [454.5, 37087.2]);
    assert.match(l.description, /^P1 au compteur \(chauffage\) — .* 10\/2025 : CPT-GAZ .* → 100 MWh × 81,6 €\/MWh = 8\s160,00 €/);
    // Tous les relevés pris sont tracés (figés) : 2 compteurs × 3 mois.
    assert.equal(l.p1Releve!.compteurs.length, 6);
    assert.match(dueInvoiceLines(input({ p1CoefGestion: 'prestation' }), [], '2026-01-01').errors[0], /coefficient de gestion de la prestation non renseigné/);
    assert.equal(dueInvoiceLines(input({ p1CoefGestion: 'prestation', coefficientPrix: 1.1 }), [], '2026-01-01').lines[0].total, 39996);
    assert.equal(dueInvoiceLines(input(), [], '2026-01-01').lines[0].total, 36360);   // sans coefficient
});

test('moteur : même compteur dans deux prestations (ECS facturée et déduite du chauffage) ; début en cours de mois calé sur les mois civils', () => {
    const ecsM3: CompteurFacture = { id: 'w', code: 'CPT-ECS', unit: 'm3', signe: 1, qe: 0.058, readings: [
        { id: 'w9', date: '2025-09-30', value: 1000 }, { id: 'w10', date: '2025-10-31', value: 1100 }, { id: 'w11', date: '2025-11-30', value: 1220 }, { id: 'w12', date: '2025-12-31', value: 1350 },
    ] };
    const deux = input({}, {
        contract: { id: 'k', siteIds: ['s'], activityIds: ['p1', 'p1e'], startDate: '2025-10-01', endDate: '2026-09-30' },
        activities: [{ id: 'p1', code: 'P1', label: 'Chaleur' }, { id: 'p1e', code: 'P1E', label: 'Eau chaude' }],
        services: [
            { id: 'c', siteId: 's', contractId: 'k', activityId: 'p1', price: 0, startDate: '2025-10-01', vatRateId: 'v', billingTermId: 'echu', scheduleId: 'trim', p1Mode: 'releve', p1Type: 'CHAUFFAGE' },
            { id: 'w', siteId: 's', contractId: 'k', activityId: 'p1e', price: 0, startDate: '2025-10-01', vatRateId: 'v', billingTermId: 'echu', scheduleId: 'mens', p1Mode: 'releve', p1Type: 'ECS', meterId: 'w' },
        ],
        releves: { meters: (_s, meterId) => (meterId ? [ecsM3] : [gaz, { ...ecsM3, signe: -1 as const }]) },
    });
    const r = dueInvoiceLines(deux, [], '2026-01-01');
    assert.deepEqual(r.errors, []);
    // ECS : 3 lignes mensuelles (100, 120, 130 m³) ; chauffage : 1 ligne trimestrielle, ECS déduite (100 × 0,058 = 5,8 MWh en octobre).
    assert.deepEqual(r.lines.filter(l => l.activityCode === 'P1E').map(l => l.p1Releve!.volume), [100, 120, 130]);
    const ch = r.lines.find(l => l.activityCode === 'P1')!;
    assert.deepEqual(ch.p1Releve!.detail!.map(m => m.quantite), [99.2, 150.54, 202.46]);
    // Facturé : la suite repart du dernier index de chaque prestation.
    const billed = [{ lineItems: r.lines.map(l => ({ itemKey: l.itemKey, periodEndDate: l.periodEndDate, p1Releve: l.p1Releve })) }];
    assert.deepEqual(dueInvoiceLines(deux, billed, '2026-01-01').lines, []);

    // Début le 15/09 : septembre (15 → 30, prorata), puis octobre complet.
    const mi = dueInvoiceLines(input({ scheduleId: 'mens', startDate: '2025-09-15' }, { contract: { id: 'k', siteIds: ['s'], activityIds: ['p1'], startDate: '2025-09-15', endDate: '2026-09-30' }, releves: { meters: () => [gaz] } }), [], '2025-11-01');
    assert.deepEqual(mi.errors, []);
    assert.deepEqual(mi.lines.map(l => [l.periodStartDate, l.periodEndDate, l.p1Releve!.detail![0].methode]), [['2025-09-15', '2025-09-30', 'jours'], ['2025-10-01', '2025-10-31', 'complet']]);
});

test('changement de compteur : (dépose − relevé précédent) + (index du nouveau − pose) ; index en baisse sans changement toujours refusé', () => {
    // Fin septembre 100 000 ; compteur changé le 20/10 (ancien déposé à 108 000, nouveau posé à 20) ; fin octobre 500 sur le nouveau.
    const base = [{ id: 'a', date: '2025-09-30', value: 100000 }];
    const change = { ...gaz, readings: [...base, { id: 'c', date: '2025-10-20', value: 20, changement: { depose: 108000, pose: 20 } }, { id: 'b', date: '2025-10-31', value: 500 }] };
    const r = factureAuCompteur(ctx({ compteurs: () => [change] }));
    assert.ok(typeof r !== 'string');
    const c = r.detail[0].compteurs[0];
    assert.deepEqual([c.debut.index, c.fin.index, c.volume, c.changements], [100000, 500, 8480, [{ date: '2025-10-20', depose: 108000, pose: 20 }]]);
    assert.equal(r.quantite, 89.04);   // 8 480 m³ × 0,0105
    assert.match(texteCompteur(r).replace(/[\u202f\u00a0]/g, ' '), /compteur changé le 20\/10\/2025 \(dépose 108 000, pose 20\)/);
    // Le relevé de fin de mois porte lui-même le changement.
    const fin = { ...gaz, readings: [...base, { id: 'b', date: '2025-10-31', value: 500, changement: { depose: 108000, pose: 20 } }] };
    const rf = factureAuCompteur(ctx({ compteurs: () => [fin] }));
    assert.ok(typeof rf !== 'string');
    assert.equal(rf.detail[0].compteurs[0].volume, 8480);
    // Le mois suivant repart du nouveau compteur, sans reprendre le changement (il précède l'index de départ).
    const nov = factureAuCompteur(ctx({ debut: '2025-11-01', fin: '2025-11-30', compteurs: () => [{ ...change, readings: [...change.readings, { id: 'n', date: '2025-11-30', value: 1500 }] }], dejaFacture: new Map([['g', { readingId: 'b', date: '2025-10-31', index: 500 }]]) }));
    assert.ok(typeof nov !== 'string');
    assert.deepEqual([nov.detail[0].compteurs[0].volume, nov.detail[0].compteurs[0].changements], [1000, undefined]);
    // Sans changement déclaré, la baisse bloque et dit quoi faire ; index de dépose incohérent : refus aussi.
    assert.match(String(factureAuCompteur(ctx({ compteurs: () => [{ ...gaz, readings: [...base, { id: 'b', date: '2025-10-31', value: 500 }] }] }))), /en baisse \(100000 → 500\) : changement de compteur à déclarer sur le relevé/);
    assert.match(String(factureAuCompteur(ctx({ compteurs: () => [{ ...gaz, readings: [...base, { id: 'b', date: '2025-10-31', value: 500, changement: { depose: 90000, pose: 20 } }] }] }))), /consommation négative du compteur CPT-GAZ .* malgré le changement de compteur/);
    // Contrôles de saisie.
    assert.equal(controleChangement(null, 10), null);
    assert.equal(controleChangement({ depose: 108000, pose: 20 }, 500), null);
    assert.match(String(controleChangement({ depose: 108000 }, 500)), /index de pose du nouveau compteur obligatoire/);
    assert.match(String(controleChangement({ pose: 20 }, 500)), /index de dépose de l'ancien compteur obligatoire/);
    assert.match(String(controleChangement({ depose: 108000, pose: 600 }, 500)), /ne peut pas être inférieur à son index de pose/);
    assert.deepEqual([lireChangement({ depose: 1, pose: 0 }), lireChangement({ depose: 1 }), lireChangement(undefined)], [{ depose: 1, pose: 0 }, null, null]);
    assert.equal(correctionChangements(change.readings, '2025-09-30', '2025-10-31'), 107980);
    assert.equal(correctionChangements(change.readings, '2025-10-20', '2025-10-31'), 0);
});

test('relevés en double le même jour : le plus proche du précédent est retenu, signalé dans le détail ; le changement de compteur l\'emporte', () => {
    const r = (id: string, date: string, value: number, plus: object = {}) => ({ id, date, value, ...plus });
    // Un index à zéro saisi par erreur le même jour que le bon : écarté.
    const serie = [r('a', '2025-09-30', 100000), r('z', '2025-10-31', 0), r('b', '2025-10-31', 110000), r('c', '2025-11-30', 125000)];
    const res = resoudreDoublons(serie);
    assert.deepEqual([res.retenus.map(x => x.id), res.doublons], [['a', 'b', 'c'], [{ date: '2025-10-31', retenu: 110000, ecartes: [0], motif: res.doublons[0].motif }]]);
    assert.equal(texteDoublon(res.doublons[0], 'm³').replace(/[\u202f\u00a0]/g, ' '), "Deux relevés le 31/10/2025 : 110 000 et 0 m³. L'index 110 000 est retenu, le plus proche du relevé précédent (100 000).");
    // En tête de série : le plus proche du relevé suivant ; seul : le plus grand ; même index deux fois : pas une anomalie.
    assert.deepEqual(resoudreDoublons([r('x', '2025-09-30', 5), r('a', '2025-09-30', 100000), r('b', '2025-10-31', 110000)]).retenus.map(x => x.id), ['a', 'b']);
    assert.deepEqual(resoudreDoublons([r('x', '2025-09-30', 5), r('a', '2025-09-30', 9)]).retenus.map(x => x.id), ['a']);
    assert.deepEqual(resoudreDoublons([r('a', '2025-09-30', 9), r('b', '2025-09-30', 9)]).doublons, []);
    // Trois relevés le même jour.
    const trois = resoudreDoublons([r('a', '2025-09-30', 100), r('b', '2025-10-31', 150), r('c', '2025-10-31', 900), r('d', '2025-10-31', 0)]);
    assert.deepEqual([trois.retenus.map(x => x.id), trois.doublons[0].ecartes.sort()], [['a', 'b'], [0, 900]]);
    assert.match(texteDoublon(trois.doublons[0]), /^3 relevés le 31\/10\/2025 : 150 et /);
    // Le relevé qui porte le changement de compteur l'emporte, même plus éloigné du précédent.
    const chg = resoudreDoublons([r('a', '2025-09-30', 100000), r('b', '2025-10-31', 108000), r('c', '2025-10-31', 20, { changement: { depose: 108000, pose: 20 } })]);
    assert.deepEqual([chg.retenus.map(x => x.id), chg.doublons[0].motif], [['a', 'c'], 'il porte le changement de compteur']);

    // Facturation : octobre sur l'index retenu (110 000), le doublon est cité dans le détail et le texte de la ligne.
    const f = factureAuCompteur(ctx({ compteurs: () => [{ ...gaz, readings: serie }] }));
    assert.ok(typeof f !== 'string');
    const c = f.detail[0].compteurs[0];
    assert.deepEqual([c.fin.readingId, c.fin.index, c.volume, c.doublons?.map(d => [d.date, d.retenu, d.ecartes])], ['b', 110000, 10000, [['2025-10-31', 110000, [0]]]]);
    assert.match(texteCompteur(f).replace(/[\u202f\u00a0]/g, ' '), /Deux relevés le 31\/10\/2025 : 110 000 et 0\. L'index 110 000 est retenu/);
    // Novembre repart du relevé retenu : pas de fausse baisse, et le doublon de l'index de départ reste cité.
    const nov = factureAuCompteur(ctx({ debut: '2025-11-01', fin: '2025-11-30', compteurs: () => [{ ...gaz, readings: serie }] }));
    assert.ok(typeof nov !== 'string');
    assert.deepEqual([nov.detail[0].compteurs[0].debut.index, nov.detail[0].compteurs[0].volume, nov.detail[0].compteurs[0].doublons?.length], [110000, 15000, 1]);
});

test('passage par zéro : facturé si la capacité du compteur est déclarée (index + capacité − index précédent), sinon bloqué', () => {
    // Compteur à 6 chiffres : 999 400 fin septembre, 600 fin octobre → 1 200 m³.
    const lectures = [{ id: 'a', date: '2025-09-30', value: 999400 }, { id: 'b', date: '2025-10-31', value: 600 }];
    const sans = factureAuCompteur(ctx({ compteurs: () => [{ ...gaz, readings: lectures }] }));
    assert.match(String(sans), /en baisse \(999400 → 600\) : changement de compteur à déclarer .* capacité du compteur à renseigner s'il est repassé par zéro/);
    const avec = factureAuCompteur(ctx({ compteurs: () => [{ ...gaz, capacite: 1000000, readings: lectures }] }));
    assert.ok(typeof avec !== 'string');
    assert.deepEqual([avec.detail[0].compteurs[0].volume, avec.detail[0].compteurs[0].passageZero, avec.quantite], [1200, { capacite: 1000000 }, 12.6]);
    assert.match(texteCompteur(avec).replace(/[\u202f\u00a0]/g, ' '), /passage par zéro \(capacité 1 000 000\)/);
    // Capacité incohérente (index précédent au-dessus) : refus. Sans baisse, la capacité ne joue pas.
    assert.match(String(factureAuCompteur(ctx({ compteurs: () => [{ ...gaz, capacite: 100000, readings: lectures }] }))), /supérieur à sa capacité déclarée \(100000\)/);
    const normal = factureAuCompteur(ctx({ compteurs: () => [{ ...gaz, capacite: 1000000 }] }));
    assert.ok(typeof normal !== 'string');
    assert.equal(normal.detail[0].compteurs[0].passageZero, undefined);
});
