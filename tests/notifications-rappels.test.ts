// Rappels programmés : paliers de préavis et d'échéance, échéances dépassées, documents en attente : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RAPPELS_DEFAUT, controleRappels, palierAtteint, rappelsDuJour, type AttenteRappel, type ContratRappel } from '../src/lib/notifications/rappels';
import { composer } from '../src/lib/notifications/modeles';

const contrat = (id: string, fin: string | null, plus: Partial<ContratRappel> = {}): ContratRappel => ({ id, numero: `CTN-${id}`, client: `Client ${id}`, actif: true, valide: true, fin, preavis: '3 mois', reconductible: true, tacite: true, dureeReconduction: '1 an', ...plus });
const cles = (c: ContratRappel[], a: AttenteRappel[], today: string) => rappelsDuJour(c, a, today).map(r => `${r.evenement}|${r.cle}`);

test('palier courant : le plus petit palier atteint ; rien avant le premier palier ni après la date', () => {
    const P = [90, 60, 30];
    assert.deepEqual([palierAtteint(120, P), palierAtteint(91, P), palierAtteint(90, P), palierAtteint(75, P), palierAtteint(60, P), palierAtteint(31, P), palierAtteint(30, P), palierAtteint(0, P), palierAtteint(-1, P)], [null, null, 90, 90, 60, 60, 30, 30, null]);
    assert.equal(palierAtteint(10, []), null);
    assert.equal(controleRappels(RAPPELS_DEFAUT), null);
    assert.match(String(controleRappels({ ...RAPPELS_DEFAUT, preavis: [90, 0] })), /Rappels de préavis : jusqu'à six nombres de jours entiers/);
    assert.match(String(controleRappels({ ...RAPPELS_DEFAUT, attenteJours: 0 })), /Rappel des documents en attente/);
});

test('préavis et échéance : un rappel par palier, avec sa clé ; le même jour rejoué donne la même clé', () => {
    // Échéance le 31/03/2027, préavis 3 mois → date limite le 31/12/2026.
    const c = [contrat('a', '2027-03-31')];
    assert.deepEqual(cles(c, [], '2026-10-01'), []);                                                             // préavis dans 91 jours, échéance dans 181 : aucun palier atteint
    assert.deepEqual(cles(c, [], '2026-10-02'), ['preavis|contracts/a/preavis/2026-12-31/90', 'echeance|contracts/a/echeance/2027-03-31/180']);
    assert.deepEqual(cles(c, [], '2026-11-23'), ['preavis|contracts/a/preavis/2026-12-31/60', 'echeance|contracts/a/echeance/2027-03-31/180']);
    assert.deepEqual(cles(c, [], '2026-12-31'), ['preavis|contracts/a/preavis/2026-12-31/30', 'echeance|contracts/a/echeance/2027-03-31/90']);
    assert.deepEqual(cles(c, [], '2027-01-15'), ['echeance|contracts/a/echeance/2027-03-31/90']);                // préavis dépassé : plus de rappel de préavis
    // Tâche restée arrêtée : au redémarrage, seul le palier courant est rappelé (pas les paliers manqués).
    assert.equal(rappelsDuJour(c, [], '2026-12-20').filter(r => r.evenement === 'preavis').length, 1);
    const r = rappelsDuJour(c, [], '2026-11-23')[0];
    assert.deepEqual([r.contexte.jours, r.contexte.date, r.contexte.echeance, r.contexte.preavis, r.contexte.reconduction], [38, '2026-12-31', '2027-03-31', '3 mois', 'sans dénonciation, reconduction tacite de 1 an']);
    assert.match(composer('preavis', { ...r.contexte, urlApplication: '' }).texte, /est le 31\/12\/2026, dans 38 jours\.\nPréavis : 3 mois avant l'échéance du 31\/03\/2027\.\nPassé cette date : sans dénonciation, reconduction tacite de 1 an\./);
});

test('contrats hors rappels : inactif, non validé, sans échéance ; préavis illisible : l\'échéance seule', () => {
    assert.deepEqual(cles([contrat('a', '2026-12-31', { actif: false }), contrat('b', '2026-12-31', { valide: false }), contrat('c', null)], [], '2026-11-23'), []);
    assert.deepEqual(cles([contrat('d', '2026-12-31', { preavis: 'selon CCAP' })], [], '2026-11-23'), ['echeance|contracts/d/echeance/2026-12-31/90']);
    assert.equal(rappelsDuJour([contrat('e', '2026-12-31', { reconductible: false, tacite: false })], [], '2026-12-10').find(r => r.evenement === 'echeance')!.contexte.reconduction, 'sans reconduction');
});

test('échéance dépassée : dès le dépassement, puis tous les 30 jours', () => {
    const c = [contrat('a', '2026-10-31')];
    assert.deepEqual(cles(c, [], '2026-11-01'), ['echeance_depassee|contracts/a/depassee/2026-10-31/0']);
    assert.deepEqual(cles(c, [], '2026-11-29'), ['echeance_depassee|contracts/a/depassee/2026-10-31/0']);       // même clé : pas de nouveau mail
    assert.deepEqual(cles(c, [], '2026-11-30'), ['echeance_depassee|contracts/a/depassee/2026-10-31/1']);       // 30 jours : rappel
    assert.equal(rappelsDuJour(c, [], '2026-11-30')[0].contexte.jours, 30);
});

test('documents en attente : un seul mail récapitulatif, le jour où un document franchit un nouveau seuil (7, 14, 21… jours)', () => {
    const actifs = [contrat('k', '2030-12-31'), contrat('l', '2030-12-31')];
    const doc = (id: string, contractId: string, deposeLe: string | null, plus: Partial<AttenteRappel> = {}): AttenteRappel => ({ collection: 'amendments', id, contractId, nature: 'avenant', deposeLe, deposePar: 'adv@v.fr', ...plus });
    const docs = [doc('d1', 'k', '2026-11-10', { resume: 'Ajout d\'un site' }), doc('d2', 'l', '2026-11-02', { nature: 'reconduction', collection: 'renewals' }), doc('d3', 'k', '2026-11-20')];
    const recap = (today: string, dernier: string | null) => rappelsDuJour(actifs, docs, today, RAPPELS_DEFAUT, dernier).filter(r => r.evenement === 'document_en_attente');
    // Le 16/11 : d2 attend depuis 14 jours (deuxième seuil) → un seul mail, qui liste d2 (d1 n'a que 6 jours).
    const le16 = recap('2026-11-16', '2026-11-15');
    assert.deepEqual([le16.length, le16[0].cle, le16[0].contexte.liste!.map(d => `${d.numero}:${d.nature}:${d.jours}`), le16[0].contexte.jours], [1, 'attente/2026-11-16', ['CTN-l:reconduction:14'], 14]);
    // Le 17/11 : d1 atteint 7 jours → récapitulatif des deux, le plus ancien d'abord. Le 18/11 : aucun nouveau seuil → rien.
    assert.deepEqual(recap('2026-11-17', '2026-11-16')[0].contexte.liste!.map(d => `${d.numero}:${d.jours}`), ['CTN-l:15', 'CTN-k:7']);
    assert.deepEqual(recap('2026-11-18', '2026-11-17'), []);
    // Tâche arrêtée du 16 au 24 : au redémarrage, les seuils franchis entre-temps déclenchent un récapitulatif, un seul.
    assert.equal(recap('2026-11-24', '2026-11-16').length, 1);
    // Premier passage de tous les temps : tout document au-delà du premier seuil compte. Relancé le même jour : même clé.
    assert.deepEqual([recap('2026-11-18', null).length, recap('2026-11-18', null)[0].cle, recap('2026-11-18', '2026-11-18').length], [1, 'attente/2026-11-18', 0]);
    // Le mail : nombre, plus ancienne attente, une ligne par document, lien vers la contrathèque.
    const mail = composer('document_en_attente', { ...recap('2026-11-17', '2026-11-16')[0].contexte, urlApplication: 'https://zen.veolia.com' });
    assert.equal(mail.sujet, '[Contrathèque] 2 document(s) en attente de validation');
    assert.equal(mail.texte, [
        'Bonjour,', '', '2 document(s) attendent leur validation, le plus ancien depuis 15 jours :', '',
        '- CTN-l — Client l : reconduction déposée le 02/11/2026 par adv@v.fr, 15 jours d\'attente',
        '- CTN-k — Client k : avenant déposé le 10/11/2026 par adv@v.fr, 7 jours d\'attente — Ajout d\'un site', '',
        'Merci de les traiter : validation ou refus motivé.', '', 'Contrathèque : https://zen.veolia.com/contracts/library', '',
        'Message automatique de Zenergya, réservé à un usage interne. Ne pas répondre.',
    ].join('\n'));
    // Document dont le contrat est inconnu, ou sans date de dépôt : ni rappel ni ligne inventés.
    assert.deepEqual(rappelsDuJour(actifs, [doc('x', 'inconnu', '2026-11-01'), doc('y', 'k', null)], '2026-12-24', RAPPELS_DEFAUT, null), []);
});
