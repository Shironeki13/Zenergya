
'use client';

import Link from 'next/link';
import { MoreHorizontal, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { InvoiceStatus, Invoice } from '@/lib/types';
import { useData } from '@/context/data-context';

export default function InvoicesPage() {
  const { invoices, isLoading } = useData();

  const getBadgeVariant = (status: InvoiceStatus) => {
    switch (status) {
      case 'paid':
        return 'secondary';
      case 'due':
        return 'outline';
      case 'overdue':
        return 'destructive';
      case 'proforma':
          return 'default';
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
      case 'proforma':
        return 'Proforma';
      default:
        return status;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Factures & Proformas</CardTitle>
            <CardDescription>
              Liste de tous les documents de facturation.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>N° Document</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="hidden md:table-cell">Date</TableHead>
              <TableHead className="hidden md:table-cell">Date d'échéance</TableHead>
              <TableHead className="text-right">Montant</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
                <TableRow>
                    <TableCell colSpan={7} className="text-center h-24">
                       <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                    </TableCell>
                </TableRow>
            ) : invoices.length > 0 ? (
                invoices.map((invoice: Invoice) => (
                <TableRow key={invoice.id}>
                    <TableCell className="font-medium">{invoice.invoiceNumber || invoice.id}</TableCell>
                    <TableCell>{invoice.clientName}</TableCell>
                    <TableCell>
                    <Badge variant={getBadgeVariant(invoice.status)}>
                        {translateStatus(invoice.status)}
                    </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                    {new Date(invoice.date).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                    {invoice.status !== 'proforma' ? new Date(invoice.dueDate).toLocaleDateString() : 'N/A'}
                    </TableCell>
                    <TableCell className="text-right">
                    {invoice.total.toFixed(2)} €
                    </TableCell>
                    <TableCell>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                        <Button aria-haspopup="true" size="icon" variant="ghost">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Ouvrir le menu</span>
                        </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem asChild>
                            <Link href={`/invoices/${invoice.id}`}>Voir les détails</Link>
                        </DropdownMenuItem>
                        {invoice.status !== 'proforma' && <DropdownMenuItem>Marquer comme payée</DropdownMenuItem>}
                        {invoice.status !== 'proforma' && <DropdownMenuItem>Envoyer un rappel</DropdownMenuItem>}
                        {invoice.status === 'proforma' && <DropdownMenuItem>Convertir en facture</DropdownMenuItem>}
                        </DropdownMenuContent>
                    </DropdownMenu>
                    </TableCell>
                </TableRow>
                ))
            ) : (
                <TableRow>
                    <TableCell colSpan={7} className="text-center h-24">Aucune facture trouvée.</TableCell>
                </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
