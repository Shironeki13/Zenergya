
'use client';

import { useSearchParams } from 'next/navigation';
import React, { useEffect, useState, Suspense, useMemo } from 'react';
import type { Invoice, Client, Company, InvoiceStatus, InvoiceLineItem } from '@/lib/types';
import { Logo } from '@/components/logo';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Printer, Loader2 } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

function PrintContent() {
  const searchParams = useSearchParams();
  const invoiceId = searchParams.get('invoiceId');
  const clientId = searchParams.get('clientId');
  const companyId = searchParams.get('companyId');

  const [data, setData] = useState<{ invoice: Invoice; client: Client; company: Company } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!invoiceId || !clientId || !companyId) {
      setError("Informations manquantes pour charger la facture.");
      setIsLoading(false);
      return;
    }

    async function fetchData() {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/generate-pdf?invoiceId=${invoiceId}&clientId=${clientId}&companyId=${companyId}`);
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Erreur lors du chargement des données.');
        }
        const fetchedData = await response.json();
        setData(fetchedData);
        // Automatically trigger print dialog once data is loaded
        setTimeout(() => window.print(), 500);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Une erreur inconnue est survenue.');
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [invoiceId, clientId, companyId]);
  
  const groupedLineItems = useMemo(() => {
    if (!data) return {};
    return data.invoice.lineItems.reduce((acc, item) => {
        const key = item.activityCode || 'divers';
        if (!acc[key]) {
            acc[key] = [];
        }
        acc[key].push(item);
        return acc;
    }, {} as Record<string, InvoiceLineItem[]>);
  }, [data]);


  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Chargement de la facture...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="p-8 text-center text-red-500">Erreur : {error}</div>;
  }

  if (!data) {
    return <div className="p-8 text-center">Aucune donnée à afficher.</div>;
  }

  const { invoice, client, company } = data;

  const getBadgeVariant = (status: InvoiceStatus) => {
    switch (status) {
      case 'paid': return 'secondary';
      case 'due': return 'outline';
      case 'overdue': return 'destructive';
      default: return 'default';
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
    <>
      <div className="p-4 sm:p-8 A4-container bg-white text-black shadow-lg print:shadow-none">
        <header className="flex justify-between items-start pb-8">
          <div>
            {company?.logoUrl ? <img src={company.logoUrl} alt={company.name} className="h-12 w-auto object-contain" /> : <Logo />}
            <p className="text-gray-500 text-sm mt-4">
              {company?.name}<br />
              {company?.address}<br />
              {company?.postalCode} {company?.city}
            </p>
          </div>
          <div className="text-right">
            <h1 className="text-3xl font-bold text-primary">FACTURE</h1>
            <p className="text-gray-500">{invoice.invoiceNumber}</p>
            <Badge variant={getBadgeVariant(invoice.status)} className="mt-2 text-xs">
              {translateStatus(invoice.status).toUpperCase()}
            </Badge>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-4 py-8">
          <div>
            <h2 className="font-semibold text-xs mb-1 text-gray-500 tracking-wider">FACTURÉ À</h2>
            <p className="font-bold text-base">{client?.name}</p>
            <p className="text-gray-600 text-sm">
              {client?.address}<br />
              {client?.postalCode} {client?.city}
            </p>
          </div>
          <div className="text-right space-y-1">
            <p><span className="font-semibold text-sm">Date de facturation :</span> <span className="text-gray-600 text-sm">{new Date(invoice.date).toLocaleDateString()}</span></p>
            <p><span className="font-semibold text-sm">Date d'échéance :</span> <span className="text-gray-600 text-sm">{new Date(invoice.dueDate).toLocaleDateString()}</span></p>
             {invoice.periodStartDate && invoice.periodEndDate && (
               <p><span className="font-semibold text-sm">Période de service :</span> <span className="text-gray-600 text-sm">{new Date(invoice.periodStartDate).toLocaleDateString()} - {new Date(invoice.periodEndDate).toLocaleDateString()}</span></p>
            )}
          </div>
        </section>

        <section>
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50 print:bg-gray-50">
                <TableHead className="w-[60%]">Description</TableHead>
                <TableHead>Qté</TableHead>
                <TableHead>P.U.</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
               {Object.entries(groupedLineItems).map(([activityCode, items]) => (
                <React.Fragment key={activityCode}>
                  <TableRow className="border-b-0">
                    <TableCell colSpan={4} className="p-2 bg-gray-100 print:bg-gray-100">
                      <h3 className="font-semibold text-sm">Prestations {activityCode}</h3>
                    </TableCell>
                  </TableRow>
                  {items.map((item, index) => (
                    <TableRow key={index} className="border-b">
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
                    <TableCell colSpan={4}><Separator className="my-2 bg-gray-300" /></TableCell>
                </TableRow>
              <TableRow>
                <TableCell colSpan={3} className="text-right font-semibold py-2">Sous-total</TableCell>
                <TableCell className="text-right font-medium py-2">{invoice.subtotal.toFixed(2)} €</TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={3} className="text-right font-semibold py-2">TVA (10%)</TableCell>
                <TableCell className="text-right font-medium py-2">{invoice.tax.toFixed(2)} €</TableCell>
              </TableRow>
              <TableRow className="text-lg font-bold border-t-2 border-black">
                <TableCell colSpan={3} className="text-right py-3 text-base">Total</TableCell>
                <TableCell className="text-right text-primary text-xl py-3">{invoice.total.toFixed(2)} €</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </section>

        <footer className="mt-8 pt-8 border-t text-center">
            <p className="text-gray-500 text-xs">
              Merci de votre confiance !
            </p>
            <p className="text-gray-500 text-xs mt-1">
              Paiement sous 30 jours. Les retards sont soumis à des frais de 1,5%/mois.
            </p>
        </footer>
      </div>
      <div className="fixed top-4 right-4 print:hidden">
          <Button onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            Imprimer la facture
          </Button>
      </div>
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        
        body {
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          font-family: 'Inter', sans-serif;
          background-color: #e5e7eb;
        }

        .text-primary {
          color: hsl(var(--primary));
        }
        
        @media print {
          body {
            background-color: #fff;
          }
          .A4-container {
            width: 210mm;
            height: 297mm;
            margin: 0;
            padding: 15mm;
            box-shadow: none;
            border: none;
          }
        }
        @page {
          size: A4;
          margin: 0;
        }
        .A4-container {
          width: 210mm;
          min-height: 297mm;
          margin: 1rem auto;
        }
      `}</style>
    </>
  );
}

export default function PrintPage() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
            <PrintContent />
        </Suspense>
    )
}
