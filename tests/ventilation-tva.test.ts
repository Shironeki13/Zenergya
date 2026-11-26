import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlerVentilation, ecrireVentilation, lireVentilation, repartir } from '../src/lib/billing/ventilation-tva';
import { dueInvoiceLines, vatTotals, type BillingInput } from '../src/lib/billing/contract-billing';
import { echeancesDues } from '../src/lib/billing/selection';
import { precedentDe } from '../src/lib/billing/controle';

const TAUX = [{ id: 'tva20', code: 'TVA20', rate: 20 }, { id: 'tva10', code: 'TVA10', rate: 10 }, { id: 'tva55', code: 'TVA5,5', rate: 5.5 }];
const MIXTE = [{ vatRateId: 'tva10', part: 66.67, libelle: 'habitation' }, { vatRateId: 'tva20', part: 33.33 }];

test('répartition au centime : la somme retombe sur le montant, plus grands restes, signe conservé', () => {
    assert.deepEqual(repartir(1000, MIXTE), [666.7, 333.3]);
    assert.deepEqual(repartir(0.01, MIXTE), [0.01, 0]);
    assert.deepEqual(repartir(100, [{ part: 33.33 }, { part: 33.33 }, { part: 33.34 }]), [33.33, 33.33, 33.34]);
    for (const m of [304.17, 1234.56, 0.03, 99999.99, -500.01]) {
        const r = repartir(m, [{ part: 33.33 }, { part: 33.33 }, { part: 33.34 }]);
        assert.equal(Math.round(r.reduce((s, x) => s + x, 0) * 100), Math.round(m * 100), String(m));
    }
    assert.deepEqual(repartir(-1000, MIXTE), [-666.7, -333.3]);
    assert.deepEqual(repartir(10, []), []);
});

test('contrôle : au moins deux quote-parts, 100 %, taux connus et distincts, deux décimales', () => {
    assert.deepEqual(controlerVentilation([], TAUX), []);
    assert.deepEqual(controlerVentilation(MIXTE, TAUX), []);
    assert.match(controlerVentilation([{ vatRateId: 'tva10', part: 100 }], TAUX).join(), /au moins deux/);
    assert.match(controlerVentilation([{ vatRateId: 'tva10', part: 60 }, { vatRateId: 'tva20', part: 30 }], TAUX).join(), /90 % au lieu de 100 %/);
    assert.match(controlerVentilation([{ vatRateId: 'tva10', part: 50 }, { vatRateId: 'tva10', part: 50 }], TAUX).join(), /deux fois/);
    assert.match(controlerVentilation([{ vatRateId: 'x', part: 50 }, { vatRateId: 'tva10', part: 50 }], TAUX).join(), /inconnu/);
    assert.match(controlerVentilation([{ vatRateId: 'tva20', part: 50.005 }, { vatRateId: 'tva10', part: 49.995 }], TAUX).join(), /deux décimales/);
});

test('format de l\'import : lecture et écriture', () => {
    const codes = new Map(TAUX.map(t => [t.code.toLowerCase(), t.id]));
    assert.deepEqual(lireVentilation('TVA10=66,67 (habitation); tva20 = 33,33 %', codes), { parts: MIXTE, erreurs: [] });
    assert.deepEqual(lireVentilation('TVA99=50; TVA10:50', codes).erreurs, ['TVA « TVA99 » inconnue', '« TVA10:50 » : format attendu CODE=pourcentage (libellé)']);
    assert.equal(ecrireVentilation(MIXTE, new Map(TAUX.map(t => [t.id, t.code]))), 'TVA10=66,67 (habitation); TVA20=33,33');
});

const contrat = { id: 'k', siteIds: ['s1', 's2'], activityIds: ['p2'], startDate: '2026-01-01', endDate: '2028-12-31', billingSchedule: 'Trimestriel' };
const entree = (services: BillingInput['services'], global = false): BillingInput => ({
    contract: { ...contrat, ...(global && { invoicingType: 'global' as const }) },
    sites: [{ id: 's1', name: 'Mixte', amountsSource: 'services' }, { id: 's2', name: 'Bureaux', amountsSource: 'services' }],
    services,
    activities: [{ id: 'p2', code: 'P2', label: 'Maintenance', vatRateId: 'tva20' }],
    vatRates: TAUX,
    schedules: [{ id: 'trim', name: 'Trimestriel' }, { id: 'mens', name: 'Mensuel' }],
    terms: [{ id: 'ta', name: 'À échoir' }],
});
const mixte = { id: 'm', siteId: 's1', contractId: 'k', activityId: 'p2', price: 12000, startDate: '2026-02-15', scheduleId: 'trim', billingTermId: 'ta', label: 'Entretien', vatSplit: MIXTE };

