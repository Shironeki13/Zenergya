// MTI au DJU (facturation mensuelle sans décompte) et saisons de chauffe : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueInvoiceLines, type BillingInput } from '../src/lib/billing/contract-billing';
import { controleSaison, partieChauffee, saisonDe, type SaisonChauffe } from '../src/lib/p1/saisons';
import { decompteSaison } from '../src/lib/billing/p1-decompte';

const saison = (allumage: string, arret: string | null): SaisonChauffe => ({ id: 'x', siteId: 's', saison: saisonDe(allumage), allumage, arret });

test('saisons de chauffe : saison juillet → juin, contrôles, partie chauffée d\'un mois', () => {
    assert.deepEqual([saisonDe('2025-10-19'), saisonDe('2026-05-07'), saisonDe('2026-07-01')], ['2025-2026', '2025-2026', '2026-2027']);
    assert.equal(controleSaison({ saison: '2025-2026', allumage: '2025-10-19', arret: '2026-05-07' }), null);
    assert.match(String(controleSaison({ saison: '2025-2026', allumage: '2026-10-19', arret: null })), /n'est pas dans la saison/);
    assert.match(String(controleSaison({ saison: '2025-2026', allumage: '2025-10-19', arret: '2025-10-01' })), /précède/);
    const s = [saison('2025-10-19', '2026-05-07')];
    assert.deepEqual(partieChauffee(s, '2025-10-01', '2025-10-31'), { debut: '2025-10-19', fin: '2025-10-31' });
    assert.deepEqual(partieChauffee(s, '2026-01-01', '2026-01-31'), { debut: '2026-01-01', fin: '2026-01-31' });
    assert.deepEqual(partieChauffee(s, '2026-05-01', '2026-05-31'), { debut: '2026-05-01', fin: '2026-05-07' });
    assert.equal(partieChauffee(s, '2026-06-01', '2026-06-30'), null);
    assert.equal(partieChauffee([], '2025-08-01', '2025-08-31'), null);          // été sans saison saisie : rien
    assert.match(String(partieChauffee([], '2025-11-01', '2025-11-30')), /saison 2025-2026 non renseignées/);
    assert.deepEqual(partieChauffee([saison('2025-10-19', null)], '2026-03-01', '2026-03-31'), { debut: '2026-03-01', fin: '2026-03-31' });   // en cours
});

// Cas réel anonymisé (MTI, janvier) : base 5 583,54 € × 1,03587 / 2 308 DJU × 411,9 DJU = 1 032,22 €.
const djuJour = (d: string) => (d.slice(5, 7) === '01' ? 411.9 / 31 : d.slice(5, 7) === '10' ? 6 : d.slice(5, 7) === '05' ? 3 : 0);
const djuEntre = (debut: string, fin: string) => {
    let t = 0;
    for (let x = Date.parse(`${debut}T00:00:00Z`); x <= Date.parse(`${fin}T00:00:00Z`); x += 86_400_000) t += djuJour(new Date(x).toISOString().slice(0, 10));
    return t;
};
const input = (patch: Partial<BillingInput> = {}, saisons = [saison('2025-10-19', '2026-05-07')]): BillingInput => ({
    contract: { id: 'k', siteIds: ['s'], activityIds: ['p1'], startDate: '2025-09-01', endDate: '2027-08-31' },
    sites: [{ id: 's', name: 'Hôtel de Ville', contractId: 'k' }],
    services: [{ id: 'm', siteId: 's', contractId: 'k', activityId: 'p1', price: 5583.54, startDate: '2025-09-01', vatRateId: 'v', billingTermId: 'echu', scheduleId: 'mens', p1Mode: 'dju', p1Type: 'CHAUFFAGE' }],
    activities: [{ id: 'p1', code: 'P1', label: 'P1 MTI' }], vatRates: [{ id: 'v', code: 'TVA20', rate: 20 }],
    schedules: [{ id: 'mens', name: 'Mensuel' }], terms: [{ id: 'echu', name: 'Terme échu' }],
    p1Dju: {
        coefficient: () => ({ coefficient: 1.03587, indices: [] }), djuReference: () => 2308,
        dju: (_s, debut, fin) => djuEntre(debut, fin), saisons: () => saisons,
    },
    ...patch,
});

test('MTI au DJU : montant du mois au centime près (cas réel) ; mois d\'allumage et d\'arrêt bornés ; été sans facture', () => {
    const r = dueInvoiceLines(input(), [], '2026-06-30');
    assert.deepEqual(r.errors, []);
    const parMois = Object.fromEntries(r.lines.map(l => [l.periodStartDate!.slice(0, 7), l]));
    // Septembre : hors saison, aucune ligne. Octobre : du 19 au 31 (13 jours × 6 DJU = 78).
    assert.equal(parMois['2025-09'], undefined);
    assert.deepEqual(parMois['2025-10'].p1Dju!.mois.map(m => [m.debut, m.fin, m.dju]), [['2025-10-19', '2025-10-31', 78]]);
    assert.equal(parMois['2025-10'].total, Math.round((5583.54 * 1.03587 / 2308) * 78 * 100) / 100);
    assert.equal(parMois['2026-01'].total, 1032.22);
    assert.match(parMois['2026-01'].description, /^P1 MTI au DJU — .* 01\/2026 : 5\s583,54 € × 1,03587 \/ 2\s308 × 411,9 DJU \(01\/01\/2026 → 31\/01\/2026\) = 1\s032,22 €/);
    // Mai : arrêt le 07 → 7 jours × 3 DJU ; juin : rien.
    assert.deepEqual(parMois['2026-05'].p1Dju!.mois.map(m => [m.fin, m.dju]), [['2026-05-07', 21]]);
    assert.equal(parMois['2026-06'], undefined);
});

test('MTI au DJU : saison non saisie, DJU de référence manquant, terme à échoir, type ECS : refusés', () => {
    assert.match(dueInvoiceLines(input({}, []), [], '2025-12-01').errors[0], /saison 2025-2026 non renseignées/);
    assert.match(dueInvoiceLines(input({ p1Dju: { ...input().p1Dju!, djuReference: () => 'DJU de référence non renseignés' } }), [], '2025-12-01').errors[0], /DJU de référence non renseignés/);
    const svc = input().services[0];
    assert.match(dueInvoiceLines(input({ services: [{ ...svc, billingTermId: 'echoir' }], terms: [{ id: 'echoir', name: 'À échoir' }] }), [], '2025-12-01').errors[0], /au DJU à terme échu/);
    assert.match(dueInvoiceLines(input({ services: [{ ...svc, p1Type: 'ECS' }] }), [], '2025-12-01').errors[0], /chauffage seulement/);
});

test('décompte MTI : P1 dû de la saison au centime près (cas réel), réparti par mois au prorata des DJU', () => {
    // Cas réel anonymisé : P1₀ = 102 MWh × 80,7529 €/MWh = 8 236,80 € ; C/C0 annuel 1,09863 (affiché 1,0986) ; 992 DJU / 1 200 → 7 480,66 €.
    const djuParMois = { '2025-10': 61, '2025-11': 170, '2025-12': 210, '2026-01': 220, '2026-02': 150, '2026-03': 110, '2026-04': 60, '2026-05': 11 };
    const d = decompteSaison({ saison: '2025-2026', quantite: 102, prixBase: 80.7529, coefficient: 1.09863, djuReference: 1200, djuParMois });
    assert.ok(typeof d !== 'string');
    assert.deepEqual([d.dju, d.du], [992, 7480.66]);
    assert.equal(Math.round(d.mois.reduce((s, m) => s + m.montant, 0) * 100) / 100, 7480.66);
    assert.equal(d.mois[0].montant, Math.round((7480.66 * 61 / 992) * 100) / 100);
    assert.match(String(decompteSaison({ saison: '2025-2026', quantite: 0, prixBase: 80, coefficient: 1, djuReference: 1200, djuParMois })), /quantité de référence/);
    assert.match(String(decompteSaison({ saison: '2025-2026', quantite: 102, prixBase: 80, coefficient: 1, djuReference: 1200, djuParMois: {} })), /aucun DJU/);
});
