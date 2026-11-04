// Cycle de vie des devis (émulateurs Firestore + Storage) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminBucket, adminDb } from '../src/lib/firebase-admin';
import {
    acceptQuote, archiveQuoteVersion, cancelQuote, getQuotePdf, getQuoteVersions, newQuoteVersion, refuseQuote, sendQuote,
} from '../src/services/quotes-admin';
import { computeQuoteTotals } from '../src/lib/quotes/pricing';
import { sha256 } from '../src/services/document-archive';
import type { Quote, QuoteLine, QuotePricing } from '../src/lib/quotes/types';

if (!process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateurs requis).');

const today = new Date().toISOString().slice(0, 10);
const pricing: QuotePricing = { coefficient: 1.35, laborRate: 58, laborCost: 36.5, defaultVatRate: 20 };
const lines: QuoteLine[] = [
    { id: 't', kind: 'TITRE', label: 'Chaufferie', quantity: 0, vatRate: 20, level: 0 },
    { id: 'f', kind: 'FOURNITURE', label: 'Brûleur', quantity: 1, unitCost: 1000, vatRate: 20 },
    { id: 'm', kind: 'MAIN_OEUVRE', label: 'Pose', unit: 'h', quantity: 6, vatRate: 20 },
    { id: 'o', kind: 'FOURNITURE', label: 'Option : sonde', quantity: 1, unitCost: 100, vatRate: 20, optional: true },
];

let n = 0;
async function draftQuote(overrides: Partial<Quote> = {}): Promise<string> {
    n++;
    const ref = adminDb.collection('quotes').doc();
    const q: Omit<Quote, 'id'> = {
        number: `QF-DEV2026-${String(n).padStart(4, '0')}`, companyId: 'qf-co', clientId: 'qf-prospect', clientName: 'Prospect SA', prospect: true,
        interventionAddress: { address: '5 rue des Lilas', postalCode: '69003', city: 'Lyon' },
        title: 'Remplacement brûleur', mode: 'P5', status: 'brouillon', version: 1,
        date: '2026-01-10', validityDays: 30, validUntil: '2026-02-09',
        pricing, lines, totals: computeQuoteTotals(lines, pricing),
        authorName: 'Jeanne Martin', authorEmail: 'jeanne@example.com', contactName: 'M. Durand',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        ...overrides,
    };
    await ref.set(q);
    return ref.id;
}

before(async () => {
    await adminDb.collection('companies').doc('qf-co').set({
        code: 'QF', name: 'Veolia Test', address: '1 rue X', postalCode: '75001', city: 'Paris', siret: '73282932000074',
        insurer: 'Assureur Mutuel', insuranceCoverage: 'France métropolitaine',
    });
    await adminDb.collection('clients').doc('qf-prospect').set({
        name: 'Prospect SA', address: '5 rue des Lilas', postalCode: '69003', city: 'Lyon', relation: 'prospect', companyId: 'qf-co',
    });
    await adminDb.collection('config').doc('sequences').set({ site: 41 }, { merge: true });
});

test('envoi : date du jour, version figée, PDF archivé une seule fois avec son empreinte', async () => {
    const id = await draftQuote();
    const sent = await sendQuote(id, 'jeanne@example.com');
    assert.equal(sent.status, 'envoye');
    assert.equal(sent.date, today);
    assert.ok(sent.validUntil > today);
    assert.equal(sent.sentBy, 'jeanne@example.com');
    assert.ok(sent.pdf, 'PDF enregistré sur le devis');

    const [v1] = await getQuoteVersions(id);
    assert.equal(v1.version, 1);
    assert.equal(v1.totalHT, sent.totals.totalHT);
    assert.equal(v1.snapshot.lines.length, 4);
    const [stored] = await adminBucket().file(v1.pdf.path).download();
    assert.equal(stored.subarray(0, 5).toString(), '%PDF-');
    assert.equal(sha256(stored), v1.pdf.sha256);

    const again = await archiveQuoteVersion(id);
    assert.deepEqual(again.pdf, v1.pdf);

    const pdf = await getQuotePdf(id);
    assert.equal(pdf.sha256, v1.pdf.sha256);
    assert.match(pdf.filename, /^Devis_QF-DEV2026-\d{4}-V1\.pdf$/);

    await assert.rejects(sendQuote(id), /Action impossible/);
});

