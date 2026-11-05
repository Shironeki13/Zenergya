// Acomptes P1 et régularisation (calcul pur) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acompteP1, billedUntil, billingItems, dueInvoiceLines, type BillingInput, type Echeance, type P1AcompteSource } from '../src/lib/billing/contract-billing';
import { regularisationP1, type RegulDocument } from '../src/lib/billing/p1-regularisation';
import { validateParam } from '../src/lib/p1/stockage';

const saison = [12.5, 12.5, 12.5, 12.5, 12.5, 0, 0, 0, 0, 12.5, 12.5, 12.5];
const source = (patch: Partial<P1AcompteSource> = {}): P1AcompteSource => ({
    quantite: () => 1200, repartition: () => saison, prix: (_s, m) => (m === '2025-12' ? 84 : 80), ...patch,
});

const input = (patch: Partial<BillingInput> = {}): BillingInput => ({
    contract: { id: 'k', siteIds: ['s'], activityIds: ['p1'], startDate: '2025-10-01', endDate: '2026-09-30', billingSchedule: 'Mensuel' },
    sites: [{ id: 's', name: 'Chaufferie', amountsSource: 'services' }],
    services: [{ id: 'a', siteId: 's', contractId: 'k', activityId: 'p1', price: 0, startDate: '2025-10-01', vatRateId: 'v', billingTermId: 'echoir', p1Mode: 'acompte' }],
    activities: [{ id: 'p1', code: 'P1', label: 'Énergie' }], vatRates: [{ id: 'v', code: 'TVA55', rate: 5.5 }],
    schedules: [], terms: [{ id: 'echoir', name: 'À échoir' }], p1: source(), ...patch,
});

test('acompte d\'une échéance : quantité × part du mois × prix révisé, au prorata des jours du mois', () => {
    const { items } = billingItems(input());
    const e = { item: items[0], start: '2025-10-16', end: '2025-12-31', days: 77, nominalDays: 92 } as Echeance;
    const r = acompteP1(e, source());
    assert.ok(typeof r !== 'string');
    // Octobre : 1 200 × 12,5 % × 16/31 = 77,419… MWh × 80 = 6 193,55 ; novembre : 150 × 80 = 12 000 ; décembre : 150 × 84 = 12 600.
    assert.deepEqual(r.mois.map(m => [m.mois, m.prix, m.montant]), [['2025-10', 80, 6193.55], ['2025-11', 80, 12000], ['2025-12', 84, 12600]]);
    assert.equal(r.total, 30793.55);
    assert.match(acompteP1(e, source({ quantite: () => 'quantité absente' })) as string, /quantité absente/);
    assert.match(acompteP1(e, source({ prix: () => 'indice manquant' })) as string, /prix 2025-10 : indice manquant/);
    assert.match(acompteP1(e, undefined) as string, /indisponible/);
});

test('facture : une ligne d\'acompte par échéance, détail mensuel conservé ; sans source P1, bloquée', () => {
    const due = dueInvoiceLines(input(), [], '2025-11-05');
    assert.deepEqual(due.errors, []);
    assert.deepEqual(due.lines.map(l => [l.periodStartDate, l.total, l.vatRate, l.p1Acompte?.mois.length]), [['2025-10-01', 12000, 5.5, 1], ['2025-11-01', 12000, 5.5, 1]]);
    assert.match(due.lines[0].description, /^Acompte Énergie .* acompte sur 150 MWh estimés au prix révisé P1 \(2025-10 : 80 €\/MWh\)/);
    assert.match(dueInvoiceLines(input({ p1: undefined }), [], '2025-11-05').errors[0], /Acompte P1 impossible : site Chaufferie, paramétrage P1 indisponible/);
    const global = dueInvoiceLines(input({ contract: { ...input().contract, invoicingType: 'global' } }), [], '2025-10-05');
    assert.match(global.errors[0], /facturation globale non prise en charge/);
    // Les mois régularisés comptent comme facturés pour les acomptes du site.
    const { items } = billingItems(input());
    const billed = billedUntil(items, [{ lineItems: [{ p1Regul: { siteId: 's', mois: ['2025-10', '2025-11'], reel: 1, acomptes: 1 } }] }]);
    assert.equal(billed.get('svc:a'), '2025-11-30');
});

