
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
  getInvoicesByContract,
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
      const { contractId, invoiceDate } = input;
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
      
      const existingInvoices = await getInvoicesByContract(contractId);
      existingInvoices.sort((a, b) => new Date(b.periodEndDate || 0).getTime() - new Date(a.periodEndDate || 0).getTime());
      
      const lastInvoice = existingInvoices[0];
      const contractStartDate = new Date(contract.startDate);
      
      let periodStartDate = lastInvoice ? new Date(lastInvoice.periodEndDate!) : contractStartDate;
      if (lastInvoice) {
        periodStartDate.setDate(periodStartDate.getDate() + 1);
      }

      let periodEndDate = new Date(periodStartDate);
      let billingFactor = 1;
      let scheduleLabel = "Annuel";
      
      switch (contract.billingSchedule) {
        case 'Mensuel':
            billingFactor = 1 / 12;
            scheduleLabel = "Mensuel";
            periodEndDate.setMonth(periodEndDate.getMonth() + 1);
            periodEndDate.setDate(periodEndDate.getDate() - 1);
            break;
        case 'Trimestriel':
            billingFactor = 1 / 4;
            scheduleLabel = "Trimestriel";
            periodEndDate.setMonth(periodEndDate.getMonth() + 3);
            periodEndDate.setDate(periodEndDate.getDate() - 1);
            break;
        case 'Semestriel':
            billingFactor = 1 / 2;
            scheduleLabel = "Semestriel";
            periodEndDate.setMonth(periodEndDate.getMonth() + 6);
            periodEndDate.setDate(periodEndDate.getDate() - 1);
            break;
        case 'Annuel':
        default:
            billingFactor = 1;
            scheduleLabel = "Annuel";
            periodEndDate.setFullYear(periodEndDate.getFullYear() + 1);
            periodEndDate.setDate(periodEndDate.getDate() - 1);
            break;
      }
      
      const contractEndDate = new Date(contract.endDate);
      if (periodEndDate > contractEndDate) {
        periodEndDate = contractEndDate;
      }

      if (periodStartDate > contractEndDate) {
          throw new Error("Toutes les périodes de facturation pour ce contrat ont déjà été facturées.");
      }

      const sites = await getSitesByClient(contract.clientId);
      const contractSites = sites.filter(site => contract.siteIds.includes(site.id));
      if (contractSites.length === 0) {
        throw new Error("Aucun site valide n'est associé à ce contrat.");
      }

      const activities = await getActivities();
      const activityMap = new Map(activities.map(a => [a.id, a]));

      let lineItems: InvoiceLineItem[] = [];
      const periodString = `Période du ${periodStartDate.toLocaleDateString()} au ${periodEndDate.toLocaleDateString()}`;
      
      if (invoicingType === 'multi-site') {
          for (const site of contractSites) {
            if (!site.amounts || site.amounts.length === 0) continue;

            for (const amountInfo of site.amounts) {
              const activity = activityMap.get(amountInfo.activityId);
              if (activity && contract.activityIds.includes(activity.id)) {
                const lineTotal = amountInfo.amount * billingFactor;
                lineItems.push({
                  description: `Prestation: ${activity.label} (${scheduleLabel}) - Site: ${site.name} - ${periodString}`,
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
                  description: `Prestation: ${activity.label} (${scheduleLabel}) - ${periodString}`,
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
      
      const invoiceDateObj = new Date(invoiceDate);
      const dueDate = new Date(invoiceDateObj);
      dueDate.setDate(dueDate.getDate() + 30); // 30 days to pay
      
      const invoiceNumber = await getNextInvoiceNumber(company.code);

      const newInvoice = {
        invoiceNumber,
        contractId: contract.id,
        clientId: contract.clientId,
        clientName: contract.clientName,
        date: invoiceDateObj.toISOString().split('T')[0],
        dueDate: dueDate.toISOString().split('T')[0],
        periodStartDate: periodStartDate.toISOString().split('T')[0],
        periodEndDate: periodEndDate.toISOString().split('T')[0],
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
