
'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { PlusCircle, MoreHorizontal, Loader2, Download, Search, UploadCloud } from 'lucide-react';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { useData } from '@/context/data-context';
import type { Contract } from '@/lib/types';
import { downloadCSV } from '@/lib/utils';

export default function ContractLibraryPage() {
  const { contracts, isLoading } = useData();
  const [searchTerm, setSearchTerm] = useState('');

  const filteredContracts = useMemo(() => {
    if (!searchTerm) {
      return contracts;
    }
    return contracts.filter(contract =>
      contract.clientName.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [contracts, searchTerm]);

  const handleExport = () => {
    const dataToExport = filteredContracts.map(({ id, ...rest }) => ({
        ...rest,
        siteIds: rest.siteIds.join('; '),
        activityIds: rest.activityIds.join('; '),
    }));
    downloadCSV(dataToExport, 'contratheque.csv');
  };

  const getBadgeVariant = (status: Contract['status']): 'secondary' | 'destructive' | 'warning' | 'outline' => {
      switch (status) {
        case 'Actif':
          return 'secondary';
        case 'Résilié':
          return 'destructive';
        case 'Terminé':
          return 'warning';
        default:
          return 'outline';
      }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>Contrathèque</CardTitle>
            <CardDescription>
              Gérez et analysez tous vos documents contractuels.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Rechercher un contrat..."
                className="pl-8 sm:w-[300px]"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
             <Button size="sm" variant="outline" className="gap-1" onClick={handleExport}>
              <Download className="h-4 w-4" />
              Exporter
            </Button>
            <Button size="sm" className="gap-1" disabled>
              <UploadCloud className="h-4 w-4" />
              Ajouter un Contrat PDF
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Date de début</TableHead>
              <TableHead>Date de fin</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : filteredContracts.length > 0 ? (
              filteredContracts.map((contract) => (
                <TableRow key={contract.id}>
                  <TableCell className="font-medium">{contract.clientName}</TableCell>
                  <TableCell>
                    <Badge variant={getBadgeVariant(contract.status)}>
                      {contract.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{new Date(contract.startDate).toLocaleDateString()}</TableCell>
                  <TableCell>
                    {contract.status === 'Résilié' && contract.terminationDate 
                      ? new Date(contract.terminationDate).toLocaleDateString() 
                      : new Date(contract.endDate).toLocaleDateString()
                    }
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="icon">
                        <Link href={`/contracts/${contract.id}`}>
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Voir les détails</span>
                        </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="text-center h-24">Aucun contrat trouvé.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
