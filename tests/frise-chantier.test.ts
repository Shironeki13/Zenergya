// Frise chronologique d'un chantier : étapes, jauges, avancement par lot : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avancementGlobal, avancementParLot, etatFacture, friseChantier } from '../src/lib/projects/frise';
import type { Project, ProjectSituation } from '../src/lib/projects/types';
import type { Invoice } from '../src/lib/types';

const ligne = (id: string, label: string, totalHT: number, section?: string) => ({ id, label, quantity: 1, unitPrice: totalHT, totalHT, vatRate: 20, ...(section && { section }) });
const projet = (plus: Partial<Project> = {}): Project => ({
    id: 'p', code: 'ZEN-AFF2026-0001', companyId: 'c', clientId: 'cl', clientName: 'Copropriété', quoteId: 'q1', quoteNumber: 'DEV-001', quoteVersion: 1, title: 'Chaufferie',
    status: 'en_cours', lines: [ligne('a', 'Dépose', 20000, 'Dépose'), ligne('b', 'Chaudières', 60000, 'Production'), ligne('c', 'Hydraulique', 20000, 'Production')],
    totalHT: 100000, totalTTC: 120000, vat: [], retentionPct: 5, createdAt: '2026-01-10T09:00:00Z', updatedAt: '2026-01-10T09:00:00Z', ...plus,
});
const situation = (n: number, progress: Record<string, number>, plus: Partial<ProjectSituation> = {}): ProjectSituation => ({ id: `s${n}`, projectId: 'p', number: n, period: `2026-0${n + 1}`, progress, status: 'facturee', invoiceId: `f${n}`, invoiceNumber: `FAC-00${n}`, createdAt: '', updatedAt: `2026-0${n + 1}-28T10:00:00Z`, ...plus });
const facture = (n: number, subtotal: number, status: Invoice['status'], plus: Partial<Invoice> = {}): Invoice => ({
    id: `f${n}`, invoiceNumber: `FAC-00${n}`, contractId: '', clientId: 'cl', clientName: 'Copropriété', date: `2026-0${n + 1}-28`, dueDate: `2026-0${n + 2}-28`, status, lineItems: [],
    subtotal, tax: subtotal * 0.2, total: subtotal * 1.2, situation: { projectId: 'p', projectCode: 'x', situationId: `s${n}`, number: n, period: '', progress: {}, cumulative: [], retention: { pct: 5, amount: subtotal * 0.06 }, netToPay: subtotal * 1.14 }, ...plus,
});

test('avancement : pondéré par le montant des lignes ; par lot (titres du devis) ou ligne par ligne', () => {
    const p = projet();
    // Dépose 100 % (20 000) + chaudières 50 % (30 000) = 50 % du marché.
    assert.equal(avancementGlobal(p.lines, { a: 100, b: 50, c: 0 }), 50);
    assert.equal(avancementGlobal(p.lines, undefined), 0);
    assert.deepEqual(avancementParLot(p.lines, { a: 100, b: 50, c: 0 }, { a: 100 }).map(l => [l.label, l.montant, l.pct, l.avant]), [['Dépose', 20000, 100, 100], ['Production', 80000, 37.5, 0]]);
    // Sans titres : une barre par ligne.
    assert.deepEqual(avancementParLot([ligne('a', 'Dépose', 20000), ligne('b', 'Chaudières', 60000)], { a: 10, b: 20 }).map(l => [l.label, l.pct]), [['Dépose', 10], ['Chaudières', 20]]);
});

test('état d\'une facture : payée, à payer, en retard (échéance passée), annulée', () => {
    assert.deepEqual([etatFacture({ status: 'paid', dueDate: '2026-01-01' }, '2026-06-01'), etatFacture({ status: 'due', dueDate: '2026-07-01' }, '2026-06-01'), etatFacture({ status: 'due', dueDate: '2026-05-01' }, '2026-06-01'),
        etatFacture({ status: 'overdue', dueDate: '2026-07-01' }, '2026-06-01'), etatFacture({ status: 'due', dueDate: '2026-07-01', cancelledByCreditNoteId: 'a' }, '2026-06-01')], ['payee', 'a_payer', 'en_retard', 'en_retard', 'annulee']);
});

