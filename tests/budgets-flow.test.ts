// Budget d'un contrat : réalisé par activité et par nature, échéancier, saisie et gel (émulateur Firestore).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../src/lib/firebase-admin';
import { enregistrerBudget, figerBudget, suiviBudget } from '../src/services/budgets-admin';

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const ts = (d: string) => Timestamp.fromDate(new Date(`${d}T00:00:00Z`));
const ligne = (code: string, total: number, debut: string, fin: string) => ({ description: code, quantity: 1, unitPrice: total, total, activityCode: code, periodStartDate: debut, periodEndDate: fin, itemKey: code === 'BP2' ? 'svc:bu-sv2' : `svc:bu-${code}` });

before(async () => {
    await set('activities', 'bu-p1', { code: 'BP1', label: 'Chauffage B', type: 'P1' });
    await set('activities', 'bu-p2', { code: 'BP2', label: 'Maintenance B', type: 'P2' });
    await set('schedules', 'bu-trim', { name: 'Trimestriel' });
    await set('terms', 'bu-echoir', { name: 'À échoir' });
    await set('vatRates', 'bu-tva', { code: 'TVA20B', rate: 20 });
    await set('contracts', 'bu-k', { contractNumber: 'CTN-BU01', label: 'Budget test', clientId: 'bu-c', clientName: 'Client budget', siteIds: ['bu-s'], activityIds: ['bu-p1', 'bu-p2'], status: 'Actif', startDate: ts('2026-01-01'), endDate: ts('2028-12-31'), billingSchedule: 'Trimestriel' });
    await set('sites', 'bu-s', { name: 'Site budget', contractId: 'bu-k', clientId: 'bu-c', amountsSource: 'services' });
    await set('services', 'bu-sv2', { contractId: 'bu-k', siteId: 'bu-s', activityId: 'bu-p2', price: 12000, startDate: '2026-01-01', scheduleId: 'bu-trim', billingTermId: 'bu-echoir', vatRateId: 'bu-tva', isActive: true });
    // Factures : T1 et T2 2026 du P2, plus une ligne à cheval sur 2025 ; une facture annulée et son avoir s'écartent.
    await set('invoices', 'bu-f1', { invoiceNumber: 'BU-1', contractId: 'bu-k', clientId: 'bu-c', status: 'paid', date: ts('2026-01-02'), lineItems: [ligne('BP2', 3000, '2026-01-01', '2026-03-31'), { ...ligne('BP2', 3000, '2026-04-01', '2026-06-30') }, ligne('BP1', 1200, '2025-12-01', '2026-01-31')] });
    await set('invoices', 'bu-f2', { invoiceNumber: 'BU-2', contractId: 'bu-k', clientId: 'bu-c', status: 'cancelled', cancelledByCreditNoteId: 'bu-a1', date: ts('2026-02-01'), lineItems: [ligne('BP2', 9999, '2026-01-01', '2026-03-31')] });
    await set('creditNotes', 'bu-a1', { contractId: 'bu-k', originalInvoiceIds: ['bu-f2'], date: ts('2026-02-02'), lineItems: [ligne('BP2', -9999, '2026-01-01', '2026-03-31')] });
    await set('creditNotes', 'bu-a2', { contractId: 'bu-k', originalInvoiceIds: [], date: ts('2026-03-01'), lineItems: [ligne('BP2', 500, '2026-03-01', '2026-03-01')] });
    // Dépenses : commande engagée (une ligne de sous-traitance, une ligne d'un autre contrat), commande refusée, heures, énergie.
    const cible = (activityCode?: string, contractId = 'bu-k') => ({ type: 'contrat', contractId, ...(activityCode && { activityCode }) });
    await set('commandes', 'bu-c1', { status: 'validee', date: '2026-02-10', lines: [{ total: 800, nature: 'FOURNITURE', cible: cible('BP2') }, { total: 1500, nature: 'SOUS_TRAITANCE', cible: cible('BP2') }, { total: 99, nature: 'FOURNITURE', cible: cible('BP2', 'autre') }, { total: 40, nature: 'DIVERS', cible: cible() }] });
    await set('commandes', 'bu-c2', { status: 'refusee', date: '2026-02-10', lines: [{ total: 5000, nature: 'FOURNITURE', cible: cible('BP2') }] });
    await set('commandes', 'bu-c3', { status: 'passee', date: '2025-12-20', lines: [{ total: 7000, nature: 'FOURNITURE', cible: cible('BP2') }] });
    await set('heures', 'bu-h1', { date: '2026-03-03', cost: 450, statut: 'validee', cible: cible('BP2') });
    await set('heures', 'bu-h2', { date: '2026-03-04', cost: 300, statut: 'a_valider', cible: cible('BP2') });
    await set('facturesEnergie', 'bu-e1', { siteId: 'bu-s', numero: 'GAZ-1', date: '2026-02-05', debut: '2025-12-01', fin: '2026-01-31', montantHT: 6200 });
});

// Les tests suivants comptent les heures à valider et les commandes : rien de ce fichier ne doit rester.
after(async () => {
    for (const c of ['activities', 'schedules', 'terms', 'vatRates', 'contracts', 'sites', 'services', 'invoices', 'creditNotes', 'commandes', 'heures', 'facturesEnergie', 'budgets', 'clients', 'agencies']) {
        for (const d of (await adminDb.collection(c).get()).docs) if (d.id.startsWith('bu-')) await d.ref.delete();
    }
    for (const a of [2026, 2027]) await adminDb.collection('budgets').doc(`bu-k_${a}`).delete();
});

