import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';

/**
 * Mêmes fonctions que le SDK Firestore du navigateur (collection, doc, getDoc, updateDoc, runTransaction…), exécutées
 * par le SDK d'administration. Sert à faire tourner côté serveur, sans la réécrire, la logique d'écriture qui était
 * exécutée par le navigateur (services/ecritures-admin.ts).
 */

type Ref = FirebaseFirestore.DocumentReference;
type Col = FirebaseFirestore.CollectionReference;
type Q = FirebaseFirestore.Query;
export type DocumentData = FirebaseFirestore.DocumentData;
type Options = FirebaseFirestore.SetOptions;

export const db = adminDb;
export { Timestamp };

/** Document lu : `exists()` est une fonction, comme dans le SDK du navigateur. */
export type Snap = { id: string; ref: Ref; exists: () => boolean; data: () => DocumentData; get: (champ: string) => any };
const snap = (d: FirebaseFirestore.DocumentSnapshot): Snap => ({ id: d.id, ref: d.ref, exists: () => d.exists, data: () => (d.data() ?? {}) as DocumentData, get: (champ: string) => d.get(champ) });

export const collection = (_db: unknown, nom: string): Col => adminDb.collection(nom);
/** doc(db, 'collection', id) ou doc(collectionRef) pour un nouvel identifiant. */
export function doc(a: unknown, nom?: string, id?: string): Ref {
    if (typeof nom === 'string') return id === undefined ? adminDb.doc(nom) : adminDb.collection(nom).doc(id);
    return (a as Col).doc();
}
export const addDoc = (c: Col, data: DocumentData): Promise<Ref> => c.add(data);
export const setDoc = async (r: Ref, data: DocumentData, options?: Options): Promise<void> => { await (options ? r.set(data, options) : r.set(data)); };
export const updateDoc = async (r: Ref, data: DocumentData): Promise<void> => { await r.update(data); };
export const deleteDoc = async (r: Ref): Promise<void> => { await r.delete(); };
export const getDoc = async (r: Ref): Promise<Snap> => snap(await r.get());
export async function getDocs(q: Q): Promise<{ docs: Snap[]; empty: boolean; size: number; forEach: (f: (d: Snap) => void) => void }> {
    const s = await q.get();
    const docs = s.docs.map(snap);
    return { docs, empty: s.empty, size: s.size, forEach: f => docs.forEach(f) };
}
type Contrainte = (q: Q) => Q;
export const where = (champ: string, op: FirebaseFirestore.WhereFilterOp, valeur: unknown): Contrainte => q => q.where(champ, op, valeur);
export const orderBy = (champ: string, sens?: 'asc' | 'desc'): Contrainte => q => q.orderBy(champ, sens);
export const limit = (n: number): Contrainte => q => q.limit(n);
export const query = (q: Q, ...contraintes: Contrainte[]): Q => contraintes.reduce((acc, c) => c(acc), q);
export const writeBatch = (_db?: unknown) => adminDb.batch();

export type Tx = { get: (r: Ref) => Promise<Snap>; set: (r: Ref, data: DocumentData, options?: Options) => Tx; update: (r: Ref, data: DocumentData) => Tx; delete: (r: Ref) => Tx };
export function runTransaction<T>(_db: unknown, f: (tx: Tx) => Promise<T>): Promise<T> {
    return adminDb.runTransaction(async t => {
        const tx: Tx = {
            get: async r => snap(await t.get(r)),
            set: (r, data, options) => { if (options) t.set(r, data, options); else t.set(r, data); return tx; },
            update: (r, data) => { t.update(r, data); return tx; },
            delete: r => { t.delete(r); return tx; },
        };
        return f(tx);
    });
}
