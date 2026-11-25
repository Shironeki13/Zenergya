// Contrats de fourniture d'énergie : import, rattachement par le PDL, périodes saisies, périmètre (émulateur) : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import type { GardePerimetre } from '../src/lib/auth/perimetre-server';
import type { SessionUser } from '../src/lib/auth/server';
import { lireFeuille } from '../src/lib/energie/fournitures';
import { creerFactureEnergie, facturesEnergieDuPoint, facturesEnergieDuSite } from '../src/services/factures-energie-admin';
import { rappelsEnergie } from '../src/services/notifications-metier';
import { margeSite, margesP1 } from '../src/services/energie-marge-admin';
import { baseEnergie, enregistrerPeriode, exigerAchatsEnergie, importerPoints, pointLivraison, rattacherPoint, supprimerPeriode } from '../src/services/energie-admin';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const tout = { tout: true, ids: async () => null } as unknown as GardePerimetre;
const restreint = (sites: string[]) => ({ tout: false, ids: async () => new Set(sites) }) as unknown as GardePerimetre;
const an = new Date().getFullYear();
const ENT = ['ENERGIE', 'AGENCE / SECTEUR (CONTRAT CLIENT)', 'CLIENT', 'SITE', 'PDL', 'FIN CONTRAT CLIENT', 'DEBUT CONTRAT FOURNISSEUR', 'FIN CONTRAT FOURNISSEUR', 'FOURNISSEUR', 'CONTRAT FOURNISSEUR N°', 'PRIX MOLECULE\n(dont RFA €/MWh)', 'CONTRAT FOURNISSEUR SUR LE DRIVE'];
const feuille = (finB: string) => lireFeuille([ENT,
    ['GAZ', 'Agence Test', 'Client Énergie', 'Chaufferie A', 'EN-PDL-1', `31/12/${an + 4}`, `01/01/${an - 1}`, `31/12/${an - 1}`, 'ENI', 'EN-K1', '21,50 €', 'OUI'],
    ['GAZ', 'Agence Test', 'Client Énergie', 'Chaufferie A', 'EN-PDL-1', `31/12/${an + 4}`, `01/01/${an}`, `31/12/${an + 2}`, 'EDF', 'EN-K2', '24,10 €', 'NON'],
    ['GAZ', 'Agence Test', 'Client Énergie', 'Chaufferie B', 'EN-PDL-2', `31/12/${an + 4}`, `01/01/${an - 2}`, finB, 'ENI', 'EN-K1', '', ''],
]).points;

before(async () => {
    await set('sites', 'en-s1', { name: 'Site rattaché A', contractId: 'en-k' });
    await set('sites', 'en-s2', { name: 'Site B', contractId: 'en-k' });
    await set('meters', 'en-m1', { siteId: 'en-s1', reference: 'EN-PDL-1', code: 'CPT-EN1' });
});

test('droit : administrateurs et module Achats seulement', () => {
    const u = (isAdmin: boolean, modules: string[]) => ({ isAdmin, profile: { modules } }) as unknown as SessionUser;
    exigerAchatsEnergie(u(true, []));
    exigerAchatsEnergie(u(false, ['purchases']));
    assert.throws(() => exigerAchatsEnergie(u(false, ['billing'])), /module Achats/);
});

test('import : points créés, rattachés au site du compteur qui porte le PDL, couverture calculée', async () => {
    const r = await importerPoints(feuille(`31/12/${an - 1}`), 'achats@v.fr');
    assert.deepEqual(r, { points: 2, crees: 2, misAJour: 0, periodes: 3, rattaches: 1 });
    const b = await baseEnergie(tout);
    const [a, bb] = ['EN-PDL-1', 'EN-PDL-2'].map(pdl => b.points.find(p => p.pdl === pdl)!);
    assert.deepEqual([a.siteId, a.siteNom, a.contractId, a.statut, a.fournisseur, a.numeroContrat, a.finCouverture, a.periodes, a.prixMolecule], ['en-s1', 'Site rattaché A', 'en-k', 'couvert', 'EDF', 'EN-K2', `${an + 2}-12-31`, 2, 24.1]);
    assert.deepEqual([bb.siteId, bb.statut, bb.fournisseur], [null, 'sans_couverture', 'ENI']);
    const k1 = b.contrats.find(k => k.numero === 'EN-K1')!;
    assert.deepEqual([k1.points, k1.etat, k1.sansDocument], [2, 'terminee', 1]);
    assert.ok(b.synthese.lignes.find(l => l.client === 'Client Énergie')!.parAnnee[b.synthese.annees.indexOf(an)] >= 1);
});

