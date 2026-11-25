// Contrats de fourniture d'énergie : lecture de la feuille, états, couverture, contrats, synthèse (calcul pur) : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    contratsFournisseur, couverture, etatPeriode, lireDate, lireFeuille, lireIndexation, lireMarche, lireNombre, reconnaitreColonnes, syntheseAnnuelle, type PeriodeFourniture,
} from '../src/lib/energie/fournitures';

const ENT = ['CODE SOCIETE SAP\nACHATS P1', 'CODE OTP AGORA / CENTRE DE COUT', 'ENERGIE', 'TYPE DE MARCHE', 'AGENCE / SECTEUR (CONTRAT CLIENT)', 'TITULAIRE CONTRAT ENERGIE\n(CONTRAT FOURNISSEUR)', 'CLIENT', 'SITE', 'PDL',
    'CAR / PUISS. SOUSC. \n(MWh/kVA)', 'DEBUT CONTRAT CLIENT', 'FIN CONTRAT CLIENT', 'DEBUT CONTRAT FOURNISSEUR', 'FIN CONTRAT FOURNISSEUR', 'ETAT CONTRAT FOURNISSEUR', 'FOURNISSEUR', 'CONTRAT FOURNISSEUR N°',
    'TACITE RECONDUCTION', 'CONTRAT FOURNISSEUR SUR LE DRIVE', 'INDEXATION ACHAT', 'PRIX MOLECULE\n(dont RFA €/MWh)', 'TOTAL ABONNEMENT\nEUR/AN', 'VILLE'];
const L = (o: Record<string, string>) => ENT.map(h => o[h.split('\n')[0].split(' / ')[0].trim()] ?? o[h] ?? '');
const ligne = (pdl: string, debut: string, fin: string, fournisseur: string, plus: Record<string, string> = {}) =>
    L({ 'CODE SOCIETE SAP': 'X227', ENERGIE: 'GAZ', AGENCE: 'VEF Lyon', CLIENT: 'Ville A', SITE: 'École', PDL: pdl, 'DEBUT CONTRAT FOURNISSEUR': debut, 'FIN CONTRAT FOURNISSEUR': fin, FOURNISSEUR: fournisseur, ...plus });

test('lecture des valeurs : dates, nombres, indexations et marchés normalisés', () => {
    assert.deepEqual(['01/06/2016', '2026-01-31', 'Date ?', '31/13/2020', ''].map(lireDate), ['2016-06-01', '2026-01-31', null, null, null]);
    assert.deepEqual(['1 000,00 €', '19,82 €', '', '?', '109,462'].map(lireNombre), [1000, 19.82, null, null, 109.462]);
    assert.deepEqual(['PEGEOD', 'peg eod', ' Fixe', 'Prix fixe', 'PEG EOD + PEG MA', ''].map(lireIndexation), ['PEG EOD', 'PEG EOD', 'FIXE', 'FIXE', 'PEG EOD + PEG MA', '']);
    assert.deepEqual(['CPrévisé', 'CP révisé', 'NON RENSEIGNE', 'mti'].map(lireMarche), ['CP révisé', 'CP révisé', '', 'MTI']);
    const c = reconnaitreColonnes(ENT);
    assert.deepEqual([c.client, c.site, c.pdl, c.fournisseur, c.numeroContrat, c.debut, c.debutClient, c.titulaire], [6, 7, 8, 15, 16, 12, 10, 5]);
});

test('feuille : une ligne par période, regroupées par point de livraison ; anomalies signalées sans tout bloquer', () => {
    const r = lireFeuille([ENT,
        ligne('111', '01/01/2020', '31/12/2023', 'EDF', { 'CONTRAT FOURNISSEUR N°': 'ACCORD CADRE', 'TACITE RECONDUCTION': 'NON', 'INDEXATION ACHAT': 'PEGEOD', 'PRIX MOLECULE': '19,82 €', 'ETAT CONTRAT FOURNISSEUR': 'Terminé' }),
        ligne('111', '01/01/2024', '31/12/2026', 'ENDESA', { 'TACITE RECONDUCTION': 'OUI (3 ans)', 'CONTRAT FOURNISSEUR SUR LE DRIVE': 'OUI', SITE: 'École (nouveau nom)', 'CAR': '109,462' }),
        ligne('111', '01/01/2024', '31/12/2026', 'Endesa'),
        ligne('222', 'Date ?', '31/12/2026', 'ENI', { 'ETAT CONTRAT FOURNISSEUR': 'Non rattaché' }),
        ligne('', '01/01/2024', '31/12/2026', 'ENI'),
        ENT.map(() => ''),
    ]);
    assert.deepEqual([r.lignes, r.periodes, r.points.length], [5, 3, 2]);
    const p = r.points[0];
    assert.deepEqual([p.pdl, p.energie, p.site, p.car, p.agence, p.societe], ['111', 'GAZ', 'École (nouveau nom)', 109.462, 'VEF Lyon', 'X227']);
    assert.deepEqual(p.periodes.map(x => [x.debut, x.fin, x.fournisseur, x.numeroContrat, x.tacite, x.taciteDetail ?? '', x.indexationAchat ?? '', x.prixMolecule ?? null]),
        [['2020-01-01', '2023-12-31', 'EDF', 'ACCORD CADRE', 'non', '', 'PEG EOD', 19.82], ['2024-01-01', '2026-12-31', 'ENDESA', '', 'oui', '3 ans', '', null]]);
    assert.deepEqual([r.points[1].periodes[0].debut, r.points[1].periodes[0].remarque], [null, 'Non rattaché']);
    assert.deepEqual(r.anomalies.map(a => [a.ligne, a.message.slice(0, 40)]), [[4, 'PDL 111 : période du 01/01/2024 chez End'], [5, 'PDL 222 : dates du contrat fournisseur à'], [6, 'Point de livraison absent (École) : lign']]);
    assert.match(lireFeuille([['A', 'B']]).anomalies[0].message, /Colonne « PDL » introuvable/);
});

