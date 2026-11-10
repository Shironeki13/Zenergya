// Analytique : code généré, code externe, héritage, totaux par axe : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analytiqueEffective, codeGenere, controleCodeCourt, proposerCodeCourt, segment, totauxParAxe, type AnalytiqueLigne } from '../src/lib/analytique';

const S = { societe: 'ZEN', agence: 'LYO', secteur: 'LN', client: 'CLI-00012', contrat: 'CTN-00034', activite: 'P2' };

test('segments et codes courts', () => {
    assert.deepEqual([segment('CLI-00012'), segment('Lyon Nord'), segment('é à ç'), segment(null)], ['CLI00012', 'LYONNORD', 'EAC', '']);
    assert.deepEqual([proposerCodeCourt('Lyon'), proposerCodeCourt('Lyon Nord'), proposerCodeCourt('Paris 11e-12e'), proposerCodeCourt('Île-de-France Est')], ['LYO', 'LN', 'P11E12E', 'IDFE']);
    assert.deepEqual([controleCodeCourt('LYO'), controleCodeCourt('L'), controleCodeCourt('LY O')], [null, 'De 2 à 8 caractères.', 'Lettres et chiffres seulement, sans espace ni accent.']);
});

test('code généré : pyramide client › contrat › prestation ; segment manquant nommé', () => {
    assert.deepEqual(codeGenere(S, 'client'), { code: 'ZEN-LYO-LN-CLI00012' });
    assert.deepEqual(codeGenere(S, 'contrat'), { code: 'ZEN-LYO-LN-CLI00012-CTN00034' });
    assert.deepEqual(codeGenere(S, 'prestation'), { code: 'ZEN-LYO-LN-CLI00012-CTN00034-P2' });
    assert.deepEqual(codeGenere({ ...S, agence: '', secteur: null }, 'contrat'), { manque: ['code de l\'agence', 'code du secteur'] });
});

test('code effectif : figé prioritaire sur le calcul ; externe propre, hérité avec son segment, ou généré', () => {
    // Sans rien : généré, non figé.
    const client = analytiqueEffective('client', {}, S);
    assert.deepEqual([client.code, client.origine, client.fige], ['ZEN-LYO-LN-CLI00012', 'genere', false]);
    // Code figé : un changement de secteur ne le modifie pas.
    const fige = analytiqueEffective('contrat', { analyticCode: 'ZEN-LYO-LN-CLI00012-CTN00034' }, { ...S, secteur: 'LS' }, client);
    assert.deepEqual([fige.code, fige.fige], ['ZEN-LYO-LN-CLI00012-CTN00034', true]);
    // Externe sur le client : le contrat et la prestation en héritent avec leur segment ; le généré reste lisible.
    const cExt = analytiqueEffective('client', { analyticExternal: ' V080912 ' }, S);
    const kExt = analytiqueEffective('contrat', {}, S, cExt);
    const pExt = analytiqueEffective('prestation', {}, S, kExt);
    assert.deepEqual([cExt.code, cExt.origine, kExt.code, kExt.origine, pExt.code, pExt.genere], ['V080912', 'externe', 'V080912-CTN00034', 'externe-herite', 'V080912-CTN00034-P2', 'ZEN-LYO-LN-CLI00012-CTN00034-P2']);
    // Externe propre à la prestation : l'emporte, même si le contrat est généré.
    const p = analytiqueEffective('prestation', { analyticExternal: '68W2/V080912-1-001' }, S, analytiqueEffective('contrat', {}, S, client));
    assert.deepEqual([p.code, p.origine, p.externe], ['68W2/V080912-1-001', 'externe', '68W2/V080912-1-001']);
    // Rien de générable et pas d'externe : non affecté, avec ce qui manque.
    const vide = analytiqueEffective('client', {}, { ...S, agence: '' });
    assert.deepEqual([vide.code, vide.origine, vide.manque], [null, 'aucun', ['code de l\'agence']]);
});

test('suivi : totaux par axe, lignes sans analytique regroupées en « non affecté »', () => {
    const a = (contrat: string, activite: string): AnalytiqueLigne => ({ code: `ZEN-LYO-LN-CLI00012-${contrat}-${activite}`, axes: { societe: 'ZEN', agence: 'LYO', secteur: 'LN', client: 'CLI00012', contrat, activite } });
    const lignes = [
        { analytique: a('CTN00034', 'P2'), montant: 1000, site: 'A' }, { analytique: a('CTN00034', 'P2'), montant: 500.1, site: 'B' },
        { analytique: a('CTN00034', 'P1'), montant: 2000.2, site: 'A' }, { analytique: a('CTN00035', 'P2'), montant: -100, site: 'C' }, { montant: 50 },
    ];
    assert.deepEqual(totauxParAxe(lignes, 'contrat').map(t => [t.cle, t.code, t.montant, t.lignes]), [
        ['(non affecté) › (non affecté) › (non affecté) › (non affecté) › (non affecté)', '(non affecté)', 50, 1],
        ['ZEN › LYO › LN › CLI00012 › CTN00034', 'ZEN-LYO-LN-CLI00012-CTN00034', 3500.3, 3],
        ['ZEN › LYO › LN › CLI00012 › CTN00035', 'ZEN-LYO-LN-CLI00012-CTN00035', -100, 1],
    ]);
    assert.deepEqual(totauxParAxe(lignes, 'societe').map(t => [t.cle, t.montant]), [['(non affecté)', 50], ['ZEN', 3400.3]]);
    // Par site : même code de prestation, détail par site.
    assert.deepEqual(totauxParAxe(lignes.slice(0, 2), 'site').map(t => [t.axes.site, t.code, t.montant]), [['A', 'ZEN-LYO-LN-CLI00012-CTN00034-P2', 1000], ['B', 'ZEN-LYO-LN-CLI00012-CTN00034-P2', 500.1]]);
});
