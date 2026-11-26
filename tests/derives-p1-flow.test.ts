// Dérives P1 : marge par site contre l'an dernier et le budget ; récapitulatif du jour où un site entre en dérive.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { derivesP1, enregistrerSeuils, lireSeuils } from '../src/services/derives-p1-admin';
import { rappelsDerivesP1 } from '../src/services/notifications-metier';
import { MODELES_DEFAUT } from '../src/lib/notifications/modeles';
import { rendre } from '../src/lib/notifications/balises';

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const mois = [1, 2, 3, 10, 11];
const ligne = (an: number, m: number, total: number) => ({ description: 'P1', quantity: 1, unitPrice: total, total, activityCode: 'DP1', siteId: 'dp-s', periodStartDate: `${an}-${String(m).padStart(2, '0')}-01`, periodEndDate: `${an}-${String(m).padStart(2, '0')}-28` });

before(async () => {
    await set('activities', 'dp-p1', { code: 'DP1', label: 'Chauffage DP', type: 'P1' });
    await set('contracts', 'dp-k', { contractNumber: 'CTN-DP01', clientName: 'Client dérive', siteIds: ['dp-s'], activityIds: ['dp-p1'], status: 'Actif' });
    await set('sites', 'dp-s', { name: 'Chaufferie dérive', contractId: 'dp-k' });
    // An dernier : 1 000 € facturés et 700 € d'achat par mois (30 %) ; cette année, l'achat passe à 950 € (5 %).
    await set('invoices', 'dp-f', { invoiceNumber: 'DP-1', contractId: 'dp-k', status: 'paid', lineItems: [...mois.map(m => ligne(2025, m, 1000)), ...mois.map(m => ligne(2026, m, 1000))] });
    for (const an of [2025, 2026]) for (const m of mois) {
        const mm = String(m).padStart(2, '0');
        await set('facturesEnergie', `dp-e-${an}-${mm}`, { siteId: 'dp-s', numero: `GZ-${an}-${mm}`, date: `${an}-${mm}-28`, debut: `${an}-${mm}-01`, fin: `${an}-${mm}-28`, montantHT: an === 2026 ? 950 : 700, quantite: 10 });
    }
    await set('budgets', 'dp-k_2026', { contractId: 'dp-k', annee: 2026, lignes: [{ activite: 'DP1', ca: 12000, energie: 8400, achats: 0, mainOeuvre: 0, sousTraitance: 0 }] });
});
after(async () => {
    for (const c of ['activities', 'contracts', 'sites', 'invoices', 'facturesEnergie', 'budgets']) for (const d of (await adminDb.collection(c).get()).docs) if (d.id.startsWith('dp-')) await d.ref.delete();
    for (const id of ['seuils', 'etat']) await adminDb.collection('derivesP1').doc(id).delete();
});

test('site en dérive forte : seuil, an dernier et budget ; cause : le prix d\'achat ; périmètre respecté', async () => {
    const d = await derivesP1(null, '2026-11-26');
    const s = d.sites.find(x => x.siteId === 'dp-s')!;
    assert.deepEqual([d.de, d.a, s.contractNumber, s.analyse.taux, s.analyse.tauxN1, s.analyse.tauxBudget, s.analyse.gravite], ['2025-12', '2026-11', 'CTN-DP01', 5, 30, 30, 'forte']);
    assert.match(s.analyse.cause!, /prix d'achat de l'énergie en hausse de 35,7 %/);
    assert.equal((await derivesP1(new Set(['autre']), '2026-11-26')).sites.some(x => x.siteId === 'dp-s'), false);
});

test('seuils réglables : un site redevient correct si le seuil le permet', async () => {
    await assert.rejects(enregistrerSeuils({ tauxMin: 500 }, 'a@x'), /entre -100 et 100/);
    await enregistrerSeuils({ tauxMin: 0, baisseN1: 50, ecartBudget: 50, moisMin: 3 }, 'a@x');
    assert.equal((await lireSeuils()).baisseN1, 50);
    assert.equal((await derivesP1(null, '2026-11-26')).sites.find(x => x.siteId === 'dp-s')!.analyse.gravite, null);
    await adminDb.collection('derivesP1').doc('seuils').delete();
});

test('récapitulatif : le jour où le site entre en dérive, pas le lendemain ; texte du mail', async () => {
    const [premier] = await rappelsDerivesP1('2026-11-26');
    assert.equal(premier.evenement, 'derive_p1');
    const lignes = premier.contexte.derives!.lignes.filter(l => l.site === 'Chaufferie dérive');
    assert.deepEqual(lignes.map(l => [l.nouveau, l.gravite, l.taux]), [[true, 'forte', 5]]);
    assert.deepEqual(await rappelsDerivesP1('2026-11-27'), []);
    const mail = rendre(MODELES_DEFAUT.derive_p1, { ...premier.contexte, urlApplication: 'https://zen.example.com' });
    assert.match(mail.sujet, /site\(s\) en dérive de marge P1/);
    assert.match(mail.texte, /\[nouveau\] Client dérive, Chaufferie dérive — marge 5 % \(an dernier 30 %, budget 30 %\) — dérive forte — prix d'achat/);
    assert.match(mail.texte, /https:\/\/zen\.example\.com\/billing\/derives-p1/);
});