test('frise : ouverture, situations avec leur facture et son règlement, situation en préparation, puis ce qui reste à venir ; trois jauges', () => {
    const situations = [situation(1, { a: 100, b: 0, c: 0 }), situation(2, { a: 100, b: 50, c: 0 }), situation(3, { a: 100, b: 80, c: 50 }, { status: 'brouillon', invoiceId: undefined, invoiceNumber: undefined })];
    const f = friseChantier(projet(), situations, [facture(1, 20000, 'paid'), facture(2, 30000, 'due')], '2026-04-15');
    assert.deepEqual(f.etapes.map(e => [e.type, e.date, e.etat, e.avancement ?? null, e.facture?.etat ?? null]), [
        ['ouverture', '2026-01-10', 'fait', null, null],
        ['situation', '2026-02-28', 'fait', 20, 'payee'],
        ['situation', '2026-03-28', 'en_cours', 50, 'a_payer'],     // échéance le 28/04 : pas encore dépassée
        ['preparation', '2026-04-28', 'en_cours', 78, null],
        ['reste', null, 'a_venir', null, null],
        ['reception', null, 'a_venir', null, null],
        ['retenue', null, 'a_venir', null, null],
    ]);
    // Un mois plus tard, l'échéance est passée : la situation 2 passe en alerte.
    const plusTard = friseChantier(projet(), situations, [facture(1, 20000, 'paid'), facture(2, 30000, 'due')], '2026-05-15');
    assert.deepEqual([plusTard.etapes[2].etat, plusTard.etapes[2].facture!.etat], ['alerte', 'en_retard']);
    // Avancement 78 % (préparation comprise), facturé 50 %, encaissé 20 %.
    assert.deepEqual(f.jauges, { avancement: 78, facture: 50, encaisse: 20 });
    assert.deepEqual(f.montants, { marche: 100000, facture: 50000, encaisse: 20000, resteAFacturer: 50000, aEncaisser: 30000 });
    // Détail de la situation 2 : avancement par lot, avant et après.
    assert.deepEqual(f.etapes[2].lots!.map(l => [l.label, l.avant, l.pct]), [['Dépose', 100, 100], ['Production', 0, 37.5]]);
    assert.deepEqual([f.etapes[2].montantHT, f.etapes[2].facture!.numero, f.etapes[2].netAPayer], [30000, 'FAC-002', 34200]);
    assert.deepEqual(f.lots.map(l => [l.label, l.pct]), [['Dépose', 100], ['Production', 72.5]]);
});

test('frise : facture annulée hors des jauges ; chantier terminé et clôturé ; facturation directe', () => {
    const p = projet({ status: 'cloture', completedAt: '2026-05-02T08:00:00Z', retentionReleasedAt: '2027-05-02T08:00:00Z', closedAt: '2027-05-03T08:00:00Z' });
    const f = friseChantier(p, [situation(1, { a: 100, b: 100, c: 100 })], [facture(1, 100000, 'paid')], '2027-06-01');
    assert.deepEqual(f.etapes.map(e => e.type), ['ouverture', 'situation', 'reception', 'retenue', 'cloture']);
    assert.deepEqual(f.jauges, { avancement: 100, facture: 100, encaisse: 100 });
    const annulee = friseChantier(projet(), [situation(1, { a: 100, b: 0, c: 0 })], [facture(1, 20000, 'cancelled')], '2026-04-15');
    assert.deepEqual([annulee.etapes[1].etat, annulee.jauges, annulee.montants.facture], ['annule', { avancement: 0, facture: 0, encaisse: 0 }, 0]);
    // Facturation directe : pas d'avancement saisi, une étape par facture de devis.
    const direct = friseChantier(projet({ billing: 'directe' as never }), [], [facture(1, 30000, 'paid', { situation: undefined, quote: { id: 'q1', number: 'DEV-001' } as never })], '2026-04-15');
    assert.deepEqual([direct.etapes.map(e => e.type), direct.jauges.facture, direct.lots], [['ouverture', 'facture', 'reste', 'reception'], 30, []]);
});
