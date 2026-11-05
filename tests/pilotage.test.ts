// Vues de pilotage : suivi de la facturation, alertes des compteurs (calcul pur) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suiviContrat } from '../src/lib/pilotage/suivi-facturation';
import { alertesCompteur, trierAlertes, type CompteurSuivi, type RelevePilotage } from '../src/lib/pilotage/alertes-compteurs';
import type { BillingInput } from '../src/lib/billing/contract-billing';

const input = (patch: Partial<BillingInput> = {}): BillingInput => ({
    contract: { id: 'k', siteIds: ['s'], activityIds: ['p2'], startDate: '2025-10-01', endDate: '2026-09-30', billingSchedule: 'Mensuel' },
    sites: [{ id: 's', name: 'Résidence', amountsSource: 'services' }],
    services: [{ id: 'a', siteId: 's', contractId: 'k', activityId: 'p2', price: 1200, startDate: '2025-10-01', vatRateId: 'v', billingTermId: 'echoir' }],
    activities: [{ id: 'p2', code: 'P2', label: 'Maintenance' }], vatRates: [{ id: 'v', code: 'TVA20', rate: 20 }],
    schedules: [], terms: [{ id: 'echoir', name: 'À échoir' }], ...patch,
});
const head = { id: 'k', contractNumber: 'CTN-1', clientName: 'Client' };
const facture = [{ lineItems: [{ itemKey: 'svc:a', periodEndDate: '2025-10-31' }] }];

test('suivi : échéances en retard (jours), du jour, à venir ; montant exact si facturable, estimé sinon ; blocage', () => {
    const s = suiviContrat(head, input(), facture, '2025-12-15', '2026-02-13');
    // Novembre facturable le 01/11 : 44 jours de retard ; décembre : 14 ; janvier dans 17 jours ; février dans 48.
    assert.deepEqual(s.echeances.map(e => [e.start, e.statut, e.jours, e.montant, e.estime]), [
        ['2025-11-01', 'retard', 44, 100, false],
        ['2025-12-01', 'retard', 14, 100, false],
        ['2026-01-01', 'a_venir', 17, 100, true],
        ['2026-02-01', 'a_venir', 48, 100, true],
    ]);
    assert.equal(suiviContrat(head, input(), facture, '2025-12-01', '2025-12-31').echeances.find(e => e.start === '2025-12-01')!.statut, 'aujourdhui');
    const sansTva = suiviContrat(head, input({ vatRates: [] }), facture, '2025-12-15', '2026-01-31');
    assert.match(sansTva.echeances[0].blocage!, /TVA non renseignée : P2 sur le site Résidence/);
    assert.equal(sansTva.echeances.find(e => e.statut === 'a_venir')!.blocage, undefined);
    assert.match(suiviContrat(head, input({ contract: { ...input().contract, billingSchedule: undefined } }), [], '2025-12-15', '2026-01-31').erreurs[0], /périodicité/);
});

const m = (patch: Partial<CompteurSuivi> = {}): CompteurSuivi => ({ id: 'm', code: 'CPT-1', name: 'Gaz', siteId: 's', site: 'Résidence', client: 'Client', unit: 'MWh', status: 'on', ...patch });
const r = (date: string, value: number, type?: string): RelevePilotage => ({ id: `${date}-${value}`, date, value, ...(type && { type }) });
const types = (a: { type: string }[]) => a.map(x => x.type).sort();

test('alertes : index en baisse (sauf relevé corrigé), relevés contradictoires, sans relevé, relevé estimé', () => {
    const today = '2026-03-10';
    assert.deepEqual(types(alertesCompteur(m(), [r('2026-01-31', 100), r('2026-02-28', 90)], today)), ['index_baisse']);
    assert.deepEqual(alertesCompteur(m(), [r('2026-01-31', 100), r('2026-02-28', 5, 'CORRIGE')], today), []);
    const doublon = alertesCompteur(m(), [r('2026-02-28', 100), r('2026-02-28', 104)], today);
    assert.match(doublon[0].message, /Deux relevés le 28\/02\/2026 : 100 et 104 MWh/);
    assert.match(alertesCompteur(m(), [r('2026-01-10', 100)], today).find(a => a.type === 'sans_releve')!.message, /depuis 59 jours/);
    assert.deepEqual(types(alertesCompteur(m(), [], today)), ['sans_releve']);
    assert.deepEqual(alertesCompteur(m({ status: 'off' }), [], today), []);
    assert.deepEqual(types(alertesCompteur(m(), [r('2026-01-31', 100), r('2026-02-01', 101, 'ESTIME')], today)), ['estime']);
    // Anomalies de plus d'un an : plus signalées.
    assert.deepEqual(alertesCompteur(m(), [r('2024-01-31', 100), r('2024-02-28', 90), r('2026-03-01', 200)], today), []);
});

test('alertes : dérive par rapport à l\'an passé, sinon à la médiane ; ECS au relevé ; ECS sans consommation', () => {
    const today = '2026-03-10';
    // L'an passé : 300 MWh en février (≈ 10,7/jour) ; cette année : 900 MWh (≈ 32,1/jour) → × 3.
    const an = [r('2025-01-31', 1000), r('2025-02-28', 1300), r('2026-01-31', 5000), r('2026-02-28', 5900)];
    const derive = alertesCompteur(m(), an, today);
    assert.deepEqual(types(derive), ['derive']);
    assert.match(derive[0].message, /en hausse .* × 3 par rapport à la même période l'an passé \(31\/01\/2025 → 28\/02\/2025\)/);
    // Sans an passé : médiane des intervalles précédents (10/jour) ; dernier à 4/jour → × 0,4.
    const med = [r('2025-10-01', 0), r('2025-10-11', 100), r('2025-10-21', 200), r('2025-10-31', 300), r('2025-11-10', 340)];
    assert.match(alertesCompteur(m(), med, '2025-11-12')[0].message, /en baisse .* × 0,4 par rapport à la médiane des 3 intervalles précédents/);
    assert.deepEqual(alertesCompteur(m(), [...med.slice(0, 4), r('2025-11-10', 400)], '2025-11-12'), []);
    // ECS au relevé : relevé de février manquant au 10/03 → critique.
    const ecs = alertesCompteur(m({ unit: 'm3', ecsAuReleve: true, usage: 'ecs' }), [r('2026-01-31', 10), r('2026-03-02', 20)], today);
    assert.deepEqual(ecs.map(a => [a.type, a.gravite]), [['releve_ecs_manquant', 'critique']]);
    // ECS sans consommation depuis plus de 60 jours.
    const nulle = alertesCompteur(m({ unit: 'm3', usage: 'ecs' }), [r('2025-11-30', 50), r('2025-12-31', 80), r('2026-01-31', 80), r('2026-03-05', 80)], today);
    assert.match(nulle.find(a => a.type === 'conso_nulle')!.message, /Aucune consommation depuis le 31\/12\/2025/);
    assert.deepEqual(trierAlertes([...nulle, ...ecs]).map(a => a.gravite)[0], 'critique');
});
