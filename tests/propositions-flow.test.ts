// Propositions de création : dépôt, lecture (simulée), visibilité, refus, création et acceptation (émulateurs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../src/lib/firebase-admin';
import { deposerProposition, exigerAcceptable, lireProposition, listerPropositions, marquerAcceptee, propositionVisible, refuserProposition } from '../src/services/propositions-admin';
import { creerContratAssistant } from '../src/services/contrat-assistant-admin';
import type { SessionUser } from '../src/lib/auth/server';
import type { GardePerimetre } from '../src/lib/auth/perimetre-server';

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const u = (id: string, droits: Partial<SessionUser> = {}) => ({ uid: id, email: `${id}@v.fr`, isAdmin: false, isContratheque: false, isAcheteur: false, profile: { modules: ['contracts'] }, ...droits }) as unknown as SessionUser;
const garde = (tout = false) => ({ tout, exiger: async () => { throw new Error('hors périmètre'); } }) as unknown as GardePerimetre;
const pdf = Buffer.from('%PDF-1.4\n%démo\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const avant = process.env.IA_SIMULATION;

before(async () => {
    process.env.IA_SIMULATION = '1';
    for (const [id, code, type, vat] of [['pp-p1', 'P1', 'P1', 'pp-v'], ['pp-p2', 'P2', 'P2', 'pp-v'], ['pp-p3', 'P3', 'P3', 'pp-v']]) await set('activities', id, { code, label: code, type, vatRateId: vat });
    await set('vatRates', 'pp-v', { code: 'TVA20PP', rate: 20 });
    await set('schedules', 'pp-trim', { name: 'Trimestriel' });
    await set('terms', 'pp-echoir', { name: 'À échoir' });
    await set('terms', 'pp-echu', { name: 'Terme échu' });
    await set('typologies', 'pp-copro', { name: 'Copropriété' });
    await set('users', 'pp-u', { name: 'Responsable', email: 'pp-adv@v.fr' });
});
after(async () => {
    process.env.IA_SIMULATION = avant;
    for (const c of ['activities', 'vatRates', 'schedules', 'terms', 'typologies', 'users']) for (const d of (await adminDb.collection(c).get()).docs) if (d.id.startsWith('pp-')) await d.ref.delete();
});

test('dépôt : document enregistré, lu, proposition à revoir avec justificatifs ; rien n\'est créé', async () => {
    const clientsAvant = (await adminDb.collection('clients').count().get()).data().count;
    const p = await deposerProposition({ nom: 'Contrat Érables.pdf', contentType: 'application/pdf', contenu: pdf, type: 'pdf-prive' }, u('pp-adv'));
    assert.deepEqual([p.statut, p.lecture?.simulee, p.resume?.client, p.resume?.clientExistant, p.resume?.sites], ['a_revoir', true, 'Syndicat des copropriétaires Résidence Les Érables', false, 2]);
    assert.equal(p.brouillon!.prestations.lignes.filter(l => l.montant).length, 3);
    assert.ok(p.preuves!.some(x => x.champ === 'client.siret'));
    assert.match(p.document.url, /propositions%2F/);
    assert.equal((await adminDb.collection('clients').count().get()).data().count, clientsAvant);
    await assert.rejects(deposerProposition({ nom: 'x.png', contentType: 'image/png', contenu: pdf, type: 'pdf-prive' }, u('pp-adv')), /PDF uniquement/);
});

test('visibilité : déposant et contrathèque ; un autre utilisateur hors périmètre ne la voit pas', async () => {
    const [p] = (await listerPropositions(u('pp-adv'), garde())).filter(x => x.document.name === 'Contrat Érables.pdf');
    assert.ok(p);
    assert.ok((await listerPropositions(u('pp-ctq', { isContratheque: true }), garde())).some(x => x.id === p.id));
    assert.ok(!(await listerPropositions(u('pp-autre'), garde())).some(x => x.id === p.id));
    await assert.rejects(propositionVisible(p.id, u('pp-autre'), garde()), /hors de votre périmètre/);
});

test('refus : contrathèque seulement, motif requis, définitif', async () => {
    const p = await deposerProposition({ nom: 'Doublon.pdf', contentType: 'application/pdf', contenu: pdf, type: 'pdf-prive' }, u('pp-adv'));
    await assert.rejects(refuserProposition(p.id, 'non', u('pp-adv')), /contrathèque/);
    await assert.rejects(refuserProposition(p.id, ' ', u('pp-ctq', { isContratheque: true })), /Motif/);
    await refuserProposition(p.id, 'Document en double', u('pp-ctq', { isContratheque: true }));
    const r = await propositionVisible(p.id, u('pp-ctq', { isContratheque: true }), garde());
    assert.deepEqual([r.statut, r.decision?.motif, r.decision?.par], ['refusee', 'Document en double', 'pp-ctq@v.fr']);
    await assert.rejects(lireProposition(p.id), /déjà traitée/);
    await assert.rejects(exigerAcceptable(p.id, u('pp-ctq', { isContratheque: true })), /non disponible/);
});

test('acceptation : contrathèque, création depuis le brouillon complété, proposition acceptée avec le contrat', async () => {
    const ctq = u('pp-ctq', { isContratheque: true });
    const [p] = (await listerPropositions(ctq, garde(true))).filter(x => x.document.name === 'Contrat Érables.pdf');
    await assert.rejects(exigerAcceptable(p.id, u('pp-adv')), /Seules la contrathèque/);
    const prop = await exigerAcceptable(p.id, ctq);
    const b = prop.brouillon!;
    // À la revue : société, agence, secteur et responsable choisis, montants répartis.
    b.client.nouveau = { ...b.client.nouveau, companyId: 'pp-soc', agencyId: 'pp-ag', sectorId: 'pp-sec' };
    b.contrat.billingManagerId = 'pp-u';
    b.contrat.vatRateId = 'pp-v';
    b.prestations.lignes = b.prestations.lignes.map(l => ({ ...l, vatRateId: l.vatRateId || 'pp-v', scheduleId: l.scheduleId || 'pp-trim', termId: l.termId || 'pp-echoir' }));
    const cree = await creerContratAssistant({ ...b, document: prop.document }, ctq);
    await marquerAcceptee(p.id, cree, ctq);
    const fin = await propositionVisible(p.id, ctq, garde(true));
    assert.deepEqual([fin.statut, fin.decision?.contractId, fin.decision?.contractNumber], ['acceptee', cree.contractId, cree.contractNumber]);
    const k = (await adminDb.collection('contracts').doc(cree.contractId).get()).data()!;
    assert.deepEqual([k.status, k.validationStatus, k.siteIds.length], ['Brouillon', 'pending_validation', 2]);
    assert.ok((k.documents ?? []).some((d: { name: string }) => d.name === 'Contrat Érables.pdf'), 'document de la proposition joint au contrat');
    await assert.rejects(exigerAcceptable(p.id, ctq), /déjà acceptée/);
});
