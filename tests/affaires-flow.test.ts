// Affaires de travaux de bout en bout (émulateurs) : affaire à l'acceptation d'un devis P5, devis complémentaire,
// analytique sur les factures, suivi des ventes, reprise : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { attachQuoteToProject, createDirectProject, createProjectFromQuote, invoiceSituation, repriseAffaires, saveSituationDraft } from '../src/services/projects-admin';
import { acceptQuote } from '../src/services/quotes-admin';
import { invoiceQuote } from '../src/services/quote-billing';
import { setAnalytiqueExterneAffaire, suiviVentes } from '../src/services/analytique-admin';
import { totauxParAxe } from '../src/lib/analytique';
import { computeQuoteTotals } from '../src/lib/quotes/pricing';
import type { Project } from '../src/lib/projects/types';
import type { Quote, QuoteLine, QuotePricing } from '../src/lib/quotes/types';

if (!process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateurs requis).');

const pricing: QuotePricing = { coefficient: 1.4, laborRate: 70, laborCost: 45, defaultVatRate: 20 };
const lignes = (prefixe: string, fourniture: number, heures: number): QuoteLine[] => [
    { id: `${prefixe}1`, kind: 'FOURNITURE', label: 'Matériel', quantity: 1, unitCost: fourniture, vatRate: 20 },
    { id: `${prefixe}2`, kind: 'MAIN_OEUVRE', label: 'Pose', unit: 'h', quantity: heures, vatRate: 20 },
];
let n = 0;
async function devis(etat: 'envoye' | 'accepte', mode: 'P5' | 'P6', lines: QuoteLine[], extra: Partial<Quote> = {}): Promise<string> {
    n++;
    const ref = adminDb.collection('quotes').doc();
    await ref.set({
        number: `TR-DEV2026-${String(n).padStart(4, '0')}`, companyId: 'tr-co', clientId: 'tr-cli', clientName: 'Copropriété travaux', agencyId: 'tr-ag', sectorId: 'tr-se',
        title: `Travaux ${n}`, mode, status: etat, version: 1, date: '2026-10-01', validityDays: 60, validUntil: '2026-12-31', pricing, lines, totals: computeQuoteTotals(lines, pricing),
        ...(etat === 'accepte' && { acceptance: { acceptedAt: '2026-10-15', signatoryName: 'M. Syndic', recordedAt: new Date().toISOString() } }),
        sentAt: '2026-10-02T08:00:00Z', createdAt: '', updatedAt: '', ...extra,
    } as Omit<Quote, 'id'>);
    return ref.id;
}
const projet = async (id: string) => ({ id, ...(await adminDb.collection('projects').doc(id).get()).data() }) as Project;
const quote = async (id: string) => (await adminDb.collection('quotes').doc(id).get()).data() as Quote;
const facture = async (id: string) => (await adminDb.collection('invoices').doc(id).get()).data()!;

before(async () => {
    await adminDb.collection('companies').doc('tr-co').set({ code: 'TRV', name: 'Société travaux', siret: '73282932000074' });
    await adminDb.collection('agencies').doc('tr-ag').set({ name: 'Lyon', code: 'LYO', companyId: 'tr-co' });
    await adminDb.collection('sectors').doc('tr-se').set({ name: 'Lyon Nord', code: 'LN', agencyId: 'tr-ag' });
    await adminDb.collection('clients').doc('tr-cli').set({ name: 'Copropriété travaux', externalCode: 'CLI-07001', clientType: 'private', companyId: 'tr-co', agencyId: 'tr-ag', sectorId: 'tr-se' });
});

let affaireId = '';
test('P5 : affaire créée à l\'acceptation (facturation directe), budget par nature, analytique figée ; facture avec le code', async () => {
    const id = await devis('envoye', 'P5', lignes('a', 1000, 10));
    const q = await acceptQuote(id, { acceptedAt: '2026-10-15', signatoryName: 'M. Syndic' }, 'adv@v.fr');
    assert.ok(q.projectId);
    assert.equal(q.projectBilling, 'direct');
    affaireId = q.projectId!;
    const p = await projet(affaireId);
    assert.match(p.code, /^TRV-AFF\d{4}-\d{4}$/);
    assert.deepEqual([p.billing, p.mode, p.quotes!.length], ['direct', 'P5', 1]);
    // Vente 1 400 + 700 ; déboursé 1 000 + 450.
    assert.deepEqual([p.budget!.vente, p.budget!.cout, p.budget!.parNature.FOURNITURE, p.budget!.parNature.MAIN_OEUVRE, p.budget!.heures, p.budget!.marge], [2100, 1450, 1000, 450, 10, 650]);
    const seg = p.code.slice(p.code.indexOf('AFF')).replace(/-/g, '');
    assert.equal(p.analyticCode, `TRV-LYO-LN-CLI07001-${seg}`);
    // Facturation directe toujours possible (acompte), et la ligne porte le code et les axes de l'affaire.
    const { invoiceId } = await invoiceQuote(id, { kind: 'acompte', percent: 30 });
    const f = await facture(invoiceId);
    assert.equal(f.projectId, affaireId);
    assert.deepEqual([f.lineItems[0].analytique.code, f.lineItems[0].analytique.axes.affaire, f.lineItems[0].analytique.axes.activite, f.lineItems[0].analytique.axes.projectId], [`TRV-LYO-LN-CLI07001-${seg}`, seg, 'P5', affaireId]);
    // Idempotent.
    assert.equal((await createDirectProject(id)).id, affaireId);
});

