import Link from 'next/link';
import { MoreHorizontal } from 'lucide-react';
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
import { getInvoices } from '@/services/firestore';
import type { InvoiceStatus, Invoice } from '@/lib/types';

export default async function InvoicesPage() {
  const invoices = await getInvoices();

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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Factures</CardTitle>
            <CardDescription>
              Liste de toutes les factures pour tous les clients.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID Facture</TableHead>
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
            {invoices.map((invoice: Invoice) => (
              <TableRow key={invoice.id}>
                <TableCell className="font-medium">{invoice.id}</TableCell>
                <TableCell>{invoice.clientName}</TableCell>
                <TableCell>
                  <Badge variant={getBadgeVariant(invoice.status)}>
                    {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                  </Badge>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {new Date(invoice.date).toLocaleDateString()}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {new Date(invoice.dueDate).toLocaleDateString()}
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
                      <DropdownMenuItem>Marquer comme payée</DropdownMenuItem>
                      <DropdownMenuItem>Envoyer un rappel</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
