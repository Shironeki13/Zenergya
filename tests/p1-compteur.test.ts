// Facturation P1 au compteur (chauffage, ECS) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversion, factureAuCompteur, moisCouverts, type CompteurFacture, type ContexteCompteur } from '../src/lib/billing/p1-compteur';
import { dueInvoiceLines, type BillingInput } from '../src/lib/billing/contract-billing';

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
