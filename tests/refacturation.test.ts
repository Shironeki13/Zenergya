// P1A abonnement et €€ refacturation à l'euro l'euro (calcul pur) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billingItems, dueInvoiceLines, echeancesOf, type BillingInput } from '../src/lib/billing/contract-billing';
import { controleSelection, echeancesDues, lignesRetenues } from '../src/lib/billing/selection';
import { libelleFamilleP1 } from '../src/lib/p1/familles';

const input = (patch: Partial<BillingInput> = {}): BillingInput => ({
    contract: { id: 'k', siteIds: ['s1'], activityIds: ['p1'], startDate: '2026-01-01', endDate: '2027-12-31', billingSchedule: 'Mensuel' } as BillingInput['contract'],
    sites: [{ id: 's1', name: 'Alpha', amountsSource: 'services' }],
    services: [
        { id: 'abo', siteId: 's1', contractId: 'k', activityId: 'p1', price: 1200, startDate: '2026-01-01', vatRateId: 'v55', billingTermId: 'e', p1Type: 'ABONNEMENT', label: 'Abonnement gaz' },
        { id: 'ee', siteId: 's1', contractId: 'k', activityId: 'p1', startDate: '2026-01-01', vatRateId: 'v20', p1Type: 'REFACTURATION', refacFrais: 5 },
    ],
    activities: [{ id: 'p1', code: 'P1', label: 'Fourniture de chaleur' }],
    vatRates: [{ id: 'v55', code: 'TVA55', rate: 5.5 }, { id: 'v20', code: 'TVA20', rate: 20 }],
    schedules: [], terms: [{ id: 'e', name: 'À échoir' }],
    facturesEnergie: [
        { id: 'f1', siteId: 's1', fournisseur: 'Gaz du Sud', numero: 'G-101', date: '2026-02-10', debut: '2026-01-01', fin: '2026-01-31', montantHT: 1000 },
        { id: 'f2', siteId: 's1', fournisseur: 'Gaz du Sud', numero: 'G-102', date: '2026-03-12', montantHT: 800.4 },
        { id: 'f3', siteId: 's1', fournisseur: 'Gaz du Sud', numero: 'G-103', date: '2026-06-01', montantHT: 500 },
        { id: 'autre', siteId: 's2', fournisseur: 'X', numero: 'X-1', date: '2026-02-01', montantHT: 99 },
    ],
    ...patch,
});

test('familles : codes métier affichés', () => {
    assert.deepEqual(['CHAUFFAGE', 'ECS', 'ABONNEMENT', 'REFACTURATION', 'EAU_FROIDE', '', 'inconnu'].map(libelleFamilleP1),
        ['P1C — Chauffage', 'P1E — Eau chaude sanitaire', 'P1A — Abonnement', "€€ — Refacturation à l'euro l'euro", 'Eau froide', '', '']);
});

test('éléments : abonnement au forfait ; refacturation sans prix ni échéancier ; modes incompatibles refusés', () => {
    const { items, errors } = billingItems(input());
    assert.deepEqual(errors, []);
    assert.deepEqual(items.map(i => [i.key, i.p1Famille, i.annual, i.refacturation?.frais ?? null]), [['svc:abo', 'ABONNEMENT', 1200, null], ['svc:ee', 'REFACTURATION', 0, 5]]);
    assert.deepEqual(echeancesOf(items[1], '2026-01-01', null, '2026-12-31'), []);
    const mode = (id: string, p1Mode: string) => billingItems(input({ services: input().services.map(s => (s.id === id ? { ...s, p1Mode: p1Mode as never } : s)) })).errors[0];
    assert.match(mode('abo', 'acompte'), /un abonnement P1 se facture au forfait/);
    assert.match(mode('ee', 'releve'), /refacturation à l'euro l'euro ne se facture ni en acompte, ni au compteur, ni au DJU/);
});

test('lignes : abonnement libellé P1A ; une ligne par facture du fournisseur, frais de gestion, TVA de la prestation', () => {
    const due = dueInvoiceLines(input(), [], '2026-03-31');
    assert.deepEqual(due.errors, []);
    const abo = due.lines.filter(l => l.itemKey === 'svc:abo');
    assert.equal(abo.length, 3);
    assert.match(abo[0].description, /^P1A Abonnement — Fourniture de chaleur — Abonnement gaz \(Mensuel, à échoir\) — Site : Alpha/);
    const ee = due.lines.filter(l => l.refacturation);
    // f3 est datée de juin : pas encore refacturable au 31 mars ; « autre » est sur un autre site.
    assert.deepEqual(ee.map(l => [l.itemKey, l.total, l.vatRate, l.periodStartDate, l.periodEndDate, l.refacturation!.montantFournisseur, l.refacturation!.frais]),
        [['svc:ee#f1', 1050, 20, '2026-01-01', '2026-01-31', 1000, 5], ['svc:ee#f2', 840.42, 20, '2026-03-12', '2026-03-12', 800.4, 5]]);
    assert.equal(ee[0].description, "Refacturation à l'euro l'euro (€€) — Gaz du Sud, facture n° G-101 du 10/02/2026, consommation du 01/01/2026 au 31/01/2026 — Site : Alpha — frais de gestion 5 %");
    assert.equal(ee[1].description, "Refacturation à l'euro l'euro (€€) — Gaz du Sud, facture n° G-102 du 12/03/2026 — Site : Alpha — frais de gestion 5 %");
});