test('saisie, rattachement à la main et nouvel import : les périodes saisies restent, celles de l\'import sont remplacées', async () => {
    const b = await baseEnergie(tout);
    const idB = b.points.find(p => p.pdl === 'EN-PDL-2')!.id;
    await rattacherPoint(idB, 'en-s2', 'achats@v.fr');
    await assert.rejects(rattacherPoint(idB, 'inconnu', 'achats@v.fr'), /Site introuvable/);
    await assert.rejects(enregistrerPeriode(idB, { debut: `${an}-06-01`, fin: `${an}-01-01`, fournisseur: 'X' }, 'a'), /précède son début/);
    await assert.rejects(enregistrerPeriode(idB, { debut: `${an}-01-01`, fin: `${an}-12-31`, fournisseur: ' ' }, 'a'), /Fournisseur obligatoire/);
    await enregistrerPeriode(idB, { debut: `${an}-01-01`, fin: `${an + 1}-12-31`, fournisseur: 'TOTAL ENERGIES', numeroContrat: 'EN-K9', prixMolecule: 30 }, 'achats@v.fr');
    let p = await pointLivraison(idB, tout);
    assert.deepEqual(p.periodes.map(x => [x.fournisseur, x.debut]), [['TOTAL ENERGIES', `${an}-01-01`], ['ENI', `${an - 2}-01-01`]]);

    // La feuille corrigée (fin de la période ENI avancée) est réimportée : pas de doublon, la saisie et le rattachement restent.
    const r = await importerPoints(feuille(`30/06/${an - 1}`), 'achats@v.fr');
    assert.deepEqual([r.crees, r.misAJour, r.rattaches], [0, 2, 0]);
    p = await pointLivraison(idB, tout);
    assert.deepEqual([p.siteId, p.periodes.map(x => [x.fournisseur, x.fin])], ['en-s2', [['TOTAL ENERGIES', `${an + 1}-12-31`], ['ENI', `${an - 1}-06-30`]]]);
    assert.equal((await baseEnergie(tout)).points.find(x => x.id === idB)!.statut, 'couvert');
    await supprimerPeriode(idB, p.periodes[0].id, 'achats@v.fr');
    assert.equal((await pointLivraison(idB, tout)).periodes.length, 1);
});

test('période sans fournisseur ni numéro (ligne incomplète de la feuille) : importée et lisible', async () => {
    const pts = lireFeuille([ENT, ['GAZ', 'Agence Test', 'Client Énergie', 'Chaufferie C', 'EN-PDL-3', '', `01/01/${an}`, `31/12/${an}`, '', '', '', '']]).points;
    await importerPoints(pts, 'achats@v.fr');
    const b = await baseEnergie(tout);
    const c = b.points.find(p => p.pdl === 'EN-PDL-3')!;
    assert.deepEqual([c.statut, c.fournisseur, c.numeroContrat], ['a_renouveler', '', '']);
    assert.ok(b.contrats.some(k => k.fournisseur === '' && k.numero === ''));
    assert.deepEqual((await pointLivraison(c.id, tout)).periodes.map(x => [x.fournisseur, x.titulaire, x.tacite]), [['', '', '']]);
});

