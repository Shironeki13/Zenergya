import 'server-only';
import { Timestamp, FieldPath, type DocumentData, type Query } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import type { Activity, Client, Company, Contract, CreditNote, Index, IndexValue, Invoice, Site } from '@/lib/types';

/**
 * Accès Firestore côté serveur (Admin SDK).
 * Équivalent serveur des fonctions de `firestore.ts`, qui elles utilisent le SDK client
 * et sont soumises aux règles de sécurité (donc inutilisables côté serveur sans utilisateur connecté).
 */

function convert(data: any): any {
    if (data === null || data === undefined) return data;
    if (data instanceof Timestamp) return data.toDate().toISOString();
    if (Array.isArray(data)) return data.map(convert);
    if (typeof data === 'object' && Object.prototype.toString.call(data) === '[object Object]') {
        const out: Record<string, any> = {};
        for (const [key, value] of Object.entries(data)) out[key] = convert(value);
        return out;
    }
    return data;
}

async function getDocument<T>(collectionName: string, id: string): Promise<T | null> {
    const snap = await adminDb.collection(collectionName).doc(id).get();
    if (!snap.exists) return null;
    return convert({ id: snap.id, ...snap.data() }) as T;
}

async function getCollection<T>(q: Query<DocumentData>): Promise<T[]> {
    const snap = await q.get();
    return snap.docs.map(d => convert({ id: d.id, ...d.data() }) as T);
}

// --- Lecture ---

export const getContract = (id: string) => getDocument<Contract>('contracts', id);
export const getClient = (id: string) => getDocument<Client>('clients', id);
export const getInvoice = (id: string) => getDocument<Invoice>('invoices', id);
export const getCompany = (id: string) => getDocument<Company>('companies', id);

export const getCompanies = () => getCollection<Company>(adminDb.collection('companies'));
export const getActivities = () => getCollection<Activity>(adminDb.collection('activities'));
export const getIndices = () => getCollection<Index>(adminDb.collection('indices'));
export const getIndexValues = () => getCollection<IndexValue>(adminDb.collection('indexValues'));

export const getSitesByClient = (clientId: string) =>
    getCollection<Site>(adminDb.collection('sites').where('clientId', '==', clientId));

export const getInvoicesByContract = (contractId: string) =>
    getCollection<Invoice>(adminDb.collection('invoices').where('contractId', '==', contractId));

export async function getInvoicesByIds(ids: string[]): Promise<Invoice[]> {
    if (ids.length === 0) return [];
    const results: Invoice[] = [];
    // Firestore limite les requêtes `in` à 30 valeurs.
    for (let i = 0; i < ids.length; i += 30) {
        const chunk = ids.slice(i, i + 30);
        results.push(...await getCollection<Invoice>(
            adminDb.collection('invoices').where(FieldPath.documentId(), 'in', chunk)
        ));
    }
    return results;
}

// --- Factures ---

export async function getNextInvoiceNumber(companyCode: string): Promise<string> {
    const now = new Date();
    const period = `${now.getFullYear().toString().slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const counterRef = adminDb.collection('counters').doc(`invoiceCounter_${period}`);

    return adminDb.runTransaction(async (tx) => {
        const counterDoc = await tx.get(counterRef);
        const newCount = counterDoc.exists ? (counterDoc.get('current') as number) + 1 : 1;
        tx.set(counterRef, { current: newCount }, { merge: true });
        return `${companyCode}-${period}-${String(newCount).padStart(4, '0')}`;
    });
}

export async function createInvoice(data: Omit<Invoice, 'id'>) {
    const invoiceData = {
        ...data,
        date: new Date(data.date),
        dueDate: new Date(data.dueDate),
        periodStartDate: data.periodStartDate ? new Date(data.periodStartDate) : undefined,
        periodEndDate: data.periodEndDate ? new Date(data.periodEndDate) : undefined,
    };
    const ref = await adminDb.collection('invoices').add(invoiceData);
    return { id: ref.id, ...invoiceData };
}

// --- Avoirs ---

async function getNextCreditNoteNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const counterRef = adminDb.collection('counters').doc(`creditNoteCounter_${year}`);

    return adminDb.runTransaction(async (tx) => {
        const counterDoc = await tx.get(counterRef);
        const newCount = counterDoc.exists ? (counterDoc.get('current') as number) + 1 : 1;
        tx.set(counterRef, { current: newCount }, { merge: true });
        return `AV${year}-${String(newCount).padStart(4, '0')}`;
    });
}

export async function createCreditNote(data: Omit<CreditNote, 'id' | 'creditNoteNumber'>): Promise<CreditNote> {
    const creditNoteNumber = await getNextCreditNoteNumber();
    const newCreditNoteData = { ...data, creditNoteNumber, date: new Date(data.date) };

    const batch = adminDb.batch();
    const creditNoteRef = adminDb.collection('creditNotes').doc();
    batch.set(creditNoteRef, newCreditNoteData);
    for (const invoiceId of data.originalInvoiceIds) {
        batch.update(adminDb.collection('invoices').doc(invoiceId), { status: 'cancelled' });
    }
    await batch.commit();

    return { id: creditNoteRef.id, ...newCreditNoteData, date: newCreditNoteData.date.toISOString() } as CreditNote;
}

// --- Indices ---

export async function createIndex(data: Omit<Index, 'id'>): Promise<Index> {
    const ref = await adminDb.collection('indices').add(data);
    return { id: ref.id, ...data };
}

export async function updateIndex(id: string, data: Partial<Omit<Index, 'id'>>) {
    await adminDb.collection('indices').doc(id).update(data);
}

export async function createIndexValue(data: Omit<IndexValue, 'id'>) {
    const existing = await adminDb.collection('indexValues')
        .where('indexId', '==', data.indexId)
        .where('period', '==', data.period)
        .limit(1)
        .get();
    if (!existing.empty) {
        throw new Error(`Une valeur existe déjà pour l'indice ${data.indexId} sur la période ${data.period}`);
    }
    const valueData = { ...data, lastUpdated: new Date().toISOString() };
    const ref = await adminDb.collection('indexValues').add(valueData);
    return { id: ref.id, ...valueData };
}

export async function updateIndexValue(id: string, data: Partial<Omit<IndexValue, 'id'>>) {
    await adminDb.collection('indexValues').doc(id).update({ ...data, lastUpdated: new Date().toISOString() });
}