test('répartition des acomptes : 12 parts sommant à 100 %', () => {
    assert.deepEqual(validateParam('contract', 'repartitionAcomptes', '12,5;12,5;12,5;12,5;12,5;0;0;0;0;12,5;12,5;12,5'), { value: saison });
    assert.match((validateParam('contract', 'repartitionAcomptes', '10;10') as { error: string }).error, /12 parts/);
    assert.match((validateParam('contract', 'repartitionAcomptes', Array(12).fill(8)) as { error: string }).error, /96 % au lieu de 100 %/);
    assert.ok('value' in validateParam('contract', 'repartitionAcomptes', Array(12).fill(8.3333)));
});

const acompte = (id: string, mois: string, montant: number, extra: Partial<RegulDocument> = {}): RegulDocument => ({
    id, kind: 'invoice', ...extra, lineItems: [{ vatRate: 5.5, p1Acompte: { siteId: 's', mois: [{ mois, quantite: 150, prix: 80, montant }] } }],
});
const sites = [{ id: 's', name: 'Chaufferie', activityCode: 'P1', vatRates: { chauffage: 5.5 } }];

test('régularisation : réel − acomptes par site, avoir si en faveur du client, intéressement, pas de double régularisation', () => {
    const reel = new Map([['s', new Map([['total|2025-10', 11000], ['total|2025-11', 12500]])]]);
    const documents = [acompte('f1', '2025-10', 12000), acompte('f2', '2025-11', 12000), acompte('f3', '2025-11', 999, { status: 'cancelled' }), acompte('p', '2025-11', 777, { status: 'proforma' })];
    const interests = [{ id: 'i1', siteId: 's', seasonLabel: '2025-2026', endDate: '2025-11-30', amount: 300 }, { id: 'i2', siteId: 's', seasonLabel: 'x', endDate: '2026-05-31', amount: 50 }];
    const r = regularisationP1({ mois: ['2025-10', '2025-11'], sites, reel, documents, interests });
    assert.deepEqual(r.errors, []);
    // Réel 23 500 − acomptes 24 000 = −500 (factures annulées et proformas ignorées) ; intéressement 300.
    assert.deepEqual(r.detail, [{ siteId: 's', site: 'Chaufferie', usage: 'total', reel: 23500, acomptes: 24000, ecart: -500 }]);
    assert.deepEqual(r.lines.map(l => [l.total, l.vatRate]), [[-500, 5.5], [300, 5.5]]);
    assert.deepEqual(r.acompteInvoiceIds.sort(), ['f1', 'f2']);

    // Réel manquant pour un mois facturé en acompte : bloquant.
    const sansReel = regularisationP1({ mois: ['2025-10', '2025-11'], sites, reel: new Map([['s', new Map([['total|2025-10', 1]])]]), documents, interests: [] });
    assert.match(sansReel.errors[0], /réel P1 du moteur non importé pour 11\/2025/);
    // Une fois régularisés (avoir émis), les mêmes mois et le même intéressement ne repassent pas.
    const regul: RegulDocument = { id: 'av', kind: 'creditNote', status: 'finalized', lineItems: [{ p1Regul: { siteId: 's', mois: ['2025-10', '2025-11'], reel: 23500, acomptes: 24000 } }, { p1Regul: { siteId: 's', interestId: 'i1' } }] };
    const again = regularisationP1({ mois: ['2025-11', '2025-12'], sites, reel, documents: [...documents, regul], interests });
    assert.match(again.errors[0], /11\/2025 déjà régularisé/);
    const later = regularisationP1({ mois: ['2025-12'], sites, reel, documents: [...documents, regul], interests });
    assert.deepEqual([later.errors, later.lines], [[], []]);
});

