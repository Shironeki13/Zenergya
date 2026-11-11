// Écritures nommées par le serveur (émulateur) : mêmes effets qu'avant (codes, cascades, montants), périmètre de
// l'utilisateur, garde-fous repris des règles Firestore : npm run test:billing
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../src/lib/firebase-admin';
import { ECRITURES, ecrire } from '../src/services/ecritures-admin';
import { PerimetreError } from '../src/lib/auth/perimetre-server';
import type { SessionUser } from '../src/lib/auth/server';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('À lancer via « npm run test:billing » (émulateur requis).');

const set = (c: string, id: string, data: object) => adminDb.collection(c).doc(id).set(data);
const lu = async (c: string, id: string) => (await adminDb.collection(c).doc(id).get());
const u = (id: string, agencyIds: string[], droits: Partial<SessionUser> = {}): SessionUser =>
    ({ uid: id, email: `${id}@v.fr`, isAdmin: false, isContratheque: false, isAcheteur: false, profile: { id, name: id, email: `${id}@v.fr`, scope: { companyIds: ['*'], agencyIds, sectorIds: ['*'] } } as never, ...droits });
const lyon = u('ec-lyon', ['ec-ag-lyon']), admin = u('ec-adm', [], { isAdmin: true });
const L = { companyId: 'ec-co', agencyId: 'ec-ag-lyon', sectorId: 'ec-se-l' }, P = { companyId: 'ec-co', agencyId: 'ec-ag-paris', sectorId: 'ec-se-p' };

