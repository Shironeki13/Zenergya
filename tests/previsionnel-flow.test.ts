// Prévisionnel de facturation : contrats actifs lus et rangés par mois, agence et activité (émulateur) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../src/lib/firebase-admin';
import { moisSuivants } from '../src/lib/billing/previsionnel';
import { previsionnelFacturation } from '../src/services/previsionnel-admin';
import { simulationRevision } from '../src/services/simulation-revision-admin';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const midi = (day: string) => Timestamp.fromDate(new Date(`${day}T12:00:00Z`));
const aujourdhui = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
const mois = moisSuivants(aujourdhui, 12);

before(async () => {
    await set('agencies', 'pv-ag', { name: 'Agence Prévision', code: 'PRV' });
    await set('vatRates', 'pv-20', { code: 'TVA20P', rate: 20 });
    await set('terms', 'pv-echoir', { name: 'À échoir P' });
    await set('activities', 'pv-p2', { code: 'P2PV', label: 'Conduite', type: 'P2', vatRateId: 'pv-20' });
    await set('clients', 'pv-cli', { name: 'Client Prévision', agencyId: 'pv-ag' });
    // Contrat trimestriel à échoir, démarré au 1er du mois en cours et jamais facturé : 4 échéances sur 12 mois.
    await set('contracts', 'pv-k', {
        contractNumber: 'CTN-09941', clientId: 'pv-cli', clientName: 'Client Prévision', status: 'Actif', startDate: midi(`${mois[0]}-01`), endDate: midi(`${Number(mois[0].slice(0, 4)) + 5}-12-31`),
        billingSchedule: 'Trimestriel', siteIds: ['pv-s'], activityIds: ['pv-p2'], invoicingType: 'multi-site',
    });
    await set('sites', 'pv-s', { code: 'SIT-09941', name: 'Site Prévision', contractId: 'pv-k', termId: 'pv-echoir', amounts: [{ activityId: 'pv-p2', amount: 1200 }] });
    // Contrat sans site : signalé, non compté.
    await set('contracts', 'pv-vide', { contractNumber: 'CTN-09942', clientId: 'pv-cli', clientName: 'Client Prévision', status: 'Actif', startDate: midi(`${mois[0]}-01`), endDate: midi(`${Number(mois[0].slice(0, 4)) + 1}-12-31`), siteIds: [], activityIds: [] });
});

test('prévisionnel : échéances du contrat rangées par mois avec son agence et son activité ; contrat incomplet signalé', async () => {
    const p = await previsionnelFacturation(12);
    assert.deepEqual(p.mois, mois);
    const lignes = p.lignes.filter(l => l.contractId === 'pv-k').sort((a, b) => a.mois.localeCompare(b.mois));
    assert.deepEqual(lignes.map(l => [l.mois, l.agence, l.activite, l.montant, l.estime, l.clientId]),
        [0, 3, 6, 9].map(i => [mois[i], 'Agence Prévision', 'P2PV', 300, 0, 'pv-cli']));
    assert.match(p.contratsEnErreur.find(c => c.contractId === 'pv-vide')?.erreur ?? '', /Aucun site/);
    assert.equal((await adminDb.collection('invoices').where('contractId', '==', 'pv-k').get()).size, 0);
});

test('simulation de révision : indice utilisé, révision à venir, effet de l\'hypothèse ; sans hypothèse, aucun écart', async () => {
    const an = Number(aujourdhui.slice(0, 4));
    await set('indices', 'pv-idx', { code: 'IDXPV', label: 'Indice prévision', unit: '', active: true });
    await set('indexValues', 'pv-v0', { indexId: 'pv-idx', period: `${an - 1}-01`, value: 100 });
    await set('indexValues', 'pv-v1', { indexId: 'pv-idx', period: `${an - 1}-12`, value: 110 });
    await set('revisionRules', 'pv-r', { code: 'RPV', name: 'Règle prévision', type: 'PONDERE_SIMPLE', nbMonths: 1, lagMonths: 1, indices: [{ indexId: 'pv-idx', coefficient: 1 }] });
    await set('contracts', 'pv-kr', {
        contractNumber: 'CTN-09943', clientId: 'pv-cli', clientName: 'Client Prévision', status: 'Actif', startDate: midi(`${an - 1}-01-01`), endDate: midi(`${an + 5}-12-31`),
        billingSchedule: 'Trimestriel', siteIds: ['pv-sr'], activityIds: ['pv-p2'], invoicingType: 'multi-site',
    });
    await set('sites', 'pv-sr', { code: 'SIT-09943', name: 'Site Révisé', contractId: 'pv-kr', amountsSource: 'services', amounts: [] });
    await set('services', 'pv-svc', { siteId: 'pv-sr', contractId: 'pv-kr', activityId: 'pv-p2', price: 10000, startDate: midi(`${an - 1}-01-01`), vatRateId: 'pv-20', billingTermId: 'pv-echoir',
        revisionRuleId: 'pv-r', initialIndexValues: [{ indexId: 'pv-idx', value: 100, period: `${an - 1}-01` }], isActive: true });

    const s = await simulationRevision({ 'pv-idx': 10, inconnu: 'x' });
    assert.deepEqual(s.hypotheses, { 'pv-idx': 10 });
    assert.deepEqual(s.indices.filter(i => i.id === 'pv-idx').map(i => [i.code, i.periode, i.valeur, i.contrats]), [['IDXPV', `${an - 1}-12`, 110, 1]]);
    const r = s.revisions.find(x => x.contractId === 'pv-kr')!;
    // Révision du 1er janvier prochain, sur l'indice de décembre : 110 constant, 121 avec +10 %.
    assert.deepEqual([r.date, r.constant, r.simule, r.annuel, r.contractNumber], [`${an + 1}-01-01`, 1.1, 1.21, 10000, 'CTN-09943']);
    const l = s.lignes.filter(x => x.contractId === 'pv-kr' && x.mois !== 'retard');
    assert.ok(l.length > 0 && l.reduce((a, x) => a + x.simule, 0) > l.reduce((a, x) => a + x.base, 0));
    const neutre = await simulationRevision({});
    assert.ok(neutre.lignes.filter(x => x.contractId === 'pv-kr').every(x => x.base === x.simule));
});
