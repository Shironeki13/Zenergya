
'use server';
/**
 * @fileOverview Flow to generate an invoice for a given contract.
 *
 * - generateInvoice - The main function to trigger invoice generation.
 * - GenerateInvoiceInput - The input type for the flow.
 * - GenerateInvoiceOutput - The return type for the flow.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { createInvoice } from '@/services/firestore-admin';
import { prepareContractInvoice } from '@/services/contract-billing-admin';
import { archiveDocumentSafely } from '@/services/document-archive';
import { requireUser } from '@/lib/auth/server';
import { gardePerimetre } from '@/lib/auth/perimetre-server';
import { GenerateInvoiceInputSchema, GenerateInvoiceOutputSchema, type GenerateInvoiceInput, type GenerateInvoiceOutput } from '@/lib/types';


// This is the exported function that the UI will call.
export async function generateInvoice(input: GenerateInvoiceInput): Promise<GenerateInvoiceOutput> {
  try {
    await gardePerimetre(await requireUser()).exiger('contrat', String(input?.contractId ?? ''));
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
  return generateInvoiceFlow(input);
}


const generateInvoiceFlow = ai.defineFlow(
  {
    name: 'generateInvoiceFlow',
    inputSchema: GenerateInvoiceInputSchema,
    outputSchema: GenerateInvoiceOutputSchema,
  },
  async (input) => {
    try {
      const { contractId, invoiceDate, isProforma, until } = input;
      // Échéances facturables jusqu'à la date (terme et périodicité de chaque prestation), TVA par ligne, prorata
      // au jour près, totaux par taux, échéance de paiement : voir lib/billing/contract-billing.
      const { invoice: newInvoice, company, billingVersion } = await prepareContractInvoice(contractId, invoiceDate, { isProforma, until });

      // Numéro attribué dans la même transaction que l'écriture ; refus si le contrat a été facturé entre-temps.
      const savedInvoice = await createInvoice(newInvoice, company, { contractId, billingVersion });

      // Copie conforme archivée dès l'émission (un proforma n'est pas archivé).
      if (!isProforma) await archiveDocumentSafely('invoice', savedInvoice.id);

      return {
        success: true,
        invoiceId: savedInvoice.id,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Une erreur inconnue est survenue.";
      console.error("Erreur dans generateInvoiceFlow:", error);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
);
