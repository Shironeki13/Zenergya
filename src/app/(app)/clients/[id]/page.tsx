
'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronLeft, PlusCircle, Eye, Loader2 } from 'lucide-react';
import { getClient, getContractsByClient } from '@/services/firestore';
import type { Client, Contract } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { AttachContractDialog } from '@/components/attach-contract-dialog';

export default function ClientDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { toast } = useToast();

  const [client, setClient] = useState<Client | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchContracts = useCallback(async () => {
    try {
      const clientContracts = await getContractsByClient(id);
      setContracts(clientContracts);
    } catch (error) {
      console.error("Failed to fetch contracts", error);
    }
  }, [id]);

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      try {
        const [clientData] = await Promise.all([
          getClient(id),
        ]);

        if (!clientData) {
          notFound();
          return;
        }
        setClient(clientData);
        await fetchContracts();
      } catch (error) {
        console.error("Failed to fetch data for client detail page", error);
        toast({ title: "Erreur", description: "Impossible de charger les données de la page.", variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [id, toast, fetchContracts]);

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  if (!client) {
    return notFound();
  }

  return (
    <div className="grid gap-4 md:gap-8">
      <div className="flex items-center gap-4">
        <Link href="/clients">
          <Button variant="outline" size="icon" className="h-7 w-7">
            <ChevronLeft className="h-4 w-4" />
            <span className="sr-only">Retour</span>
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-semibold">{client.name}</h1>
          <p className="text-sm text-muted-foreground">{client.address || ''}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Contrats</CardTitle>
              <CardDescription>
                Liste des contrats rattachés à ce client.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <AttachContractDialog client={client} onContractAttached={fetchContracts} />
              <Link href={`/contracts/new?clientId=${client.id}`}>
                <Button size="sm" variant="outline" className="gap-1">
                  <PlusCircle className="h-4 w-4" />
                  Nouveau
                </Button>
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Référence</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Date de début</TableHead>
                <TableHead>Date de fin</TableHead>
                <TableHead>Nb Sites</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contracts.length > 0 ? (
                contracts.map((contract) => (
                  <TableRow key={contract.id}>
                    <TableCell className="font-medium">{contract.id.substring(0, 8)}...</TableCell>
                    <TableCell>
                      <Badge variant={contract.status === 'Actif' ? 'default' : 'secondary'}>
                        {contract.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{contract.startDate ? new Date(contract.startDate).toLocaleDateString() : '-'}</TableCell>
                    <TableCell>{contract.endDate ? new Date(contract.endDate).toLocaleDateString() : '-'}</TableCell>
                    <TableCell>{contract.siteIds?.length || 0}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/contracts/${contract.id}`}>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center">
                    Aucun contrat n'est rattaché à ce client.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
