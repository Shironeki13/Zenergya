// Analytique de bout en bout (émulateur) : code figé à l'émission, externe, réaffectation, suivi des ventes, reprise :
// npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../src/lib/firebase-admin';
import { prepareContractInvoice } from '../src/services/contract-billing-admin';
import { createInvoice, createCreditNote } from '../src/services/firestore-admin';
import { analytiqueContrat, reaffecterAnalytique, repriseAnalytique, setAnalytiqueExterne, suiviVentes } from '../src/services/analytique-admin';
import { totauxParAxe } from '../src/lib/analytique';
import { creditNoteAmounts } from '../src/lib/credit-notes';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const get = async (c: string, id: string) => (await adminDb.collection(c).doc(id).get()).data()!;
const paris = (day: string) => Timestamp.fromDate(new Date(`${day}T00:00:00+02:00`));
const bill = async (date: string) => {
    const p = await prepareContractInvoice('an-k', date, { isProforma: false });
    const { id } = await createInvoice(p.invoice, p.company, { contractId: 'an-k', billingVersion: p.billingVersion });
    return { id, lines: p.invoice.lineItems };
};

before(async () => {
    await set('companies', 'an-co', { code: 'ANA', name: 'Société analytique' });
    await set('agencies', 'an-ag', { name: 'Lyon', code: 'LYO', companyId: 'an-co' });
    await set('sectors', 'an-s1', { name: 'Lyon Nord', code: 'LN', agencyId: 'an-ag' });
    await set('sectors', 'an-s2', { name: 'Lyon Sud', code: 'LS', agencyId: 'an-ag' });
    await set('vatRates', 'an-20', { code: 'TVA20AN', rate: 20 });
    await set('activities', 'an-p2', { code: 'P2AN', label: 'Conduite', type: 'P2', vatRateId: 'an-20' });
    await set('activities', 'an-p3', { code: 'P3AN', label: 'Garantie', type: 'P3', vatRateId: 'an-20' });
    await set('schedules', 'an-trim', { name: 'Trimestriel AN' });
    await set('terms', 'an-echoir', { name: 'À échoir AN' });
    await set('clients', 'an-cli', { name: 'Copropriété analytique', externalCode: 'CLI-08801', companyId: 'an-co', agencyId: 'an-ag', sectorId: 'an-s1' });
    await set('contracts', 'an-k', {
        contractNumber: 'CTN-08801', clientId: 'an-cli', clientName: 'Copropriété analytique', companyId: 'an-co', status: 'Actif',
        startDate: paris('2026-01-01'), endDate: paris('2028-12-31'), billingSchedule: 'Trimestriel AN', siteIds: ['an-site'], activityIds: ['an-p2', 'an-p3'], invoicingType: 'multi-site',
    });
    await set('sites', 'an-site', { code: 'SIT-08801', name: 'Bâtiment A', clientId: 'an-cli', contractId: 'an-k', amountsSource: 'services' });
    for (const [id, act, price] of [['an-sv2', 'an-p2', 4000], ['an-sv3', 'an-p3', 1200]] as const) {
        await set('services', id, { siteId: 'an-site', contractId: 'an-k', activityId: act, type: 'P2', price, startDate: '2026-01-01', endDate: '2028-12-31', isActive: true, scheduleId: 'an-trim', billingTermId: 'an-echoir' });
    }
});

test('émission : chaque ligne porte le code de sa prestation et ses axes ; codes figés sur client, contrat, prestations', async () => {
    const avant = await analytiqueContrat('an-k');
    assert.deepEqual([avant.contrat.code, avant.contrat.fige, avant.contrat.origine], ['ANA-LYO-LN-CLI08801-CTN08801', false, 'genere']);
    const { lines } = await bill('2026-01-05');
    assert.deepEqual(lines.map(l => [l.activityCode, l.analytique?.code]), [['P2AN', 'ANA-LYO-LN-CLI08801-CTN08801-P2AN'], ['P3AN', 'ANA-LYO-LN-CLI08801-CTN08801-P3AN']]);
    assert.deepEqual(lines[0].analytique!.axes, {
        societe: 'ANA', agence: 'LYO', secteur: 'LN', client: 'CLI08801', contrat: 'CTN08801', activite: 'P2AN',
        companyId: 'an-co', agencyId: 'an-ag', sectorId: 'an-s1', clientId: 'an-cli', contractId: 'an-k', siteId: 'an-site',
    });
    assert.deepEqual([(await get('clients', 'an-cli')).analyticCode, (await get('contracts', 'an-k')).analyticCode, (await get('services', 'an-sv2')).analyticCode],
        ['ANA-LYO-LN-CLI08801', 'ANA-LYO-LN-CLI08801-CTN08801', 'ANA-LYO-LN-CLI08801-CTN08801-P2AN']);
});

