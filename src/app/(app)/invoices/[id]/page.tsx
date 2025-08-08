
'use client';

import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { getInvoice, getCompanies, getClient } from '@/services/firestore';
import type { Invoice, Client, Company, InvoiceStatus, InvoiceLineItem } from '@/lib/types';
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
import { ChevronLeft, Mail, Printer, Loader2 } from 'lucide-react';
import { Logo } from '@/components/logo';
import { Separator } from '@/components/ui/separator';

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
  
  const handlePrint = () => {
    if (!invoice || !client || !company) return;
    const url = `/invoice/print?invoiceId=${invoice.id}&clientId=${client.id}&companyId=${company.id}`;
    window.open(url, '_blank');
  };

  const groupedLineItems = useMemo(() => {
    if (!invoice) return {};
    return invoice.lineItems.reduce((acc, item) => {
        const key = item.activityCode || 'divers';
        if (!acc[key]) {
            acc[key] = [];
        }
        acc[key].push(item);
        return acc;
    }, {} as Record<string, InvoiceLineItem[]>);
  }, [invoice]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
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

  const getBadgeVariant = (status: InvoiceStatus) => {
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
  
  const translateStatus = (status: InvoiceStatus) => {
    switch (status) {
      case 'paid':
        return 'Payée';
      case 'due':
        return 'Due';
      case 'overdue':
        return 'En retard';
      default:
        return status;
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
          <Button size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" />
            Imprimer / PDF
          </Button>
        </div>
      </div>
      <div className="p-8 rounded-lg border bg-card text-card-foreground shadow-sm max-w-4xl mx-auto">
        <header className="flex justify-between items-start pb-8">
          <div>
            {company?.logoUrl ? <img src={company.logoUrl} alt={company.name} className="h-12 w-auto object-contain" /> : <Logo />}
            <p className="text-muted-foreground text-sm mt-4">
              {company?.name}<br />
              {company?.address}<br/>
              {company?.postalCode} {company?.city}
            </p>
          </div>
          <div className="text-right">
            <h1 className="text-3xl font-bold text-primary">FACTURE</h1>
            <p className="text-muted-foreground">{invoice.invoiceNumber}</p>
            <Badge variant={getBadgeVariant(invoice.status)} className="mt-2 text-xs">
              {translateStatus(invoice.status).toUpperCase()}
            </Badge>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-4 py-8">
          <div>
            <h2 className="font-semibold text-xs mb-1 text-muted-foreground tracking-wider">FACTURÉ À</h2>
            <p className="font-bold text-base">{client?.name}</p>
            <p className="text-muted-foreground text-sm">
                {client?.address}<br/>
                {client?.postalCode} {client?.city}
            </p>
          </div>
          <div className="text-right space-y-1">
            <p><span className="font-semibold text-sm">Date de facturation :</span> <span className="text-muted-foreground text-sm">{new Date(invoice.date).toLocaleDateString()}</span></p>
            <p><span className="font-semibold text-sm">Date d'échéance :</span> <span className="text-muted-foreground text-sm">{new Date(invoice.dueDate).toLocaleDateString()}</span></p>
          </div>
        </section>

        <section>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-[60%]">Description</TableHead>
                <TableHead>Qté</TableHead>
                <TableHead>P.U.</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(groupedLineItems).map(([activityCode, items]) => (
                <React.Fragment key={activityCode}>
                  <TableRow>
                    <TableCell colSpan={4} className="p-2 bg-muted/30">
                      <h3 className="font-semibold text-sm">Prestations {activityCode}</h3>
                    </TableCell>
                  </TableRow>
                  {items.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium py-3 pl-4">{item.description}</TableCell>
                      <TableCell className="py-3">{item.quantity}</TableCell>
                      <TableCell className="py-3">{item.unitPrice.toFixed(2)} €</TableCell>
                      <TableCell className="text-right py-3">{item.total.toFixed(2)} €</TableCell>
                    </TableRow>
                  ))}
                </React.Fragment>
              ))}
            </TableBody>
            <TableFooter>
                <TableRow>
                    <TableCell colSpan={4}><Separator className="my-2" /></TableCell>
                </TableRow>
              <TableRow>
                <TableCell colSpan={3} className="text-right font-semibold py-2">Sous-total</TableCell>
                <TableCell className="text-right font-medium py-2">{invoice.subtotal.toFixed(2)} €</TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={3} className="text-right font-semibold py-2">TVA (10%)</TableCell>
                <TableCell className="text-right font-medium py-2">{invoice.tax.toFixed(2)} €</TableCell>
              </TableRow>
              <TableRow className="text-lg font-bold">
                <TableCell colSpan={3} className="text-right py-3 text-base">Total</TableCell>
                <TableCell className="text-right text-primary text-xl py-3">{invoice.total.toFixed(2)} €</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </section>

        <footer className="mt-8 pt-8 border-t text-center">
            <p className="text-muted-foreground text-xs">
              Merci de votre confiance !
            </p>
            <p className="text-muted-foreground text-xs mt-1">
              Paiement sous 30 jours. Les retards sont soumis à des frais de 1,5%/mois.
            </p>
        </footer>
      </div>
    </div>
  );
}
