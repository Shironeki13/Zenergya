
'use client';

import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getInvoice, getCompanies, getClient } from '@/services/firestore';
import type { Invoice, Client, Company } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, Mail, Printer } from 'lucide-react';
import { Logo } from '@/components/logo';

export default function InvoiceDetailPage() {
  const params = useParams();
  const invoiceId = params.id as string;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        if (!invoiceId) return;
        const invoiceData = await getInvoice(invoiceId);
        if (!invoiceData) {
          notFound();
          return;
        }
        setInvoice(invoiceData);

        const [clientData, companiesData] = await Promise.all([
          getClient(invoiceData.clientId),
          getCompanies(),
        ]);

        if (!clientData) {
          console.error("Client not found for this invoice.");
          setClient(null);
        } else {
          setClient(clientData);
        }
        
        if (companiesData && companiesData.length > 0) {
            // Find the correct company. Assuming there's a relation, but for now we'll find it.
            // This assumes a single company context, or you'd need a way to determine which company issued the invoice.
            // For this app, we'll assume the first company is the one. A real app might have companyId on the invoice.
            setCompany(companiesData[0]);
        } else {
            console.error("No company configured.");
        }

      } catch (error) {
        console.error("Failed to fetch invoice data:", error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [invoiceId]);

  const handleDownloadPdf = () => {
    if (!invoice || !client || !company) return;
    const url = `/api/generate-pdf?invoiceId=${invoice.id}&clientId=${client.id}&companyId=${company.id}`;
    window.open(url, '_blank');
  };

  if (isLoading) {
    return <div>Chargement de la facture...</div>;
  }

  if (!invoice) {
    return <div>Facture non trouvée.</div>;
  }
  
  if (!company) {
    return <div>Erreur: Aucune société configurée.</div>;
  }
  
  if (!client) {
    return <div>Erreur: Client non trouvé pour cette facture.</div>;
  }

  const getBadgeVariant = (status: typeof invoice.status) => {
    switch (status) {
      case 'paid':
        return 'secondary';
      case 'due':
        return 'outline';
      case 'overdue':
        return 'destructive';
      default:
        return 'default';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button asChild variant="outline" size="icon" className="h-7 w-7">
          <Link href="/invoices">
            <ChevronLeft className="h-4 w-4" />
            <span className="sr-only">Retour</span>
          </Link>
        </Button>
        <h1 className="text-lg font-semibold md:text-2xl">Facture {invoice.invoiceNumber}</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Mail className="h-4 w-4 mr-2" />
            Envoyer par email
          </Button>
          <Button size="sm" onClick={handleDownloadPdf}>
            <Printer className="h-4 w-4 mr-2" />
            Télécharger en PDF
          </Button>
        </div>
      </div>
      <div className="p-8 rounded-lg border bg-card text-card-foreground shadow-sm max-w-4xl mx-auto">
        <header className="flex justify-between items-start pb-8">
          <div>
            {company?.logoUrl ? <img src={company.logoUrl} alt={company.name} className="h-16 w-auto object-contain" /> : <Logo />}
            <p className="text-muted-foreground text-sm mt-2">
              {company?.name}<br />
              {company?.address}<br/>
              {company?.postalCode} {company?.city}
            </p>
          </div>
          <div className="text-right">
            <h1 className="text-2xl font-bold text-primary">FACTURE</h1>
            <p className="text-muted-foreground">{invoice.invoiceNumber}</p>
            <Badge variant={getBadgeVariant(invoice.status)} className="mt-2">
              {invoice.status.toUpperCase()}
            </Badge>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-4 pb-8">
          <div>
            <h2 className="font-semibold text-sm mb-1">FACTURÉ À</h2>
            <p className="font-bold">{client?.name}</p>
            <p className="text-muted-foreground text-sm">
                {client?.address}<br/>
                {client?.postalCode} {client?.city}
            </p>
          </div>
          <div className="text-right">
            <p><span className="font-semibold text-sm">Date de facturation :</span> {new Date(invoice.date).toLocaleDateString()}</p>
            <p><span className="font-semibold text-sm">Date d'échéance :</span> {new Date(invoice.dueDate).toLocaleDateString()}</p>
          </div>
        </section>

        <section>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60%]">Description</TableHead>
                <TableHead>Quantité</TableHead>
                <TableHead>Prix Unitaire</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.lineItems.map((item, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">{item.description}</TableCell>
                  <TableCell>{item.quantity}</TableCell>
                  <TableCell>{item.unitPrice.toFixed(2)} €</TableCell>
                  <TableCell className="text-right">{item.total.toFixed(2)} €</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="text-right font-semibold">Sous-total</TableCell>
                <TableCell className="text-right">{invoice.subtotal.toFixed(2)} €</TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={3} className="text-right font-semibold">TVA (10%)</TableCell>
                <TableCell className="text-right">{invoice.tax.toFixed(2)} €</TableCell>
              </TableRow>
              <TableRow className="text-lg font-bold">
                <TableCell colSpan={3} className="text-right">Total</TableCell>
                <TableCell className="text-right text-primary">{invoice.total.toFixed(2)} €</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </section>

        <footer className="mt-8 pt-8 border-t">
            <h3 className="font-semibold text-sm mb-2">Conditions de paiement</h3>
            <p className="text-muted-foreground text-sm">
              Paiement sous 30 jours à compter de la date de facturation. Les retards de paiement sont soumis à des frais mensuels de 1,5%.
              <br/>Merci de votre confiance !
            </p>
        </footer>
      </div>
    </div>
  );
}
