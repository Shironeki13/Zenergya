
'use server';
/**
 * @fileOverview Flow to generate a credit note for given invoices.
 *
 * - generateCreditNote - The main function to trigger credit note generation.
 * - GenerateCreditNoteInput - The input type for the flow.
 * - GenerateCreditNoteOutput - The return type for the flow.
 */

import { ai } from '@/ai/genkit';
import { createCreditNote } from '@/services/firestore-admin';
import { creditNoteAmounts } from '@/lib/credit-notes';
import { archiveDocumentSafely } from '@/services/document-archive';
import { requireUser } from '@/lib/auth/server';
import { gardePerimetre } from '@/lib/auth/perimetre-server';
import type { Invoice } from '@/lib/types';
import { GenerateCreditNoteInputSchema, GenerateCreditNoteOutputSchema, type GenerateCreditNoteInput, type GenerateCreditNoteOutput } from '@/lib/types';


export async function generateCreditNote(input: GenerateCreditNoteInput): Promise<GenerateCreditNoteOutput> {
  try {
    const garde = gardePerimetre(await requireUser());
    for (const id of input?.invoiceIds ?? []) await garde.exiger('facture', String(id));
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
  return generateCreditNoteFlow(input);
}


const generateCreditNoteFlow = ai.defineFlow(
  {
    name: 'generateCreditNoteFlow',
    inputSchema: GenerateCreditNoteInputSchema,
    outputSchema: GenerateCreditNoteOutputSchema,
  },
  async (input) => {
    try {
      const { invoiceIds, reason, creditNoteDate } = input;
      
      if (!invoiceIds || invoiceIds.length === 0) {
        throw new Error("Aucun ID de facture fourni.");
      }
      
      if (!reason) {
          throw new Error("Un motif est requis pour générer un avoir.");
      }

      // Lecture, contrôles, numérotation et écriture dans une seule transaction (voir createCreditNote).
      const savedCreditNote = await createCreditNote(invoiceIds, (invoicesToCredit: Invoice[]) => {
        // Check if any invoice is already cancelled or is a proforma
        const invalidInvoices = invoicesToCredit.filter(inv => inv.status === 'cancelled' || inv.status === 'proforma');
        if (invalidInvoices.length > 0) {
          const invalidNumbers = invalidInvoices.map(inv => inv.invoiceNumber || inv.id).join(', ');
          throw new Error(`Impossible de générer un avoir. Les factures suivantes sont déjà annulées ou sont des proformas : ${invalidNumbers}.`);
        }

        const { clientId, clientName, contractId } = invoicesToCredit[0];

        // Ensure all invoices belong to the same client
        if (!invoicesToCredit.every(inv => inv.clientId === clientId)) {
          throw new Error("Toutes les factures doivent appartenir au même client.");
        }

        const { lineItems: creditedLineItems, subtotal, tax, total, vatBreakdown } = creditNoteAmounts(invoicesToCredit);

        return {
          originalInvoiceIds: invoicesToCredit.map(inv => inv.id),
          contractId,
          clientId,
          clientName,
          date: new Date(creditNoteDate).toISOString(),
          status: 'finalized' as const,
          lineItems: creditedLineItems,
          subtotal,
          tax,
          total,
          reason,
          ...(vatBreakdown.length > 0 && { vatBreakdown }),
        };
      });

      // Copie conforme archivée dès l'émission.
      await archiveDocumentSafely('creditNote', savedCreditNote.id);

      return {
        success: true,
        creditNoteId: savedCreditNote.id,
        creditNoteNumber: savedCreditNote.creditNoteNumber,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Une erreur inconnue est survenue.";
      console.error("Erreur dans generateCreditNoteFlow:", error);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
);
