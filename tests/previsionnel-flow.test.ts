// Prévisionnel de facturation : contrats actifs lus et rangés par mois, agence et activité (émulateur) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../src/lib/firebase-admin';
import { moisSuivants } from '../src/lib/billing/previsionnel';
import { previsionnelFacturation } from '../src/services/previsionnel-admin';

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
