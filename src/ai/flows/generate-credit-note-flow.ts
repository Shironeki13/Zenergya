
'use server';
/**
 * @fileOverview Flow to generate a credit note for given invoices.
 *
 * - generateCreditNote - The main function to trigger credit note generation.
 * - GenerateCreditNoteInput - The input type for the flow.
 * - GenerateCreditNoteOutput - The return type for the flow.
 */

import { ai } from '@/ai/genkit';
import { getInvoicesByIds, createCreditNote } from '@/services/firestore';
import type { InvoiceLineItem, Invoice } from '@/lib/types';
import { GenerateCreditNoteInputSchema, GenerateCreditNoteOutputSchema, type GenerateCreditNoteInput, type GenerateCreditNoteOutput } from '@/lib/types';


export async function generateCreditNote(input: GenerateCreditNoteInput): Promise<GenerateCreditNoteOutput> {
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

      const invoicesToCredit = await getInvoicesByIds(invoiceIds);
      if (invoicesToCredit.length === 0) {
        throw new Error("Aucune facture correspondante trouvée.");
      }
      
      // Check if any invoice is already cancelled or is a proforma
      const invalidInvoices = invoicesToCredit.filter(inv => inv.status === 'cancelled' || inv.status === 'proforma');
      if (invalidInvoices.length > 0) {
        const invalidNumbers = invalidInvoices.map(inv => inv.invoiceNumber || inv.id).join(', ');
        throw new Error(`Impossible de générer un avoir. Les factures suivantes sont déjà annulées ou sont des proformas : ${invalidNumbers}.`);
      }

      const firstInvoice = invoicesToCredit[0];
      const { clientId, clientName, contractId } = firstInvoice;

      // Ensure all invoices belong to the same client
      if (!invoicesToCredit.every(inv => inv.clientId === clientId)) {
        throw new Error("Toutes les factures doivent appartenir au même client.");
      }

      // Aggregate all line items and negate their amounts
      const creditedLineItems: InvoiceLineItem[] = invoicesToCredit.flatMap(inv => 
        inv.lineItems.map(item => ({
          ...item,
          unitPrice: -Math.abs(item.unitPrice),
          total: -Math.abs(item.total),
          description: `Avoir sur facture ${inv.invoiceNumber}: ${item.description}`,
        }))
      );
      
      const subtotal = creditedLineItems.reduce((acc, item) => acc + item.total, 0);
      // The tax is also negative, summing up the negated taxes from original invoices
      const tax = invoicesToCredit.reduce((acc, inv) => acc - Math.abs(inv.tax), 0);
      const total = subtotal + tax;
      
      const newCreditNote = {
        originalInvoiceIds: invoiceIds,
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
      };

      const savedCreditNote = await createCreditNote(newCreditNote);

      return {
        success: true,
        creditNoteId: savedCreditNote.id,
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