test('acomptes ECS : volume (m³) × part ECS × prix ECS ; seuls chauffage et ECS se facturent en acompte', () => {
    const ecsSource = source({
        quantite: (_s, _m, usage) => (usage === 'ecs' ? 2400 : 1200),
        repartition: (_m, usage) => (usage === 'ecs' ? Array(12).fill(100 / 12) : saison),
        prix: (_s, _m, usage) => (usage === 'ecs' ? 6.5 : 80),
    });
    const base = input({ p1: ecsSource });
    const both = input({
        p1: ecsSource,
        services: [...base.services, { id: 'e', siteId: 's', contractId: 'k', activityId: 'p1', price: 0, startDate: '2025-10-01', vatRateId: 'v20', billingTermId: 'echoir', p1Mode: 'acompte', p1Type: 'ECS' }],
        vatRates: [...base.vatRates, { id: 'v20', code: 'TVA20', rate: 20 }],
    });
    const due = dueInvoiceLines(both, [], '2025-10-05');
    assert.deepEqual(due.errors, []);
    // ECS : 2 400 m³ / 12 = 200 m³ × 6,5 €/m³ = 1 300 €, TVA 20 %.
    const ecs = due.lines.find(l => l.p1Acompte?.usage === 'ecs')!;
    assert.deepEqual([ecs.total, ecs.vatRate], [1300, 20]);
    assert.match(ecs.description, /acompte ECS sur 200 m³ estimés au prix révisé P1 \(2025-10 : 6,5 €\/m³\)/);
    assert.equal(due.lines.find(l => l.p1Acompte?.usage === 'chauffage')!.total, 12000);
    const eau = input({ services: [{ ...base.services[0], p1Type: 'EAU_FROIDE' }] });
    assert.match(dueInvoiceLines(eau, [], '2025-10-05').errors[0], /chauffage ou l'ECS seulement/);
});

test('régularisation chauffage + ECS : par usage à sa TVA ; au total seulement avec une TVA commune ; pas de mélange', () => {
    const docs: RegulDocument[] = [
        acompte('f1', '2025-10', 12000),
        { id: 'f2', kind: 'invoice', lineItems: [{ vatRate: 20, p1Acompte: { siteId: 's', usage: 'ecs', mois: [{ mois: '2025-10', quantite: 200, prix: 6.5, montant: 1300 }] } }] },
    ];
    const sitesTva = [{ id: 's', name: 'Chaufferie', activityCode: 'P1', vatRates: { chauffage: 5.5, ecs: 20 } }];
    const parUsage = regularisationP1({ mois: ['2025-10'], sites: sitesTva, documents: docs, interests: [],
        reel: new Map([['s', new Map([['chauffage|2025-10', 11500], ['ecs|2025-10', 1450]])]]) });
    assert.deepEqual(parUsage.errors, []);
    assert.deepEqual(parUsage.lines.map(l => [l.total, l.vatRate, (l.p1Regul as { usage: string }).usage]), [[-500, 5.5, 'chauffage'], [150, 20, 'ecs']]);
    const auTotal = regularisationP1({ mois: ['2025-10'], sites: sitesTva, documents: docs, interests: [], reel: new Map([['s', new Map([['total|2025-10', 13000]])]]) });
    assert.match(auTotal.errors[0], /acomptes chauffage et ECS à des TVA différentes \(5,5 % et 20 %\) : importez le réel par usage/);
    const mixte = regularisationP1({ mois: ['2025-10'], sites: sitesTva, documents: docs, interests: [],
        reel: new Map([['s', new Map([['total|2025-10', 1], ['ecs|2025-10', 1]])]]) });
    assert.match(mixte.errors[0], /à la fois au total et par usage/);
    const sansEcs = regularisationP1({ mois: ['2025-10'], sites: sitesTva, documents: docs, interests: [], reel: new Map([['s', new Map([['chauffage|2025-10', 1]])]]) });
    assert.match(sansEcs.errors[0], /réel P1 ECS du moteur non importé pour 10\/2025/);
});
