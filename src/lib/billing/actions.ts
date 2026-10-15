'use server';

import { requireUser } from '@/lib/auth/server';
import { convertProformaToInvoice } from '@/services/firestore-admin';
import { archiveDocumentSafely } from '@/services/document-archive';

/** Transforme un proforma en facture définitive (numéro attribué côté serveur). */
export async function convertProforma(invoiceId: string): Promise<{ success: boolean; invoiceNumber?: string; error?: string }> {
    try {
        await requireUser();
        const invoiceNumber = await convertProformaToInvoice(invoiceId);
        await archiveDocumentSafely('invoice', invoiceId);
        return { success: true, invoiceNumber };
    } catch (error) {
        console.error('convertProforma error:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Conversion impossible.' };
    }
}
