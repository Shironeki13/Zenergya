
'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, Loader2, Check, X, Edit, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useData } from '@/context/data-context';
import type { Contract } from '@/lib/types';
import { updateContract } from '@/services/firestore';
import { useToast } from '@/hooks/use-toast';

export default function ContractsValidationPage() {
  const { contracts, isLoading, reloadData } = useData();
  const { toast } = useToast();
  const router = useRouter();

  const pendingContracts = useMemo(() => {
    return contracts.filter(c => c.validationStatus === 'pending_validation');
  }, [contracts]);

  const handleUpdateStatus = async (contractId: string, validationStatus: 'validated' | 'refused') => {
    try {
      const updateData: Partial<Contract> = { validationStatus };
      if (validationStatus === 'validated') {
        updateData.status = 'Actif';
      }
      await updateContract(contractId, updateData);
      toast({
        title: "Statut mis à jour",
        description: `Le contrat a été ${validationStatus === 'validated' ? 'validé' : 'refusé'}.`
      });
      await reloadData();
    } catch (error) {
      toast({
        title: "Erreur",
        description: "La mise à jour du statut a échoué.",
        variant: "destructive"
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-4">
          <ShieldCheck className="h-6 w-6" />
          <div>
            <CardTitle>Validation des Contrats</CardTitle>
            <CardDescription>
              Vérifiez, validez ou refusez les nouvelles bases marché soumises.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Date de Soumission</TableHead>
              <TableHead className="hidden md:table-cell">Date de Début</TableHead>
              <TableHead className="hidden md:table-cell">Date de Fin</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : pendingContracts.length > 0 ? (
              pendingContracts.map((contract) => (
                <TableRow key={contract.id}>
                  <TableCell className="font-medium">{contract.clientName}</TableCell>
                  <TableCell>{new Date().toLocaleDateString()}</TableCell> {/* Placeholder */}
                  <TableCell className="hidden md:table-cell">{new Date(contract.startDate).toLocaleDateString()}</TableCell>
                  <TableCell className="hidden md:table-cell">{new Date(contract.endDate).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleUpdateStatus(contract.id, 'validated')}>
                        <Check className="h-4 w-4 text-green-600" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleUpdateStatus(contract.id, 'refused')}>
                        <X className="h-4 w-4 text-destructive" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                        <Link href={`/contracts/${contract.id}/edit`}>
                            <Edit className="h-4 w-4" />
                        </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="text-center h-24">Aucun contrat en attente de validation.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
