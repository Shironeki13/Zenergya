
'use client';

import Link from 'next/link';
import { PlusCircle, MoreHorizontal, Loader2, Download, Search } from 'lucide-react';
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
import { downloadCSV } from '@/lib/utils';


export default function ClientsPage() {
  const { clients, typologies, isLoading } = useData();
  const [searchTerm, setSearchTerm] = useState('');

  const filteredClients = useMemo(() => {
    const typologyMap = new Map(typologies.map(t => [t.id, t.name]));
    
    let clientsWithTypology = clients.map(client => ({
      ...client,
      typologyName: typologyMap.get(client.typologyId) || 'N/A',
    }));

    if (!searchTerm) {
      return clientsWithTypology;
    }

    return clientsWithTypology.filter(client =>
      client.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [clients, typologies, searchTerm]);

  const handleExport = () => {
    const dataToExport = filteredClients.map(({ id, ...rest }) => rest);
    downloadCSV(dataToExport, 'clients.csv');
  };
  
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>Clients</CardTitle>
            <CardDescription>
              Gérez les entités clientes et leurs sites.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Rechercher un client..."
                className="pl-8 sm:w-[300px]"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Button asChild size="sm" className="gap-1">
              <Link href="/clients/new">
                <PlusCircle className="h-4 w-4" />
                <span className="hidden sm:inline">Nouveau Client</span>
              </Link>
            </Button>
            <Button size="sm" variant="outline" className="gap-1" onClick={handleExport}>
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Exporter</span>
            </Button>
          </div>
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
            ) : filteredClients.length > 0 ? (
                filteredClients.map((client) => (
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
