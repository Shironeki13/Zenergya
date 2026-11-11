'use server';

import { requireUser } from '@/lib/auth/server';
import { gardePerimetre } from '@/lib/auth/perimetre-server';
import type { Quote } from '@/lib/quotes/types';
import type { QuoteBillingRequest } from '@/lib/quotes/billing';
import { invoiceQuote } from '@/services/quote-billing';
import {
    acceptQuote, cancelQuote, newQuoteVersion, refuseQuote, sendQuote, type AcceptInput,
} from '@/services/quotes-admin';

/**
 * Actions du cycle de vie des devis (serveur, session requise).
 * Le navigateur ne modifie lui-même qu'un brouillon (règles Firestore).
 */

export type QuoteActionResult = { success: true; quote: Quote } | { success: false; error: string };

/** Chaque action porte sur un devis : il doit être dans le périmètre de l'utilisateur (client du devis). */
async function run(id: string, action: (by: string) => Promise<Quote>): Promise<QuoteActionResult> {
    try {
        const user = await requireUser();
        await gardePerimetre(user).exiger('devis', id);
        return { success: true, quote: await action(user.email) };
    } catch (error) {
        console.error('Action devis :', error);
        return { success: false, error: error instanceof Error ? error.message : 'Action impossible.' };
    }
}

export async function sendQuoteAction(id: string) {
    return run(id, by => sendQuote(id, by));
}

export async function acceptQuoteAction(id: string, input: AcceptInput) {
    return run(id, by => acceptQuote(id, input, by));
}

export async function refuseQuoteAction(id: string, input: { refusedAt: string; reason: string }) {
    return run(id, by => refuseQuote(id, input, by));
}

export async function cancelQuoteAction(id: string, reason: string) {
    return run(id, by => cancelQuote(id, reason, by));
}

export async function newQuoteVersionAction(id: string) {
    return run(id, by => newQuoteVersion(id, by));
}

/** Facture un devis accepté : totalité, acompte (en %) ou solde. */
export async function invoiceQuoteAction(id: string, request: QuoteBillingRequest):
    Promise<{ success: true; invoiceId: string; invoiceNumber: string } | { success: false; error: string }> {
    try {
        const user = await requireUser();
        await gardePerimetre(user).exiger('devis', id);
        return { success: true, ...(await invoiceQuote(id, request, user.email)) };
    } catch (error) {
        console.error('Facturation du devis :', error);
        return { success: false, error: error instanceof Error ? error.message : 'Facturation impossible.' };
    }
}
