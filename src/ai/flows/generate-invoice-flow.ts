
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
  createInvoice,
  getNextInvoiceNumber,
  getClient,
  getCompanies,
} from '@/services/firestore';
import type { InvoiceLineItem } from '@/lib/types';
import { GenerateInvoiceInputSchema, GenerateInvoiceOutputSchema, type GenerateInvoiceInput, type GenerateInvoiceOutput } from '@/lib/types';


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

      const client = await getClient(contract.clientId);
      if (!client) {
          throw new Error('Client non trouvé.');
      }
      
      const invoicingType = client.invoicingType || 'multi-site';
      
      // For now, let's assume one company for the whole system
      const companies = await getCompanies();
      if (companies.length === 0) {
          throw new Error("Aucune société n'est configurée dans les paramètres.");
      }
      const company = companies[0];


      // Determine billing factor based on contract schedule
      let billingFactor = 1;
      let scheduleLabel = "Annuel";
      switch (contract.billingSchedule) {
        case 'Mensuel':
            billingFactor = 1 / 12;
            scheduleLabel = "Mensuel";
            break;
        case 'Trimestriel':
            billingFactor = 1 / 4;
            scheduleLabel = "Trimestriel";
            break;
        case 'Semestriel':
            billingFactor = 1 / 2;
            scheduleLabel = "Semestriel";
            break;
        case 'Annuel':
            billingFactor = 1;
            scheduleLabel = "Annuel";
            break;
        // The default of 1 covers 'Annuel' and any other cases.
      }


      const sites = await getSitesByClient(contract.clientId);
      const contractSites = sites.filter(site => contract.siteIds.includes(site.id));
      if (contractSites.length === 0) {
        throw new Error("Aucun site valide n'est associé à ce contrat.");
      }

      const activities = await getActivities();
      const activityMap = new Map(activities.map(a => [a.id, a]));

      let lineItems: InvoiceLineItem[] = [];
      
      if (invoicingType === 'multi-site') {
          for (const site of contractSites) {
            if (!site.amounts || site.amounts.length === 0) continue;

            for (const amountInfo of site.amounts) {
              const activity = activityMap.get(amountInfo.activityId);
              if (activity && contract.activityIds.includes(activity.id)) {
                const lineTotal = amountInfo.amount * billingFactor;
                lineItems.push({
                  description: `Prestation: ${activity.label} (${scheduleLabel}) - Site: ${site.name}`,
                  quantity: 1, 
                  unitPrice: lineTotal,
                  total: lineTotal,
                  siteId: site.id,
                  activityCode: activity.code,
                });
              }
            }
          }
      } else { // 'global' invoicing
          const aggregatedAmounts: Record<string, { activity: any; total: number }> = {};

          for (const site of contractSites) {
              if (!site.amounts || site.amounts.length === 0) continue;
              
              for (const amountInfo of site.amounts) {
                  const activity = activityMap.get(amountInfo.activityId);
                  if (activity && contract.activityIds.includes(activity.id)) {
                      if (!aggregatedAmounts[activity.id]) {
                          aggregatedAmounts[activity.id] = { activity, total: 0 };
                      }
                      aggregatedAmounts[activity.id].total += amountInfo.amount * billingFactor;
                  }
              }
          }

          for (const key in aggregatedAmounts) {
              const { activity, total } = aggregatedAmounts[key];
              lineItems.push({
                  description: `Prestation: ${activity.label} (${scheduleLabel})`,
                  quantity: 1,
                  unitPrice: total,
                  total: total,
                  activityCode: activity.code,
              });
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
      
      const invoiceNumber = await getNextInvoiceNumber(company.code);

      const newInvoice = {
        invoiceNumber,
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

      const savedInvoice = await createInvoice(newInvoice);

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