const per = (debut: string | null, fin: string | null, fournisseur = 'EDF', numero = 'C1', plus: Partial<PeriodeFourniture> = {}): PeriodeFourniture => ({ id: `${debut}`, debut, fin, fournisseur, numeroContrat: numero, titulaire: 'VEF', tacite: '', ...plus });

test('états et couverture : calculés des dates ; enchaînement des périodes, renouvellement, fin du contrat client', () => {
    const J = '2026-11-25';
    assert.deepEqual([per('2026-01-01', '2026-12-31'), per('2027-01-01', '2027-12-31'), per('2020-01-01', '2025-12-31'), per(null, '2026-12-31')].map(p => etatPeriode(p, J)), ['en_cours', 'a_venir', 'terminee', 'a_dater']);
    const c = (periodes: PeriodeFourniture[], finClient?: string) => { const r = couverture({ periodes, finClient }, J); return [r.statut, r.finCouverture, r.jours]; };
    assert.deepEqual(c([per('2026-01-01', '2026-12-31')]), ['a_renouveler', '2026-12-31', 36]);
    assert.deepEqual(c([per('2026-01-01', '2026-12-31'), per('2027-01-01', '2028-12-31', 'ENI')]), ['couvert', '2028-12-31', 767]);
    assert.deepEqual(c([per('2026-01-01', '2026-12-31'), per('2027-02-01', '2028-12-31')]), ['a_renouveler', '2026-12-31', 36]);   // trou d'un mois
    assert.deepEqual(c([per('2026-01-01', '2026-12-31')], '2026-12-31'), ['couvert', '2026-12-31', 36]);                              // le contrat client s'arrête aussi
    assert.deepEqual(c([per('2020-01-01', '2025-12-31')]), ['sans_couverture', null, null]);
    assert.deepEqual(c([per('2020-01-01', '2025-12-31')], '2025-12-31'), ['termine', null, null]);
    assert.deepEqual(c([per('2027-01-01', '2027-12-31')]), ['a_venir', null, null]);
    assert.deepEqual(c([]), ['sans_couverture', null, null]);
});

test('contrats fournisseur et synthèse annuelle', () => {
    const points = [
        { id: 'a', energie: 'GAZ' as const, agence: 'Lyon', client: 'Ville A', periodes: [per('2024-01-01', '2025-12-31', 'EDF', 'Cadre 1', { contratDisponible: 'OUI' }), per('2026-01-01', '2026-12-31', 'ENDESA', '')] },
        { id: 'b', energie: 'GAZ' as const, agence: 'Lyon', client: 'Ville A', periodes: [per('2025-07-01', '2027-06-30', 'edf', 'CADRE 1', { titulaire: 'Ville A' })] },
        { id: 'c', energie: 'ELEC' as const, agence: 'Nice', client: 'OPH', periodes: [per('2026-03-01', '2026-03-31', 'EDF', 'E-9')] },
    ];
    const k = contratsFournisseur(points, '2026-11-25');
    assert.deepEqual(k.map(x => [x.fournisseur, x.numero, x.points, x.debut, x.fin, x.etat, x.titulaires.join('+'), x.sansDocument]), [
        ['EDF', 'Cadre 1', 2, '2024-01-01', '2027-06-30', 'en_cours', 'VEF+Ville A', 1], ['ENDESA', '', 1, '2026-01-01', '2026-12-31', 'en_cours', 'VEF', 1], ['EDF', 'E-9', 1, '2026-03-01', '2026-03-31', 'terminee', 'VEF', 1],
    ]);
    const s = syntheseAnnuelle(points, [2024, 2025, 2026, 2027]);
    assert.deepEqual(s.lignes.map(l => [l.energie, l.agence, l.client, l.parAnnee]), [['ELEC', 'Nice', 'OPH', [0, 0, 1, 0]], ['GAZ', 'Lyon', 'Ville A', [1, 2, 2, 1]]]);
    assert.deepEqual(s.totaux, [1, 2, 3, 1]);
});
