'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, PlusCircle, Loader2, Search, Download } from 'lucide-react';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { updateSite } from '@/services/firestore';
import type { Site, Activity } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useData } from '@/context/data-context';
import { downloadCSV } from '@/lib/utils';


export default function SitesPage() {
  const { sites, clients, activities, isLoading, reloadData } = useData();

  const [addSiteDialogOpen, setAddSiteDialogOpen] = useState(false);
  const [editSiteDialogOpen, setEditSiteDialogOpen] = useState(false);

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const router = useRouter();
  const { toast } = useToast();

  // Form state for editing
  const [siteName, setSiteName] = useState('');
  const [siteNumber, setSiteNumber] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [sitePostalCode, setSitePostalCode] = useState('');
  const [siteCity, setSiteCity] = useState('');
  const [siteActivityIds, setSiteActivityIds] = useState<string[]>([]);
  const [siteAmounts, setSiteAmounts] = useState<Record<string, number>>({});

  const handleGoToCreateSite = () => {
    if (selectedClientId) {
      router.push(`/clients/${selectedClientId}`);
    } else {
      toast({ title: 'Aucun client sélectionné', description: 'Veuillez sélectionner un client pour continuer.', variant: 'destructive' });
    }
  };

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

  const handleOpenEditDialog = (site: Site) => {
    // Use setTimeout to allow DropdownMenu to close properly before opening Dialog
    setTimeout(() => {
      resetForm();
      setEditingSite(site);
      setSiteName(site.name);
      setSiteNumber(site.siteNumber || '');
      setSiteAddress(site.address);
      setSitePostalCode(site.postalCode || '');
      setSiteCity(site.city || '');
      setSiteActivityIds(site.activityIds || []);
      const amounts = site.amounts?.reduce((acc, curr) => ({ ...acc, [curr.activityId]: curr.amount }), {}) || {};
      setSiteAmounts(amounts);
      setEditSiteDialogOpen(true);
    }, 0);
  };

  const handleActivityChange = (activityId: string, checked: boolean) => {
    setSiteActivityIds(prev =>
      checked ? [...prev, activityId] : prev.filter(id => id !== activityId)
    );
  };

  const handleSubmitSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSite || !siteName.trim() || !siteAddress.trim()) return;

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
      await updateSite(editingSite.id, siteData);
      toast({ title: "Site mis à jour", description: "Le site a été mis à jour avec succès." });
      await reloadData();
      setEditSiteDialogOpen(false);
      // Do NOT call resetForm() here to avoid clearing data while dialog is closing
    } catch (error) {
      console.error(error);
      toast({ title: "Erreur", description: "La mise à jour a échoué.", variant: "destructive" });
    }
  };

  const getFullAddress = (site: Site) => {
    const parts = [site.address, site.postalCode, site.city];
    return parts.filter(Boolean).join(', ');
  }

  const sitesWithClientNames = useMemo(() => {
    const clientMap = new Map(clients.map(c => [c.id, c.name]));
    return sites.map(site => ({
      ...site,
      clientName: clientMap.get(site.clientId) || 'N/A'
    }));
  }, [sites, clients]);

  const filteredSites = useMemo(() => {
    if (!searchTerm) {
      return sitesWithClientNames;
    }
    return sitesWithClientNames.filter(site =>
      site.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      site.clientName.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [sitesWithClientNames, searchTerm]);

  const handleExport = () => {
    const dataToExport = filteredSites.map(({ id, clientId, ...rest }) => rest);
    downloadCSV(dataToExport, 'sites.csv');
  };


  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>Sites</CardTitle>
            <CardDescription>
              Liste de tous les sites d'intervention, tous clients confondus.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Rechercher un site..."
                className="pl-8 sm:w-[300px]"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Button size="sm" variant="outline" className="gap-1" onClick={handleExport}>
              <Download className="h-4 w-4" />
              Exporter
            </Button>
            <Dialog open={addSiteDialogOpen} onOpenChange={setAddSiteDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1">
                  <PlusCircle className="h-4 w-4" />
                  Ajouter un Site
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>À quel client ce site appartient-il ?</DialogTitle>
                  <DialogDescription>
                    Sélectionnez le client pour lequel vous souhaitez créer un nouveau site.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <Label htmlFor="client-select">Sélectionnez un client</Label>
                  <Select onValueChange={(value) => setSelectedClientId(value)}>
                    <SelectTrigger id="client-select">
                      <SelectValue placeholder="Choisir un client..." />
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAddSiteDialogOpen(false)}>Annuler</Button>
                  <Button onClick={handleGoToCreateSite} disabled={!selectedClientId}>
                    Continuer
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom du Site</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Adresse</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center h-24">
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : filteredSites.length > 0 ? (
              filteredSites.map((site: Site & { clientName: string }) => (
                <TableRow key={site.id}>
                  <TableCell className="font-medium">
                    <Link href={`/sites/${site.id}`} className="hover:underline">
                      {site.name}
                    </Link>
                  </TableCell>
                  <TableCell>{site.clientName}</TableCell>
                  <TableCell>
                    {getFullAddress(site)}
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
                        <DropdownMenuItem onSelect={() => handleOpenEditDialog(site)}>
                          Modifier
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href={`/clients/${site.clientId}`}>Voir le client</Link>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="text-center h-24">Aucun site trouvé.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={editSiteDialogOpen} onOpenChange={setEditSiteDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Modifier le site: {editingSite?.name}</DialogTitle>
            <DialogDescription>
              Client: {clients.find(c => c.id === editingSite?.clientId)?.name}
            </DialogDescription>
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
                          id={`activity-${activity.id}-edit`}
                          checked={siteActivityIds.includes(activity.id)}
                          onCheckedChange={(checked) => handleActivityChange(activity.id, !!checked)}
                        />
                        <label htmlFor={`activity-${activity.id}-edit`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
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
                        <Label htmlFor={`amount-${activity.id}-edit`}>Montant Annuel HT pour {activity.label}</Label>
                        <Input
                          id={`amount-${activity.id}-edit`}
                          type="number"
                          placeholder="Montant en €"
                          value={siteAmounts[activity.id] || ''}
                          onChange={(e) => setSiteAmounts(prev => ({ ...prev, [activity.id]: parseFloat(e.target.value) || 0 }))}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setEditSiteDialogOpen(false)}>Annuler</Button>
              <Button type="submit">Enregistrer</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