test('déjà refacturée : ne revient pas, sauf si la facture est annulée ; chaque facture se coche seule', () => {
    const emise = [{ status: 'due', lineItems: [{ itemKey: 'svc:ee#f1', periodEndDate: '2026-01-31', refacturation: { factureId: 'f1', siteId: 's1', fournisseur: 'Gaz du Sud', numero: 'G-101', date: '2026-02-10', montantFournisseur: 1000, frais: 5 } }] }];
    const ids = (invoices: object[]) => dueInvoiceLines(input(), invoices as never, '2026-12-31').lines.filter(l => l.refacturation).map(l => l.refacturation!.factureId);
    assert.deepEqual(ids(emise), ['f2', 'f3']);
    assert.deepEqual(ids([{ ...emise[0], cancelledByCreditNoteId: 'av' }]), ['f1', 'f2', 'f3']);
    // Sélection : la facture G-103 seule, sans G-101 ni G-102 (pas d'ordre imposé entre factures du fournisseur).
    const due = dueInvoiceLines(input(), [], '2026-12-31');
    const dues = echeancesDues(due).filter(e => e.lignes.some(l => l.refacturation));
    assert.deepEqual(dues.map(e => [e.montant, e.debut]), [[1050, '2026-01-01'], [840.42, '2026-03-12'], [525, '2026-06-01']]);
    assert.deepEqual(dues.map(e => [e.famille, e.libelle])[0], ['€€', 'Gaz du Sud, facture n° G-101 du 10/02/2026']);
    assert.deepEqual(echeancesDues(due).filter(e => e.famille === 'P1A').map(e => e.libelle)[0], 'Fourniture de chaleur — Abonnement gaz');
    assert.deepEqual(controleSelection(echeancesDues(due), [dues[2].id]), []);
    assert.deepEqual(lignesRetenues(echeancesDues(due), [dues[2].id]).map(l => l.total), [525]);
});

test('TVA manquante : la refacturation est bloquée sur sa facture, le reste se facture', () => {
    const sansTva = input({ services: input().services.map(s => (s.id === 'ee' ? { ...s, vatRateId: undefined } : s)) });
    const due = dueInvoiceLines(sansTva, [], '2026-02-28');
    assert.deepEqual(due.bloquees?.map(b => [b.key, b.nature]), [['svc:ee#f1', 'tva']]);
    assert.equal(due.lines.filter(l => l.itemKey === 'svc:abo').length, 2);
});

test('annexe : une ligne par facture du fournisseur, colonne des frais seulement s\'il y en a', async () => {
    const { annexesP1 } = await import('../src/lib/billing/p1-annexe');
    const lignes = dueInvoiceLines(input(), [], '2026-03-31').lines;
    const a = annexesP1(lignes).find(x => x.type === 'refacturation')!;
    assert.equal(a.titre, "Refacturation à l'euro l'euro");
    assert.deepEqual(a.lignes.map(l => [l.valeurs.fournisseur, l.valeurs.numero, l.valeurs.date, l.valeurs.periode, l.valeurs.montantFournisseur, l.valeurs.frais, l.valeurs.ht]),
        [['Gaz du Sud', 'G-101', '10/02/2026', '01/01/2026 → 31/01/2026', 1000, 5, 1050], ['Gaz du Sud', 'G-102', '12/03/2026', '', 800.4, 5, 840.42]]);
    assert.deepEqual(a.totaux, { ht: 1890.42, tva: 378.08, ttc: 2268.5 });
    const sansFrais = input({ services: input().services.map(s => (s.id === 'ee' ? { ...s, refacFrais: 0 } : s)) });
    const b = annexesP1(dueInvoiceLines(sansFrais, [], '2026-03-31').lines).find(x => x.type === 'refacturation')!;
    assert.ok(!b.colonnes.some(c => c.cle === 'frais'));
    assert.equal(b.formule, 'Montant refacturé = montant HT de la facture du fournisseur');
    assert.equal(b.totaux.ht, 1800.4);
});

test('saisie d\'une facture du fournisseur : champs obligatoires, période cohérente, avoir en négatif', async () => {
    const { controlerFactureEnergie } = await import('../src/lib/billing/factures-energie');
    const ok = controlerFactureEnergie({ fournisseur: ' Gaz du Sud ', numero: 'G-1', date: '2026-02-10', montantHT: -120.456, debut: '', fin: '' });
    assert.deepEqual(ok, { ok: true, valeur: { fournisseur: 'Gaz du Sud', numero: 'G-1', date: '2026-02-10', debut: null, fin: null, montantHT: -120.46, serviceId: null, pointId: null, quantite: null } });
    const ko = controlerFactureEnergie({ fournisseur: '', numero: '', date: '10/02/2026', montantHT: 0, debut: '2026-02-01' });
    assert.equal(ko.ok, false);
    assert.equal(!ko.ok && ko.erreurs.length, 5);
    const inverse = controlerFactureEnergie({ fournisseur: 'X', numero: '1', date: '2026-02-10', montantHT: 10, debut: '2026-02-28', fin: '2026-02-01' });
    assert.match(!inverse.ok ? inverse.erreurs[0] : '', /la fin précède le début/);
});
