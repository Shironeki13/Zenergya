import { db } from '@/lib/firebase';
import { ecrireServeur, lireServeur } from '@/services/lecture';
import { collection, deleteDoc, doc, getDoc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { addDays, computeQuoteTotals, quoteCounterKey, quoteNumber } from '@/lib/quotes/pricing';
import type { Quote, QuoteVersionRecord } from '@/lib/quotes/types';
import type { Client, Company, Invoice } from '@/lib/types';
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

// Lectures : faites par le serveur, qui ne renvoie que les devis des clients du périmètre de l'utilisateur.
export const getQuotes = (): Promise<Quote[]> => lireServeur<Quote[]>('devisTous', {}, []);
export const getQuote = (id: string): Promise<Quote | null> => lireServeur<Quote | null>('devis', { id }, null);
/** Versions envoyées d'un devis (lecture seule : écrites par le serveur). */
export const getQuoteVersions = (quoteId: string): Promise<QuoteVersionRecord[]> => lireServeur<QuoteVersionRecord[]>('versionsDuDevis', { id: quoteId }, []);
/** Factures émises depuis un devis. */
export const getQuoteInvoices = (quoteId: string): Promise<Invoice[]> => lireServeur<Invoice[]>('facturesDuDevis', { id: quoteId }, []);

export type NewQuoteInput = Omit<Quote, 'id' | 'number' | 'status' | 'version' | 'validUntil' | 'totals' | 'createdAt' | 'updatedAt'>;

/**
 * Crée un devis en brouillon. Numéro {CODE}-DEV{AAAA}-{NNNN} attribué dans la même transaction
 * que l'écriture : un numéro n'est consommé que si le devis est créé.
 */
export async function createQuote(input: NewQuoteInput, company: Pick<Company, 'code' | 'name'>): Promise<Quote> {
    return ecrireServeur<Quote>('createQuote', [input, company]);
}

export type QuoteDraftPatch = Partial<Pick<Quote,
    'title' | 'date' | 'validityDays' | 'paymentTerms' | 'estimatedStart' | 'estimatedDuration' | 'notes' | 'internalNotes'
    | 'pricing' | 'lines' | 'siteId' | 'siteName' | 'contractId' | 'interventionAddress' | 'mode'
    | 'authorId' | 'authorName' | 'authorEmail' | 'agencyId' | 'sectorId'
    | 'contactId' | 'contactName' | 'contactEmail' | 'contactPhone' | 'clientReference' | 'requestDate'>>;

/** Modifie un brouillon (un devis envoyé ne se modifie plus : il faudra une nouvelle version). */
export async function updateQuoteDraft(id: string, patch: QuoteDraftPatch, user?: string): Promise<Quote> {
    return ecrireServeur<Quote>('updateQuoteDraft', [id, patch, user]);
}

/** Supprime un brouillon jamais envoyé. Un devis envoyé (ou en version 2 et plus) s'annule, il ne se supprime pas. */
export async function deleteQuoteDraft(id: string): Promise<void> {
    return ecrireServeur<void>('deleteQuoteDraft', [id]);
}

/** Crée un prospect : une fiche client marquée « prospect », qui deviendra client à l'acceptation d'un devis. */
export async function createProspect(data: Omit<Client, 'id' | 'relation'>): Promise<Client> {
    return ecrireServeur<Client>('createProspect', [data]);
}