test('figé : le client change de secteur, le code ne bouge pas ; réaffectation explicite : nouveau code, ancien dans l\'historique', async () => {
    await adminDb.collection('clients').doc('an-cli').update({ sectorId: 'an-s2' });
    const t2 = await bill('2026-04-05');
    assert.deepEqual([t2.lines[0].analytique!.code, t2.lines[0].analytique!.axes.secteur, t2.lines[0].analytique!.axes.sectorId], ['ANA-LYO-LN-CLI08801-CTN08801-P2AN', 'LN', 'an-s1']);
    await assert.rejects(reaffecterAnalytique('an-k', ' ', 'a@v.fr'), /Motif/);
    const apres = await reaffecterAnalytique('an-k', 'client passé à Lyon Sud', 'a@v.fr', { client: true });
    assert.deepEqual([apres.client.code, apres.contrat.code, apres.historique.map(h => [h.code, h.motif])], ['ANA-LYO-LS-CLI08801', 'ANA-LYO-LS-CLI08801-CTN08801', [['ANA-LYO-LN-CLI08801-CTN08801', 'client passé à Lyon Sud']]]);
    const t3 = await bill('2026-07-05');
    assert.deepEqual([t3.lines[0].analytique!.code, t3.lines[0].analytique!.axes.secteur], ['ANA-LYO-LS-CLI08801-CTN08801-P2AN', 'LS']);
});

test('code externe : propre à une prestation, puis au contrat (hérité avec le segment) ; le code généré reste sur la ligne', async () => {
    await setAnalytiqueExterne('prestation', 'an-sv3', ' 68W2/V080912-1-003 ', 'a@v.fr');
    await setAnalytiqueExterne('contrat', 'an-k', 'V080912-1', 'a@v.fr');
    await assert.rejects(setAnalytiqueExterne('contrat', 'an-k', 'x'.repeat(61), 'a@v.fr'), /60 caractères/);
    const a = await analytiqueContrat('an-k');
    assert.deepEqual(a.prestations.map(p => [p.activityCode, p.analytique.code, p.analytique.origine]).sort(), [['P2AN', 'V080912-1-P2AN', 'externe-herite'], ['P3AN', '68W2/V080912-1-003', 'externe']]);
    const t4 = await bill('2026-10-05');
    const p3 = t4.lines.find(l => l.activityCode === 'P3AN')!.analytique!;
    assert.deepEqual([p3.code, p3.externe, p3.genere], ['68W2/V080912-1-003', '68W2/V080912-1-003', 'ANA-LYO-LS-CLI08801-CTN08801-P3AN']);
    // Retrait du code externe du contrat : retour au code généré.
    await setAnalytiqueExterne('contrat', 'an-k', '', 'a@v.fr');
    assert.equal((await analytiqueContrat('an-k')).contrat.origine, 'genere');
});

test('suivi des ventes : par axe, avoir d\'annulation en négatif ; reprise d\'une facture sans analytique', async () => {
    const factures = (await adminDb.collection('invoices').where('contractId', '==', 'an-k').get()).docs.sort((x, y) => String(x.get('invoiceNumber')).localeCompare(String(y.get('invoiceNumber'))));
    const ht = factures.map(f => Number(f.get('subtotal')));
    const cents = (x: number) => Math.round(x * 100) / 100;
    const s = await suiviVentes('2026-01-01', '2026-12-31');
    const an = s.lignes.filter(l => l.analytique?.axes.contractId === 'an-k');
    assert.equal(factures.length, 4);
    assert.equal(cents(an.reduce((t, l) => t + l.montant, 0)), cents(ht.reduce((a, b) => a + b, 0)));
    // Deux premiers trimestres au secteur LN, deux suivants au secteur LS (après réaffectation).
    assert.deepEqual(totauxParAxe(an, 'secteur').map(t => [t.axes.secteur, t.montant]), [['LN', cents(ht[0] + ht[1])], ['LS', cents(ht[2] + ht[3])]]);
    assert.deepEqual([s.libelles.agence.LYO, s.libelles.secteur.LS, s.libelles.client.CLI08801], ['Lyon', 'Lyon Sud', 'Copropriété analytique']);
    // Avoir d'annulation de la dernière facture : ses ventes repassent à zéro.
    const derniere = factures[3];
    await createCreditNote([derniere.id], invoices => ({
        originalInvoiceIds: invoices.map(i => i.id), contractId: 'an-k', clientId: 'an-cli', clientName: 'Copropriété analytique', date: '2026-10-20', reason: 'Erreur de période',
        status: 'finalized', ...creditNoteAmounts(invoices),
    } as never));
    const apres = (await suiviVentes('2026-01-01', '2026-12-31')).lignes.filter(l => l.analytique?.axes.contractId === 'an-k');
    assert.equal(cents(apres.reduce((t, l) => t + l.montant, 0)), cents(ht[0] + ht[1] + ht[2]));

    // Reprise : une ancienne facture sans analytique reçoit le code actuel ; la simulation n'écrit rien.
    await set('invoices', 'an-ancienne', { contractId: 'an-k', clientId: 'an-cli', status: 'paid', invoiceNumber: 'ANA-OLD-1', date: new Date('2025-06-01'), lineItems: [{ description: 'Conduite', quantity: 1, unitPrice: 100, total: 100, siteId: 'an-site', activityCode: 'P2AN', serviceId: 'an-sv2' }] });
    const simulation = await repriseAnalytique(false);
    assert.ok(simulation.documents >= 1);
    assert.equal((await get('invoices', 'an-ancienne')).lineItems[0].analytique, undefined);
    await repriseAnalytique(true);
    assert.equal((await get('invoices', 'an-ancienne')).lineItems[0].analytique.code, 'ANA-LYO-LS-CLI08801-CTN08801-P2AN');
});