test('envoi refusé pour un devis incomplet ; aperçu du brouillon non archivé', async () => {
    const id = await draftQuote({ lines: [{ id: 'x', kind: 'MAIN_OEUVRE', label: 'Pose', quantity: 2, vatRate: 20 }], pricing: { ...pricing, laborRate: null } });
    await assert.rejects(sendQuote(id), /incomplet.*taux horaire/);
    const preview = await getQuotePdf(id);
    assert.equal(preview.buffer.subarray(0, 5).toString(), '%PDF-');
    assert.equal(preview.sha256, undefined);
    assert.equal((await getQuoteVersions(id)).length, 0);
});

test('nouvelle version : V1 conservée et téléchargeable, V2 brouillon modifiable puis renvoyée', async () => {
    const id = await draftQuote();
    await sendQuote(id);
    const v2 = await newQuoteVersion(id, 'jeanne@example.com');
    assert.equal(v2.status, 'brouillon');
    assert.equal(v2.version, 2);
    const doc = (await adminDb.collection('quotes').doc(id).get()).data()!;
    assert.equal(doc.pdf, undefined);
    assert.equal(doc.sentAt, undefined);

    const [v1] = await getQuoteVersions(id);
    assert.ok(v1.supersededAt);
    const old = await getQuotePdf(id, 1);
    assert.equal(old.sha256, v1.pdf.sha256);

    await sendQuote(id);
    const versions = await getQuoteVersions(id);
    assert.deepEqual(versions.map(v => v.version), [1, 2]);
    assert.notEqual(versions[0].pdf.path, versions[1].pdf.path);
});

test("acceptation : le prospect devient client, le site est créé depuis l'adresse d'intervention", async () => {
    const id = await draftQuote();
    await sendQuote(id);
    const accepted = await acceptQuote(id, {
        acceptedAt: today, signatoryName: 'M. Durand', signatoryRole: 'Gérant', purchaseOrderNumber: 'BC-778', createSite: true,
    }, 'jeanne@example.com');
    assert.equal(accepted.status, 'accepte');
    assert.equal(accepted.acceptance?.clientConverted, true);
    assert.equal(accepted.acceptance?.purchaseOrderNumber, 'BC-778');

    const client = (await adminDb.collection('clients').doc('qf-prospect').get()).data()!;
    assert.equal(client.relation, 'client');
    const site = (await adminDb.collection('sites').doc(accepted.acceptance!.createdSiteId!).get()).data()!;
    assert.equal(site.code, 'SIT-00042');
    assert.equal(site.clientId, 'qf-prospect');
    assert.equal(site.city, 'Lyon');
    assert.equal(accepted.siteId, accepted.acceptance!.createdSiteId);

    await assert.rejects(newQuoteVersion(id), /Action impossible/);
    await assert.rejects(cancelQuote(id, 'x'), /Action impossible/);
});

test('devis expiré : accepter demande une confirmation explicite', async () => {
    const id = await draftQuote({ clientId: 'qf-prospect' });
    await sendQuote(id);
    await adminDb.collection('quotes').doc(id).update({ validUntil: '2020-01-01' });
    await assert.rejects(acceptQuote(id, { acceptedAt: today, signatoryName: 'X' }), /plus valable/);
    const ok = await acceptQuote(id, { acceptedAt: today, signatoryName: 'X', confirmExpired: true });
    assert.equal(ok.acceptance?.acceptedExpired, true);
});

test('refus avec motif, puis nouvelle version ; annulation avec motif', async () => {
    const id = await draftQuote();
    await sendQuote(id);
    await assert.rejects(refuseQuote(id, { refusedAt: today, reason: ' ' }), /Motif/);
    const refused = await refuseQuote(id, { refusedAt: today, reason: 'Trop cher' });
    assert.equal(refused.status, 'refuse');
    const v2 = await newQuoteVersion(id);
    assert.equal(v2.version, 2);
    assert.equal((await adminDb.collection('quotes').doc(id).get()).get('refusal'), undefined);

    const cancelled = await cancelQuote(id, 'Projet abandonné');
    assert.equal(cancelled.status, 'annule');
    assert.equal(cancelled.cancellation?.previousStatus, 'brouillon');
});
