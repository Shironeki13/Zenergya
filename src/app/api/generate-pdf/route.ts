
import { NextRequest, NextResponse } from 'next/server';
import { getInvoice, getClient, getCompanies } from '@/services/firestore';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const invoiceId = searchParams.get('invoiceId');
  const clientId = searchParams.get('clientId');
  const companyId = searchParams.get('companyId');

  if (!invoiceId || !clientId || !companyId) {
    return new NextResponse(
      JSON.stringify({ error: "ID manquants pour la génération du PDF." }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const invoice = await getInvoice(invoiceId);
    if (!invoice) {
      return new NextResponse(
        JSON.stringify({ error: `Facture non trouvée avec ID: ${invoiceId}` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const client = await getClient(clientId);
    if (!client) {
      return new NextResponse(
        JSON.stringify({ error: `Client non trouvé avec ID: ${clientId}` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const companies = await getCompanies();
    const company = companies.find(c => c.id === companyId);
    if (!company) {
      return new NextResponse(
        JSON.stringify({ error: `Société non trouvée avec ID: ${companyId}` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Return all data needed for the print page
    return NextResponse.json({ invoice, client, company });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Une erreur inconnue est survenue.";
    console.error("Erreur API lors de la récupération des données de la facture:", errorMessage, error);
    return new NextResponse(
      JSON.stringify({ error: `Erreur serveur: ${errorMessage}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
