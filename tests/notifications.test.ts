// Notifications par mail : règles, destinataires internes seulement, texte des mails : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENEMENTS, MODELES_DEFAUT, REGLES_DEFAUT, composer, contexteExemple, destinataires, modeleDe, regleDe, type Annuaire } from '../src/lib/notifications/modeles';
import { BALISES, balisesDe, controlerModele, rendre } from '../src/lib/notifications/balises';

const annuaire: Annuaire = { deposant: ['adv@veolia.com'], contratheque: ['c1@veolia.com', 'C2@Veolia.com'], responsable_facturation: ['resp@veolia.com'], n1_responsable: ['chef@veolia.com'], administrateurs: ['admin@veolia.com'] };

test('destinataires : rôles de la règle et adresses fixes, sans doublon ; jamais hors des domaines internes', () => {
    const r = destinataires({ actif: true, roles: ['contratheque', 'deposant'], adresses: ['juridique@veolia.com', 'c1@veolia.com', 'syndic@gmail.com', 'pas-une-adresse'] }, annuaire, ['veolia.com']);
    assert.deepEqual(r.retenus, ['c1@veolia.com', 'c2@veolia.com', 'adv@veolia.com', 'juridique@veolia.com']);
    assert.deepEqual(r.ecartes, [{ adresse: 'syndic@gmail.com', motif: 'domaine gmail.com hors des domaines internes' }, { adresse: 'pas-une-adresse', motif: 'adresse invalide' }]);
    // Aucun domaine paramétré : rien ne part (jamais d'envoi par défaut vers l'extérieur).
    const sans = destinataires(REGLES_DEFAUT.document_depose, annuaire, []);
    assert.deepEqual([sans.retenus, sans.ecartes.map(e => e.motif)], [[], ['aucun domaine interne paramétré', 'aucun domaine interne paramétré']]);
    // Un sous-domaine ou un domaine ressemblant n'est pas le domaine interne.
    assert.deepEqual(destinataires({ actif: true, roles: [], adresses: ['x@veolia.com.evil.fr', 'y@notveolia.com', 'z@VEOLIA.COM'] }, {}, ['Veolia.com ']).retenus, ['z@veolia.com']);
    // Rôle sans titulaire (contrat sans responsable) : simplement personne.
    assert.deepEqual(destinataires(REGLES_DEFAUT.preavis, { contratheque: ['c1@veolia.com'] }, ['veolia.com']).retenus, []);
});

test('règles : celles par défaut, surchargées par les réglages enregistrés', () => {
    assert.deepEqual(regleDe({ regles: {} }, 'document_refuse'), { actif: true, roles: ['deposant'], adresses: [] });
    assert.deepEqual(regleDe({ regles: { document_refuse: { actif: false } } }, 'document_refuse'), { actif: false, roles: ['deposant'], adresses: [] });
    assert.deepEqual(regleDe({ regles: { resiliation_validee: { adresses: ['juridique@veolia.com'], roles: ['contratheque'] } } }, 'resiliation_validee'), { actif: true, roles: ['contratheque'], adresses: ['juridique@veolia.com'] });
    assert.deepEqual(EVENEMENTS.filter(e => !REGLES_DEFAUT[e]), []);
});

