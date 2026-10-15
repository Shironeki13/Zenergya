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
export const getCreditNote = (id: string) => getDocument<CreditNote>('creditNotes', id);
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

// --- Numérotation des factures et avoirs ---
//
// Obligations (art. 242 nonies A, annexe II du CGI) : numérotation unique, chronologique et continue, par société émettrice.
// - Le numéro est attribué dans la MÊME transaction que l'écriture de la facture / de l'avoir : pas de trou possible.
// - Un compteur par préfixe (code société + période) : chaque société a sa propre série.
// - Factures : {CODE}-{AAMM}-{NNNN} ; avoirs : {CODE}-AV{AAAA}-{NNNN}.

type NumberedKind = 'invoice' | 'creditNote';

const NUMBERING = {
    invoice: { collection: 'invoices', field: 'invoiceNumber' },
    creditNote: { collection: 'creditNotes', field: 'creditNoteNumber' },
} as const;

function numberPrefix(kind: NumberedKind, companyCode: string, issueDate: Date): string {
    const yyyy = issueDate.getFullYear().toString();
    const mm = String(issueDate.getMonth() + 1).padStart(2, '0');
    return kind === 'invoice' ? `${companyCode}-${yyyy.slice(-2)}${mm}-` : `${companyCode}-AV${yyyy}-`;
}

type PreparedSeries = { prefix: string; counterRef: FirebaseFirestore.DocumentReference; seed: number };

/**
 * Prépare une série de numérotation, HORS transaction.
 * Si son compteur n'existe pas encore (nouvelle période, ou données antérieures à ce mécanisme), on relève
 * le plus grand numéro déjà émis avec ce préfixe. Ce relevé reste exact jusqu'à la transaction : tout numéro
 * émis par l'application crée le compteur dans la même transaction, qui l'utilisera alors à la place.
 * (Faire cette recherche dans la transaction verrouillerait une plage de la collection et ferait échouer
 * les émissions simultanées.)
 */
async function prepareSeries(kind: NumberedKind, companyCode: string, issueDate: Date): Promise<PreparedSeries> {
    const prefix = numberPrefix(kind, companyCode, issueDate);
    const { collection, field } = NUMBERING[kind];
    const counterRef = adminDb.collection('counters').doc(`${kind}_${encodeURIComponent(prefix)}`);

    let seed = 0;
    if (!(await counterRef.get()).exists) {
        const last = await adminDb.collection(collection)
            .where(field, '>=', prefix)
            .where(field, '<', prefix + '\uf8ff')
            .orderBy(field, 'desc')
            .limit(1)
            .get();
        seed = last.empty ? 0 : parseInt(String(last.docs[0].get(field)).slice(prefix.length), 10) || 0;
    }
    return { prefix, counterRef, seed };
}

/**
 * Réserve le numéro suivant dans une transaction (lecture du compteur uniquement ;
 * l'appelant écrit le compteur via `commit` et le document dans la même transaction).
 */
async function reserveNumber(tx: FirebaseFirestore.Transaction, series: PreparedSeries) {
    const counterSnap = await tx.get(series.counterRef);
    const current = counterSnap.exists ? (counterSnap.get('current') as number) : series.seed;
    const next = current + 1;
    return {
        number: `${series.prefix}${String(next).padStart(4, '0')}`,
        commit: () => tx.set(series.counterRef, { current: next, prefix: series.prefix, updatedAt: Timestamp.now() }, { merge: true }),
    };
}

/**
 * Société émettrice d'une facture : celle du contrat, sinon celle du client,
 * sinon la seule société configurée. Refus explicite si elle ne peut pas être déterminée.
 */
export async function resolveIssuingCompany(contract: Contract | null, client: Client | null): Promise<Company> {
    const companyId = contract?.companyId || client?.companyId;
    if (companyId) {
        const company = await getCompany(companyId);
        if (!company) throw new Error(`Société émettrice introuvable (ID : ${companyId}).`);
        return company;
    }
    const companies = await getCompanies();
    if (companies.length === 1) return companies[0];
    if (companies.length === 0) throw new Error("Aucune société n'est configurée dans les paramètres.");
    throw new Error("Impossible de déterminer la société émettrice : renseignez la société du client ou du contrat.");
}

function assertCompanyCode(company: Company) {
    if (!company.code?.trim()) {
        throw new Error(`La société « ${company.name} » n'a pas de code : il est nécessaire pour numéroter ses factures.`);
    }
}

// --- Factures ---

type NewInvoice = Omit<Invoice, 'id' | 'invoiceNumber' | 'companyId' | 'issuedAt'>;

function toInvoiceDoc(data: NewInvoice) {
    return {
        ...data,
        date: new Date(data.date),
        dueDate: new Date(data.dueDate),
        periodStartDate: data.periodStartDate ? new Date(data.periodStartDate) : undefined,
        periodEndDate: data.periodEndDate ? new Date(data.periodEndDate) : undefined,
    };
}

