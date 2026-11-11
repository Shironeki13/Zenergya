// Tests des règles Firestore (émulateur requis) : npm run test:rules
// Le navigateur n'accède directement qu'aux référentiels ; tout le reste passe par le serveur.
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-zenergya',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
});

// Collections lues et écrites par le serveur seulement.
const SERVEUR = ['clients', 'contracts', 'sites', 'services', 'meters', 'meterReadings', 'invoices', 'creditNotes', 'contacts',
  'amendments', 'terminations', 'renewals', 'trusteeChanges', 'beChanges', 'interests', 'service_settlements',
  'quotes', 'quoteVersions', 'projects', 'projectSituations', 'commandes', 'fournisseurs', 'heures',
  'p1Parametrage', 'p1Reel', 'saisonsChauffe', 'suiviCommentaires', 'counters', 'apiKeys', 'apiUsage', 'apiIdempotency', 'apiLogs',
  'collectionInconnue'];
const REFERENTIELS = ['companies', 'agencies', 'sectors', 'activities', 'schedules', 'terms', 'typologies', 'vatRates', 'revisionFormulas',
  'revisionRules', 'paymentTerms', 'pricingRules', 'markets', 'meterTypes', 'weatherStations', 'djus', 'djuMonthly', 'indices', 'indexValues', 'settlement_rules'];
const BIBLIOTHEQUE = ['priceArticles', 'priceWorks', 'config'];

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const c of [...SERVEUR, ...REFERENTIELS, ...BIBLIOTHEQUE, 'users', 'roles', 'imports']) await setDoc(doc(db, c, 'x'), { a: 1, clientId: 'c', status: 'due' });
  await setDoc(doc(db, 'clients', 'x', 'sub', 'y'), { a: 1 });
  await setDoc(doc(db, 'companies', 'x', 'sub', 'y'), { a: 1 });
});
const anon = env.unauthenticatedContext().firestore();
const stranger = env.authenticatedContext('s', { email: 'evil@x.com' }).firestore();
const user = env.authenticatedContext('u', { zen: true, admin: false }).firestore();
const param = env.authenticatedContext('p', { zen: true, admin: false, param: true }).firestore();
const admin = env.authenticatedContext('a', { zen: true, admin: true, param: true }).firestore();

let ok = 0, ko = 0;
async function t(name, p) { try { await p; ok++; console.log('PASS', name); } catch (e) { ko++; console.log('FAIL', name, e.message); } }

// --- Sans compte autorisé : rien.
for (const [qui, db] of [['anonyme', anon], ['compte non autorisé', stranger]]) {
  await t(`${qui} : ne lit pas un référentiel`, assertFails(getDoc(doc(db, 'companies', 'x'))));
  await t(`${qui} : ne lit pas un client`, assertFails(getDoc(doc(db, 'clients', 'x'))));
  await t(`${qui} : n'écrit pas un référentiel`, assertFails(setDoc(doc(db, 'companies', 'n'), { a: 1 })));
  await t(`${qui} : ne lit pas les utilisateurs`, assertFails(getDoc(doc(db, 'users', 'x'))));
}

// --- Collections du serveur : fermées au navigateur, pour tous, administrateur compris.
for (const c of SERVEUR) {
  for (const [qui, db] of [['utilisateur', user], ['paramétrage', param], ['administrateur', admin]]) {
    await t(`${c} : ${qui} ne lit pas un document`, assertFails(getDoc(doc(db, c, 'x'))));
    await t(`${c} : ${qui} ne liste pas`, assertFails(getDocs(collection(db, c))));
    await t(`${c} : ${qui} ne crée pas`, assertFails(setDoc(doc(db, c, 'n'), { a: 1 })));
    await t(`${c} : ${qui} ne modifie pas`, assertFails(updateDoc(doc(db, c, 'x'), { a: 2 })));
    await t(`${c} : ${qui} ne supprime pas`, assertFails(deleteDoc(doc(db, c, 'x'))));
  }
}
// Une requête filtrée ne contourne rien (les règles ne sont pas des filtres).
await t('utilisateur : requête filtrée sur les contrats refusée', assertFails(getDocs(query(collection(user, 'contracts'), where('clientId', '==', 'c')))));
await t('utilisateur : requête filtrée sur les factures refusée', assertFails(getDocs(query(collection(user, 'invoices'), where('status', '==', 'due')))));
await t('utilisateur : statut d\'une facture non modifiable directement', assertFails(updateDoc(doc(user, 'invoices', 'x'), { status: 'paid' })));

