
'use server';

import { getInvoice, getClient, getCompany } from '@/services/firestore';
import { generateInvoicePdf as generatePdf } from '@/services/pdf';

export async function generatePdfAction(formData: FormData) {
  const invoiceId = formData.get('invoiceId') as string;
  const clientId = formData.get('clientId') as string;
  const companyId = formData.get('companyId') as string;

  if (!invoiceId || !clientId || !companyId) {
    return new Response("ID manquants pour la génération du PDF.", { status: 400 });
  }

  const invoice = await getInvoice(invoiceId);
  if (!invoice) {
    return new Response("Facture non trouvée.", { status: 404 });
  }

  const client = await getClient(clientId);
   if (!client) {
    return new Response("Client non trouvé.", { status: 404 });
  }

  const companies = await getCompany();
  const company = companies.find(c => c.id === companyId);
   if (!company) {
    return new Response("Société non trouvée.", { status: 404 });
  }
  
  return generatePdf(invoice, client, company);
}
