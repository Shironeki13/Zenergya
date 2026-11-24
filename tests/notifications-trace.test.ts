// Trace des mails sur la vie d'un contrat : à quelle étape de la frise chaque mail se rattache : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etapeDuMail, mailsParEtape, type MailContrat } from '../src/lib/notifications/trace';

const mail = (evenement: MailContrat['evenement'], cle: string, creeLe = '2026-11-20T10:00:00Z'): MailContrat => ({ id: `${evenement}|${cle}`, evenement, cle, creeLe, destinataires: ['a@v.fr'], nbEcartes: 0, statut: 'simule', sujet: 'x' });

test('étape d\'un mail : document déposé, validé ou refusé ; contrat ; préavis et échéance', () => {
    assert.deepEqual([
        etapeDuMail(mail('document_depose', 'amendments/a1#initial')), etapeDuMail(mail('document_valide', 'amendments/a1#2026-11-21T08:00:00.000Z')),
        etapeDuMail(mail('document_refuse', 'renewals/r1#2026-11-21T08:00:00.000Z')), etapeDuMail(mail('resiliation_validee', 'terminations/t1#2026-11-21T08:00:00.000Z')),
        etapeDuMail(mail('document_depose', 'trusteeChanges/s1#initial')), etapeDuMail(mail('document_depose', 'beChanges/b1#initial')),
    ], ['avenant:a1', 'avenant:a1', 'reconduction:r1', 'resiliation:t1', 'syndic:s1', 'be:b1']);
    // Le contrat lui-même : son dépôt, puis sa validation ou son refus.
    assert.deepEqual([etapeDuMail(mail('document_depose', 'contracts/k#initial')), etapeDuMail(mail('document_valide', 'contracts/k#2026-11-21T08:00:00.000Z')), etapeDuMail(mail('document_refuse', 'contracts/k#x'))], ['depot', 'validation', 'validation']);
    assert.deepEqual([etapeDuMail(mail('preavis', 'contracts/k/preavis/2026-12-31/60')), etapeDuMail(mail('echeance', 'contracts/k/echeance/2027-03-31/180')), etapeDuMail(mail('echeance_depassee', 'contracts/k/depassee/2026-10-31/0'))], ['preavis', 'echeance', 'echeance']);
    // Récapitulatif (tous contrats) ou clé inconnue : aucune étape.
    assert.deepEqual([etapeDuMail(mail('document_en_attente', 'attente/2026-11-24')), etapeDuMail(mail('document_depose', 'inconnue/x#initial'))], [null, null]);
});

test('mails regroupés par étape, du plus ancien au plus récent ; les autres à part', () => {
    const etapes = [{ id: 'depot' }, { id: 'avenant:a1' }, { id: 'preavis' }, { id: 'echeance' }];
    const r = mailsParEtape([
        mail('document_valide', 'amendments/a1#2026-11-21T08:00:00.000Z', '2026-11-21T08:00:01Z'), mail('document_depose', 'amendments/a1#initial', '2026-11-20T09:00:00Z'),
        mail('preavis', 'contracts/k/preavis/2026-12-31/90', '2026-10-02T06:30:00Z'), mail('preavis', 'contracts/k/preavis/2026-12-31/60', '2026-11-01T06:30:00Z'),
        mail('document_depose', 'renewals/supprime#initial'),   // document qui n'est plus sur la frise
    ], etapes);
    assert.deepEqual(r.parEtape.get('avenant:a1')!.map(m => m.evenement), ['document_depose', 'document_valide']);
    assert.deepEqual(r.parEtape.get('preavis')!.map(m => m.cle.slice(-2)), ['90', '60']);
    assert.deepEqual([r.parEtape.has('echeance'), r.autres.map(m => m.cle)], [false, ['renewals/supprime#initial']]);
});
