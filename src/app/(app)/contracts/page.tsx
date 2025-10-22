
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PlusCircle, MoreHorizontal, Loader2, Calendar as CalendarIcon } from 'lucide-react';
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Label } from '@/components/ui/label';
import { useData } from '@/context/data-context';
import type { Contract } from '@/lib/types';
import { updateContract } from '@/services/firestore';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

export default function ContractsPage() {
  const { contracts, isLoading, reloadData } = useData();
  const { toast } = useToast();
  
  const [contractToUpdate, setContractToUpdate] = useState<Contract | null>(null);
  const [newStatus, setNewStatus] = useState<"Résilié" | "Terminé" | null>(null);
  const [terminationDate, setTerminationDate] = useState<Date | undefined>(new Date());
  
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
  
  const handleOpenDialog = (contract: Contract, status: "Résilié" | "Terminé") => {
    setContractToUpdate(contract);
    setNewStatus(status);
    if(status === 'Résilié') {
      setTerminationDate(new Date());
    }
  }

  const handleCloseDialog = () => {
    setContractToUpdate(null);
    setNewStatus(null);
    setTerminationDate(undefined);
  }

  const handleStatusUpdate = async () => {
    if (!contractToUpdate || !newStatus) return;

    let updateData: Partial<Contract> = { status: newStatus };

    if (newStatus === 'Résilié') {
      if (!terminationDate) {
        toast({ title: "Erreur", description: "Veuillez sélectionner une date de résiliation.", variant: "destructive" });
        return;
      }
      updateData.terminationDate = terminationDate.toISOString();
    }

    try {
      await updateContract(contractToUpdate.id, updateData);
      toast({ title: "Statut mis à jour", description: `Le contrat est maintenant ${newStatus.toLowerCase()}.` });
      await reloadData();
    } catch (error) {
      toast({ title: "Erreur", description: "La mise à jour du statut a échoué.", variant: "destructive" });
    } finally {
      handleCloseDialog();
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Contrats</CardTitle>
              <CardDescription>
                Gérez tous les contrats de vos clients.
              </CardDescription>
            </div>
            <Button asChild size="sm" className="gap-1">
              <Link href="/contracts/new">
                <PlusCircle className="h-4 w-4" />
                Nouveau Contrat
              </Link>
            </Button>
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
              ) : contracts.length > 0 ? (
                  contracts.map((contract) => (
                  <TableRow key={contract.id}>
                      <TableCell className="font-medium">{contract.clientName}</TableCell>
                      <TableCell>
                      <Badge variant="outline">{contract.siteIds.length}</Badge>
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
                            {contract.status === 'Actif' && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={() => handleOpenDialog(contract, 'Résilié')}>
                                  Passer à Résilié
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => handleOpenDialog(contract, 'Terminé')}>
                                  Passer à Terminé
                                </DropdownMenuItem>
                              </>
                            )}
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
      
      <Dialog open={!!contractToUpdate} onOpenChange={(isOpen) => !isOpen && handleCloseDialog()}>
          <DialogContent>
              <DialogHeader>
                  <DialogTitle>Modifier le statut du contrat</DialogTitle>
                  <DialogDescription>
                      {newStatus === 'Résilié' 
                          ? `Vous êtes sur le point de résilier le contrat pour ${contractToUpdate?.clientName}. Veuillez sélectionner la date de résiliation.`
                          : `Vous êtes sur le point de marquer le contrat pour ${contractToUpdate?.clientName} comme "Terminé". Êtes-vous sûr ?`
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
                  <Button variant="outline" onClick={handleCloseDialog}>Annuler</Button>
                  <Button onClick={handleStatusUpdate}>Confirmer</Button>
              </DialogFooter>
          </DialogContent>
      </Dialog>
    </>
  );
    
    