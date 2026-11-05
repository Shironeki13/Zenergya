// Facturation des contrats : échéancier calculé à partir des prestations (calcul pur) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    addMonths, billedUntil, billingItems, dueDateFor, dueInvoiceLines, echeancesOf, nominalPeriod, paymentTermRule, scheduleOf,
    termeOf, vatTotals, type BillingInput,
} from '../src/lib/billing/contract-billing';

const contract = {
    id: 'k', siteIds: ['s1', 's2'], activityIds: ['p2', 'p3'],
    startDate: '2025-07-01', endDate: '2026-08-15', billingSchedule: 'Trimestriel',
};
const base: BillingInput = {
    contract,
    sites: [
        { id: 's1', name: 'Manuel', amounts: [{ activityId: 'p2', amount: 1200 }, { activityId: 'p3', amount: 999 }, { activityId: 'hors', amount: 50 }] },
        { id: 's2', name: 'Prestations', amountsSource: 'services' },
    ],
    services: [
        { id: 'a', siteId: 's2', contractId: 'k', activityId: 'p2', price: 3650, startDate: '2025-08-01', endDate: '', vatRateId: 'tva10', label: 'Entretien', scheduleId: 'mens', billingTermId: 'te' },
        { id: 'b', siteId: 's2', contractId: 'k', activityId: 'p2', price: 9999, startDate: '2025-07-01', isActive: false },
        { id: 'c', siteId: 's2', contractId: 'autre', activityId: 'p2', price: 5000, startDate: '2025-07-01' },
    ],
    activities: [{ id: 'p2', code: 'P2', label: 'Maintenance', vatRateId: 'tva20' }, { id: 'p3', code: 'P3', label: 'Gros entretien', vatRateId: 'tva20' }, { id: 'hors', code: 'X', label: 'Hors contrat' }],
    vatRates: [{ id: 'tva20', code: 'TVA20', rate: 20 }, { id: 'tva10', code: 'TVA10', rate: 10 }],
    schedules: [{ id: 'mens', name: 'Mensuel' }, { id: 'trim', name: 'Trimestriel' }, { id: 'var', name: 'Variable' }],
    terms: [{ id: 'te', name: 'Terme échu' }, { id: 'ta', name: 'À échoir' }, { id: 'tx', name: 'Selon accord' }],
};
const withService = (patch: object) => ({ ...base, services: [{ ...base.services[0], ...patch }, ...base.services.slice(1)] });

test('repères : mois courts, périodicité, terme, période calée sur le début du contrat', () => {
    assert.equal(addMonths('2025-01-31', 1), '2025-02-28');
    assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
    assert.deepEqual(scheduleOf('Trimestriel K'), { months: 3, label: 'Trimestriel' });
    assert.equal(scheduleOf('Variable'), null);
    assert.equal(termeOf('À échoir'), 'echoir');
    assert.equal(termeOf('Terme échu'), 'echu');
    assert.equal(termeOf('Selon accord'), null);
    assert.deepEqual(nominalPeriod('2025-07-01', 3, '2026-02-10'), { start: '2026-01-01', end: '2026-03-31' });
    assert.deepEqual(nominalPeriod('2025-07-15', 1, '2025-07-15'), { start: '2025-07-15', end: '2025-08-14' });
});

test('éléments : prestations (périodicité et terme propres) ou montants saisis (conditions du contrat), terme par défaut signalé', () => {
    const { items, errors, warnings } = billingItems(base);
    assert.deepEqual(errors, []);
    assert.deepEqual(items.map(i => [i.key, i.months, i.terme, i.from, i.to, i.vatRateId]), [
        ['site:s1:p2', 3, 'echoir', '2025-07-01', '2026-08-15', 'tva20'],
        ['site:s1:p3', 3, 'echoir', '2025-07-01', '2026-08-15', 'tva20'],
        ['svc:a', 1, 'echu', '2025-08-01', '2026-08-15', 'tva10'],
    ]);
    assert.deepEqual(warnings, ['P2 sur le site Manuel : terme non renseigné, facturé à échoir.', 'P3 sur le site Manuel : terme non renseigné, facturé à échoir.']);
    // Périodicité : prestation, sinon site, sinon contrat ; inconnue ou illisible : erreur.
    assert.equal(billingItems(withService({ scheduleId: '' })).items[2].months, 3);
    assert.equal(billingItems({ ...withService({ scheduleId: '' }), sites: [base.sites[0], { ...base.sites[1], billingSchedule: 'Semestriel' }] }).items[2].months, 6);
    assert.match(billingItems(withService({ scheduleId: 'var' })).errors[0], /P2 sur le site Prestations : périodicité de facturation « Variable » inconnue/);
    assert.match(billingItems(withService({ billingTermId: 'tx' })).errors[0], /terme « Selon accord » illisible/);
    assert.match(billingItems({ ...base, contract: { ...contract, billingSchedule: undefined } }).errors[0], /non renseignée/);
});

