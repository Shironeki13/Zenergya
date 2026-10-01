// Tests des règles Firestore (émulateur requis) : npm run test:rules
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-zenergya',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
});
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const c of ['clients', 'invoices', 'creditNotes', 'users', 'roles', 'counters', 'contracts'])
    await setDoc(doc(db, c, 'x'), { a: 1 });
  await setDoc(doc(db, 'clients', 'x', 'sub', 'y'), { a: 1 });
});
const anon = env.unauthenticatedContext().firestore();
const stranger = env.authenticatedContext('s', { email: 'evil@x.com' }).firestore();
const user = env.authenticatedContext('u', { zen: true, admin: false }).firestore();
const admin = env.authenticatedContext('a', { zen: true, admin: true }).firestore();

let ok = 0, ko = 0;
async function t(name, p) { try { await p; ok++; console.log('PASS', name); } catch (e) { ko++; console.log('FAIL', name, e.message); } }

await t('anon cannot read clients', assertFails(getDoc(doc(anon, 'clients', 'x'))));
await t('anon cannot list invoices', assertFails(getDocs(collection(anon, 'invoices'))));
await t('anon cannot write', assertFails(setDoc(doc(anon, 'clients', 'n'), { a: 1 })));
await t('signed-in stranger cannot read', assertFails(getDoc(doc(stranger, 'clients', 'x'))));
await t('signed-in stranger cannot write', assertFails(setDoc(doc(stranger, 'clients', 'n'), { a: 1 })));
await t('user reads clients', assertSucceeds(getDoc(doc(user, 'clients', 'x'))));
await t('user lists invoices', assertSucceeds(getDocs(collection(user, 'invoices'))));
await t('user creates contract', assertSucceeds(setDoc(doc(user, 'contracts', 'n'), { a: 1 })));
await t('user deletes contract', assertSucceeds(deleteDoc(doc(user, 'contracts', 'n'))));
await t('user updates counter', assertSucceeds(setDoc(doc(user, 'counters', 'x'), { current: 2 })));
await t('user reads users', assertSucceeds(getDoc(doc(user, 'users', 'x'))));
await t('user cannot write users', assertFails(setDoc(doc(user, 'users', 'x'), { roleId: 'admin' })));
await t('user cannot create user', assertFails(setDoc(doc(user, 'users', 'n'), { a: 1 })));
await t('user cannot write roles', assertFails(setDoc(doc(user, 'roles', 'x'), { isAdmin: true })));
await t('user cannot delete invoice', assertFails(deleteDoc(doc(user, 'invoices', 'x'))));
await t('user cannot delete credit note', assertFails(deleteDoc(doc(user, 'creditNotes', 'x'))));
await t('user cannot delete counter', assertFails(deleteDoc(doc(user, 'counters', 'x'))));
await t('user can update invoice', assertSucceeds(setDoc(doc(user, 'invoices', 'x'), { status: 'paid' }, { merge: true })));
await t('user cannot read subcollection', assertFails(getDoc(doc(user, 'clients', 'x', 'sub', 'y'))));
await t('admin writes users', assertSucceeds(setDoc(doc(admin, 'users', 'x'), { a: 2 })));
await t('admin writes roles', assertSucceeds(setDoc(doc(admin, 'roles', 'x'), { isAdmin: true })));
await t('admin deletes invoice', assertSucceeds(deleteDoc(doc(admin, 'invoices', 'x'))));
console.log(`\n${ok} passed, ${ko} failed`);
await env.cleanup();
process.exit(ko ? 1 : 0);
