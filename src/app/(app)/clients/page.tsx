
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
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Clients</h1>
          <p className="text-muted-foreground mt-1">Gérez les entités clientes et leurs sites.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1 bg-background" onClick={handleExport}>
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Exporter</span>
          </Button>
          <Button asChild size="sm" className="gap-1 shadow-md">
            <Link href="/clients/new">
              <PlusCircle className="h-4 w-4" />
              <span className="hidden sm:inline">Nouveau Client</span>
            </Link>
          </Button>
        </div>
      </div>

      <Card className="border-none shadow-md">
        <CardHeader className="pb-4">
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Rechercher par nom..."
              className="pl-9 bg-muted/50 border-none focus-visible:ring-1 focus-visible:ring-primary"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-b border-border/50">
                <TableHead className="w-[300px]">Raison Sociale</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Typologie</TableHead>
                <TableHead className="text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center">
                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                  </TableCell>
                </TableRow>
              ) : filteredClients.length > 0 ? (
                filteredClients.map((client) => (
                  <TableRow key={client.id} className="hover:bg-muted/30 border-b border-border/50 last:border-0 transition-colors">
                    <TableCell className="font-medium text-base">{client.name}</TableCell>
                    <TableCell>
                      <Badge variant={client.clientType === 'public' ? 'secondary' : 'outline'} className="capitalize">
                        {client.clientType === 'public' ? 'Public' : 'Privé'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-primary/50" />
                        {client.typologyName}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button aria-haspopup="true" size="icon" variant="ghost" className="hover:bg-muted">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Ouvrir le menu</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-[160px]">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuItem asChild className="cursor-pointer">
                            <Link href={`/clients/${client.id}`}>Gérer les sites</Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild className="cursor-pointer">
                            <Link href={`/clients/${client.id}/edit`}>Modifier</Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive cursor-pointer focus:bg-destructive/10 focus:text-destructive">
                            Supprimer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center h-32 text-muted-foreground">
                    Aucun client trouvé pour "{searchTerm}".
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
