

'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PlusCircle, MoreHorizontal, Loader2, Calendar as CalendarIcon, Search, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useData } from '@/context/data-context';
import type { Contract, Site } from '@/lib/types';
import { updateContract } from '@/services/firestore';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { downloadCSV } from '@/lib/utils';

export default function ContractsPage() {
  const { contracts, sites, clients, isLoading, reloadData, currentUser } = useData();
  const { toast } = useToast();
  const router = useRouter();

  const [contractToUpdate, setContractToUpdate] = useState<Contract | null>(null);
  const [newStatus, setNewStatus] = useState<"Résilié" | "Terminé" | null>(null);
  const [terminationDate, setTerminationDate] = useState<Date | undefined>(new Date());

  const [sitesToShow, setSitesToShow] = useState<Site[]>([]);
  const [isSitesDialogOpen, setIsSitesDialogOpen] = useState(false);
  const [selectedContractClient, setSelectedContractClient] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredContracts = useMemo(() => {
    let baseContracts = contracts.filter(c => c.validationStatus === 'validated');

    // Filter by User Scope
    if (currentUser && currentUser.scope) {
      const { companyIds, agencyIds, sectorIds } = currentUser.scope;

      // If not super admin (has '*')
      if (!companyIds.includes('*') || !agencyIds.includes('*') || !sectorIds.includes('*')) {
        baseContracts = baseContracts.filter(contract => {
          const client = clients.find(c => c.id === contract.clientId);
          if (!client) return false; // Should not happen, but safe to hide

          // Check Company
          if (!companyIds.includes('*') && !companyIds.includes(client.companyId)) return false;
          // Check Agency
          if (!agencyIds.includes('*') && !agencyIds.includes(client.agencyId)) return false;
          // Check Sector
          if (!sectorIds.includes('*') && !sectorIds.includes(client.sectorId)) return false;

          return true;
        });
      }
    }

    if (!searchTerm) {
      return baseContracts;
    }
    return baseContracts.filter(contract =>
      contract.clientName.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [contracts, clients, searchTerm, currentUser]);

  const handleExport = () => {
    const dataToExport = filteredContracts.map(({ id, ...rest }) => ({
      ...rest,
      siteIds: rest.siteIds.join('; '),
      activityIds: rest.activityIds.join('; '),
    }));
    downloadCSV(dataToExport, 'contrats.csv');
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

  const handleOpenStatusDialog = (contract: Contract, status: "Résilié" | "Terminé") => {
    setContractToUpdate(contract);
    setNewStatus(status);
    if (status === 'Résilié') {
      setTerminationDate(new Date());
    }
  }

  const handleCloseStatusDialog = () => {
    setContractToUpdate(null);
    setNewStatus(null);
    setTerminationDate(undefined);
  }

  const handleShowSites = (contract: Contract) => {
    const contractSites = sites.filter(site => contract.siteIds.includes(site.id));
    setSitesToShow(contractSites);
    setSelectedContractClient(contract.clientName);
    setIsSitesDialogOpen(true);
  };

  const handleStatusUpdate = async () => {
    if (!contractToUpdate || !newStatus) return;

    let updateData: Partial<Contract> = { status: newStatus };

    if (newStatus === 'Résilié') {
      if (!terminationDate) {
        toast({ title: "Erreur", description: "Veuillez sélectionner une date de résiliation.", variant: "destructive" });
        return;
      }
      updateData.terminationDate = terminationDate.toISOString();
    } else if (newStatus === 'Terminé') {
      updateData.endDate = new Date().toISOString();
    }


    try {
      await updateContract(contractToUpdate.id, updateData);
      toast({ title: "Statut mis à jour", description: `Le contrat est maintenant ${newStatus.toLowerCase()}.` });
      await reloadData();
    } catch (error) {
      toast({ title: "Erreur", description: "La mise à jour du statut a échoué.", variant: "destructive" });
    } finally {
      handleCloseStatusDialog();
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Liste des Contrats</CardTitle>
              <CardDescription>
                Gérez tous les contrats de vos clients.
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
              <Button size="sm" variant="outline" className="gap-1" onClick={handleExport}>
                <Download className="h-4 w-4" />
                Exporter
              </Button>
              <Button asChild size="sm" className="gap-1">
                <Link href="/contracts/new">
                  <PlusCircle className="h-4 w-4" />
                  Nouveau Contrat
                </Link>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Sites</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="hidden md:table-cell">
                  Date de début
                </TableHead>
                <TableHead className="hidden md:table-cell">
                  Date de fin / résiliation
                </TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : filteredContracts.length > 0 ? (
                filteredContracts.map((contract) => (
                  <TableRow key={contract.id}>
                    <TableCell className="font-medium">{contract.clientName}</TableCell>
                    <TableCell>
                      <Button variant="link" className="p-0 h-auto" onClick={() => handleShowSites(contract)}>
                        <Badge variant="outline">{contract.siteIds.length}</Badge>
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getBadgeVariant(contract.status)}>
                        {contract.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {new Date(contract.startDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {contract.status === 'Résilié' && contract.terminationDate
                        ? new Date(contract.terminationDate).toLocaleDateString()
                        : new Date(contract.endDate).toLocaleDateString()
                      }
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
                          <DropdownMenuItem asChild><Link href={`/contracts/${contract.id}`}>Voir les détails</Link></DropdownMenuItem>
                          <DropdownMenuItem asChild><Link href={`/contracts/${contract.id}/edit`}>Modifier</Link></DropdownMenuItem>
                          {contract.status === 'Actif' && (<>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => handleOpenStatusDialog(contract, 'Résilié')}>
                              Passer à Résilié
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => handleOpenStatusDialog(contract, 'Terminé')}>
                              Passer à Terminé
                            </DropdownMenuItem>
                          </>)}
                          <DropdownMenuSeparator />
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
                  <TableCell colSpan={6} className="text-center h-24">Aucun contrat trouvé.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!contractToUpdate} onOpenChange={(isOpen) => !isOpen && handleCloseStatusDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier le statut du contrat</DialogTitle>
            <DialogDescription>
              {newStatus === 'Résilié'
                ? `Vous êtes sur le point de résilier le contrat pour ${contractToUpdate?.clientName}. Veuillez sélectionner la date de résiliation.`
                : `Vous êtes sur le point de marquer le contrat pour ${contractToUpdate?.clientName} comme "Terminé". Cela mettra la date de fin du contrat à aujourd'hui. Êtes-vous sûr ?`
              }
            </DialogDescription>
          </DialogHeader>
          {newStatus === 'Résilié' && (
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="termination-date" className="text-right">
                  Date de résiliation
                </Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      id="termination-date"
                      variant={"outline"}
                      className={cn(
                        "col-span-3 justify-start text-left font-normal",
                        !terminationDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {terminationDate ? format(terminationDate, "PPP", { locale: fr }) : <span>Choisir une date</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={terminationDate}
                      onSelect={setTerminationDate}
                      initialFocus
                      locale={fr}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseStatusDialog}>Annuler</Button>
            <Button onClick={handleStatusUpdate}>Confirmer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isSitesDialogOpen} onOpenChange={setIsSitesDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sites pour {selectedContractClient}</DialogTitle>
            <DialogDescription>
              Liste des sites inclus dans ce contrat.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-60 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom du Site</TableHead>
                  <TableHead>Adresse</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sitesToShow.length > 0 ? (
                  sitesToShow.map(site => (
                    <TableRow key={site.id} className="cursor-pointer hover:bg-muted" onClick={() => router.push(`/clients/${site.clientId}`)}>
                      <TableCell>{site.name}</TableCell>
                      <TableCell>{[site.address, site.postalCode, site.city].filter(Boolean).join(', ')}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center">Aucun site à afficher.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
