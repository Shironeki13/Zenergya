// Prix annuel P1 d'un site facturé au DJU : facturé au prix du mois, régularisé à la clôture de l'exercice (émulateur) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../src/lib/firebase-admin';
import { prepareContractInvoice } from '../src/services/contract-billing-admin';
import { createInvoice } from '../src/services/firestore-admin';
import { addP1Formule, addP1FormuleVersion, addP1Poste, addP1Version, setSaisonChauffe } from '../src/services/p1-admin';
import { emitP1Regularisation, prepareP1Regularisation } from '../src/services/p1-regularisation-admin';
import { parseTermes } from '../src/lib/p1/formules';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const paris = (day: string) => Timestamp.fromDate(new Date(`${day}T00:00:00+02:00`));
const origine = (valeur: unknown) => ({ valeur, dateEffet: null, motif: 'contrat d\'origine' });
const by = 'a@v.fr';
const cents = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
// DJU par jour et indice de chaque mois de 2025 (base de l'indice : 20 en décembre 2024).
const DJU_JOUR: Record<string, number> = { '01': 10, '02': 8, '03': 6, '04': 4, '10': 3, '11': 6, '12': 9 };
const INDICE: Record<string, number> = { '2024-12': 20, '2025-01': 22, '2025-02': 24, '2025-03': 26, '2025-04': 21, '2025-10': 18, '2025-11': 19, '2025-12': 30 };
// Jours chauffés : arrêt le 20 avril, allumage le 10 octobre.
const JOURS: Record<string, number> = { '2025-01': 31, '2025-02': 28, '2025-03': 31, '2025-04': 20, '2025-10': 22, '2025-11': 30, '2025-12': 31 };
const BASE = 12000, DJU_REF = 1500;

before(async () => {
    await set('companies', 'pa-co', { code: 'PAN', name: 'Veolia Prix annuel' });
    await set('vatRates', 'pa-20', { code: 'TVA20PA', rate: 20 });
    await set('activities', 'pa-p1', { code: 'P1PA', label: 'P1 chauffage', type: 'P1' });
    await set('schedules', 'pa-mens', { name: 'Mensuel PA' });
    await set('terms', 'pa-echu', { name: 'Échu PA' });
    await set('weatherStations', 'pa-st', { code: 'PA-ST', name: 'Station PA', isActive: true });
    let b = adminDb.batch(); let n = 0;
    for (let t = Date.parse('2024-12-01T00:00:00Z'); t <= Date.parse('2026-01-31T00:00:00Z'); t += 86_400_000) {
        const date = new Date(t).toISOString().slice(0, 10);
        b.set(adminDb.collection('djus').doc(`PA-ST_${date}`), { stationCode: 'PA-ST', stationName: 'Station PA', date, value: DJU_JOUR[date.slice(5, 7)] ?? 0 });
        if (++n % 400 === 0) { await b.commit(); b = adminDb.batch(); }
    }
    await b.commit();
    await set('indices', 'pa-peg', { code: 'PEGPA', label: 'PEG', unit: '', active: true });
    for (const [period, value] of Object.entries(INDICE)) await set('indexValues', `pa-peg-${period}`, { indexId: 'pa-peg', period, value });
    await set('clients', 'pa-cli', { name: 'Ville PA', companyId: 'pa-co' });
    await set('contracts', 'pa-k', {
        contractNumber: 'CTN-04401', clientId: 'pa-cli', clientName: 'Ville PA', companyId: 'pa-co', status: 'Actif',
        startDate: paris('2025-01-01'), endDate: paris('2027-12-31'), billingSchedule: 'Mensuel PA', siteIds: ['pa-s'], activityIds: ['pa-p1'],
    });
    await set('sites', 'pa-s', { code: 'SIT-PA', name: 'Mairie', clientId: 'pa-cli', contractId: 'pa-k', amountsSource: 'services' });
    await set('services', 'pa-sv', { siteId: 'pa-s', contractId: 'pa-k', activityId: 'pa-p1', type: 'P1', p1Type: 'CHAUFFAGE', p1Mode: 'dju', price: BASE, startDate: '2025-01-01', endDate: '2027-12-31', isActive: true, vatRateId: 'pa-20', scheduleId: 'pa-mens', billingTermId: 'pa-echu' });
    await addP1Version({ scope: 'site', id: 'pa-s' }, 'stationMeteo', origine('PA-ST'), by);
    await addP1Version({ scope: 'site', id: 'pa-s' }, 'prixBase', origine(80), by);
    await addP1Version({ scope: 'site', id: 'pa-s' }, 'periodeReference', origine('annee_civile'), by);
    const poste = await addP1Poste('pa-s', 'Chauffage', by);
    await addP1Version({ scope: 'poste', id: 'pa-s', posteId: poste }, 'djuReference', origine(DJU_REF), by);
    const f = await addP1Formule('pa-k', { nom: 'Gaz', usage: 'chauffage', perimetre: { type: 'contrat' } }, by);
    await addP1FormuleVersion('pa-k', f, {
        forme: 'B', mode: 'standard', baseEnergetique: 'PCS', unitePrix: 'EUR/MWh', dateM0: '2024-12', m0Manquante: null, regimeKmol: 'variable',
        prixMoleculeNegocie: null, prixFixe: false, periodicite: 'annuel_cloture', termes: parseTermes('Kmol=1*PEGPA@20') as never,
    }, { dateEffet: null, motif: 'marché' }, by);
    await setSaisonChauffe('pa-s', { saison: '2024-2025', allumage: '2024-10-01', arret: '2025-04-20' }, by);
    await setSaisonChauffe('pa-s', { saison: '2025-2026', allumage: '2025-10-10', arret: null }, by);
});

