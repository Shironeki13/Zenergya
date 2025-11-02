
'use client';

import Link from 'next/link';
import { MoreHorizontal, Loader2, PlusCircle, Search, Download } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { useData } from '@/context/data-context';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { downloadCSV } from '@/lib/utils';

export default function CreditNotesPage() {
  const { creditNotes, isLoading } = useData();
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');

  const sortedCreditNotes = useMemo(() => 
    [...creditNotes].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [creditNotes]
  );

  const filteredCreditNotes = useMemo(() => {
    if (!searchTerm) {
      return sortedCreditNotes;
    }
    return sortedCreditNotes.filter(cn =>
      cn.creditNoteNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      cn.clientName.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [sortedCreditNotes, searchTerm]);

  const handleExport = () => {
    const dataToExport = filteredCreditNotes.map(({ lineItems, ...rest }) => ({
        ...rest,
        lineItems: lineItems.map(li => `[${li.description}:${li.total}]`).join('; ')
    }));
    downloadCSV(dataToExport, 'avoirs.csv');
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>Avoirs</CardTitle>
            <CardDescription>
              Liste de tous les avoirs émis.
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
            <Button size="sm" variant="outline" className="gap-1" onClick={handleExport}>
              <Download className="h-4 w-4" />
              Exporter
            </Button>
            <Button size="sm" className="gap-1" onClick={() => router.push('/invoices')}>
              <PlusCircle className="h-4 w-4" />
              Créer un Avoir
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>N° Avoir</TableHead>
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
                <TableCell colSpan={6} className="text-center h-24">
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : filteredCreditNotes.length > 0 ? (
              filteredCreditNotes.map((cn) => (
                <TableRow key={cn.id}>
                  <TableCell className="font-medium">{cn.creditNoteNumber}</TableCell>
                  <TableCell>{cn.clientName}</TableCell>
                  <TableCell>
                    <Badge variant="default">Finalisé</Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {new Date(cn.date).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right" style={{ color: 'hsl(var(--destructive))' }}>
                    {cn.total.toFixed(2)} €
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
                          <Link href={`/invoices/${cn.id}`}>Voir les détails</Link>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center h-24">Aucun avoir trouvé.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
