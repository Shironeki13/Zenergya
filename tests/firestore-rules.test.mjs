// Tests des règles Firestore (émulateur requis) : npm run test:rules
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-zenergya',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
});
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const c of ['clients', 'invoices', 'creditNotes', 'users', 'roles', 'counters', 'contracts'])
    await setDoc(doc(db, c, 'x'), { a: 1 });
  await setDoc(doc(db, 'clients', 'x', 'sub', 'y'), { a: 1 });
  await setDoc(doc(db, 'invoices', 'due'), { status: 'due', invoiceNumber: 'ACME-2610-0001', total: 100 });
  await setDoc(doc(db, 'invoices', 'pro'), { status: 'proforma', total: 100 });
  await setDoc(doc(db, 'invoices', 'cancelled'), { status: 'cancelled', invoiceNumber: 'ACME-2610-0002', total: 100 });
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
await t('user cannot update counter', assertFails(setDoc(doc(user, 'counters', 'x'), { current: 2 })));
await t('admin cannot update counter', assertFails(setDoc(doc(admin, 'counters', 'x'), { current: 2 })));
await t('user reads users', assertSucceeds(getDoc(doc(user, 'users', 'x'))));
await t('user cannot write users', assertFails(setDoc(doc(user, 'users', 'x'), { roleId: 'admin' })));
await t('user cannot create user', assertFails(setDoc(doc(user, 'users', 'n'), { a: 1 })));
await t('user cannot write roles', assertFails(setDoc(doc(user, 'roles', 'x'), { isAdmin: true })));
await t('user cannot delete invoice', assertFails(deleteDoc(doc(user, 'invoices', 'x'))));
await t('user cannot delete credit note', assertFails(deleteDoc(doc(user, 'creditNotes', 'x'))));
await t('user cannot delete counter', assertFails(deleteDoc(doc(user, 'counters', 'x'))));
await t('user marks invoice paid', assertSucceeds(updateDoc(doc(user, 'invoices', 'due'), { status: 'paid' })));
await t('user marks invoice due again', assertSucceeds(updateDoc(doc(user, 'invoices', 'due'), { status: 'due' })));
await t('user cannot change invoice amount', assertFails(updateDoc(doc(user, 'invoices', 'due'), { total: 1 })));
await t('user cannot change number with status', assertFails(updateDoc(doc(user, 'invoices', 'due'), { status: 'paid', invoiceNumber: 'X' })));
await t('user cannot cancel invoice directly', assertFails(updateDoc(doc(user, 'invoices', 'due'), { status: 'cancelled' })));
await t('user cannot revive cancelled invoice', assertFails(updateDoc(doc(user, 'invoices', 'cancelled'), { status: 'due' })));
await t('user cannot create invoice', assertFails(setDoc(doc(user, 'invoices', 'new'), { status: 'due', total: 1 })));
await t('admin cannot create invoice', assertFails(setDoc(doc(admin, 'invoices', 'new'), { status: 'due', total: 1 })));
await t('user cannot create credit note', assertFails(setDoc(doc(user, 'creditNotes', 'new'), { total: -1 })));
await t('user reads credit notes', assertSucceeds(getDoc(doc(user, 'creditNotes', 'x'))));
await t('anon cannot delete proforma', assertFails(deleteDoc(doc(anon, 'invoices', 'pro'))));
await t('user deletes proforma', assertSucceeds(deleteDoc(doc(user, 'invoices', 'pro'))));
await t('admin cannot delete issued invoice', assertFails(deleteDoc(doc(admin, 'invoices', 'due'))));
await t('admin cannot delete credit note', assertFails(deleteDoc(doc(admin, 'creditNotes', 'x'))));
await t('user cannot read subcollection', assertFails(getDoc(doc(user, 'clients', 'x', 'sub', 'y'))));
await t('admin writes users', assertSucceeds(setDoc(doc(admin, 'users', 'x'), { a: 2 })));
await t('admin writes roles', assertSucceeds(setDoc(doc(admin, 'roles', 'x'), { isAdmin: true })));
await t('admin deletes contract', assertSucceeds(deleteDoc(doc(admin, 'contracts', 'x'))));
console.log(`\n${ok} passed, ${ko} failed`);
await env.cleanup();
process.exit(ko ? 1 : 0);
