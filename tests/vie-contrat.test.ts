// Vie d'un contrat : frise des événements passés et à venir, préavis, validation des documents : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decaler, lireDuree, vieContrat, type DocumentsContrat } from '../src/lib/contrats/frise';
import type { Contract } from '../src/lib/types';

const contrat = (plus: Partial<Contract> = {}): Contract => ({
    id: 'k', clientId: 'c', clientName: 'Copropriété', siteIds: [], startDate: '2024-10-01', endDate: '2027-09-30', activityIds: [], status: 'Actif', validationStatus: 'validated',
    createdAt: '2024-09-10T08:00:00Z', createdBy: 'adv@v.fr', validatedAt: '2024-09-12T08:00:00Z', validatedBy: 'contratheque@v.fr',
    invoicingType: 'global', renewal: true, tacitRenewal: true, renewalDuration: '1 an', noticePeriod: '3 mois', ...plus,
});
const aucun: DocumentsContrat = { amendments: [], terminations: [], renewals: [], trusteeChanges: [], beChanges: [] };
const types = (c: Contract, d: DocumentsContrat, today: string) => vieContrat(c, d, today).etapes.map(e => `${e.type}:${e.date}:${e.etat}`);

test('durées : mois, années, jours, semaines ; texte illisible : rien n\'est supposé ; décalage en fin de mois', () => {
    assert.deepEqual([lireDuree('3 mois'), lireDuree('1 an'), lireDuree('90 jours'), lireDuree('2 semaines'), lireDuree('6'), lireDuree('trois mois'), lireDuree('')],
        [{ mois: 3, jours: 0 }, { mois: 12, jours: 0 }, { mois: 0, jours: 90 }, { mois: 0, jours: 14 }, { mois: 6, jours: 0 }, null, null]);
    assert.deepEqual([decaler('2027-09-30', { mois: 3, jours: 0 }, -1), decaler('2027-05-31', { mois: 3, jours: 0 }, -1), decaler('2027-01-15', { mois: 0, jours: 20 }, -1), decaler('2026-11-30', { mois: 0, jours: 60 }, 1)],
        ['2027-06-30', '2027-02-28', '2026-12-26', '2027-01-29']);
});

test('frise : dépôt, validation, début, repère « aujourd\'hui », puis préavis et échéance à venir', () => {
    const v = vieContrat(contrat(), aucun, '2026-11-23');
    assert.deepEqual(v.etapes.map(e => `${e.type}:${e.date}:${e.etat}`), ['depot:2024-09-10:fait', 'validation:2024-09-12:fait', 'debut:2024-10-01:fait', 'aujourdhui:2026-11-23:en_cours', 'preavis:2027-06-30:a_venir', 'echeance:2027-09-30:a_venir']);
    assert.deepEqual([v.etapes[4].resume, v.etapes[5].resume, v.prochaine?.type, v.enAttente, v.refuses], ['3 mois avant l\'échéance', 'reconduction tacite de 1 an', 'preavis', 0, 0]);
    assert.equal(v.ecoule, 71.6);   // 783 jours sur 1 094
    // À moins de 60 jours de la date limite : alerte ; une fois passée : reconduction tacite acquise.
    assert.equal(vieContrat(contrat(), aucun, '2027-05-15').etapes.find(e => e.type === 'preavis')!.etat, 'alerte');
    const passe = vieContrat(contrat(), aucun, '2027-07-10').etapes.find(e => e.type === 'preavis')!;
    assert.deepEqual([passe.etat, /reconduction tacite est acquise/.test(passe.note!)], ['fait', true]);
    // Échéance dépassée sur un contrat toujours actif : à traiter.
    const depasse = vieContrat(contrat(), aucun, '2027-10-05').etapes.find(e => e.type === 'echeance')!;
    assert.deepEqual([depasse.etat, /Échéance dépassée/.test(depasse.note!)], ['alerte', true]);
});

test('préavis non renseigné ou illisible : pas de date inventée, l\'échéance le dit ; contrat en attente ou refusé', () => {
    const sans = vieContrat(contrat({ noticePeriod: undefined }), aucun, '2026-11-23');
    assert.deepEqual([sans.etapes.some(e => e.type === 'preavis'), /Préavis non renseigné/.test(sans.etapes.find(e => e.type === 'echeance')!.note!)], [false, true]);
    assert.match(vieContrat(contrat({ noticePeriod: 'selon CCAP' }), aucun, '2026-11-23').etapes.find(e => e.type === 'echeance')!.note!, /Préavis « selon CCAP » : durée non reconnue/);
    const attente = vieContrat(contrat({ validationStatus: 'pending_validation', validatedAt: undefined }), aucun, '2026-11-23');
    assert.deepEqual([attente.etapes[1].titre, attente.etapes[1].etat, attente.enAttente], ['En attente de validation', 'en_cours', 1]);
    assert.deepEqual(vieContrat(contrat({ validationStatus: 'refused', refusalReason: 'Pièce illisible' }), aucun, '2026-11-23').etapes[1].resume, 'Pièce illisible');
    // Contrat existant enregistré après son début : « repris », pas « déposé ».
    assert.deepEqual(vieContrat(contrat({ createdAt: '2026-01-05T08:00:00Z', validatedAt: '2026-01-05T09:00:00Z' }), aucun, '2026-11-23').etapes.slice(0, 3).map(e => e.titre), ['Début du contrat', 'Repris dans Zenergya', 'Contrat validé']);
});

