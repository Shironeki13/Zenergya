
'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { ChevronLeft, PlusCircle, Eye, Loader2, Pencil, Building2, MapPin, Phone, Mail, User, FileText } from 'lucide-react';
import { getClient, getContractsByClient, getSitesByClient, getContactsByClient } from '@/services/firestore';
import type { Client, Contract, Site, Contact } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { AttachContractDialog } from '@/components/attach-contract-dialog';
import { useData } from '@/context/data-context';

export default function ClientDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { toast } = useToast();
  const { typologies, companies, agencies, sectors } = useData();

  const [client, setClient] = useState<Client | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
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
        const [clientData, clientSites, clientContacts] = await Promise.all([
          getClient(id),
          getSitesByClient(id),
          getContactsByClient(id),
        ]);

        if (!clientData) { notFound(); return; }
        setClient(clientData);
        setSites(clientSites);
        setContacts(clientContacts);
        await fetchContracts();
      } catch (error) {
        console.error("Failed to fetch data for client detail page", error);
        toast({ title: "Erreur", description: "Impossible de charger les données.", variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [id, toast, fetchContracts]);

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  if (!client) return notFound();

  const typologyName = typologies.find(t => t.id === client.typologyId)?.name ?? client.typologyName ?? '—';
  const companyName = companies.find(c => c.id === client.companyId)?.name ?? '—';
  const agencyName  = agencies.find(a => a.id === client.agencyId)?.name ?? '—';
  const sectorName  = sectors.find(s => s.id === client.sectorId)?.name ?? '—';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/clients">
          <Button variant="outline" size="icon" className="h-8 w-8">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{client.name}</h1>
          <p className="text-sm text-muted-foreground">{client.clientNumber ?? '—'}</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/clients/${id}/edit`}>
            <Pencil className="h-4 w-4 mr-2" /> Modifier
          </Link>
        </Button>
      </div>

      {/* Fiche client + Contacts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Informations générales */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4" /> Informations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-start gap-2 text-muted-foreground">
              <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{[client.address, client.postalCode, client.city].filter(Boolean).join(', ') || '—'}</span>
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-y-2">
              <span className="text-muted-foreground">Société</span>
              <span>{companyName}</span>

              <span className="text-muted-foreground">Agence</span>
              <span>{agencyName}</span>

              <span className="text-muted-foreground">Secteur</span>
              <span>{sectorName}</span>

              <span className="text-muted-foreground">Type</span>
              <Badge variant={client.clientType === 'public' ? 'secondary' : 'outline'} className="w-fit capitalize">
                {client.clientType === 'public' ? 'Public' : 'Privé'}
              </Badge>

              <span className="text-muted-foreground">Typologie</span>
              <span>{typologyName}</span>

              {client.representedBy && <>
                <span className="text-muted-foreground">Représenté par</span>
                <span>{client.representedBy}</span>
              </>}

              {client.siret && <>
                <span className="text-muted-foreground">SIRET</span>
                <span className="font-mono">{client.siret}</span>
              </>}

              {client.useChorus && <>
                <span className="text-muted-foreground">Chorus Pro</span>
                <span className="text-green-600 font-medium">Activé</span>
              </>}

              {client.isBe && <>
                <span className="text-muted-foreground">Bureau d'études</span>
                <span>{client.beName || 'Oui'}</span>
              </>}
            </div>

            {client.externalCode && (
              <>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Référence externe</span>
                  <span className="font-mono text-xs">{client.externalCode}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Contacts */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4" /> Contacts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {contacts.length === 0 ? (
              <p className="text-muted-foreground">Aucun contact renseigné.</p>
            ) : (
              contacts.map(contact => (
                <div key={contact.id} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{contact.name || '—'}</span>
                    <Badge variant="outline" className="text-xs py-0">{contact.type}</Badge>
                    {contact.role && <span className="text-xs text-muted-foreground">· {contact.role}</span>}
                  </div>
                  {contact.phone && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Phone className="h-3 w-3" /> {contact.phone}
                    </div>
                  )}
                  {contact.email && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Mail className="h-3 w-3" /> {contact.email}
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Contrats */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" /> Contrats
              </CardTitle>
              <CardDescription>Liste des contrats rattachés à ce client.</CardDescription>
            </div>
            <div className="flex gap-2">
              <AttachContractDialog client={client} onContractAttached={fetchContracts} />
              <Link href={`/contracts/new?clientId=${client.id}`}>
                <Button size="sm" variant="outline" className="gap-1">
                  <PlusCircle className="h-4 w-4" /> Nouveau
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
                <TableHead>Sites</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contracts.length > 0 ? (
                contracts.map((contract) => (
                  <TableRow key={contract.id}>
                    <TableCell className="font-medium">{contract.contractNumber || contract.id.substring(0, 8) + '…'}</TableCell>
                    <TableCell>
                      <Badge variant={contract.status === 'Actif' ? 'default' : 'secondary'}>
                        {contract.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{contract.startDate ? new Date(contract.startDate).toLocaleDateString('fr-FR') : '—'}</TableCell>
                    <TableCell>{contract.endDate ? new Date(contract.endDate).toLocaleDateString('fr-FR') : '—'}</TableCell>
                    <TableCell>{sites.filter(s => s.contractId === contract.id).length}</TableCell>
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
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Aucun contrat rattaché à ce client.
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
