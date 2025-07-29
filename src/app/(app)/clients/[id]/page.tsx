
'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, PlusCircle, Edit, Trash2 } from 'lucide-react';
import { getClient, getSitesByClient, createSite, updateSite, deleteSite, getContractsByClient, getActivities } from '@/services/firestore';
import type { Client, Site, Contract, Activity } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

export default function ClientDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { toast } = useToast();
  
  const [client, setClient] = useState<Client | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [siteToDelete, setSiteToDelete] = useState<Site | null>(null);
  
  // Form state
  const [siteName, setSiteName] = useState('');
  const [siteNumber, setSiteNumber] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [sitePostalCode, setSitePostalCode] = useState('');
  const [siteCity, setSiteCity] = useState('');
  const [siteContractId, setSiteContractId] = useState<string | undefined>('');
  const [siteAmounts, setSiteAmounts] = useState<Record<string, number>>({});

  const loadClientData = useCallback(async () => {
    try {
      setIsLoading(true);
      const clientData = await getClient(id);
      if (!clientData) {
        notFound();
      }
      setClient(clientData);
      const [sitesData, contractsData, activitiesData] = await Promise.all([
        getSitesByClient(id),
        getContractsByClient(id),
        getActivities()
      ]);
      setSites(sitesData);
      setContracts(contractsData);
      setActivities(activitiesData);
    } catch (error) {
      toast({ title: "Erreur", description: "Impossible de charger les données du client.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    loadClientData();
  }, [loadClientData]);

  const selectedContract = useMemo(() => {
    return contracts.find(c => c.id === siteContractId);
  }, [contracts, siteContractId]);

  const contractActivities = useMemo(() => {
    if (!selectedContract) return [];
    return activities.filter(a => selectedContract.activityIds.includes(a.id));
  }, [selectedContract, activities]);

  const resetForm = () => {
    setSiteName('');
    setSiteNumber('');
    setSiteAddress('');
    setSitePostalCode('');
    setSiteCity('');
    setSiteContractId(undefined);
    setSiteAmounts({});
    setEditingSite(null);
  };

  const handleOpenDialog = (site: Site | null = null) => {
    if (site) {
      setEditingSite(site);
      setSiteName(site.name);
      setSiteNumber(site.siteNumber || '');
      setSiteAddress(site.address);
      setSitePostalCode(site.postalCode || '');
      setSiteCity(site.city || '');
      setSiteContractId(site.contractId);
      const amounts = site.amounts?.reduce((acc, curr) => ({ ...acc, [curr.activityId]: curr.amount }), {}) || {};
      setSiteAmounts(amounts);
    } else {
      resetForm();
    }
    setDialogOpen(true);
  };

  const handleSubmitSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!siteName.trim() || !siteAddress.trim()) return;

    const siteData: Partial<Site> = {
        name: siteName,
        siteNumber,
        address: siteAddress,
        postalCode: sitePostalCode,
        city: siteCity,
        contractId: siteContractId,
        amounts: Object.entries(siteAmounts).map(([activityId, amount]) => ({ activityId, amount: Number(amount) || 0 })),
    };

    try {
      if (editingSite) {
        await updateSite(editingSite.id, siteData);
        toast({ title: "Site mis à jour", description: "Le site a été mis à jour avec succès." });
      } else {
        await createSite({ ...siteData, clientId: id } as Omit<Site, 'id'>);
        toast({ title: "Site créé", description: "Le nouveau site a été ajouté avec succès." });
      }
      await loadClientData();
      setDialogOpen(false);
      resetForm();
    } catch (error) {
      console.error(error);
      toast({ title: "Erreur", description: "L'opération a échoué.", variant: "destructive" });
    }
  };

  const handleDeleteSite = async () => {
    if (!siteToDelete) return;
    try {
        await deleteSite(siteToDelete.id);
        toast({ title: "Succès", description: "Le site a été supprimé." });
        await loadClientData();
        setSiteToDelete(null);
    } catch (error) {
        toast({ title: "Erreur", description: "Impossible de supprimer le site.", variant: "destructive" });
    }
  };

  if (isLoading) {
    return <div>Chargement...</div>;
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
            <p className="text-sm text-muted-foreground">{client.contactEmail}</p>
        </div>
      </div>
      
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Sites</CardTitle>
              <CardDescription>
                Liste des sites physiques rattachés à ce client.
              </CardDescription>
            </div>
            <Button size="sm" className="gap-1" onClick={() => handleOpenDialog()}>
              <PlusCircle className="h-4 w-4" />
              Ajouter un Site
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N° Site</TableHead>
                <TableHead>Nom du Site</TableHead>
                <TableHead>Adresse</TableHead>
                <TableHead>Contrat</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sites.length > 0 ? (
                sites.map((site) => (
                  <TableRow key={site.id}>
                    <TableCell>{site.siteNumber || 'N/A'}</TableCell>
                    <TableCell className="font-medium">{site.name}</TableCell>
                    <TableCell>{`${site.address}, ${site.postalCode} ${site.city}`}</TableCell>
                    <TableCell>{site.contractId ? site.contractId.substring(0, 8) + '...' : 'Aucun'}</TableCell>
                    <TableCell className="text-right">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(site)}>
                            <Edit className="h-4 w-4" />
                        </Button>
                        <Dialog open={!!siteToDelete && siteToDelete.id === site.id} onOpenChange={(isOpen) => !isOpen && setSiteToDelete(null)}>
                            <DialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setSiteToDelete(site)}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Supprimer {siteToDelete?.name}?</DialogTitle>
                                    <DialogDescription>Cette action est irréversible.</DialogDescription>
                                </DialogHeader>
                                <DialogFooter>
                                    <Button variant="outline" onClick={() => setSiteToDelete(null)}>Annuler</Button>
                                    <Button variant="destructive" onClick={handleDeleteSite}>Confirmer</Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center">
                    Aucun site n'a encore été créé for ce client.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
                <DialogTitle>{editingSite ? 'Modifier le site' : 'Nouveau site'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmitSite} className="space-y-4 max-h-[70vh] overflow-y-auto pr-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                      <Label htmlFor="siteName">Nom du site</Label>
                      <Input id="siteName" value={siteName} onChange={(e) => setSiteName(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="siteNumber">N° de site</Label>
                      <Input id="siteNumber" value={siteNumber} onChange={(e) => setSiteNumber(e.target.value)} />
                  </div>
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="siteAddress">Adresse</Label>
                    <Input id="siteAddress" value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} required />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="sitePostalCode">Code Postal</Label>
                        <Input id="sitePostalCode" value={sitePostalCode} onChange={(e) => setSitePostalCode(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="siteCity">Ville</Label>
                        <Input id="siteCity" value={siteCity} onChange={(e) => setSiteCity(e.target.value)} />
                    </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="siteContractId">Contrat rattaché</Label>
                  <Select onValueChange={(value) => setSiteContractId(value)} value={siteContractId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionnez un contrat" />
                    </SelectTrigger>
                    <SelectContent>
                      {contracts.map(contract => (
                        <SelectItem key={contract.id} value={contract.id}>
                          {`Contrat du ${new Date(contract.startDate).toLocaleDateString()} au ${new Date(contract.endDate).toLocaleDateString()}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedContract && contractActivities.length > 0 && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Montants à facturer</CardTitle>
                            <CardDescription>Saisissez les montants pour chaque prestation du contrat.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          {contractActivities.map(activity => (
                              <div key={activity.id} className="space-y-2">
                                <Label htmlFor={`amount-${activity.id}`}>{activity.label} ({activity.code})</Label>
                                <Input 
                                  id={`amount-${activity.id}`} 
                                  type="number" 
                                  placeholder="Montant en €"
                                  value={siteAmounts[activity.id] || ''} 
                                  onChange={(e) => setSiteAmounts(prev => ({...prev, [activity.id]: parseFloat(e.target.value) }))} 
                                />
                              </div>
                          ))}
                        </CardContent>
                    </Card>
                )}
                
                <DialogFooter className="pt-4">
                    <DialogClose asChild><Button type="button" variant="outline">Annuler</Button></DialogClose>
                    <Button type="submit">Enregistrer</Button>
                </DialogFooter>
            </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
