// Heures de main-d'œuvre : contrôles de saisie, coût horaire, totaux, lecture d'un import : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleDoublon, controleHeures, coutHeures, estValidee, heuresPar, heuresParStatut, jourImport, lireImportHeures, lundiDe, modifiablePar, peutValiderHeures, statutALaSaisie, statutHeures, tauxHoraire, totalHeures } from '../src/lib/heures';

const J = '2026-11-10';

test('saisie : date, pas d\'avance, quart d\'heure, plafond de la journée', () => {
    assert.equal(controleHeures({ date: '2026-11-09', hours: 7.5 }, J), null);
    assert.equal(controleHeures({ date: J, hours: 0.25 }, J), null);
    assert.match(String(controleHeures({ date: '2026-02-30', hours: 1 }, J)), /Date invalide/);
    assert.match(String(controleHeures({ date: '2026-11-11', hours: 1 }, J)), /à l'avance/);
    assert.match(String(controleHeures({ date: J, hours: 0 }, J)), /positif/);
    assert.match(String(controleHeures({ date: J, hours: 7.4 }, J)), /quart d'heure/);
    assert.match(String(controleHeures({ date: J, hours: 25 }, J)), /24 h/);
});

test('coût : taux de l\'utilisateur, sinon de la société ; arrondi au centime', () => {
    assert.deepEqual([tauxHoraire(45, 42), tauxHoraire(null, 42), tauxHoraire(0, 42), tauxHoraire(undefined, null)], [45, 42, 42, null]);
    assert.equal(coutHeures(7.25, 41.37), 299.93);
});

test('totaux, par clé ; lundi de la semaine', () => {
    const s = [{ hours: 7.5, cost: 315, k: 'a' }, { hours: 2.25, cost: 94.5, k: 'b' }, { hours: 4, cost: 180, k: 'a' }];
    assert.deepEqual(totalHeures(s), { heures: 13.75, cout: 589.5 });
    assert.deepEqual([...heuresPar(s, x => x.k)], [['a', { heures: 11.5, cout: 495 }], ['b', { heures: 2.25, cout: 94.5 }]]);
    assert.deepEqual([lundiDe('2026-11-10'), lundiDe('2026-11-09'), lundiDe('2026-11-15'), lundiDe('2027-01-01')], ['2026-11-09', '2026-11-09', '2026-11-09', '2026-12-28']);
});

test('import : en-têtes reconnus (accents, alias, astérisque), dates et heures lues, erreurs par ligne', () => {
    assert.deepEqual([jourImport('2026-11-03'), jourImport('3/11/2026'), jourImport('03.11.2026'), jourImport('2026-11-03 00:00'), jourImport('11/31/2026'), jourImport('hier')], ['2026-11-03', '2026-11-03', '2026-11-03', '2026-11-03', '', '']);
    const r = lireImportHeures([
        ['Date *', 'Technicien (email) *', 'Affaire', 'Contrat', 'Activité', 'Heures *', 'Commentaire'],
        ['03/11/2026', ' Tech@V.fr ', 'ZEN-AFF2026-0003', '', '', '7,5', 'Dépose'],
        ['2026-11-04', 'tech@v.fr', '', 'CTN-00001', 'P2', '2h', ''],
        ['', '', '', '', '', '', ''],
        ['2026-11-05', '', 'A', 'CTN-1', '', '7,4', ''],
        ['demain', 'tech@v.fr', '', 'CTN-1', '', '8', ''],
    ], J);
    assert.equal(r.erreur, undefined);
    assert.deepEqual(r.lignes.map(l => [l.ligne, l.date, l.email, l.affaire || `${l.contrat}/${l.activite}`, l.hours, l.erreurs.length]), [
        [2, '2026-11-03', 'tech@v.fr', 'ZEN-AFF2026-0003', 7.5, 0], [3, '2026-11-04', 'tech@v.fr', 'CTN-00001/P2', 2, 0], [5, '2026-11-05', '', 'A', 7.4, 4], [6, '', 'tech@v.fr', 'CTN-1/', 8, 2]]);
    assert.match(r.lignes[2].erreurs.join(' ; '), /quart d'heure.*email.*pas les deux/);
    assert.match(String(lireImportHeures([['Jour', 'Heures'], ['2026-11-03', '2']], J).erreur), /Technicien \(email\)/);
    assert.match(String(lireImportHeures([['Jour', 'Technicien', 'Durée'], ['2026-11-03', 'a@v.fr', '2']], J).erreur), /Affaire.*Contrat/);
    assert.match(String(lireImportHeures([['Jour', 'Technicien', 'Durée', 'Affaire']], J).erreur), /Aucune ligne/);
    const c = { userId: 'u', date: J, hours: 2 };
    assert.notEqual(cleDoublon({ ...c, cible: { type: 'affaire', projectId: 'p' } }), cleDoublon({ ...c, cible: { type: 'contrat', contractId: 'p', activityCode: 'P2' } }));
});

test('validation : qui valide, statut à la saisie, saisie antérieure considérée validée, ce que l\'intéressé peut modifier', () => {
    const tech = { id: 'tech', managerId: 'chef' }, chef = { id: 'chef', managerId: null }, sansChef = { id: 'dir' };
    // Le responsable valide son équipe ; un administrateur, tout le monde (dont qui n'a pas de responsable) ; jamais soi-même.
    assert.deepEqual([peutValiderHeures({ id: 'chef' }, tech), peutValiderHeures({ id: 'autre' }, tech), peutValiderHeures({ id: 'adm', isAdmin: true }, tech), peutValiderHeures({ id: 'tech', isAdmin: true }, tech),
        peutValiderHeures({ id: 'chef' }, chef), peutValiderHeures({ id: 'adm', isAdmin: true }, sansChef), peutValiderHeures({ id: 'chef' }, sansChef)], [true, false, true, false, false, true, false]);
    assert.deepEqual([statutALaSaisie({ id: 'tech' }, tech), statutALaSaisie({ id: 'chef' }, tech), statutALaSaisie({ id: 'adm', isAdmin: true }, tech), statutALaSaisie({ id: 'adm', isAdmin: true }, { id: 'adm' })], ['a_valider', 'validee', 'validee', 'a_valider']);
    assert.deepEqual([statutHeures({}), estValidee({}), estValidee({ statut: 'a_valider' }), estValidee({ statut: 'refusee' })], ['validee', true, false, false]);
    const s = (statut: 'a_valider' | 'validee' | 'refusee') => ({ statut, userId: 'tech' });
    assert.deepEqual([modifiablePar(s('a_valider'), { id: 'tech' }, tech), modifiablePar(s('refusee'), { id: 'tech' }, tech), modifiablePar(s('validee'), { id: 'chef' }, tech)], [null, null, null]);
    assert.match(String(modifiablePar(s('validee'), { id: 'tech' }, tech)), /déjà validées/);
    assert.match(String(modifiablePar(s('a_valider'), { id: 'autre' }, tech)), /pas les vôtres/);
    assert.deepEqual(heuresParStatut([{ hours: 7, cost: 294 }, { hours: 2, cost: 84, statut: 'a_valider' }, { hours: 3, cost: 126, statut: 'refusee' }, { hours: 1, cost: 42, statut: 'validee' }]),
        { a_valider: { heures: 2, cout: 84 }, validee: { heures: 8, cout: 336 }, refusee: { heures: 3, cout: 126 } });
});