test('périmètre restreint : seuls les points rattachés à un site visible', async () => {
    const b = await baseEnergie(restreint(['en-s1']));
    assert.deepEqual(b.points.filter(p => p.pdl.startsWith('EN-PDL')).map(p => p.pdl), ['EN-PDL-1']);
    const idB = (await baseEnergie(tout)).points.find(p => p.pdl === 'EN-PDL-2')!.id;
    await assert.rejects(pointLivraison(idB, restreint(['en-s1'])), /hors de votre périmètre/);
});

test('facture du fournisseur rattachée à son point de livraison : contrat retrouvé, alertes, liste sur la fiche du point', async () => {
    const b = await baseEnergie(tout);
    const [a, bb] = ['EN-PDL-1', 'EN-PDL-2'].map(pdl => b.points.find(p => p.pdl === pdl)!);
    // EN-PDL-1 (site en-s1) : EDF, contrat EN-K2, molécule à 24,10 €/MWh cette année.
    await creerFactureEnergie('en-s1', { fournisseur: 'EDF Entreprises', numero: 'F-OK', date: `${an}-03-10`, debut: `${an}-02-01`, fin: `${an}-02-28`, montantHT: 6000, quantite: 100, pointId: a.id }, 'achats@v.fr');
    await creerFactureEnergie('en-s1', { fournisseur: 'ENI', numero: 'F-KO', date: `${an + 3}-03-10`, montantHT: 100, pointId: a.id }, 'achats@v.fr');
    await creerFactureEnergie('en-s1', { fournisseur: 'EDF', numero: 'F-LIBRE', date: `${an}-04-10`, montantHT: 50 }, 'achats@v.fr');
    await assert.rejects(creerFactureEnergie('en-s1', { fournisseur: 'EDF', numero: 'F-X', date: `${an}-04-10`, montantHT: 50, pointId: bb.id }, 'achats@v.fr'), /n'est pas rattaché à ce site/);
    await assert.rejects(creerFactureEnergie('en-s1', { fournisseur: 'EDF', numero: 'F-Y', date: `${an}-04-10`, montantHT: 50, quantite: -3 }, 'achats@v.fr'), /Quantité/);

    const site = await facturesEnergieDuSite('en-s1');
    const par = (n: string) => site.find(f => f.numero === n)!;
    assert.deepEqual([par('F-OK').pdl, par('F-OK').controle?.periode?.numeroContrat, par('F-OK').controle?.prixMoyen, par('F-OK').controle?.alertes.map(x => x.gravite)], ['EN-PDL-1', 'EN-K2', 60, ['info']]);
    assert.match(par('F-KO').controle!.alertes[0].texte, /Aucun contrat fournisseur de ce point ne couvre/);
    assert.match(par('F-LIBRE').controle!.alertes[0].texte, /non rattachée à un point de livraison/);
    assert.deepEqual((await facturesEnergieDuPoint(a.id)).map(f => f.numero).sort(), ['F-KO', 'F-OK']);
    assert.deepEqual(await facturesEnergieDuPoint(bb.id), []);
});

test('rappel des renouvellements : une demande de mail listant les points à renouveler, pour les acheteurs', async () => {
    const jour = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
    await set('roles', 'en-r-ach', { name: 'Acheteur énergie', isAcheteur: true });
    await set('users', 'en-u-ach', { email: 'acheteur.energie@v.fr', name: 'Acheteur', roleId: 'en-r-ach' });
    // Un point dont la fourniture s'arrête dans 20 jours, sans suite, avec un contrat client qui continue.
    const dans = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
    await importerPoints(lireFeuille([ENT, ['GAZ', 'Agence Test', 'Client Énergie', 'Chaufferie R', 'EN-PDL-R', `31/12/${an + 4}`, dans(-300), dans(20), 'ENI', 'EN-KR', '', '']]).points, 'achats@v.fr');
    const [d] = (await rappelsEnergie(jour, null)).filter(x => x.evenement === 'energie_a_renouveler');
    assert.equal(d.cle, `energie/a-renouveler/${jour}`);
    assert.ok(d.annuaire?.acheteurs?.includes('acheteur.energie@v.fr'));
    const ligne = d.contexte.energie!.lignes.find(l => l.pdl === 'EN-PDL-R')!;
    assert.deepEqual([ligne.client, ligne.site, ligne.fournisseur, ligne.numeroContrat, ligne.jours], ['Client Énergie', 'Chaufferie R', 'ENI', 'EN-KR', 20]);
    assert.deepEqual(await rappelsEnergie(jour, jour), []);   // déjà passé aujourd'hui : rien
});

test('marge P1 : P1 facturé au client face aux achats, mois complets seulement ; annulée ignorée, avoir de régularisation déduit', async () => {
    const jour = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
    const mois = (n: number) => { const [a, m] = jour.slice(0, 7).split('-').map(Number); const t = a * 12 + m - 1 + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
    const fin = (m: string) => `${m}-${String(new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate()).padStart(2, '0')}`;
    const [m1, m2] = [mois(-1), mois(-2)];
    await set('activities', 'en-p1', { code: 'P1EN', label: 'Chaleur', type: 'P1' });
    await set('activities', 'en-p2', { code: 'P2EN', label: 'Conduite', type: 'P2' });
    await set('contracts', 'en-km', { contractNumber: 'CTN-EN-M', clientName: 'Client Marge' });
    await set('sites', 'en-s3', { name: 'Site Marge', contractId: 'en-km' });
    const ligne = (code: string, m: string, total: number, siteId = 'en-s3') => ({ siteId, activityCode: code, total, periodStartDate: `${m}-01`, periodEndDate: fin(m) });
    await set('invoices', 'en-f1', { contractId: 'en-km', invoiceNumber: 'EN-1', status: 'due', lineItems: [ligne('P1EN', m1, 5000), ligne('P2EN', m1, 900), ligne('P1EN', m1, 777, 'autre-site')] });
    await set('invoices', 'en-f2', { contractId: 'en-km', invoiceNumber: 'EN-2', status: 'paid', lineItems: [ligne('P1EN', m2, 4000)] });
    await set('invoices', 'en-f3', { contractId: 'en-km', invoiceNumber: 'EN-3', status: 'cancelled', cancelledByCreditNoteId: 'en-a1', lineItems: [ligne('P1EN', m1, 9999)] });
    await set('invoices', 'en-f4', { contractId: 'en-km', status: 'proforma', lineItems: [ligne('P1EN', m1, 8888)] });
    await set('creditNotes', 'en-a1', { contractId: 'en-km', originalInvoiceIds: ['en-f3'], lineItems: [ligne('P1EN', m1, 9999)] });
    await set('creditNotes', 'en-a2', { contractId: 'en-km', originalInvoiceIds: ['en-f1'], lineItems: [ligne('P1EN', m1, 200)] });   // régularisation : en-f1 n'est pas annulée
    await creerFactureEnergie('en-s3', { fournisseur: 'ENI', numero: 'M-1', date: jour, debut: `${m1}-01`, fin: fin(m1), montantHT: 3800, quantite: 80 }, 'achats@v.fr');

    const m = await margeSite('en-s3');
    assert.deepEqual([m.siteNom, m.client, m.contractNumber], ['Site Marge', 'Client Marge', 'CTN-EN-M']);
    assert.deepEqual(m.marge.mois.map(l => [l.mois, l.ventes, l.achats, l.marge]), [[m2, 4000, 0, null], [m1, 4800, 3800, 1000]]);
    assert.deepEqual([m.marge.ventes, m.marge.achats, m.marge.marge, m.marge.taux, m.marge.moisComplets, m.marge.ventesSansAchat], [4800, 3800, 1000, 20.8, 1, 4000]);
    assert.ok((await margesP1(tout)).some(x => x.siteId === 'en-s3'));
    assert.ok(!(await margesP1(restreint(['en-s1']))).some(x => x.siteId === 'en-s3'));
});
