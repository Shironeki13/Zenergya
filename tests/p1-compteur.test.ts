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

// --- Répartition par mois calendaire ---
// Compteur ECS : 1 000 le 20/09, 1 100 le 10/10 (20 jours, 5 m³/j), 1 400 le 09/11 (30 jours, 10 m³/j), 1 610 le 30/11 (21 jours, 10 m³/j), 1 700 le 03/12 (3 jours, 30 m³/j).
const eau: CompteurFacture = { id: 'w', code: 'CPT-ECS', unit: 'm3', signe: 1, qe: null, readings: [
    { id: 'w1', date: '2025-09-20', value: 1000 }, { id: 'w2', date: '2025-10-10', value: 1100 }, { id: 'w3', date: '2025-11-09', value: 1400 },
    { id: 'w4', date: '2025-11-30', value: 1610 }, { id: 'w5', date: '2025-12-03', value: 1700 },
] };
const cal = (p: Partial<ContexteCompteur> = {}) => factureAuCompteur(ctx({ usage: 'ecs', repartition: 'calendaire', compteurs: () => [eau], prix: () => ({ prix: 6, base: 6, coefficient: 1, source: 'p1' }), ...p }));

test('mois calendaire : chaque intervalle entre relevés donne au mois la part de ses jours ; un mois sans relevé se facture', () => {
    // Octobre : 9 jours du 01 au 09 sur l'intervalle 20/09 → 10/10 (5 m³/j = 45) + 22 jours du 10 au 31 sur 10/10 → 09/11 (10 m³/j = 220) = 265 m³.
    const oct = cal();
    assert.ok(typeof oct !== 'string');
    const c = oct.detail[0].compteurs[0];
    assert.deepEqual([oct.detail[0].methode, oct.quantite, oct.montant, c.debut.readingId, c.fin.readingId], ['calendaire', 265, 1590, 'w1', 'w3']);
    assert.deepEqual(c.segments!.map(s => [s.debut.readingId, s.fin.readingId, s.jours, s.joursPris, s.volume, s.volumePris]), [['w1', 'w2', 20, 9, 100, 45], ['w2', 'w3', 30, 22, 300, 220]]);
    assert.match(texteCompteur(oct).replace(/[  ]/g, ' '), /10\/2025 : CPT-ECS : 100 du 20\/09\/2025 au 10\/10\/2025 × 9\/20 j \+ 300 du 10\/10\/2025 au 09\/11\/2025 × 22\/30 j → 265 m³/);
    // Novembre : 8 jours (80) + 21 jours (210) + le 30 novembre sur l'intervalle 30/11 → 03/12 (30) = 320 m³. Le trimestre enchaîne les mois.
    const trim = cal({ fin: '2025-11-30' });
    assert.ok(typeof trim !== 'string');
    assert.deepEqual(trim.detail.map(m => [m.mois, m.quantite]), [['2025-10', 265], ['2025-11', 320]]);
    // Total octobre + novembre + 2 jours de décembre (60) = toute la consommation depuis le 01/10 : rien de perdu, rien en double.
    assert.equal(265 + 320 + 60 + 55, 1700 - 1000);   // 55 m³ avant le 01/10 (11 jours de septembre)
    // Un mois sans aucun relevé se facture dès que les relevés l'encadrent.
    const sansReleve = cal({ debut: '2025-10-01', fin: '2025-10-31', compteurs: () => [{ ...eau, readings: [eau.readings[0], eau.readings[3]] }] });
    assert.ok(typeof sansReleve !== 'string');
    assert.equal(sansReleve.quantite, +((610 * 31) / 71).toFixed(6));
    // Mois partiel (prestation à partir du 16/10) : jour par jour, sans méthode de prorata.
    const partiel = cal({ debut: '2025-10-16' });
    assert.ok(typeof partiel !== 'string');
    assert.deepEqual([partiel.quantite, partiel.detail[0].jours], [160, 16]);
});