test('prix annuel : chaque mois facturé au C/C0 du mois ; exercice clos, régularisation au C/C0 de l\'exercice ; une seule fois', async () => {
    // Facturation de l'année 2025 (terme échu) : sept mois chauffés, au prix du mois.
    const p = await prepareContractInvoice('pa-k', '2026-01-05', { isProforma: false });
    await createInvoice(p.invoice, p.company, { contractId: 'pa-k', billingVersion: p.billingVersion });
    const facture = (m: string) => cents((BASE * (INDICE[m] / 20)) / DJU_REF * (JOURS[m] * DJU_JOUR[m.slice(5)]));
    const lignes = p.invoice.lineItems.filter(l => l.p1Dju);
    assert.deepEqual(lignes.map(l => [l.p1Dju!.mois[0].mois, l.p1Dju!.mois[0].dju, l.total]), Object.keys(JOURS).map(m => [m, JOURS[m] * DJU_JOUR[m.slice(5)], facture(m)]));

    // Période qui ne fait que commencer l'exercice : rien (il n'est pas clos). Période qui n'en couvre que la fin : refus.
    const debutSeul = await prepareP1Regularisation('pa-k', '2025-01', '2025-06');
    assert.deepEqual([debutSeul.lines, debutSeul.errors], [[], []]);
    const finSeule = await prepareP1Regularisation('pa-k', '2025-06', '2025-12');
    assert.match(finSeule.errors.join(' '), /Site Mairie : prix annuel de l'exercice 2025, régularisez l'exercice entier \(de 01\/2025 à 12\/2025\)/);

    // Exercice entier : C/C0 du mois de clôture (décembre : 30 / 20 = 1,5) sur tous les mois facturés.
    const prep = await prepareP1Regularisation('pa-k', '2025-01', '2025-12');
    assert.deepEqual(prep.errors, []);
    const du = cents(Object.keys(JOURS).reduce((t, m) => t + cents((BASE * 1.5) / DJU_REF * (JOURS[m] * DJU_JOUR[m.slice(5)])), 0));
    const dejaFacture = cents(Object.keys(JOURS).reduce((t, m) => t + facture(m), 0));
    assert.equal(prep.lines.length, 1);
    const regul = prep.lines[0].p1Regul as { mois: string[]; reel: number; acomptes: number; prixAnnuel: { exercice: string; coefficient: number; periodicite: string }[] };
    assert.deepEqual([prep.lines[0].total, regul.reel, regul.acomptes, regul.mois, prep.lines[0].vatRate], [cents(du - dejaFacture), du, dejaFacture, Object.keys(JOURS), 20]);
    assert.deepEqual([regul.prixAnnuel[0].exercice, regul.prixAnnuel[0].coefficient, regul.prixAnnuel[0].periodicite], ['2025', 1.5, 'annuel_cloture']);
    assert.match(prep.lines[0].description, /^Régularisation P1 chauffage au prix annuel — Site : Mairie — exercice 2025 : C\/C0 annuel 1,5 \(mois de clôture de l'exercice\)/);

    // Émission : une facture (le dû dépasse le facturé) ; l'exercice ne se régularise pas deux fois.
    const out = await emitP1Regularisation('pa-k', '2025-01', '2025-12', '2026-01-10');
    assert.ok(out.invoice && !out.creditNote);
    assert.equal((await adminDb.collection('invoices').doc(out.invoice.id).get()).get('subtotal'), cents(du - dejaFacture));
    await assert.rejects(emitP1Regularisation('pa-k', '2025-01', '2025-12', '2026-01-10'), /déjà régularisé/);
});