// --- Référentiels : lus par tous, écrits avec le module Paramétrage.
for (const c of REFERENTIELS) {
  await t(`${c} : utilisateur lit`, assertSucceeds(getDoc(doc(user, c, 'x'))));
  await t(`${c} : utilisateur liste`, assertSucceeds(getDocs(collection(user, c))));
  await t(`${c} : utilisateur ne crée pas`, assertFails(setDoc(doc(user, c, 'n'), { a: 1 })));
  await t(`${c} : utilisateur ne modifie pas`, assertFails(updateDoc(doc(user, c, 'x'), { a: 2 })));
  await t(`${c} : utilisateur ne supprime pas`, assertFails(deleteDoc(doc(user, c, 'x'))));
  await t(`${c} : paramétrage crée`, assertSucceeds(setDoc(doc(param, c, 'n'), { a: 1 })));
  await t(`${c} : paramétrage modifie`, assertSucceeds(updateDoc(doc(param, c, 'n'), { a: 2 })));
  await t(`${c} : paramétrage supprime`, assertSucceeds(deleteDoc(doc(param, c, 'n'))));
  await t(`${c} : administrateur modifie`, assertSucceeds(updateDoc(doc(admin, c, 'x'), { a: 3 })));
}

// --- Bibliothèque de prix et ses compteurs : utilisateurs de l'application.
for (const c of BIBLIOTHEQUE) {
  await t(`${c} : utilisateur lit`, assertSucceeds(getDoc(doc(user, c, 'x'))));
  await t(`${c} : utilisateur écrit`, assertSucceeds(setDoc(doc(user, c, 'n'), { a: 1 })));
}

// --- Utilisateurs et rôles : lus par tous, écrits par l'administrateur seulement.
for (const c of ['users', 'roles']) {
  await t(`${c} : utilisateur lit`, assertSucceeds(getDoc(doc(user, c, 'x'))));
  await t(`${c} : utilisateur n'écrit pas`, assertFails(setDoc(doc(user, c, 'x'), { roleId: 'admin' })));
  await t(`${c} : paramétrage n'écrit pas`, assertFails(setDoc(doc(param, c, 'x'), { roleId: 'admin' })));
  await t(`${c} : paramétrage ne supprime pas`, assertFails(deleteDoc(doc(param, c, 'x'))));
  await t(`${c} : administrateur écrit`, assertSucceeds(setDoc(doc(admin, c, 'n'), { a: 1 })));
}

// --- Historique des imports : lu par l'administrateur, écrit par le serveur.
await t('imports : administrateur lit', assertSucceeds(getDocs(collection(admin, 'imports'))));
await t('imports : utilisateur ne lit pas', assertFails(getDocs(collection(user, 'imports'))));
await t('imports : paramétrage ne lit pas', assertFails(getDoc(doc(param, 'imports', 'x'))));
await t('imports : administrateur n\'écrit pas', assertFails(setDoc(doc(admin, 'imports', 'n'), { a: 1 })));

// --- Sous-collections : refusées, même sous un référentiel.
await t('sous-collection d\'un client refusée', assertFails(getDoc(doc(admin, 'clients', 'x', 'sub', 'y'))));
await t('sous-collection d\'un référentiel refusée', assertFails(getDoc(doc(admin, 'companies', 'x', 'sub', 'y'))));
await t('écriture en sous-collection refusée', assertFails(setDoc(doc(admin, 'companies', 'x', 'sub', 'n'), { a: 1 })));

console.log(`\n${ok} passed, ${ko} failed`);
await env.cleanup();
process.exit(ko ? 1 : 0);