before(async () => {
    for (const [v, r] of [['l', L], ['p', P]] as const) {
        await set('clients', `ec-c${v}`, { name: `Client ${v}`, externalCode: `CLI-9${v}`, ...r });
        await set('contracts', `ec-k${v}`, { clientId: `ec-c${v}`, clientName: `Client ${v}`, label: 'Chaufferie', name: `Client ${v} - Chaufferie`, contractNumber: `CTN-9${v}`, status: 'Actif', validationStatus: 'validated', validatedBy: 'ctq@v.fr', validatedAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00Z')) });
        await set('sites', `ec-s${v}`, { clientId: `ec-c${v}`, contractId: `ec-k${v}`, clientName: `Client ${v}`, code: `SIT-9${v}`, name: 'Site' });
        await set('meters', `ec-m${v}`, { siteId: `ec-s${v}`, code: `CPT-9${v}` });
        await set('services', `ec-p${v}`, { contractId: `ec-k${v}`, siteId: `ec-s${v}` });
        await set('interests', `ec-i${v}`, { serviceId: `ec-p${v}` });
        await set('invoices', `ec-f${v}`, { clientId: `ec-c${v}`, status: 'due' });
        await set('invoices', `ec-pf${v}`, { clientId: `ec-c${v}`, status: 'proforma' });
        await set('quotes', `ec-d${v}`, { clientId: `ec-c${v}`, status: 'brouillon', version: 1, number: 'D1', date: '2026-01-10', validityDays: 30, lines: [], pricing: { coefficient: 1.3, laborRate: 60, laborCost: 40, defaultVatRate: 20 } });
    }
    await set('contracts', 'ec-kattente', { clientId: 'ec-cl', status: 'Brouillon', validationStatus: 'pending_validation' });
});

test('périmètre : chaque écriture sur un objet de Paris est refusée à l\'utilisateur de Lyon, sans rien modifier', async () => {
    const refus: [string, unknown[]][] = [
        ['createClient', [{ name: 'Nouveau', ...P }]], ['createProspect', [{ name: 'Prospect', ...P }]], ['updateClient', ['ec-cp', { name: 'X' }]], ['deleteClient', ['ec-cp']],
        ['createSite', [{ clientId: 'ec-cp', name: 'S' }]], ['createSite', [{ contractId: 'ec-kp', name: 'S' }]], ['updateSite', ['ec-sp', { name: 'X' }]], ['deleteSite', ['ec-sp']],
        ['batchCreateSites', ['ec-kp', 'ec-cp', []]], ['updateContract', ['ec-kp', { label: 'X' }]], ['updateClientAndContract', ['ec-kp', 'ec-cp', {}]],
        ['updateInvoiceStatus', ['ec-fp', 'paid']], ['deleteProformaInvoice', [{ id: 'ec-pfp', status: 'proforma' }]],
        ['createMeter', [{ siteId: 'ec-sp', name: 'C' }]], ['updateMeter', ['ec-mp', { name: 'X' }]], ['deleteMeter', ['ec-mp']],
        ['createService', [{ contractId: 'ec-kp', siteId: 'ec-sp' }]], ['updateService', ['ec-pp', { amount: 1 }]], ['deleteService', ['ec-pp']],
        ...(['createAmendment', 'createTermination', 'createRenewal', 'createTrusteeChange', 'createBeChange'].map(n => [n, [{ contractId: 'ec-kp', validationStatus: 'pending_validation', documentUrl: 'https://x/o/a.pdf' }]] as [string, unknown[]])),
        ['createInterest', [{ serviceId: 'ec-pp' }]], ['updateInterest', ['ec-ip', { x: 1 }]], ['deleteInterest', ['ec-ip']],
        ['createSettlement', [{ serviceId: 'ec-pp' }]], ['updateSettlement', ['inconnu', {}]], ['deleteSettlement', ['inconnu']],
        ['createQuote', [{ clientId: 'ec-cp', date: '2026-01-10', validityDays: 30, lines: [], pricing: {} }, { code: 'ECR', name: 'S' }]], ['updateQuoteDraft', ['ec-dp', { title: 'X' }]], ['deleteQuoteDraft', ['ec-dp']],
    ];
    for (const [nom, args] of refus) await assert.rejects(ecrire(nom, args, lyon), PerimetreError, nom);
    // Toutes les écritures nommées sont couvertes par ce test de refus.
    assert.deepEqual([...new Set(refus.map(r => r[0]))].sort(), Object.keys(ECRITURES).sort());
    // Changer le rattachement d'un client vers une agence hors périmètre : refusé aussi.
    await assert.rejects(ecrire('updateClient', ['ec-cl', { agencyId: 'ec-ag-paris' }], lyon), PerimetreError);
    await assert.rejects(ecrire('updateMeter', ['ec-ml', { siteId: 'ec-sp' }], lyon), PerimetreError);
    assert.deepEqual([(await lu('clients', 'ec-cp')).get('name'), (await lu('sites', 'ec-sp')).exists, (await lu('invoices', 'ec-fp')).get('status'), (await lu('quotes', 'ec-dp')).exists], ['Client p', true, 'due', true]);
    await assert.rejects(ecrire('supprimerTout', [], admin), /Écriture inconnue/);
});

test('mêmes effets qu\'avant : codes attribués, nom du client propagé, prestation, intéressement, devis numéroté, dates enregistrées en dates', async () => {
    const c = await ecrire('createClient', [{ name: 'Résidence test', ...L, creeLe: { __date: '2026-02-03T00:00:00.000Z' } }], lyon) as { id: string };
    const client = await lu('clients', c.id);
    assert.match(String(client.get('externalCode')), /^CLI-\d{5}$/);
    assert.ok(client.get('creeLe') instanceof Timestamp);
    const s = await ecrire('createSite', [{ clientId: c.id, name: 'Bâtiment A' }], lyon) as { id: string; code: string };
    assert.match(s.code, /^SIT-\d{5}$/);
    const m = await ecrire('createMeter', [{ siteId: s.id, name: 'Gaz' }], lyon) as { id: string; code: string };
    assert.match(m.code, /^CPT-\d{5}$/);
    // Renommer le client : contrats et sites suivent.
    await ecrire('updateClient', ['ec-cl', { name: 'Client Lyon renommé' }], lyon);
    assert.deepEqual([(await lu('contracts', 'ec-kl')).get('clientName'), (await lu('contracts', 'ec-kl')).get('name'), (await lu('sites', 'ec-sl')).get('clientName')], ['Client Lyon renommé', 'Client Lyon renommé - Chaufferie', 'Client Lyon renommé']);
    const p = await ecrire('createService', [{ contractId: 'ec-kl', siteId: 'ec-sl', amount: 100 }], lyon) as { id: string };
    assert.equal((await lu('services', p.id)).get('contractId'), 'ec-kl');
    const i = await ecrire('createInterest', [{ serviceId: p.id, seuil: 10 }], lyon) as { id: string };
    await ecrire('updateInterest', [i.id, { seuil: 12 }], lyon);
    assert.equal((await lu('interests', i.id)).get('seuil'), 12);
    await ecrire('deleteInterest', [i.id], lyon);
    assert.equal((await lu('interests', i.id)).exists, false);
    const d = await ecrire('createQuote', [{ clientId: 'ec-cl', clientName: 'C', companyId: 'ec-co', title: 'Devis', date: '2026-03-01', validityDays: 30, lines: [], pricing: { coefficient: 1.3, laborRate: 60, laborCost: 40, defaultVatRate: 20 } }, { code: 'ECR', name: 'Société' }], lyon) as { id: string; number: string; status: string; validUntil: string };
    assert.deepEqual([/^ECR-DEV2026-\d{4}$/.test(d.number), d.status, d.validUntil], [true, 'brouillon', '2026-03-31']);
    const maj = await ecrire('updateQuoteDraft', [d.id, { title: 'Devis modifié' }, 'usurpateur@v.fr'], lyon) as { title: string; updatedBy: string };
    assert.deepEqual([maj.title, maj.updatedBy], ['Devis modifié', 'ec-lyon@v.fr']);   // l'auteur est l'utilisateur connecté
    await ecrire('deleteQuoteDraft', [d.id], lyon);
    assert.equal((await lu('quotes', d.id)).exists, false);
    await ecrire('updateInvoiceStatus', ['ec-fl', 'paid'], lyon);
    assert.equal((await lu('invoices', 'ec-fl')).get('status'), 'paid');
    await ecrire('deleteProformaInvoice', [{ id: 'ec-pfl', status: 'proforma' }], lyon);
    assert.equal((await lu('invoices', 'ec-pfl')).exists, false);
});

test('garde-fous repris des règles : codes immuables, validation des contrats, statut des factures, documents de contrat, devis envoyés', async () => {
    await assert.rejects(ecrire('updateClient', ['ec-cl', { externalCode: 'CLI-AUTRE' }], admin), /ne se modifie pas/);
    await assert.rejects(ecrire('updateContract', ['ec-kl', { contractNumber: 'CTN-AUTRE' }], admin), /ne se modifie pas/);
    await assert.rejects(ecrire('updateSite', ['ec-sl', { code: 'SIT-AUTRE' }], admin), /ne se modifie pas/);
    await assert.rejects(ecrire('updateMeter', ['ec-ml', { code: 'CPT-AUTRE' }], admin), /ne se modifie pas/);
    await ecrire('updateSite', ['ec-sl', { code: 'SIT-9l', name: 'Site renommé' }], lyon);   // même code : accepté
    // Contrat en attente : ni validé depuis l'écran, ni changement de statut ; la trace de validation est intouchable.
    await assert.rejects(ecrire('updateContract', ['ec-kattente', { validationStatus: 'validated' }], admin), /réservée à la contrathèque/);
    await assert.rejects(ecrire('updateContract', ['ec-kattente', { status: 'Actif' }], admin), /tant qu'il n'est pas validé/);
    await assert.rejects(ecrire('updateContract', ['ec-kl', { validatedBy: 'moi@v.fr' }], admin), /trace de validation/);
    await ecrire('updateContract', ['ec-kattente', { label: 'Libellé corrigé' }], lyon);   // contrat en attente : il se corrige librement
    // Factures : seul le suivi d'encaissement ; un proforma annoncé mais qui n'en est pas un ne se supprime pas.
    await assert.rejects(ecrire('updateInvoiceStatus', ['ec-fp', 'cancelled'], admin), /suivi d'encaissement/);
    await assert.rejects(ecrire('updateInvoiceStatus', ['ec-pfp', 'paid'], admin), /suivi d'encaissement/);
    await assert.rejects(ecrire('deleteProformaInvoice', [{ id: 'ec-fp', status: 'proforma' }], admin), /Seul un proforma/);
    // Documents de contrat : en attente de validation, avec leur pièce.
    await assert.rejects(ecrire('createAmendment', [{ contractId: 'ec-kl', validationStatus: 'validated', documentUrl: 'https://x/o/a.pdf' }], admin), /en attente de validation/);
    await assert.rejects(ecrire('createRenewal', [{ contractId: 'ec-kl', validationStatus: 'pending_validation' }], admin), /Pièce justificative/);
    const a = await ecrire('createAmendment', [{ contractId: 'ec-kl', validationStatus: 'pending_validation', documentUrl: 'https://x/o/a.pdf' }], lyon) as { id: string };
    assert.equal((await lu('amendments', a.id)).get('validationStatus'), 'pending_validation');
    // Devis : un devis envoyé ne se modifie ni ne se supprime.
    await adminDb.collection('quotes').doc('ec-dl').update({ status: 'envoye' });
    await assert.rejects(ecrire('updateQuoteDraft', ['ec-dl', { title: 'X' }], lyon), /plus un brouillon/);
    await assert.rejects(ecrire('deleteQuoteDraft', ['ec-dl'], lyon), /Seul un brouillon/);
});

test('contrat validé : champs contractuels réservés à la contrathèque, statut par la contrathèque ou un administrateur, modifications tracées', async () => {
    const ctq = u('ec-ctq', ['ec-ag-lyon'], { isContratheque: true });
    await set('contracts', 'ec-kv', { clientId: 'ec-cl', clientName: 'Client l', label: 'Chaufferie', contractNumber: 'CTN-9V', status: 'Actif', validationStatus: 'validated', validatedBy: 'ctq@v.fr',
        startDate: Timestamp.fromDate(new Date('2025-01-01T00:00:00Z')), endDate: Timestamp.fromDate(new Date('2029-12-31T00:00:00Z')), baseAmountP2: 6000, noticePeriod: '3 mois' });
    await set('contracts', 'ec-kancien', { clientId: 'ec-cl', clientName: 'Client l', label: 'Ancien', contractNumber: 'CTN-9A', status: 'Terminé' });   // antérieur à la validation : considéré validé
    const k = async (id = 'ec-kv') => (await lu('contracts', id)).data()!;

    // Utilisateur (et administrateur sans le droit contrathèque) : les champs contractuels ne se modifient pas.
    for (const user of [lyon, admin]) {
        await assert.rejects(ecrire('updateContract', ['ec-kv', { label: 'Autre libellé' }], user), /Contrat validé : « Libellé » ne se modifie que par la contrathèque, ou par un avenant/);
        await assert.rejects(ecrire('updateContract', ['ec-kv', { endDate: '2031-12-31', baseAmountP2: 7000 }], user), /« Fin », « Base marché P2 \(€ HT\/an\) » ne se modifient que par la contrathèque/);
    }
    await assert.rejects(ecrire('updateContract', ['ec-kancien', { label: 'X' }], lyon), /ne se modifie que par la contrathèque/);
    await assert.rejects(ecrire('updateContract', ['ec-kv', { validationStatus: 'pending_validation' }], lyon), /ne se remet pas en validation/);
    // Les autres champs restent libres, et renvoyer les mêmes valeurs (ou un champ vide jamais renseigné) n'est pas une modification.
    await ecrire('updateContract', ['ec-kv', { einvoicingAddress: 'adresse@pdp', label: 'Chaufferie', endDate: '2029-12-31', baseAmountP2: 6000, baseAmountP1: undefined, tacitRenewal: false, renewalDuration: '' }], lyon);
    assert.deepEqual([(await k()).einvoicingAddress, (await k()).modificationsValidees], ['adresse@pdp', undefined]);

    // Statut : ni l'utilisateur ; la contrathèque et l'administrateur, oui.
    await assert.rejects(ecrire('updateContract', ['ec-kv', { status: 'Résilié' }], lyon), /par un document validé \(résiliation\) ou, à la main, par la contrathèque ou un administrateur/);
    await ecrire('updateContract', ['ec-kv', { status: 'Résilié', terminationDate: '2026-11-30' }], admin);
    await ecrire('updateContract', ['ec-kv', { status: 'Actif' }], ctq);

    // Contrathèque : modifie les champs contractuels sans nouvelle validation ; le contrat reste validé ; tout est tracé.
    await ecrire('updateContract', ['ec-kv', { label: 'Chaufferie et ECS', endDate: '2030-12-31' }], ctq);
    const apres = await k();
    assert.deepEqual([apres.label, apres.validationStatus, apres.validatedBy, apres.status], ['Chaufferie et ECS', 'validated', 'ctq@v.fr', 'Actif']);
    const t = apres.modificationsValidees as { par: string; champs?: Record<string, { avant: unknown; apres: unknown }>; statut?: { avant: string; apres: string } }[];
    assert.deepEqual(t.map(x => [x.par, x.statut ? `${x.statut.avant}→${x.statut.apres}` : null, x.champs ? Object.keys(x.champs).sort().join() : null]),
        [['ec-adm@v.fr', 'Actif→Résilié', null], ['ec-ctq@v.fr', 'Résilié→Actif', null], ['ec-ctq@v.fr', null, 'endDate,label']]);
    assert.deepEqual([t[2].champs!.label, t[2].champs!.endDate.avant, t[2].champs!.endDate.apres].map(x => (typeof x === 'object' ? [(x as { avant: unknown }).avant, (x as { apres: unknown }).apres] : x)), [['Chaufferie', 'Chaufferie et ECS'], '2029-12-31', '2030-12-31']);

    // « Modifier » un contrat validé (formulaire complet) : il reste validé ; un utilisateur ne change pas ses champs contractuels.
    const formulaire = { name: 'Client Lyon renommé', label: 'Chaufferie et ECS', startDate: '2025-01-01', endDate: '2030-12-31', baseAmountP2: 6000, noticePeriod: '3 mois', companyId: 'ec-co', agencyId: 'ec-ag-lyon', sectorId: 'ec-se-l', sites: [] };
    await assert.rejects(ecrire('updateClientAndContract', ['ec-kv', 'ec-cl', { ...formulaire, noticePeriod: '6 mois' }], lyon), /« Préavis » ne se modifie que par la contrathèque/);
    assert.deepEqual([(await k()).noticePeriod, (await k()).validationStatus], ['3 mois', 'validated']);
    // Contrat refusé : la correction le renvoie en validation (comportement inchangé).
    await set('contracts', 'ec-kref', { clientId: 'ec-cl', label: 'Refusé', status: 'Brouillon', validationStatus: 'refused', refusalReason: 'Dates' });
    await ecrire('updateClientAndContract', ['ec-kref', 'ec-cl', { ...formulaire, label: 'Corrigé', endDate: '2032-01-01' }], lyon);
    assert.deepEqual([(await k('ec-kref')).label, (await k('ec-kref')).validationStatus, (await k('ec-kref')).refusalReason], ['Corrigé', 'pending_validation', '']);
});
