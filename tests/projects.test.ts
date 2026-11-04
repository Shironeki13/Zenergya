// Tests des situations de travaux (P6) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuoteTotals } from '../src/lib/quotes/pricing';
import { computeSituation, latestSnapshot, marketLines, situationInvoiceLines, situationIssues } from '../src/lib/projects/situations';
import { sumCents } from '../src/lib/money';
import type { QuoteLine, QuotePricing } from '../src/lib/quotes/types';
import type { SituationSnapshot } from '../src/lib/projects/types';

const pricing: QuotePricing = { coefficient: 1.35, laborRate: 58, laborCost: 36.5, defaultVatRate: 20 };
const lines: QuoteLine[] = [
    { id: 't1', kind: 'TITRE', label: 'Gros œuvre', quantity: 0, vatRate: 20, level: 0 },
    { id: 'a', kind: 'FOURNITURE', label: 'Chaudière', quantity: 1, unitCost: 10000, vatRate: 20 },       // 13 500
    { id: 'b', kind: 'MAIN_OEUVRE', label: 'Pose', unit: 'h', quantity: 120, vatRate: 20 },              // 6 960
    { id: 'c', kind: 'SOUS_TRAITANCE', label: 'Fumisterie', quantity: 1, unitCost: 3333.33, vatRate: 10 }, // 4 500
    { id: 'o', kind: 'FOURNITURE', label: 'Option', quantity: 1, unitCost: 100, vatRate: 20, optional: true },
];
const totals = computeQuoteTotals(lines, pricing);
const project = { lines: marketLines({ lines, pricing }), totalHT: totals.totalHT, retentionPct: 5, retentionBond: false };

const snapshot = (n: number, progress: Record<string, number>, c: ReturnType<typeof computeSituation>): SituationSnapshot => ({
    projectId: 'p', projectCode: 'AFF', situationId: `s${n}`, number: n, period: '2026-11', progress,
    cumulative: c.cumulative, retention: c.retention, netToPay: c.netToPay,
});

test('marché : lignes chiffrées du devis, options exclues, rattachées à leur titre', () => {
    assert.deepEqual(project.lines.map(l => l.id), ['a', 'b', 'c']);
    assert.equal(project.lines[0].section, 'Gros œuvre');
    assert.equal(sumCents(project.lines.map(l => l.totalHT)), totals.totalHT);
});

test('situations successives : somme exactement égale au devis à 100 %, retenue de garantie', () => {
    const p1 = { a: 50, b: 20, c: 0 };
    const s1 = computeSituation(project, p1);
    assert.equal(s1.lines.find(l => l.id === 'a')!.amount, 6750);
    assert.equal(s1.retention.pct, 5);
    assert.equal(s1.retention.amount, Math.round(s1.total * 5) / 100);
    assert.equal(s1.netToPay, Math.round((s1.total - s1.retention.amount) * 100) / 100);

    const snap1 = snapshot(1, p1, s1);
    const p2 = { a: 80, b: 55.5, c: 33.33 };
    const s2 = computeSituation(project, p2, snap1);
    assert.equal(s2.lines.find(l => l.id === 'a')!.amount, 4050);   // 80 % − 50 % de 13 500
    const snap2 = snapshot(2, p2, s2);

    const p3 = { a: 100, b: 100, c: 100 };
    const s3 = computeSituation(project, p3, snap2);
    assert.equal(s3.progressPct, 100);
    assert.equal(sumCents([s1.subtotal, s2.subtotal, s3.subtotal]), totals.totalHT);
    assert.equal(sumCents([s1.tax, s2.tax, s3.tax]), totals.totalVAT);
    assert.equal(sumCents([s1.total, s2.total, s3.total]), totals.totalTTC);
    // Lignes de facture cohérentes avec la base de la situation.
    assert.equal(sumCents(situationInvoiceLines(s2).map(l => l.total)), s2.subtotal);
});

test('caution bancaire : pas de retenue ; anomalies (baisse, rien ne bouge, hors bornes)', () => {
    const s = computeSituation({ ...project, retentionBond: true }, { a: 10 });
    assert.equal(s.retention.amount, 0);
    assert.equal(s.netToPay, s.total);

    const prev = { progress: { a: 50 } };
    assert.ok(situationIssues(project, { a: 40 }, prev).some(i => i.includes('ne peut pas baisser')));
    assert.ok(situationIssues(project, { a: 50 }, prev).some(i => i.includes("Aucune ligne n'avance")));
    assert.ok(situationIssues(project, { a: 120 }).some(i => i.includes('entre 0 et 100')));
    assert.deepEqual(situationIssues(project, { a: 60 }, prev), []);
});

test('situation annulée par avoir : la précédente non annulée fait référence', () => {
    const s1 = computeSituation(project, { a: 50 });
    const s2 = computeSituation(project, { a: 70 }, snapshot(1, { a: 50 }, s1));
    const invoices = [
        { status: 'paid', situation: snapshot(1, { a: 50 }, s1) },
        { status: 'cancelled', situation: snapshot(2, { a: 70 }, s2) },
    ];
    assert.equal(latestSnapshot(invoices)?.number, 1);
});
