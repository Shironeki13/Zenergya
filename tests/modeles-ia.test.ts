import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELE_DEFAUT, exigerCleIA, modeleIA, nomModele } from '../src/ai/modeles';

test('modèle IA : stable par défaut, réglable par GEMINI_MODELE (avec ou sans préfixe), clé exigée', () => {
    assert.equal(MODELE_DEFAUT, 'gemini-3.8-flash');
    assert.equal(nomModele({}), 'gemini-3.8-flash');
    assert.equal(modeleIA({ GEMINI_MODELE: ' gemini-3.6-flash ' }), 'googleai/gemini-3.6-flash');
    assert.equal(modeleIA({ GEMINI_MODELE: 'googleai/gemini-4-hydrogen' }), 'googleai/gemini-4-hydrogen');
    assert.throws(() => exigerCleIA({}), /GEMINI_API_KEY est absente/);
    assert.doesNotThrow(() => exigerCleIA({ GEMINI_API_KEY: 'x' }));
    // Plus aucun modèle arrêté ou en voie d'arrêt dans le code.
});
