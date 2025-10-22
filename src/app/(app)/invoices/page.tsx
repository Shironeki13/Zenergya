
'use client';

import Link from 'next/link';
import { MoreHorizontal, Loader2, FilePlus, MinusCircle } from 'lucide-react';
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
import { useState } from 'react';
import { generateCreditNote } from '@/ai/flows/generate-credit-note-flow';


export default function InvoicesPage() {
  const { invoices, creditNotes, isLoading, reloadData } = useData();
  const { toast } = useToast();
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);


  const handleSelectionChange = (invoiceId: string, checked: boolean) => {
    setSelectedInvoiceIds(prev =>
      checked ? [...prev, invoiceId] : prev.filter(id => id !== invoiceId)
    );
  };
  
  const handleSelectAll = (checked: boolean) => {
      const cancellableInvoices = invoices.filter(inv => inv.status !== 'proforma' && inv.status !== 'cancelled').map(inv => inv.id);
      if (checked) {
          setSelectedInvoiceIds(cancellableInvoices);
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
              reason: 'Annulation demandée par le client.', // Placeholder reason
              creditNoteDate: new Date().toISOString(),
          });
          if (result.success && result.creditNoteId) {
              toast({ title: "Avoir généré", description: `L'avoir ${result.creditNoteId} a été créé.` });
              setSelectedInvoiceIds([]);
              await reloadData();
          } else {
              throw new Error(result.error || "Une erreur inconnue est survenue.");
          }
      } catch (error) {
          toast({ title: "Erreur de génération", description: error instanceof Error ? error.message : String(error), variant: 'destructive'});
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
  
  const allDocuments = [
    ...invoices.map(i => ({ ...i, type: 'invoice' as const })),
    ...creditNotes.map(cn => ({ ...cn, type: 'credit_note' as const }))
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());


  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Factures & Avoirs</CardTitle>
            <CardDescription>
              Liste de tous les documents de facturation.
            </CardDescription>
          </div>
           {selectedInvoiceIds.length > 0 && (
              <Button size="sm" className="gap-1" onClick={handleGenerateCreditNote} disabled={isGenerating}>
                  {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <MinusCircle className="h-4 w-4" />}
                  Générer un Avoir ({selectedInvoiceIds.length})
              </Button>
            )}
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">
                <Checkbox
                  onCheckedChange={handleSelectAll}
                  checked={selectedInvoiceIds.length > 0 && selectedInvoiceIds.length === invoices.filter(inv => inv.status !== 'proforma' && inv.status !== 'cancelled').length}
                  aria-label="Tout sélectionner"
                />
              </TableHead>
              <TableHead>N° Document</TableHead>
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
            ) : allDocuments.length > 0 ? (
                allDocuments.map((doc) => (
                <TableRow key={doc.id}>
                    <TableCell>
                      {doc.type === 'invoice' && doc.status !== 'proforma' && doc.status !== 'cancelled' && (
                        <Checkbox
                          checked={selectedInvoiceIds.includes(doc.id)}
                          onCheckedChange={(checked) => handleSelectionChange(doc.id, !!checked)}
                        />
                      )}
                    </TableCell>
                    <TableCell className="font-medium">
                      {doc.type === 'invoice' ? (doc.invoiceNumber || `Proforma ${doc.id.substring(0,6)}`) : doc.creditNoteNumber}
                      {doc.type === 'credit_note' && <span className="text-xs text-muted-foreground ml-1">(Avoir)</span>}
                    </TableCell>
                    <TableCell>{doc.clientName}</TableCell>
                    <TableCell>
                     {doc.type === 'invoice' ? (
                       <Badge variant={getBadgeVariant(doc.status)}>
                           {translateStatus(doc.status)}
                       </Badge>
                     ) : (
                       <Badge variant="default">Finalisé</Badge>
                     )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {new Date(doc.date).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right" style={{color: doc.type === 'credit_note' ? 'hsl(var(--destructive))' : undefined}}>
                      {doc.total.toFixed(2)} €
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
                            <Link href={`/invoices/${doc.id}`}>Voir les détails</Link>
                        </DropdownMenuItem>
                        {doc.type === 'invoice' && doc.status === 'due' && <DropdownMenuItem>Marquer comme payée</DropdownMenuItem>}
                        {doc.type === 'invoice' && doc.status === 'due' && <DropdownMenuItem>Envoyer un rappel</DropdownMenuItem>}
                        {doc.type === 'invoice' && doc.status === 'proforma' && <DropdownMenuItem>Convertir en facture</DropdownMenuItem>}
                        </DropdownMenuContent>
                    </DropdownMenu>
                    </TableCell>
                </TableRow>
                ))
            ) : (
                <TableRow>
                    <TableCell colSpan={7} className="text-center h-24">Aucun document trouvé.</TableCell>
                </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