/**
 * Crée une facture. Hors proforma, le numéro est attribué dans la même transaction que l'écriture.
 */
export async function createInvoice(data: NewInvoice, company: Company): Promise<{ id: string; invoiceNumber?: string }> {
    const ref = adminDb.collection('invoices').doc();
    const doc = { ...toInvoiceDoc(data), companyId: company.id };

    if (data.status === 'proforma') {
        await ref.set(doc);
        return { id: ref.id };
    }

    assertCompanyCode(company);
    const issuedAt = new Date();
    const series = await prepareSeries('invoice', company.code, issuedAt);
    const invoiceNumber = await adminDb.runTransaction(async (tx) => {
        const reserved = await reserveNumber(tx, series);
        reserved.commit();
        tx.set(ref, { ...doc, invoiceNumber: reserved.number, issuedAt });
        return reserved.number;
    });
    return { id: ref.id, invoiceNumber };
}

/**
 * Transforme un proforma en facture définitive : numéro attribué, date d'émission = aujourd'hui.
 */
export async function convertProformaToInvoice(invoiceId: string, paymentDelayDays = 30): Promise<string> {
    const ref = adminDb.collection('invoices').doc(invoiceId);
    const proforma = await getInvoice(invoiceId);
    if (!proforma) throw new Error('Facture introuvable.');
    if (proforma.status !== 'proforma') throw new Error("Cette facture n'est pas un proforma.");

    const company = proforma.companyId
        ? await getCompany(proforma.companyId)
        : await resolveIssuingCompany(await getContract(proforma.contractId), await getClient(proforma.clientId));
    if (!company) throw new Error('Société émettrice introuvable.');
    assertCompanyCode(company);
    const issuedAt = new Date();
    const series = await prepareSeries('invoice', company.code, issuedAt);

    return adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || snap.get('status') !== 'proforma') {
            throw new Error('Ce proforma a déjà été converti ou supprimé.');
        }
        const reserved = await reserveNumber(tx, series);
        const date = new Date(issuedAt.toISOString().split('T')[0]);
        const dueDate = new Date(date);
        dueDate.setDate(dueDate.getDate() + paymentDelayDays);

        reserved.commit();
        tx.update(ref, {
            invoiceNumber: reserved.number,
            status: 'due',
            companyId: company.id,
            date,
            dueDate,
            issuedAt,
        });
        return reserved.number;
    });
}

// --- Avoirs ---

type NewCreditNote = Omit<CreditNote, 'id' | 'creditNoteNumber' | 'companyId'>;

/**
 * Crée un avoir annulant des factures, en une seule transaction :
 * relecture des factures, contrôle de leur statut, numérotation, écriture de l'avoir et annulation des factures.
 * `build` construit le contenu de l'avoir à partir des factures relues dans la transaction.
 */
export async function createCreditNote(
    invoiceIds: string[],
    build: (invoices: Invoice[]) => NewCreditNote,
): Promise<{ id: string; creditNoteNumber: string }> {
    const uniqueIds = [...new Set(invoiceIds)];
    if (uniqueIds.length === 0) throw new Error('Aucun ID de facture fourni.');

    // Société émettrice déterminée hors transaction (lecture des paramètres).
    const first = await getInvoice(uniqueIds[0]);
    if (!first) throw new Error('Aucune facture correspondante trouvée.');
    const company = first.companyId
        ? await getCompany(first.companyId)
        : await resolveIssuingCompany(await getContract(first.contractId), await getClient(first.clientId));
    if (!company) throw new Error('Société émettrice introuvable.');
    assertCompanyCode(company);

    const creditNoteRef = adminDb.collection('creditNotes').doc();
    const refs = uniqueIds.map(id => adminDb.collection('invoices').doc(id));
    const issuedAt = new Date();
    const series = await prepareSeries('creditNote', company.code, issuedAt);

    const creditNoteNumber = await adminDb.runTransaction(async (tx) => {
        const snaps = await tx.getAll(...refs);
        const missing = snaps.filter(s => !s.exists).map(s => s.id);
        if (missing.length) throw new Error(`Factures introuvables : ${missing.join(', ')}.`);

        const invoices = snaps.map(s => convert({ id: s.id, ...s.data() }) as Invoice);
        const otherCompany = invoices.find(inv => inv.companyId && inv.companyId !== company.id);
        if (otherCompany) {
            throw new Error(`Toutes les factures doivent être émises par la même société (${otherCompany.invoiceNumber || otherCompany.id}).`);
        }
        const creditNote = build(invoices);

        const reserved = await reserveNumber(tx, series);
        reserved.commit();
        tx.set(creditNoteRef, {
            ...creditNote,
            creditNoteNumber: reserved.number,
            companyId: company.id,
            date: new Date(creditNote.date),
            issuedAt,
        });
        for (const ref of refs) {
            tx.update(ref, { status: 'cancelled', cancelledByCreditNoteId: creditNoteRef.id });
        }
        return reserved.number;
    });

    return { id: creditNoteRef.id, creditNoteNumber };
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
