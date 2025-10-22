
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
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronLeft, PlusCircle, Edit, Trash2, Loader2 } from 'lucide-react';
import { createSite, updateSite, deleteSite, getClient, getSitesByClient, getActivities } from '@/services/firestore';
import type { Client, Site, Activity } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

export default function ClientDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { toast } = useToast();
  
  const [client, setClient] = useState<Client | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
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
  const [siteActivityIds, setSiteActivityIds] = useState<string[]>([]);
  const [siteAmounts, setSiteAmounts] = useState<Record<string, number>>({});

  const reloadData = useCallback(async () => {
    try {
        const clientSites = await getSitesByClient(id);
        setSites(clientSites);
    } catch (error) {
        console.error("Failed to reload sites", error);
        toast({ title: "Erreur", description: "Impossible de rafraîchir la liste des sites.", variant: "destructive" });
    }
  }, [id, toast]);


  useEffect(() => {
    async function fetchData() {
        setIsLoading(true);
        try {
            const [clientData, clientSites, activitiesData] = await Promise.all([
                getClient(id),
                getSitesByClient(id),
                getActivities(),
            ]);

            if (!clientData) {
                notFound();
                return;
            }
            setClient(clientData);
            setSites(clientSites);
            setActivities(activitiesData);
        } catch (error) {
            console.error("Failed to fetch data for client detail page", error);
            toast({ title: "Erreur", description: "Impossible de charger les données de la page.", variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    }
    fetchData();
  }, [id, toast]);


  const resetForm = () => {
    setSiteName('');
    setSiteNumber('');
    setSiteAddress('');
    setSitePostalCode('');
    setSiteCity('');
    setSiteActivityIds([]);
    setSiteAmounts({});
    setEditingSite(null);
  };

  const handleOpenDialog = (site: Site | null = null) => {
    resetForm();
    if (site) {
      setEditingSite(site);
      setSiteName(site.name);
      setSiteNumber(site.siteNumber || '');
      setSiteAddress(site.address);
      setSitePostalCode(site.postalCode || '');
      setSiteCity(site.city || '');
      setSiteActivityIds(site.activityIds || []);
      const amounts = site.amounts?.reduce((acc, curr) => ({ ...acc, [curr.activityId]: curr.amount }), {}) || {};
      setSiteAmounts(amounts);
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
        activityIds: siteActivityIds,
        amounts: Object.entries(siteAmounts)
            .filter(([activityId]) => siteActivityIds.includes(activityId))
            .map(([activityId, amount]) => ({ activityId, amount: Number(amount) || 0 })),
    };

    try {
      if (editingSite) {
        await updateSite(editingSite.id, siteData);
        toast({ title: "Site mis à jour", description: "Le site a été mis à jour avec succès." });
      } else {
        await createSite({ ...siteData, clientId: id } as Omit<Site, 'id'>);
        toast({ title: "Site créé", description: "Le nouveau site a été ajouté avec succès." });
      }
      await reloadData();
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
        await reloadData();
        setSiteToDelete(null);
    } catch (error) {
        toast({ title: "Erreur", description: "Impossible de supprimer le site.", variant: "destructive" });
    }
  };
  
  const handleActivityChange = (activityId: string, checked: boolean) => {
      setSiteActivityIds(prev => 
          checked ? [...prev, activityId] : prev.filter(id => id !== activityId)
      );
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  if (!client) {
    return notFound();
  }
  
  const getFullAddress = (site: Site) => {
    const parts = [site.address, site.postalCode, site.city];
    return parts.filter(Boolean).join(', ');
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
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sites.length > 0 ? (
                sites.map((site) => (
                  <TableRow key={site.id}>
                    <TableCell>{site.siteNumber || 'N/A'}</TableCell>
                    <TableCell className="font-medium">{site.name}</TableCell>
                    <TableCell>{getFullAddress(site)}</TableCell>
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
                  <TableCell colSpan={4} className="text-center">
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
                
                <Card>
                    <CardHeader>
                        <CardTitle>Activités et Montants</CardTitle>
                        <CardDescription>Sélectionnez les activités et saisissez les montants annuels HT.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label>Activités</Label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {activities.map(activity => (
                                <div key={activity.id} className="flex items-center space-x-2">
                                    <Checkbox
                                        id={`activity-${activity.id}`}
                                        checked={siteActivityIds.includes(activity.id)}
                                        onCheckedChange={(checked) => handleActivityChange(activity.id, !!checked)}
                                    />
                                    <label htmlFor={`activity-${activity.id}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                        {activity.label} ({activity.code})
                                    </label>
                                </div>
                            ))}
                        </div>
                      </div>
                      
                      {siteActivityIds.length > 0 && (
                          <div className="space-y-4 pt-4 border-t">
                              {activities.filter(a => siteActivityIds.includes(a.id)).map(activity => (
                                  <div key={activity.id} className="space-y-2">
                                    <Label htmlFor={`amount-${activity.id}`}>Montant Annuel HT pour {activity.label}</Label>
                                    <Input 
                                      id={`amount-${activity.id}`} 
                                      type="number" 
                                      placeholder="Montant en €"
                                      value={siteAmounts[activity.id] || ''} 
                                      onChange={(e) => setSiteAmounts(prev => ({...prev, [activity.id]: parseFloat(e.target.value) || 0 }))} 
                                    />
                                  </div>
                              ))}
                          </div>
                      )}
                    </CardContent>
                </Card>
                
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
