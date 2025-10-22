
'use client';

import Link from 'next/link';
import { PlusCircle, MoreHorizontal, Loader2 } from 'lucide-react';
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
import { getClients, getTypologies } from '@/services/firestore';
import { useEffect, useState, useMemo } from 'react';
import type { Client, Typology } from '@/lib/types';


export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [typologies, setTypologies] = useState<Typology[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [clientsData, typologiesData] = await Promise.all([
          getClients(),
          getTypologies(),
        ]);
        setClients(clientsData);
        setTypologies(typologiesData);
      } catch (error) {
        console.error("Failed to fetch clients data:", error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, []);

  const clientsWithTypology = useMemo(() => {
    const typologyMap = new Map(typologies.map(t => [t.id, t.name]));
    return clients.map(client => ({
      ...client,
      typologyName: typologyMap.get(client.typologyId) || 'N/A',
    }));
  }, [clients, typologies]);
  
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Clients</CardTitle>
            <CardDescription>
              Gérez les entités clientes et leurs sites.
            </CardDescription>
          </div>
          <Button asChild size="sm" className="gap-1">
            <Link href="/clients/new">
              <PlusCircle className="h-4 w-4" />
              Nouveau Client
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Raison Sociale</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Typologie</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
                <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center">
                      <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                    </TableCell>
                </TableRow>
            ) : clients.length > 0 ? (
                clientsWithTypology.map((client) => (
                <TableRow key={client.id}>
                    <TableCell className="font-medium">{client.name}</TableCell>
                    <TableCell>
                        <Badge variant={client.clientType === 'public' ? 'secondary' : 'outline'}>
                            {client.clientType === 'public' ? 'Public' : 'Privé'}
                        </Badge>
                    </TableCell>
                    <TableCell>{client.typologyName}</TableCell>
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
                        <DropdownMenuItem asChild><Link href={`/clients/${client.id}`}>Gérer les sites</Link></DropdownMenuItem>
                        <DropdownMenuItem asChild><Link href={`/clients/${client.id}/edit`}>Modifier</Link></DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive">
                            Supprimer
                        </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    </TableCell>
                </TableRow>
                ))
            ) : (
                <TableRow>
                    <TableCell colSpan={4} className="text-center h-24">Aucun client trouvé.</TableCell>
                </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
