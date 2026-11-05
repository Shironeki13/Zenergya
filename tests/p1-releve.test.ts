// ECS au relevé (calcul pur) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueInvoiceLines, type BillingInput, type ReleveReading } from '../src/lib/billing/contract-billing';
import { regularisationP1, type RegulDocument } from '../src/lib/billing/p1-regularisation';

const readings: ReleveReading[] = [
    { id: 'r0', date: '2025-09-30', value: 1000 },
    { id: 'r1', date: '2025-10-31', value: 1040 },
    { id: 'r2', date: '2025-11-28', value: 1100, type: 'ESTIME' },
];
const input = (patch: Partial<BillingInput> = {}, svc: Record<string, unknown> = {}, meter: Partial<{ unit: string; readings: ReleveReading[] }> = {}): BillingInput => ({
    contract: { id: 'k', siteIds: ['s'], activityIds: ['p1'], startDate: '2025-10-01', endDate: '2026-09-30', billingSchedule: 'Mensuel' },
    sites: [{ id: 's', name: 'Résidence', amountsSource: 'services' }],
    services: [{
        id: 'e', siteId: 's', contractId: 'k', activityId: 'p1', price: 0, startDate: '2025-10-01', vatRateId: 'v', billingTermId: 'echu',
        p1Mode: 'releve', p1Type: 'ECS', coefficientPrix: 1.1, ...svc,
    }],
    activities: [{ id: 'p1', code: 'P1', label: 'Eau chaude' }], vatRates: [{ id: 'v', code: 'TVA20', rate: 20 }],
    schedules: [{ id: 'trim', name: 'Trimestriel' }], terms: [{ id: 'echu', name: 'Échu' }, { id: 'echoir', name: 'À échoir' }],
    p1: { quantite: () => 0, repartition: () => [], prix: () => 6.5 },
    releves: { meters: () => [{ id: 'm', code: 'CPT-ECS', unit: 'm3', readings, ...meter }] },
    ...patch,
});

test('chaque mois : index du mois − index précédent, × prix au m³ × coefficient ; mois enchaînés', () => {
    const oct = dueInvoiceLines(input(), [], '2025-11-01');
    assert.deepEqual(oct.errors, []);
    // Octobre : 1 040 − 1 000 = 40 m³ × 6,5 × 1,1 = 7,15 €/m³ → 286 €.
    assert.deepEqual(oct.lines.map(l => [l.periodStartDate, l.p1Releve!.volume, l.p1Releve!.prix, l.total, l.vatRate]), [['2025-10-01', 40, 7.15, 286, 20]]);
    assert.match(oct.lines[0].description, /^ECS au relevé — .* CPT-ECS : 1\s040 \(31\/10\/2025\) − 1\s000 \(30\/09\/2025\) = 40 m³ — 40 m³ × 7,15 €\/m³/);
    // Octobre et novembre ensemble : novembre part du relevé d'octobre (60 m³, relevé estimé signalé).
    const both = dueInvoiceLines(input(), [], '2025-12-01');
    assert.deepEqual(both.lines.map(l => [l.p1Releve!.compteurs[0].debut.readingId, l.p1Releve!.compteurs[0].fin.readingId, l.total]), [['r0', 'r1', 286], ['r1', 'r2', 429]]);
    assert.match(both.lines[1].description, /1\s100 \(28\/11\/2025, estime\)/);
    // Octobre facturé : novembre repart du dernier relevé facturé.
    const billed = [{ lineItems: [{ itemKey: 'svc:e', periodEndDate: '2025-10-31', p1Releve: oct.lines[0].p1Releve }] }];
    assert.deepEqual(dueInvoiceLines(input(), billed, '2025-12-01').lines.map(l => [l.periodStartDate, l.total]), [['2025-11-01', 429]]);
});

test('prix de la prestation × révision ; contrôles : relevé manquant, index en baisse, unité, terme, périodicité, type', () => {
    const presta = dueInvoiceLines(input({}, { p1PrixSource: 'prestation', unitPrice: 6, coefficientPrix: undefined }), [], '2025-11-01');
    assert.equal(presta.lines[0].total, 240);   // 40 m³ × 6 €/m³
    assert.match(dueInvoiceLines(input({}, { p1PrixSource: 'prestation', unitPrice: undefined }), [], '2025-11-01').errors[0], /prix unitaire de la prestation \(€\/m³\) non renseigné/);
    assert.match(dueInvoiceLines(input(), [], '2026-01-01').errors[0], /aucun relevé du compteur CPT-ECS en 12\/2025/);
    assert.match(dueInvoiceLines(input({}, {}, { readings: [readings[0], { id: 'x', date: '2025-10-31', value: 900 }] }), [], '2025-11-01').errors[0], /index du compteur CPT-ECS en baisse \(1000 → 900\)/);
    assert.match(dueInvoiceLines(input({}, {}, { unit: 'kWh' }), [], '2025-11-01').errors[0], /compteur ECS au m³ est attendu/);
    assert.match(dueInvoiceLines(input({}, {}, { readings: readings.slice(1) }), [], '2025-11-01').errors[0], /avant 10\/2025 \(index de départ\)/);
    assert.match(dueInvoiceLines(input({}, { billingTermId: 'echoir' }), [], '2025-11-01').errors[0], /facturée à terme échu/);
    assert.match(dueInvoiceLines(input({}, { scheduleId: 'trim' }), [], '2025-11-01').errors[0], /périodicité mensuelle attendue/);
    assert.match(dueInvoiceLines(input({}, { p1Type: 'CHAUFFAGE' }), [], '2025-11-01').errors[0], /P1 ECS seulement/);
    assert.match(dueInvoiceLines(input({ releves: undefined }), [], '2025-11-01').errors[0], /relevés indisponibles/);
});

test('régularisation d\'un site à l\'ECS au relevé : chauffage seul, réel total refusé', () => {
    const docs: RegulDocument[] = [{ id: 'f', kind: 'invoice', lineItems: [{ vatRate: 5.5, p1Acompte: { siteId: 's', usage: 'chauffage', mois: [{ mois: '2025-10', quantite: 150, prix: 80, montant: 12000 }] } }] }];
    const sites = [{ id: 's', name: 'Résidence', activityCode: 'P1', vatRates: { chauffage: 5.5, ecs: 20 }, ecsAuReleve: true }];
    const ok = regularisationP1({ mois: ['2025-10'], sites, documents: docs, interests: [], reel: new Map([['s', new Map([['chauffage|2025-10', 11800], ['ecs|2025-10', 400]])]]) });
    assert.deepEqual(ok.errors, []);
    assert.deepEqual(ok.lines.map(l => [l.total, (l.p1Regul as { usage: string }).usage]), [[-200, 'chauffage']]);   // ECS ignorée : déjà au réel
    const total = regularisationP1({ mois: ['2025-10'], sites, documents: docs, interests: [], reel: new Map([['s', new Map([['total|2025-10', 12200]])]]) });
    assert.match(total.errors[0], /ECS facturée au relevé, le réel total la compterait deux fois/);
});
