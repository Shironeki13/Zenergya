
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
import { 
  getContract, 
  getSitesByClient, 
  getActivities,
  createSettingItem 
} from '@/services/firestore';
import type { InvoiceLineItem, Schedule } from '@/lib/types';

export const GenerateInvoiceInputSchema = z.object({
  contractId: z.string().describe('The ID of the contract to generate an invoice for.'),
});
export type GenerateInvoiceInput = z.infer<typeof GenerateInvoiceInputSchema>;

export const GenerateInvoiceOutputSchema = z.object({
    success: z.boolean(),
    invoiceId: z.string().optional(),
    error: z.string().optional(),
});
export type GenerateInvoiceOutput = z.infer<typeof GenerateInvoiceOutputSchema>;

// This is the exported function that the UI will call.
export async function generateInvoice(input: GenerateInvoiceInput): Promise<GenerateInvoiceOutput> {
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
      const { contractId } = input;
      const contract = await getContract(contractId);
      if (!contract) {
        throw new Error('Contrat non trouvé.');
      }

      // For simplicity, we assume we bill for the whole year at once.
      // A real implementation would check the billingSchedule and calculate the period.
      const billingFactor = 1; // 1 for annual, 1/12 for monthly, etc.

      const sites = await getSitesByClient(contract.clientId);
      const contractSites = sites.filter(site => contract.siteIds.includes(site.id));
      if (contractSites.length === 0) {
        throw new Error("Aucun site valide n'est associé à ce contrat.");
      }

      const activities = await getActivities();
      const activityMap = new Map(activities.map(a => [a.id, a]));

      let lineItems: InvoiceLineItem[] = [];

      for (const site of contractSites) {
        if (!site.amounts || site.amounts.length === 0) continue;

        for (const amountInfo of site.amounts) {
          const activity = activityMap.get(amountInfo.activityId);
          if (activity) {
            const lineTotal = amountInfo.amount * billingFactor;
            lineItems.push({
              description: `Prestation: ${activity.label} (${activity.code}) - Site: ${site.name}`,
              quantity: 1, // Annual flat rate
              unitPrice: lineTotal,
              total: lineTotal,
              siteId: site.id,
            });
          }
        }
      }

      if (lineItems.length === 0) {
          throw new Error("Aucune prestation facturable trouvée pour les sites de ce contrat.");
      }
      
      const subtotal = lineItems.reduce((acc, item) => acc + item.total, 0);
      const taxRate = 0.10; // Assuming 10% VAT
      const tax = subtotal * taxRate;
      const total = subtotal + tax;
      
      const today = new Date();
      const dueDate = new Date();
      dueDate.setDate(today.getDate() + 30); // 30 days to pay

      const newInvoice = {
        contractId: contract.id,
        clientId: contract.clientId,
        clientName: contract.clientName,
        date: today.toISOString().split('T')[0],
        dueDate: dueDate.toISOString().split('T')[0],
        status: 'due' as const,
        lineItems,
        subtotal,
        tax,
        total,
      };

      const savedInvoice = await createSettingItem('invoices', newInvoice);

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