test('mois calendaire : attend le relevé suivant ; index de départ exigé ; changement de compteur réparti ; passage depuis le relevé à relevé', () => {
    // Décembre : dernier relevé le 03/12, le mois n'est pas encore couvert.
    assert.match(String(cal({ debut: '2025-12-01', fin: '2025-12-31' })), /relevé du compteur CPT-ECS postérieur au 31\/12\/2025 attendu : au mois calendaire, 12\/2025 se facture quand l'index suivant est connu \(dernier relevé le 03\/12\/2025\)/);
    // Novembre sans le relevé de décembre : le 30/11 n'est couvert par aucun intervalle.
    assert.match(String(cal({ debut: '2025-11-01', fin: '2025-11-30', compteurs: () => [{ ...eau, readings: eau.readings.slice(0, 4) }] })), /postérieur au 30\/11\/2025 attendu/);
    // Pas de relevé au début de la période.
    assert.match(String(cal({ debut: '2025-09-01', fin: '2025-09-30' })), /aucun relevé du compteur CPT-ECS le 01\/09\/2025 ou avant \(index de départ\)/);
    // Changement de compteur le 09/11 (ancien déposé à 1 400, nouveau posé à 0) : l'intervalle garde 300 m³, répartis comme avant.
    const change = { ...eau, readings: [eau.readings[0], eau.readings[1], { id: 'w3', date: '2025-11-09', value: 0, changement: { depose: 1400, pose: 0 } }, { id: 'w4', date: '2025-11-30', value: 210 }, { id: 'w5', date: '2025-12-03', value: 300 }] };
    const avecChangement = cal({ fin: '2025-11-30', compteurs: () => [change] });
    assert.ok(typeof avecChangement !== 'string');
    assert.deepEqual(avecChangement.detail.map(m => m.quantite), [265, 320]);
    assert.deepEqual(avecChangement.detail[0].compteurs[0].changements, [{ date: '2025-11-09', depose: 1400, pose: 0 }]);
    // Passage au mois calendaire après un octobre facturé au relevé à relevé jusqu'au relevé du 10/10 : novembre reprend à partir du 10/10.
    const passage = cal({ debut: '2025-11-01', fin: '2025-11-30', dejaFacture: new Map([['w', { readingId: 'w2', date: '2025-10-10', index: 1100 }]]) });
    assert.ok(typeof passage !== 'string');
    assert.equal(passage.quantite, 220 + 320);   // 10 → 31 octobre (220), puis novembre (320)
    // Déjà facturé au mois calendaire jusqu'au 31/10 : novembre seul ; le retour au relevé à relevé est refusé.
    const suite = cal({ debut: '2025-11-01', fin: '2025-11-30', dejaCalendaire: new Map([['w', '2025-10-31']]) });
    assert.ok(typeof suite !== 'string');
    assert.equal(suite.quantite, 320);
    assert.match(String(cal({ repartition: 'releve', debut: '2025-11-01', fin: '2025-11-30', dejaCalendaire: new Map([['w', '2025-10-31']]) })), /déjà facturé au mois calendaire jusqu'au 31\/10\/2025 : le retour au relevé à relevé n'est pas possible/);
});

test('moteur, mois calendaire : octobre puis novembre sur deux factures ; tous les relevés utilisés sont tracés pour être figés', () => {
    const svc = { p1Type: 'ECS', scheduleId: 'mens', p1Repartition: 'calendaire' };
    const src = { releves: { meters: () => [eau], coefContrat: () => 1 }, p1: { quantite: () => 0, repartition: () => [], prix: () => 6, prixDetail: () => ({ prix: 6, base: 6, coefficient: 1, source: 'p1' as const }) } };
    const oct = dueInvoiceLines(input(svc, src), [], '2025-11-01');
    assert.deepEqual(oct.errors, []);
    const l = oct.lines[0];
    assert.deepEqual([l.periodStartDate, l.p1Releve!.volume, l.total, l.p1Releve!.compteurs[0].calendaire, l.p1Releve!.compteurs[0].releves], ['2025-10-01', 265, 1590, true, ['w1', 'w2', 'w3']]);
    // Novembre, octobre étant facturé : il repart du 1er novembre, sans reprendre octobre.
    const facture = { id: 'f1', status: 'due', lineItems: oct.lines } as never;
    const nov = dueInvoiceLines(input(svc, src), [facture], '2025-12-04');
    assert.deepEqual(nov.errors, []);
    assert.deepEqual([nov.lines[0].periodStartDate, nov.lines[0].p1Releve!.volume, nov.lines[0].p1Releve!.compteurs[0].releves], ['2025-11-01', 320, ['w2', 'w3', 'w4', 'w5']]);
    // Décembre attend son relevé suivant : la facture le dit.
    const dec = dueInvoiceLines(input(svc, src), [facture, { id: 'f2', status: 'due', lineItems: nov.lines } as never], '2026-01-02');
    assert.match(dec.errors.join(' '), /ECS au compteur impossible : site Chaufferie, relevé du compteur CPT-ECS postérieur au 31\/12\/2025 attendu/);
});