test('modèles d\'origine : objet, corps, accords, lien vers la vie du contrat ; les lignes sans valeur disparaissent', () => {
    const depose = composer('document_depose', contexteExemple('document_depose', 'https://zen.veolia.com/'));
    assert.equal(depose.sujet, '[Contrathèque] Un avenant est à valider — CTN-00003 — SDC Le Belvédère');
    assert.equal(depose.texte.replace(/[\u202f\u00a0]/g, ' '), [
        'Bonjour,', '',
        'Un avenant a été déposé par adv@exemple.fr le 03/11/2026 sur le contrat CTN-00003 — SDC Le Belvédère.',
        'Objet : Avenant n°1 : prolongation après rénovation de la chaufferie', 'Date d\'effet : 01/12/2026', 'P1 : −2 500,00 € HT/an', 'P2 : +1 200,00 € HT/an', '',
        'Il attend votre validation : contrôlez-le contre sa pièce, puis validez ou refusez.', '',
        'Vie du contrat : https://zen.veolia.com/contracts/exemple?onglet=historique', '',
        'Message automatique de Zenergya, réservé à un usage interne. Ne pas répondre.',
    ].join('\n'));
    assert.match(depose.html, /^<p>Bonjour,<\/p><p>Un avenant a été déposé .*<br>Objet : .*<br>Date d'effet : 01\/12\/2026<br>P1 : −2.500,00 € HT\/an<br>P2 : \+1.200,00 € HT\/an<\/p>/);
    assert.match(depose.html, /<a href="https:\/\/zen\.veolia\.com\/contracts\/exemple\?onglet=historique">https:\/\/zen\.veolia\.com\/contracts\/exemple\?onglet=historique<\/a>/);
    // Accord au féminin (reconduction), motif de refus.
    const refus = composer('document_refuse', contexteExemple('document_refuse', undefined, 'reconduction'));
    assert.equal(refus.sujet, '[Contrathèque] La reconduction est refusée — CTN-00003 — SDC Le Belvédère');
    assert.match(refus.texte, /La reconduction du contrat .* a été refusée par contratheque@exemple\.fr\.\nMotif : Document non signé par le client : joindre la version signée\nObjet : 1 an\n/);
    // Sans motif, sans objet, sans adresse d'application : ces lignes disparaissent, sans laisser de trou.
    const nu = composer('document_refuse', { contrat: { id: 'k', numero: 'CTN-1', client: 'Client' }, document: { nature: 'avenant', decidePar: 'c@v.fr' }, urlApplication: '' });
    assert.equal(nu.texte, 'Bonjour,\n\nL\'avenant du contrat CTN-1 — Client a été refusé par c@v.fr.\n\nCorrigez puis déposez à nouveau le document.\n\nMessage automatique de Zenergya, réservé à un usage interne. Ne pas répondre.');
    // Préavis, échéance dépassée, résiliation.
    assert.match(composer('preavis', contexteExemple('preavis')).texte, /La date limite de préavis du contrat .* est le 29\/06\/2027, dans 60 jours\.\nPréavis : 3 mois avant l'échéance du 29\/09\/2027\.\nPassé cette date : sans dénonciation, reconduction tacite de 1 an\./);
    assert.equal(composer('echeance_depassee', contexteExemple('echeance_depassee')).sujet, '[Contrats] Échéance dépassée depuis 12 jours — CTN-00003 — SDC Le Belvédère');
    assert.match(composer('resiliation_validee', contexteExemple('resiliation_validee')).texte, /La résiliation du contrat .* est validée\.\nDate d'effet : 31\/03\/2027\nMotif : Vente de l'immeuble\n/);
    // Chaque modèle d'origine est valide et produit un mail complet.
    for (const e of EVENEMENTS) {
        assert.deepEqual(controlerModele(MODELES_DEFAUT[e]), [], e);
        const m = composer(e, contexteExemple(e));
        assert.ok(m.sujet.length > 20 && m.texte.startsWith('Bonjour,') && m.html.startsWith('<p>Bonjour,</p>') && !/<<|>>/.test(m.sujet + m.texte), e);
    }
});

test('balises : remplacement, casse et accents libres, contrôle à l\'enregistrement, valeurs échappées dans le HTML', () => {
    const ctx = contexteExemple('document_depose', 'https://zen.veolia.com');
    // Écriture tolérante de la balise (casse, accents, espaces).
    assert.equal(rendre({ objet: '<<numero du contrat>> / << CLIENT >>', corps: 'x' }, ctx).sujet, 'CTN-00003 / SDC Le Belvédère');
    assert.deepEqual(balisesDe('A <<Client>> B <<Date d\'effet>>'), ['Client', 'Date d\'effet']);
    assert.equal(rendre({ objet: 'o', corps: 'Le <<Date du jour>>, <<Un document>> (<<Type de document>>) : <<Le document>> validé<<e>>.' }, { ...ctx, document: { nature: 'resiliation' } }).texte, 'Le 23/11/2026, Une résiliation (résiliation) : La résiliation validée.');
    // Contrôles : balise inconnue, mal fermée, objet ou corps vide, objet sur plusieurs lignes.
    assert.deepEqual(controlerModele({ objet: 'Bonjour <<Client>>', corps: 'Texte <<Numéro du contrat>>' }), []);
    assert.match(controlerModele({ objet: 'o', corps: 'Texte <<Montant du contrat>> et <<client>>' }).join(' '), /Balise\(s\) inconnue\(s\) : <<Montant du contrat>>\. Choisissez-les dans la liste\./);
    assert.match(controlerModele({ objet: 'o', corps: 'Texte <<Client' }).join(' '), /mal fermée/);
    assert.deepEqual(controlerModele({ objet: ' ', corps: '' }).slice(0, 2), ['L\'objet du mail est vide.', 'Le corps du mail est vide.']);
    assert.match(controlerModele({ objet: 'a\nb', corps: 'x' }).join(' '), /une seule ligne/);
    // Une ligne garde ses balises renseignées même si une autre est vide ; les lignes vides en trop sont resserrées.
    assert.equal(rendre({ objet: 'o', corps: 'A\n\n\n\nMotif : <<Motif du refus>>\n\n\nPar <<Déposé par>> (<<Motif du refus>>)\n\n' }, ctx).texte, 'A\n\nPar adv@exemple.fr ()');
    // Données et modèle échappés dans le HTML : pas de balise HTML injectée par un texte saisi.
    const piege = rendre({ objet: 'o', corps: '<b>Gras</b> <<Client>> : <<Objet du document>>' }, { contrat: { id: 'k', numero: 'CTN-1', client: 'A & B <script>' }, document: { nature: 'avenant', resume: '<img src=x onerror=alert(1)>' }, urlApplication: '' });
    assert.equal(piege.html, '<p>&lt;b&gt;Gras&lt;/b&gt; A &amp; B &lt;script&gt; : &lt;img src=x onerror=alert(1)&gt;</p>');
    // Chaque balise proposée a un nom unique et une valeur sur l'exemple complet.
    assert.equal(new Set(BALISES.map(b => b.nom.toLowerCase())).size, BALISES.length);
});

test('modèle en vigueur : celui du type de document, sinon celui de l\'événement, sinon celui d\'origine', () => {
    const propres = { document_depose: { defaut: { objet: 'Nouveau document sur <<Numéro du contrat>>', corps: 'Tous : <<Un document>>' }, parNature: { resiliation: { objet: 'URGENT résiliation <<Client>>', corps: 'Effet le <<Date d\'effet>>' } } } };
    assert.equal(modeleDe(undefined, 'document_depose', 'avenant').origine, 'origine');
    assert.deepEqual([modeleDe(propres, 'document_depose', 'avenant').origine, modeleDe(propres, 'document_depose', 'resiliation').origine, modeleDe(propres, 'document_depose').origine, modeleDe(propres, 'document_valide', 'resiliation').origine], ['evenement', 'nature', 'evenement', 'origine']);
    assert.equal(composer('document_depose', contexteExemple('document_depose', undefined, 'avenant'), propres).sujet, 'Nouveau document sur CTN-00003');
    const res = composer('document_depose', contexteExemple('document_depose', undefined, 'resiliation'), propres);
    assert.deepEqual([res.sujet, res.texte], ['URGENT résiliation SDC Le Belvédère', 'Effet le 01/12/2026']);
});

test('balises de montants : montants du contrat et impacts du document par prestation ; vides quand il n\'y en a pas', () => {
    const net = (x: string) => x.replace(/[  ]/g, ' ');
    const ctx = { contrat: { id: 'k', numero: 'CTN-1', client: 'Client', montants: { p1: 80000, p2: 4800, p3: 0 } }, document: { nature: 'avenant' as const, impacts: { p1: -2500, p2: 1200.5, p3r: null } }, urlApplication: '' };
    const m = (corps: string) => net(rendre({ objet: 'o', corps }, ctx).texte);
    assert.equal(m('<<Montant P1 du contrat>> | <<Montant P2 du contrat>> | <<Montant total du contrat>>'), '80 000,00 € | 4 800,00 € | 84 800,00 €');
    assert.equal(m('<<Impact P1>> | <<Impact P2>> | <<Impact total>>'), '−2 500,00 € | +1 200,50 € | −1 299,50 €');
    assert.equal(m('Montants :\n<<Montants du contrat>>\nImpacts :\n<<Impacts par prestation>>'), 'Montants :\nP1 : 80 000,00 € HT/an\nP2 : 4 800,00 € HT/an\nImpacts :\nP1 : −2 500,00 € HT/an\nP2 : +1 200,50 € HT/an');
    // Prestation sans montant ou sans impact : la ligne disparaît.
    assert.equal(m('A\nP3 : <<Montant P3 du contrat>>\nImpact P3 : <<Impact P3>>\nImpact P3R : <<Impact P3R>>\nB'), 'A\nB');
    // Document sans impact (résiliation) ou contrat sans montants : rien, et pas de « 0 € » trompeur.
    const sans = net(rendre({ objet: 'o', corps: 'A\nTotal : <<Impact total>>\n<<Impacts par prestation>>\nContrat : <<Montant total du contrat>>\nB' }, { contrat: { id: 'k', numero: 'CTN-1', client: 'C' }, document: { nature: 'resiliation' }, urlApplication: '' }).texte);
    assert.equal(sans, 'A\nB');
    // Impacts qui se compensent : le total est affiché à zéro, parce que le document a bien des impacts.
    assert.equal(net(rendre({ objet: 'o', corps: '<<Impact total>>' }, { ...ctx, document: { nature: 'avenant', impacts: { p1: -100, p2: 100 } } }).texte), '0,00 €');
    assert.deepEqual(controlerModele({ objet: 'x', corps: '<<Impact P2>> <<Impact P3R>> <<Montant P3R du contrat>> <<Impacts par prestation>>' }), []);
});
