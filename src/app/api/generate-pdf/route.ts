
import { NextRequest, NextResponse } from 'next/server';
import { getInvoice, getClient, getCompanies } from '@/services/firestore';
import { generateInvoicePdf as generatePdf } from '@/services/pdf';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const invoiceId = searchParams.get('invoiceId');
  const clientId = searchParams.get('clientId');
  const companyId = searchParams.get('companyId');

  if (!invoiceId || !clientId || !companyId) {
    return new NextResponse("ID manquants pour la génération du PDF.", { status: 400 });
  }

  try {
    const invoice = await getInvoice(invoiceId);
    if (!invoice) {
      return new NextResponse(`Facture non trouvée avec ID: ${invoiceId}`, { status: 404 });
    }

    const client = await getClient(clientId);
    if (!client) {
      return new NextResponse(`Client non trouvé avec ID: ${clientId}`, { status: 404 });
    }

    const companies = await getCompanies();
    const company = companies.find(c => c.id === companyId);
    if (!company) {
      return new NextResponse(`Société non trouvée avec ID: ${companyId}`, { status: 404 });
    }
    
    // La fonction generatePdf retourne déjà une Response complète avec headers et buffer
    return generatePdf(invoice, client, company);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Une erreur inconnue est survenue.";
    console.error("Erreur API lors de la génération du PDF:", errorMessage, error);
    return new NextResponse(`Erreur serveur: ${errorMessage}`, { status: 500 });
  }
}
