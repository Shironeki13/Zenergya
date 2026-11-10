// MTI de bout en bout (émulateur) : facturation au DJU bornée par l'allumage et l'arrêt ; acomptes 1/7 puis décompte
// calculé (P1₀ × C/C0 annuel × DJU de la saison / DJU contractuels − acomptes) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../src/lib/firebase-admin';
import { prepareContractInvoice } from '../src/services/contract-billing-admin';
import { createInvoice } from '../src/services/firestore-admin';
import { addP1Formule, addP1FormuleVersion, addP1Poste, addP1Version, setSaisonChauffe } from '../src/services/p1-admin';
import { prepareP1Regularisation } from '../src/services/p1-regularisation-admin';
import { parseTermes } from '../src/lib/p1/formules';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const paris = (day: string) => Timestamp.fromDate(new Date(`${day}T00:00:00+02:00`));
const origine = (valeur: unknown) => ({ valeur, dateEffet: null, motif: 'contrat d\'origine' });
const by = 'a@v.fr';
const bill = async (date: string) => {
    const p = await prepareContractInvoice('mt-k', date, { isProforma: false });
    await createInvoice(p.invoice, p.company, { contractId: 'mt-k', billingVersion: p.billingVersion });
    return p.invoice;
};
const jours = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

before(async () => {
    await set('companies', 'mt-co', { code: 'MTI', name: 'Veolia MTI' });
    await set('vatRates', 'mt-20', { code: 'TVA20M', rate: 20 });
    await set('activities', 'mt-p1', { code: 'P1M', label: 'P1 chauffage', type: 'P1' });
    await set('schedules', 'mt-mens', { name: 'Mensuel M' });
    await set('terms', 'mt-echu', { name: 'Échu M' });
    await set('terms', 'mt-echoir', { name: 'À échoir M' });
    await set('weatherStations', 'mt-st', { code: 'MT-ST', name: 'Station MTI', isActive: true });
    // 5 DJU par jour d'octobre à mai.
    const b = adminDb.batch();
    for (let t = Date.parse('2025-09-01T00:00:00Z'); t <= Date.parse('2026-06-30T00:00:00Z'); t += 86_400_000) {
        const date = new Date(t).toISOString().slice(0, 10);
        const m = Number(date.slice(5, 7));
        b.set(adminDb.collection('djus').doc(`MT-ST_${date}`), { stationCode: 'MT-ST', stationName: 'Station MTI', date, value: m >= 10 || m <= 5 ? 5 : 0 });
    }
    await b.commit();
    await set('clients', 'mt-cli', { name: 'Ville MTI', companyId: 'mt-co' });
    await set('contracts', 'mt-k', {
        contractNumber: 'CTN-03301', clientId: 'mt-cli', clientName: 'Ville MTI', companyId: 'mt-co', status: 'Actif',
        startDate: paris('2025-07-01'), endDate: paris('2027-06-30'), billingSchedule: 'Mensuel M', siteIds: ['mt-dju', 'mt-acc'], activityIds: ['mt-p1'],
    });
    for (const id of ['mt-dju', 'mt-acc']) await set('sites', id, { code: `SIT-${id}`, name: id === 'mt-dju' ? 'Hôtel de Ville' : 'Résidence', clientId: 'mt-cli', contractId: 'mt-k', amountsSource: 'services' });
    await set('services', 'mt-s1', { siteId: 'mt-dju', contractId: 'mt-k', activityId: 'mt-p1', type: 'P1', p1Type: 'CHAUFFAGE', p1Mode: 'dju', price: 5583.54, startDate: '2025-07-01', endDate: '2027-06-30', isActive: true, vatRateId: 'mt-20', scheduleId: 'mt-mens', billingTermId: 'mt-echu' });
    await set('services', 'mt-s2', { siteId: 'mt-acc', contractId: 'mt-k', activityId: 'mt-p1', type: 'P1', p1Type: 'CHAUFFAGE', p1Mode: 'acompte', price: 0, startDate: '2025-07-01', endDate: '2027-06-30', isActive: true, vatRateId: 'mt-20', scheduleId: 'mt-mens', billingTermId: 'mt-echoir' });
    // Paramétrage P1 : station, prix de base, poste (DJU contractuels 1 200, cible 102 MWh), formule à prix fixe (C/C0 = 1).
    for (const id of ['mt-dju', 'mt-acc']) {
        await addP1Version({ scope: 'site', id }, 'stationMeteo', origine('MT-ST'), by);
        await addP1Version({ scope: 'site', id }, 'prixBase', origine(80.7529), by);
        const poste = await addP1Poste(id, 'Chauffage', by);
        await addP1Version({ scope: 'poste', id, posteId: poste }, 'djuReference', origine(1200), by);
        await addP1Version({ scope: 'poste', id, posteId: poste }, 'cibleNb', origine(102), by);
        await addP1Version({ scope: 'poste', id, posteId: poste }, 'cibleNbUnite', origine('MWh'), by);
    }
    await addP1Version({ scope: 'site', id: 'mt-acc' }, 'quantiteAcompte', origine(102), by);
    // 1/7 d'octobre à avril (janvier → décembre).
    const septieme = [1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1].map(x => (x ? '14,2857142857' : '0')).join(';');
    await addP1Version({ scope: 'contract', id: 'mt-k' }, 'repartitionAcomptes', origine(septieme), by);
    await addP1Version({ scope: 'contract', id: 'mt-k' }, 'regularisation', origine('decompte_dju'), by);
    const f = await addP1Formule('mt-k', { nom: 'Gaz', usage: 'chauffage', perimetre: { type: 'contrat' } }, by);
    await addP1FormuleVersion('mt-k', f, {
        forme: 'B', mode: 'standard', baseEnergetique: 'PCS', unitePrix: 'EUR/MWh', dateM0: '2025-01', m0Manquante: null, regimeKmol: 'variable',
        prixMoleculeNegocie: null, prixFixe: true, periodicite: 'mensuel', termes: parseTermes('p0=1') as never,
    }, { dateEffet: null, motif: 'marché' }, by);
    await setSaisonChauffe('mt-dju', { saison: '2025-2026', allumage: '2025-10-15', arret: '2026-05-10' }, by);
    await setSaisonChauffe('mt-acc', { saison: '2025-2026', allumage: '2025-10-13', arret: null }, by);
});