test('documents : à leur date d\'effet, avec leur circuit de validation et ce qu\'ils changent ; modifications de la contrathèque', () => {
    const docs: DocumentsContrat = {
        ...aucun,
        amendments: [
            { id: 'a1', contractId: 'k', createdAt: '2025-03-01T10:00:00Z', createdBy: 'adv@v.fr', impactsDuration: true, newEndDate: '2028-09-30', impactsServices: false, impactP2: 1200, effectiveDate: '2025-04-01', description: 'Ajout d\'un site', signed: true, validationStatus: 'validated', validatedAt: '2025-03-05T09:00:00Z', validatedBy: 'contratheque@v.fr', documentUrl: 'https://x/a1.pdf', documentName: 'avenant-1.pdf', corrections: [{ champ: 'impactP2', libelle: 'Impact P2', avant: '1000', apres: '1200', par: 'c', le: 'x' }] },
            { id: 'a2', contractId: 'k', nature: 'os', createdAt: '2026-11-20T10:00:00Z', createdBy: 'adv@v.fr', impactsDuration: false, impactsServices: false, effectiveDate: '2026-11-20', description: 'Remplacement circulateur', signed: false, validationStatus: 'pending_validation' },
        ] as never,
        trusteeChanges: [{ id: 't1', contractId: 'k', createdAt: '2025-06-10T10:00:00Z', createdBy: 'adv@v.fr', currentRepresentative: 'Foncia', newRepresentative: 'Nexity', effectiveDate: '2025-07-01', validationStatus: 'refused', refusalReason: 'PV d\'AG manquant', validatedBy: 'contratheque@v.fr', validatedAt: '2025-06-12T10:00:00Z' }] as never,
    };
    const c = contrat({ modificationsValidees: [{ par: 'contratheque@v.fr', le: '2025-09-02T10:00:00Z', champs: { noticePeriod: { libelle: 'Préavis', avant: '2 mois', apres: '3 mois' } } }] });
    const v = vieContrat(c, docs, '2026-11-23');
    assert.deepEqual(v.etapes.map(e => `${e.type}:${e.date}:${e.etat}`), ['depot:2024-09-10:fait', 'validation:2024-09-12:fait', 'debut:2024-10-01:fait', 'avenant:2025-04-01:fait', 'syndic:2025-07-01:annule',
        'modification:2025-09-02:fait', 'os:2026-11-20:en_cours', 'aujourdhui:2026-11-23:en_cours', 'preavis:2027-06-30:a_venir', 'echeance:2027-09-30:a_venir']);
    assert.deepEqual([v.enAttente, v.refuses], [1, 1]);
    const avenant = v.etapes[3];
    assert.deepEqual(avenant.validation, { etat: 'valide', deposePar: 'adv@v.fr', deposeLe: '2025-03-01', validePar: 'contratheque@v.fr', valideLe: '2025-03-05', corrections: docs.amendments[0].corrections });
    assert.deepEqual([avenant.effets!.map(e => `${e.libelle} = ${e.valeur.replace(/[  ]/g, ' ')}`), avenant.piece, avenant.onglet], [['Nouvelle échéance = 30/09/2028', 'Montant P2 = +1 200 € HT/an', 'Signé = Oui'], { url: 'https://x/a1.pdf', nom: 'avenant-1.pdf' }, 'amendments']);
    assert.deepEqual([v.etapes[4].validation!.etat, v.etapes[4].validation!.motifRefus, v.etapes[5].effets], ['refuse', 'PV d\'AG manquant', [{ libelle: 'Préavis', valeur: '2 mois → 3 mois' }]]);
});

test('contrat résilié : la résiliation validée à sa date d\'effet, plus de préavis ni d\'échéance', () => {
    const docs: DocumentsContrat = { ...aucun, terminations: [{ id: 'r1', contractId: 'k', createdAt: '2026-05-02T10:00:00Z', createdBy: 'adv@v.fr', effectiveDate: '2026-08-31', reason: 'Vente de l\'immeuble', validationStatus: 'validated', validatedAt: '2026-05-04T10:00:00Z', validatedBy: 'c@v.fr' }] as never };
    assert.deepEqual(types(contrat({ status: 'Résilié', terminationDate: '2026-08-31' }), docs, '2026-11-23'), ['depot:2024-09-10:fait', 'validation:2024-09-12:fait', 'debut:2024-10-01:fait', 'resiliation:2026-08-31:fait', 'aujourdhui:2026-11-23:en_cours']);
    // Résiliation validée dont l'effet est à venir : étape à venir, l'échéance reste affichée tant que le contrat est actif.
    assert.ok(types(contrat(), docs, '2026-06-01').includes('resiliation:2026-08-31:a_venir'));
    // Statut changé à la main, sans document : la fin figure quand même.
    assert.ok(types(contrat({ status: 'Résilié', terminationDate: '2026-08-31' }), aucun, '2026-11-23').includes('fin:2026-08-31:fait'));
});
