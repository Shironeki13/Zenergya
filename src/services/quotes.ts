import { db } from '@/lib/firebase';
import { collection, deleteDoc, doc, getDoc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { addDays, computeQuoteTotals, quoteCounterKey, quoteNumber } from '@/lib/quotes/pricing';
import type { Quote } from '@/lib/quotes/types';
import type { Client, Company } from '@/lib/types';
import { createClient } from '@/services/firestore';

/**
 * Devis (collection `quotes`). Les totaux sont toujours recalculés à l'écriture à partir des lignes
 * et des paramètres de prix : on n'enregistre jamais des totaux venus de l'écran.
 */

const QUOTES = 'quotes';
// Référence calculée à l'appel : `db` n'est initialisé qu'après réception de la configuration Firebase.
const sequencesRef = () => doc(db, 'config', 'sequences');

/** Retire les `undefined` (refusés par Firestore), y compris dans les objets et tableaux imbriqués. */
function clean<T>(value: T): T {
    if (Array.isArray(value)) return value.map(clean) as T;
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).map(([k, v]) => [k, clean(v)]),
        ) as T;
    }
    return value;
}

export async function getQuotes(): Promise<Quote[]> {
    const snap = await getDocs(collection(db, QUOTES));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Quote);
}

export async function getQuote(id: string): Promise<Quote | null> {
    const snap = await getDoc(doc(db, QUOTES, id));
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as Quote) : null;
}

export async function getQuotesBy(field: 'clientId' | 'siteId', value: string): Promise<Quote[]> {
    const snap = await getDocs(query(collection(db, QUOTES), where(field, '==', value)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Quote);
}

export type NewQuoteInput = Omit<Quote, 'id' | 'number' | 'status' | 'version' | 'validUntil' | 'totals' | 'createdAt' | 'updatedAt'>;

/**
 * Crée un devis en brouillon. Numéro {CODE}-DEV{AAAA}-{NNNN} attribué dans la même transaction
 * que l'écriture : un numéro n'est consommé que si le devis est créé.
 */
export async function createQuote(input: NewQuoteInput, company: Pick<Company, 'code' | 'name'>): Promise<Quote> {
    const code = company.code?.trim();
    if (!code) throw new Error(`La société « ${company.name} » n'a pas de code : il est nécessaire pour numéroter ses devis.`);
    const year = Number(input.date.slice(0, 4));
    const counter = quoteCounterKey(code, year);
    const ref = doc(collection(db, QUOTES));
    const now = new Date().toISOString();

    return runTransaction(db, async (tx) => {
        const seq = await tx.get(sequencesRef());
        const next = (seq.exists() ? seq.data()[counter] || 0 : 0) + 1;
        const quote: Omit<Quote, 'id'> = {
            ...input,
            number: quoteNumber(code, year, next),
            status: 'brouillon',
            version: 1,
            validUntil: addDays(input.date, input.validityDays),
            totals: computeQuoteTotals(input.lines, input.pricing),
            createdAt: now,
            updatedAt: now,
        };
        tx.set(sequencesRef(), { [counter]: next }, { merge: true });
        tx.set(ref, clean(quote));
        return { id: ref.id, ...quote };
    });
}

export type QuoteDraftPatch = Partial<Pick<Quote,
    'title' | 'date' | 'validityDays' | 'paymentTerms' | 'estimatedStart' | 'estimatedDuration' | 'notes' | 'internalNotes'
    | 'pricing' | 'lines' | 'siteId' | 'siteName' | 'contractId' | 'interventionAddress' | 'mode'>>;

/** Modifie un brouillon (un devis envoyé ne se modifie plus : il faudra une nouvelle version). */
export async function updateQuoteDraft(id: string, patch: QuoteDraftPatch, user?: string): Promise<Quote> {
    const ref = doc(db, QUOTES, id);
    return runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Devis introuvable.');
        const current = { id: snap.id, ...snap.data() } as Quote;
        if (current.status !== 'brouillon') throw new Error("Ce devis n'est plus un brouillon : il ne peut plus être modifié.");
        const merged = { ...current, ...patch };
        const updated: Quote = {
            ...merged,
            validUntil: addDays(merged.date, merged.validityDays),
            totals: computeQuoteTotals(merged.lines, merged.pricing),
            updatedAt: new Date().toISOString(),
            ...(user && { updatedBy: user }),
        };
        const { id: _id, ...data } = updated;
        tx.set(ref, clean(data));
        return updated;
    });
}

/** Supprime un brouillon. Un devis envoyé s'annule, il ne se supprime pas. */
export async function deleteQuoteDraft(id: string): Promise<void> {
    const quote = await getQuote(id);
    if (!quote) return;
    if (quote.status !== 'brouillon') throw new Error("Seul un brouillon peut être supprimé ; un devis envoyé s'annule.");
    await deleteDoc(doc(db, QUOTES, id));
}

/** Crée un prospect : une fiche client marquée « prospect », qui deviendra client à l'acceptation d'un devis. */
export async function createProspect(data: Omit<Client, 'id' | 'relation'>): Promise<Client> {
    const created = await createClient({ ...data, relation: 'prospect' });
    return { ...data, relation: 'prospect', id: created.id } as Client;
}