test('facture par site : une ligne par quote-part, prorata appliqué avant la répartition, une seule échéance à cocher', () => {
    const due = dueInvoiceLines(entree([mixte]), [], '2026-04-01');
    assert.deepEqual(due.errors, []);
    // T1 au prorata (15/02 → 31/03 : 45 j sur 90) puis T2 : 1 500 € et 3 000 €.
    assert.deepEqual(due.lines.map(l => [l.periodStartDate, l.total, l.vatRate, l.itemKey]), [
        ['2026-02-15', 1000.05, 10, 'svc:m'], ['2026-02-15', 499.95, 20, 'svc:m'],
        ['2026-04-01', 2000.1, 10, 'svc:m'], ['2026-04-01', 999.9, 20, 'svc:m'],
    ]);
    assert.match(due.lines[0].description, /prorata 45\/90 j — quote-part habitation 66,67 % \(TVA 10 %\)/);
    assert.match(due.lines[1].description, /quote-part 33,33 % \(TVA 20 %\)/);
    const dues = echeancesDues(due);
    assert.deepEqual(dues.map(e => [e.debut, e.montant, e.lignes.length]), [['2026-02-15', 1500, 2], ['2026-04-01', 3000, 2]]);
    assert.deepEqual(vatTotals(due.lines).vatBreakdown.map(v => [v.rate, v.base, v.amount]), [[20, 1499.85, 299.97], [10, 3000.15, 300.02]]);
});

test('facture globale : les quote-parts rejoignent les lignes du même taux des autres sites', () => {
    const bureaux = { id: 'b', siteId: 's2', contractId: 'k', activityId: 'p2', price: 4000, startDate: '2026-01-01', scheduleId: 'trim', billingTermId: 'ta' };
    const due = dueInvoiceLines(entree([{ ...mixte, startDate: '2026-01-01' }, bureaux], true), [], '2026-01-01');
    assert.deepEqual(due.lines.map(l => [l.vatRate, l.total, [...(l.itemKeys ?? [])].sort()]).sort((a, b) => Number(a[0]) - Number(b[0])), [[10, 2000.1, ['svc:m']], [20, 1999.9, ['svc:b', 'svc:m']]]);
    assert.match(due.lines.find(l => l.vatRate === 10)!.description, /quote-part habitation 66,67 % \(TVA 10 %\)/);
});

test('déjà facturé et contrôle avant émission : les deux lignes d\'une même période comptent pour une échéance', () => {
    const premiere = dueInvoiceLines(entree([{ ...mixte, startDate: '2026-01-01' }]), [], '2026-01-01');
    const emise = { id: 'f1', invoiceNumber: 'F-1', status: 'due' as const, date: '2026-01-02', subtotal: 3000, lineItems: premiere.lines };
    const suite = dueInvoiceLines(entree([{ ...mixte, startDate: '2026-01-01' }]), [emise], '2026-04-01');
    assert.deepEqual(suite.lines.map(l => [l.periodStartDate, l.total]), [['2026-04-01', 2000.1], ['2026-04-01', 999.9]]);
    // Même montant par jour que la facture précédente : pas d'écart artificiel (jours comptés une fois).
    assert.deepEqual(precedentDe([emise]).parCle['svc:m'], { montant: 3000, jours: 90, fin: '2026-03-31', numero: 'F-1' });
});

test('ventilation invalide ou sur un P1 calculé : la prestation est refusée avec un message clair', () => {
    const faux = dueInvoiceLines(entree([{ ...mixte, vatSplit: [{ vatRateId: 'tva10', part: 70 }, { vatRateId: 'tva20', part: 20 }] }]), [], '2026-04-01');
    assert.match(faux.errors.join(), /P2 sur le site Mixte : ventilation de TVA invalide \(les quote-parts totalisent 90 % au lieu de 100 %\)/);
    assert.equal(faux.lines.length, 0);
    const p1 = dueInvoiceLines({ ...entree([{ ...mixte, activityId: 'p1', p1Mode: 'acompte' }]), contract: { ...contrat, activityIds: ['p1'] }, activities: [{ id: 'p1', code: 'P1', label: 'Chauffage', vatRateId: 'tva55' }] }, [], '2026-04-01');
    assert.match(p1.errors.join(), /ventilation de TVA réservée aux prestations au forfait/);
});
