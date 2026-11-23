// Tableau de bord de la contrathèque : ce qu'il faut traiter, par urgence, et calendrier des douze mois : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suiviContratheque, type DocumentSuivi } from '../src/lib/contrats/suivi';
import type { Contract } from '../src/lib/types';

const contrat = (id: string, plus: Partial<Contract> = {}): Contract => ({
    id, contractNumber: `CTN-${id}`, clientId: 'c', clientName: `Client ${id}`, siteIds: [], startDate: '2024-01-01', endDate: '2028-12-31', activityIds: [], status: 'Actif', validationStatus: 'validated',
    invoicingType: 'global', renewal: true, tacitRenewal: true, renewalDuration: '1 an', noticePeriod: '3 mois', ...plus,
});
const doc = (plus: Partial<DocumentSuivi>): DocumentSuivi => ({ type: 'avenant', id: 'd', contractId: 'a', etat: 'en_attente', deposeLe: '2026-11-20', deposePar: 'adv@v.fr', effet: null, resume: '', ...plus });
const TODAY = '2026-11-23';

test('échéances et préavis : dépassée, préavis proche (urgent) ou sous six mois, échéance sous six mois, préavis inconnu signalé', () => {
    const s = suiviContratheque([
        contrat('a', { endDate: '2026-10-31' }),                          // échéance dépassée, toujours actif
        contrat('b', { endDate: '2027-03-31' }),                          // préavis le 31/12/2026 : dans 38 jours → urgent ; échéance dans 128 jours
        contrat('c', { endDate: '2027-07-31' }),                          // préavis le 30/04/2027 : dans 158 jours → à surveiller ; échéance hors des 180 jours
        contrat('d', { endDate: '2027-02-28', noticePeriod: undefined }), // échéance proche, préavis non renseigné
        contrat('e', { endDate: '2027-01-15' }),                          // préavis dépassé (15/10/2026) : seule l'échéance reste
        contrat('f', { endDate: '2026-12-31', status: 'Résilié' }),       // non actif : rien
        contrat('g'),                                                     // lointain : rien
    ], [], TODAY);
    assert.deepEqual(s.lignes.map(l => `${l.contrat}:${l.type}:${l.gravite}:${l.jours}`), [
        'CTN-a:echeance_depassee:critique:-23', 'CTN-b:preavis:critique:38',
        'CTN-d:echeance:attention:97', 'CTN-c:preavis:attention:158',
        'CTN-e:echeance:info:53', 'CTN-b:echeance:info:128',
    ]);
    assert.match(s.lignes[0].texte, /Échéance dépassée depuis 23 jour\(s\) \(31\/10\/2026\) : contrat toujours actif/);
    assert.match(s.lignes[1].texte, /Date limite de préavis dans 38 jour\(s\) \(31\/12\/2026\), 3 mois avant l'échéance du 31\/03\/2027 ; sans dénonciation, reconduction tacite/);
    assert.match(s.lignes[2].texte, /préavis non renseigné : date limite de dénonciation inconnue/);
    assert.match(s.lignes[4].texte, /reconduction tacite de 1 an ; préavis dépassé\./);
    assert.deepEqual(s.chiffres, { actifs: 6, aValider: 0, refuses: 0, preavis90: 1, echeances180: 3, depassees: 1, sansPreavis: 1 });
});

test('calendrier : préavis et échéances des douze prochains mois, mois par mois', () => {
    const s = suiviContratheque([contrat('b', { endDate: '2027-03-31' }), contrat('c', { endDate: '2027-07-31', tacitRenewal: false }), contrat('g')], [], TODAY);
    assert.deepEqual([s.calendrier.length, s.calendrier[0].mois, s.calendrier[11].mois], [12, '2026-11', '2027-10']);
    const plein = s.calendrier.filter(m => m.preavis.length + m.echeances.length).map(m => `${m.mois} préavis ${m.preavis.map(x => x.contrat).join()} échéances ${m.echeances.map(x => `${x.contrat}${x.tacite ? '' : ' (sans tacite)'}`).join()}`);
    assert.deepEqual(plein, ['2026-12 préavis CTN-b échéances ', '2027-03 préavis  échéances CTN-b', '2027-04 préavis CTN-c échéances ', '2027-07 préavis  échéances CTN-c (sans tacite)']);
});

test('documents et contrats : en attente (urgent au-delà de 7 jours), refusés récents, résiliation à venir', () => {
    const contrats = [contrat('a'), contrat('h', { validationStatus: 'pending_validation', createdAt: '2026-11-01T08:00:00Z', requesterEmail: 'adv@v.fr' }), contrat('i', { validationStatus: 'refused', refusalReason: 'Contrat non signé', status: 'Brouillon' })];
    const s = suiviContratheque(contrats, [
        doc({ id: '1', deposeLe: '2026-11-20', resume: 'Ajout d\'un site' }),                                   // 3 jours
        doc({ id: '2', type: 'syndic', deposeLe: '2026-11-05' }),                                               // 18 jours : urgent
        doc({ id: '3', type: 'reconduction', etat: 'refuse', motifRefus: 'Durée erronée.', decideLe: '2026-11-10' }),   // point final du motif : pas doublé
        doc({ id: '4', type: 'be', etat: 'refuse', decideLe: '2026-06-01' }),                                   // refus ancien : plus affiché
        doc({ id: '5', type: 'resiliation', etat: 'valide', effet: '2026-12-10', resume: 'Vente' }),            // dans 17 jours
        doc({ id: '6', type: 'resiliation', etat: 'valide', effet: '2026-09-30' }),                             // déjà effective : rien
    ], TODAY);
    assert.deepEqual(s.lignes.map(l => `${l.cle}:${l.type}:${l.gravite}`), [
        'contrat:h:contrat_attente:critique', 'doc:syndic:2:document_attente:critique',
        'doc:avenant:1:document_attente:attention', 'contrat:i:contrat_refuse:attention', 'doc:resiliation:5:resiliation_a_venir:attention',
        'doc:reconduction:3:document_refuse:info',
    ]);
    assert.match(s.lignes[1].texte, /Changement de syndic en attente de validation depuis 18 jour\(s\), déposé par adv@v\.fr\./);
    assert.match(s.lignes[5].texte, /^Reconduction refusée : Durée erronée \(déposée par adv@v\.fr\)\. À corriger et redéposer\.$/);
    assert.deepEqual([s.chiffres.aValider, s.chiffres.refuses], [3, 2]);
    // Nature de chaque ligne, pour le sous-filtre par type de document.
    assert.deepEqual(s.lignes.map(l => l.document), ['contrat', 'syndic', 'avenant', 'contrat', 'resiliation', 'reconduction']);
});
