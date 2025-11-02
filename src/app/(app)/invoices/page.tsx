
'use client';

import Link from 'next/link';
import { MoreHorizontal, Loader2, MinusCircle, Search } from 'lucide-react';
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
import { Checkbox } from '@/components/ui/checkbox';
import type { InvoiceStatus, Invoice } from '@/lib/types';
import { useData } from '@/context/data-context';
import { useToast } from '@/hooks/use-toast';
import { useState, useMemo } from 'react';
import { generateCreditNote } from '@/ai/flows/generate-credit-note-flow';
import { Input } from '@/components/ui/input';


export default function InvoicesPage() {
  const { invoices, isLoading, reloadData } = useData();
  const { toast } = useToast();
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const sortedInvoices = useMemo(() => 
    [...invoices].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [invoices]
  );
  
  const filteredInvoices = useMemo(() => {
    if (!searchTerm) {
      return sortedInvoices;
    }
    return sortedInvoices.filter(invoice => 
      (invoice.invoiceNumber && invoice.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase())) ||
      invoice.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      invoice.id.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [sortedInvoices, searchTerm]);
  
  const cancellableInvoices = useMemo(() => 
    filteredInvoices.filter(inv => inv.status !== 'proforma' && inv.status !== 'cancelled'),
    [filteredInvoices]
  );


  const handleSelectionChange = (invoiceId: string, checked: boolean) => {
    setSelectedInvoiceIds(prev =>
      checked ? [...prev, invoiceId] : prev.filter(id => id !== invoiceId)
    );
  };
  
  const handleSelectAll = (checked: boolean) => {
      if (checked) {
          setSelectedInvoiceIds(cancellableInvoices.map(inv => inv.id));
      } else {
          setSelectedInvoiceIds([]);
      }
  };

  const handleGenerateCreditNote = async () => {
      if (selectedInvoiceIds.length === 0) {
          toast({ title: "Aucune facture sélectionnée", description: "Veuillez sélectionner au moins une facture à annuler.", variant: 'destructive' });
          return;
      }
      setIsGenerating(true);
      try {
          const result = await generateCreditNote({
              invoiceIds: selectedInvoiceIds,
              reason: 'Annulation demandée par l\'utilisateur.', // Placeholder reason
              creditNoteDate: new Date().toISOString(),
          });
          if (result.success && result.creditNoteId) {
              toast({ title: "Avoir généré", description: `L'avoir ${result.creditNoteId} a été créé.` });
              setSelectedInvoiceIds([]);
              await reloadData();
          } else {
              throw new Error(result.error || "Une erreur inconnue est survenue lors de la création de l'avoir.");
          }
      } catch (error) {
          toast({ title: "Erreur de génération", description: error instanceof Error ? error.message : String(error), variant: 'destructive', duration: 10000});
      } finally {
          setIsGenerating(false);
      }
  };


  const getBadgeVariant = (status: InvoiceStatus) => {
    switch (status) {
      case 'paid':
        return 'secondary';
      case 'due':
        return 'outline';
      case 'overdue':
        return 'destructive';
      case 'cancelled':
        return 'warning';
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
      case 'cancelled':
        return 'Annulée';
      default:
        return status;
    }
  };


  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>Factures</CardTitle>
            <CardDescription>
              Liste de toutes les factures.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
             <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Rechercher..."
                className="pl-8 sm:w-[300px]"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            {selectedInvoiceIds.length > 0 && (
              <Button size="sm" className="gap-1" onClick={handleGenerateCreditNote} disabled={isGenerating}>
                  {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <MinusCircle className="h-4 w-4" />}
                  Générer un Avoir ({selectedInvoiceIds.length})
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">
                <Checkbox
                  onCheckedChange={(checked) => handleSelectAll(!!checked)}
                  checked={selectedInvoiceIds.length > 0 && cancellableInvoices.length > 0 && selectedInvoiceIds.length === cancellableInvoices.length}
                  aria-label="Tout sélectionner"
                  disabled={cancellableInvoices.length === 0}
                />
              </TableHead>
              <TableHead>N° Facture</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="hidden md:table-cell">Date</TableHead>
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
            ) : filteredInvoices.length > 0 ? (
                filteredInvoices.map((invoice) => (
                <TableRow key={invoice.id}>
                    <TableCell>
                      {invoice.status !== 'proforma' && invoice.status !== 'cancelled' && (
                        <Checkbox
                          checked={selectedInvoiceIds.includes(invoice.id)}
                          onCheckedChange={(checked) => handleSelectionChange(invoice.id, !!checked)}
                        />
                      )}
                    </TableCell>
                    <TableCell className="font-medium">
                      {invoice.invoiceNumber || `Proforma ${invoice.id.substring(0,6)}`}
                    </TableCell>
                    <TableCell>{invoice.clientName}</TableCell>
                    <TableCell>
                       <Badge variant={getBadgeVariant(invoice.status)}>
                           {translateStatus(invoice.status)}
                       </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {new Date(invoice.date).toLocaleDateString()}
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
                        {invoice.status === 'due' && <DropdownMenuItem>Marquer comme payée</DropdownMenuItem>}
                        {invoice.status === 'due' && <DropdownMenuItem>Envoyer un rappel</DropdownMenuItem>}
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
