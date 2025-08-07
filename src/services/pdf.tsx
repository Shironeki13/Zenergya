
'use server';

import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { InvoicePDF } from '@/components/invoice-pdf';
import type { Invoice, Client, Company } from '@/lib/types';

export async function generateInvoicePdf(invoice: Invoice, client: Client, company: Company) {
    try {
        const buffer = await renderToBuffer(<InvoicePDF invoice={invoice} client={client} company={company} />);
        
        const responseHeaders = new Headers();
        responseHeaders.set('Content-Type', 'application/pdf');
        responseHeaders.set('Content-Disposition', `attachment; filename="facture-${invoice.invoiceNumber || invoice.id}.pdf"`);

        return new Response(buffer, {
            status: 200,
            headers: responseHeaders,
        });
    } catch (error) {
        console.error("Error generating PDF:", error);
        return new Response("Erreur lors de la génération du PDF.", { status: 500 });
    }
}