test('réalisé par activité et par nature ; échéancier de l\'année et reste à facturer', async () => {
    const s = await suiviBudget('bu-k', 2026);
    const l = (a: string) => s.lignes.find(x => x.activite === a)!;
    assert.deepEqual(s.activites.map(a => a.code), ['BP1', 'BP2']);
    assert.equal(s.activiteEnergie, 'BP1');
    // P2 : 3 000 + 3 000 − 500 (avoir de régularisation) ; la facture annulée et son avoir sont écartés.
    assert.deepEqual([l('BP2').realise.ca, l('BP2').realise.achats, l('BP2').realise.sousTraitance, l('BP2').realise.mainOeuvre], [5500, 800, 1500, 450]);
    // P1 : la moitié de la ligne à cheval (janvier sur décembre-janvier) ; énergie au prorata (31 j sur 62).
    assert.deepEqual([l('BP1').realise.ca, l('BP1').realise.energie], [600, 3100]);
    assert.equal(l('—').realise.achats, 40);
    assert.deepEqual([s.caTheorique.BP2, l('BP2').resteCA, l('BP2').atterrissage.ca], [12000, 6000, 11500]);
    assert.deepEqual(s.avertissements, []);
});

test('saisie, gel de l\'initial, révision ; contrôles', async () => {
    await assert.rejects(enregistrerBudget('bu-k', 2026, [{ activite: 'P9', ca: 1 }], 'u@x'), /hors du contrat/);
    await assert.rejects(figerBudget('bu-k', 2026, 'a@x'), /Aucun budget/);
    await enregistrerBudget('bu-k', 2026, [{ activite: 'BP2', ca: 12000, achats: 1000, mainOeuvre: 2000, sousTraitance: 1000 }, { activite: 'BP1', ca: 8000, energie: 5000 }], 'u@x');
    await figerBudget('bu-k', 2026, 'a@x');
    await assert.rejects(figerBudget('bu-k', 2026, 'a@x'), /déjà figé/);
    await enregistrerBudget('bu-k', 2026, [{ activite: 'BP2', ca: 13000, achats: 1000, mainOeuvre: 2000, sousTraitance: 1000 }, { activite: 'BP1', ca: 8000, energie: 5000 }], 'u@x');
    const s = await suiviBudget('bu-k', 2026);
    const p2 = s.lignes.find(x => x.activite === 'BP2')!;
    assert.deepEqual([p2.budgetInitial?.ca, p2.budget.ca, s.budget?.initial?.figePar], [12000, 13000, 'a@x']);
    // Sous-traitance 1 500 réalisée pour 1 000 budgétée : signalée, et comptée à l'atterrissage.
    assert.deepEqual([p2.atterrissage.sousTraitance, p2.alertes[0]], [1500, 'Sous-traitance : réalisé au-delà du budget (+500 €)']);
    assert.equal((await suiviBudget('bu-k', 2027)).budget, null);
});

test('pilotage et fiche client : contrats budgétés du périmètre, contrats actifs sans budget', async () => {
    const { pilotageBudgets, budgetClient } = await import('../src/services/budgets-admin');
    await set('contracts', 'bu-k2', { contractNumber: 'CTN-BU02', label: 'Sans budget', clientId: 'bu-c', clientName: 'Client budget', siteIds: [], activityIds: ['bu-p2'], status: 'Actif', startDate: ts('2026-01-01'), endDate: ts('2028-12-31') });
    await set('clients', 'bu-c', { name: 'Client budget', agencyId: 'bu-ag' });
    await set('agencies', 'bu-ag', { name: 'Agence budget' });
    const tout = await pilotageBudgets(2026, null);
    const k = tout.contrats.find(c => c.contractId === 'bu-k')!;
    assert.deepEqual([k.numero, k.agence, k.aBudget, k.fige, k.total.budget.ca], ['CTN-BU01', 'Agence budget', true, true, 21000]);
    assert.ok(tout.sansBudget.some(c => c.contractId === 'bu-k2'));
    assert.ok(!tout.contrats.some(c => c.contractId === 'bu-k2'));
    // Périmètre : un contrat hors périmètre n'apparaît nulle part.
    const restreint = await pilotageBudgets(2026, new Set(['bu-k2']));
    assert.deepEqual([restreint.contrats.length, restreint.sansBudget.map(c => c.contractId)], [0, ['bu-k2']]);
    const client = await budgetClient('bu-c', 2026, null);
    assert.deepEqual(client.contrats.map(c => [c.numero, c.aBudget]), [['CTN-BU01', true], ['CTN-BU02', false]]);
    await assert.rejects(pilotageBudgets(1999, null), /Année invalide/);
});

test('travaux facturés sur le contrat : ligne P6 à part, budgétable ; « non affecté » seulement sans code', async () => {
    await set('invoices', 'bu-f9', { invoiceNumber: 'BU-9', contractId: 'bu-k', clientId: 'bu-c', status: 'due', date: ts('2026-05-02'), situation: { number: 1 }, lineItems: [{ description: 'Chaudière : avancement 50 %', quantity: 1, unitPrice: 4000, total: 4000, activityCode: 'P6' }, { description: 'Sans code', quantity: 1, unitPrice: 10, total: 10 }] });
    const s = await suiviBudget('bu-k', 2026);
    assert.deepEqual(s.activites.map(a => [a.code, a.libelle]).filter(([c]) => c === 'P6'), [['P6', 'Travaux P6']]);
    assert.deepEqual([s.lignes.find(l => l.activite === 'P6')?.realise.ca, s.lignes.find(l => l.activite === '—')?.realise.ca], [4000, 10]);
    await enregistrerBudget('bu-k', 2026, [{ activite: 'BP2', ca: 13000 }, { activite: 'P6', ca: 5000, sousTraitance: 3000 }], 'u@x');
    assert.equal((await suiviBudget('bu-k', 2026)).lignes.find(l => l.activite === 'P6')?.budget.ca, 5000);
});
