
import { NextRequest, NextResponse } from 'next/server';
import { getInvoice, getClient, getCompany } from '@/services/firestore-admin';
import { AuthError, requireUser } from '@/lib/auth/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    await requireUser();
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 401;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }

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

    const company = await getCompany(companyId);
    if (!company) {
      return new NextResponse(
        JSON.stringify({ error: `Société non trouvée avec ID: ${companyId}` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Return all data needed for the print page
    return NextResponse.json({ invoice, client, company });

  } catch (error) {
    console.error("Erreur API lors de la récupération des données de la facture:", error);
    return new NextResponse(
      JSON.stringify({ error: "Erreur serveur lors de la récupération de la facture." }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