test('échéances : à échoir dès le début de période, échu le lendemain de sa fin ; prorata au jour près', () => {
    const { items } = billingItems(withService({ startDate: '2025-08-15' }));
    const [p2, , svc] = items;
    // À échoir, trimestriel : au 15/10, T3 et T4 sont facturables.
    assert.deepEqual(echeancesOf(p2, '2025-07-01', null, '2025-10-15').map(e => [e.start, e.end, e.billableOn, e.amount]), [
        ['2025-07-01', '2025-09-30', '2025-07-01', 300],
        ['2025-10-01', '2025-12-31', '2025-10-01', 300],
    ]);
    // Échu, mensuel, à partir du 15/08 : 17 jours d'août (prorata), puis septembre ; octobre facturable le 01/11.
    assert.deepEqual(echeancesOf(svc, '2025-07-01', null, '2025-10-15').map(e => [e.start, e.end, e.billableOn, e.amount, `${e.days}/${e.nominalDays}`]), [
        ['2025-08-15', '2025-08-31', '2025-09-01', 166.8, '17/31'],
        ['2025-09-01', '2025-09-30', '2025-10-01', 304.17, '30/30'],
    ]);
    // Fin du contrat en cours de trimestre : 46 jours sur 92.
    const last = echeancesOf(p2, '2025-07-01', '2026-06-30', '2026-12-31');
    assert.deepEqual(last.map(e => [e.start, e.end, e.amount]), [['2026-07-01', '2026-08-15', 150]]);
});

test('déjà facturé : lignes par élément (y compris regroupées), factures antérieures par site et activité, avoirs exclus', () => {
    const { items } = billingItems(base);
    const billed = billedUntil(items, [
        { lineItems: [{ itemKey: 'site:s1:p2', periodEndDate: '2025-09-30' }] },
        { periodEndDate: '2025-12-31', lineItems: [{ siteId: 's1', activityCode: 'P3' }] },            // facture antérieure
        { lineItems: [{ itemKeys: ['svc:a'], periodEndDate: '2025-08-31' }] },                         // ligne regroupée
        { status: 'cancelled', lineItems: [{ itemKey: 'site:s1:p2', periodEndDate: '2026-06-30' }] },  // annulée par avoir
    ]);
    assert.deepEqual([...billed.entries()], [['site:s1:p2', '2025-09-30'], ['site:s1:p3', '2025-12-31'], ['svc:a', '2025-08-31']]);
});

test('lignes de facture : une par échéance (multi-site) ou par activité, taux et période (globale) ; TVA manquante bloquante', () => {
    const due = dueInvoiceLines(base, [], '2025-10-15');
    assert.deepEqual(due.errors, []);
    assert.deepEqual(due.lines.map(l => [l.itemKey, l.periodStartDate, l.periodEndDate, l.total, l.vatRate]), [
        ['site:s1:p2', '2025-07-01', '2025-09-30', 300, 20],
        ['site:s1:p3', '2025-07-01', '2025-09-30', 249.75, 20],
        ['svc:a', '2025-08-01', '2025-08-31', 304.17, 10],
        ['svc:a', '2025-09-01', '2025-09-30', 304.17, 10],
        ['site:s1:p2', '2025-10-01', '2025-12-31', 300, 20],
        ['site:s1:p3', '2025-10-01', '2025-12-31', 249.75, 20],
    ]);
    assert.match(due.lines[2].description, /Maintenance — Entretien \(Mensuel, à terme échu\) — Site : Prestations — du 01\/08\/2025 au 31\/08\/2025/);

    const twoSites: BillingInput = { ...base, services: [], sites: [base.sites[0], { id: 's2', name: 'Autre', amounts: [{ activityId: 'p2', amount: 800 }] }] };
    const global = dueInvoiceLines({ ...twoSites, contract: { ...contract, invoicingType: 'global' } }, [], '2025-07-01');
    assert.deepEqual(global.lines.map(l => [l.activityCode, l.total, l.itemKeys, l.siteId]), [
        ['P2', 500, ['site:s2:p2', 'site:s1:p2'], undefined],
        ['P3', 249.75, ['site:s1:p3'], undefined],
    ]);

    const missing = dueInvoiceLines({ ...base, activities: base.activities.map(a => ({ ...a, vatRateId: undefined })) }, [], '2025-07-01');
    assert.match(missing.errors[0], /TVA non renseignée : P2 sur le site Manuel/);
});

test('totaux par taux ; échéance de paiement', () => {
    const totals = vatTotals([
        { description: '', quantity: 1, unitPrice: 549.75, total: 549.75, activityCode: 'P2', vatRate: 20 },
        { description: '', quantity: 1, unitPrice: 605.03, total: 605.03, activityCode: 'P2', vatRate: 10 },
    ]);
    assert.deepEqual(totals.vatBreakdown, [{ rate: 20, base: 549.75, amount: 109.95 }, { rate: 10, base: 605.03, amount: 60.5 }]);
    assert.deepEqual([totals.subtotal, totals.tax, totals.total, totals.taxRate], [1154.78, 170.45, 1325.23, undefined]);
    assert.equal(dueDateFor('2025-10-15'), '2025-11-14');
    assert.equal(dueDateFor('2025-10-15', { days: 45, endOfMonth: true }), '2025-11-30');
    assert.equal(dueDateFor('2025-01-20', { days: 30, endOfMonth: true }), '2025-02-28');
    assert.deepEqual(paymentTermRule({ deadline: '45 jours fin de mois' }), { days: 45, endOfMonth: true });
    assert.equal(dueDateFor('2025-10-15', { deadline: 'À réception' }), '2025-10-15');
    assert.throws(() => dueDateFor('2025-10-15', { code: 'SPECIAL', deadline: 'selon accord' }), /illisible/);
});