test('MTI au DJU : rien l\'été, octobre depuis l\'allumage, montant = base × C/C0 / DJU contractuels × DJU', async () => {
    await assert.rejects(prepareContractInvoice('mt-k', '2025-09-15', { isProforma: false }), /Rien à facturer/);
    const inv = await bill('2025-12-01');
    const dju = inv.lineItems.filter(l => l.p1Dju);
    // Octobre : du 15 au 31 = 17 jours × 5 = 85 DJU ; novembre : 30 × 5 = 150 DJU.
    assert.deepEqual(dju.map(l => [l.periodStartDate, l.p1Dju!.mois[0].debut, l.p1Dju!.mois[0].dju, l.total]), [
        ['2025-10-01', '2025-10-15', 85, Math.round(5583.54 / 1200 * 85 * 100) / 100],
        ['2025-11-01', '2025-11-01', 150, Math.round(5583.54 / 1200 * 150 * 100) / 100],
    ]);
    // Acomptes 1/7 : juillet à décembre (à échoir), saison d'octobre à avril seulement.
    const acomptes = inv.lineItems.filter(l => l.p1Acompte).map(l => [l.periodStartDate, l.total]);
    assert.deepEqual(acomptes.map(a => a[0]), ['2025-10-01', '2025-11-01', '2025-12-01']);
    assert.equal(acomptes[0][1], Math.round(102 * 80.7529 * 0.142857142857 * 100) / 100);
});

test('décompte : saison en cours refusée ; après l\'arrêt, P1 dû − acomptes, détail repris dans la ligne', async () => {
    for (const d of ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01']) await bill(d);
    const enCours = await prepareP1Regularisation('mt-k', '2025-07', '2026-06');
    assert.match(enCours.errors.join(' '), /saison 2025-2026 en cours \(arrêt non renseigné\)/);
    await setSaisonChauffe('mt-acc', { saison: '2025-2026', allumage: '2025-10-13', arret: '2026-05-27' }, by);
    const prep = await prepareP1Regularisation('mt-k', '2025-07', '2026-06');
    assert.deepEqual(prep.errors, []);
    const dju = jours('2025-10-13', '2026-05-27') * 5;
    const du = Math.round(102 * 80.7529 * dju / 1200 * 100) / 100;
    const acomptes = Math.round(7 * Math.round(102 * 80.7529 * 0.142857142857 * 100) / 100 * 100) / 100;
    const ligne = prep.lines.find(l => l.siteId === 'mt-acc')!;
    assert.equal(ligne.total, Math.round((du - acomptes) * 100) / 100);
    assert.match(ligne.description, new RegExp(`^Décompte P1 chauffage MTI — Site : Résidence — saison 2025-2026 : P1₀ 8\\s236,80 € × C/C0 1 × ${dju.toLocaleString('fr-FR').replace(/\s/g, '\\s')} / 1\\s200 DJU`));
    const regul = ligne.p1Regul as { decompte?: { du: number; dju: number }[] };
    assert.deepEqual([regul.decompte![0].dju, regul.decompte![0].du], [dju, du]);
});