test('devis complémentaire : rattaché à la même affaire, budget cumulé, même code ; contrôles', async () => {
    const complement = await devis('envoye', 'P5', lignes('b', 500, 4));
    const q = await acceptQuote(complement, { acceptedAt: '2026-11-02', signatoryName: 'M. Syndic', attachProjectId: affaireId }, 'adv@v.fr');
    assert.deepEqual([q.projectId, q.projectBilling], [affaireId, 'direct']);
    const p = await projet(affaireId);
    assert.deepEqual([p.quotes!.length, p.budget!.vente, p.budget!.parNature.FOURNITURE, p.budget!.heures, p.totalHT, p.lines.length], [2, 2100 + 700 + 280, 1500, 14, 3080, 4]);
    const { invoiceId } = await invoiceQuote(complement, { kind: 'totale' });
    assert.equal((await facture(invoiceId)).lineItems[0].analytique.code, p.analyticCode);
    // Déjà rattaché ; autre client : refusés.
    await assert.rejects(attachQuoteToProject(complement, affaireId), /déjà dans l'affaire/);
    const autre = await devis('accepte', 'P5', lignes('c', 100, 1), { clientId: 'tr-autre' });
    await assert.rejects(attachQuoteToProject(autre, affaireId), /même client/);
});

test('P6 : pas d\'affaire à l\'acceptation ; créée par situations, code sur la facture de situation ; complément ajouté au marché', async () => {
    const id = await devis('envoye', 'P6', lignes('d', 10000, 100));
    const q = await acceptQuote(id, { acceptedAt: '2026-10-20', signatoryName: 'M. Syndic' }, 'adv@v.fr');
    assert.equal(q.projectId, undefined);
    const p = await createProjectFromQuote(id, { retentionPct: 5 }, 'adv@v.fr');
    assert.deepEqual([p.billing, p.mode, p.budget!.vente, !!p.analyticCode], ['situations', 'P6', 21000, true]);
    assert.equal((await quote(id)).projectBilling, 'situations');
    await assert.rejects(invoiceQuote(id, { kind: 'totale' }), /avancement/);
    const s = await saveSituationDraft(p.id, { period: '2026-11', progress: { d1: 50, d2: 20 } });
    const { invoiceId } = await invoiceSituation(s.id);
    assert.deepEqual([(await facture(invoiceId)).lineItems[0].analytique.code, (await facture(invoiceId)).lineItems[0].analytique.axes.activite], [p.analyticCode, 'P6']);
    // Devis complémentaire rattaché : ses lignes rejoignent le marché, à 0 %.
    const plus = await devis('accepte', 'P6', lignes('d', 2000, 10));   // mêmes identifiants de lignes : rendus uniques
    const apres = await attachQuoteToProject(plus, p.id, 'adv@v.fr');
    assert.deepEqual([apres.lines.length, new Set(apres.lines.map(l => l.id)).size, apres.totalHT, apres.budget!.vente], [4, 4, 21000 + 3500, 24500]);
});

test('code externe de l\'affaire ; suivi des ventes par affaire ; reprise d\'un devis P5 accepté avant', async () => {
    await setAnalytiqueExterneAffaire(affaireId, '68W2/T260001', 'adv@v.fr');
    const id3 = await devis('envoye', 'P5', lignes('e', 200, 2));
    await acceptQuote(id3, { acceptedAt: '2026-11-05', signatoryName: 'M. Syndic', attachProjectId: affaireId }, 'adv@v.fr');
    const { invoiceId } = await invoiceQuote(id3, { kind: 'totale' });
    const a = (await facture(invoiceId)).lineItems[0].analytique;
    assert.deepEqual([a.code, a.externe, a.genere], ['68W2/T260001', '68W2/T260001', (await projet(affaireId)).analyticCode]);

    const annee = new Date().getUTCFullYear();
    const s = await suiviVentes(`${annee}-01-01`, `${annee}-12-31`);
    const p = await projet(affaireId);
    const seg = p.code.slice(p.code.indexOf('AFF')).replace(/-/g, '');
    const parAffaire = totauxParAxe(s.lignes.filter(l => l.analytique?.axes.clientId === 'tr-cli'), 'contrat');
    const ligne = parAffaire.find(t => t.axes.contrat === seg)!;
    // Acompte 30 % de 2 100 + complément 980 + troisième devis 420.
    assert.equal(ligne.montant, 630 + 980 + 420);
    assert.match(s.libelles.contrat[seg], /^Travaux — /);

    // Reprise : devis P5 accepté sans affaire, avec une facture sans analytique.
    const ancien = await devis('accepte', 'P5', lignes('f', 300, 3));
    await adminDb.collection('invoices').doc('tr-ancienne').set({ quoteId: ancien, clientId: 'tr-cli', contractId: '', status: 'paid', invoiceNumber: 'TRV-OLD-1', date: new Date('2026-09-01'), lineItems: [{ description: 'Travaux', quantity: 1, unitPrice: 630, total: 630, activityCode: 'P5' }] });
    const simu = await repriseAffaires(false);
    assert.ok(simu.affairesCreees >= 1);
    assert.equal((await quote(ancien)).projectId, undefined);
    await repriseAffaires(true);
    const repris = await quote(ancien);
    assert.ok(repris.projectId);
    const f = await facture('tr-ancienne');
    assert.deepEqual([f.projectId, f.lineItems[0].analytique.axes.projectId], [repris.projectId, repris.projectId]);
});
