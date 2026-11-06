'use client';

import { Badge } from '@/components/ui/badge';
import { DataTable, type Colonne } from '@/components/data-table/data-table';
import type { FiltreTable } from '@/components/data-table/logique';
import { eur0 } from '@/components/fiches/fiche';
import { etatSite } from '@/components/fiches/tableaux';
import type { Contract } from '@/lib/types';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { optionsClients } from '@/lib/select-options';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { updateSite, deleteSite } from '@/services/firestore';
import type { Site, Activity } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useData } from '@/context/data-context';
import { downloadCSV } from '@/lib/utils';


export default function SitesPage() {
  const { sites, clients, contracts, activities, services, isLoading, reloadData } = useData();

  const [addSiteDialogOpen, setAddSiteDialogOpen] = useState(false);
  const [editSiteDialogOpen, setEditSiteDialogOpen] = useState(false);

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [deletingSite, setDeletingSite] = useState<Site | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

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
  const amountsFromServices = editingSite?.amountsSource === 'services';

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
      // Site piloté par ses prestations : activités et montants calculés, jamais écrits depuis ce formulaire.
      ...(!amountsFromServices && {
        activityIds: siteActivityIds,
        amounts: Object.entries(siteAmounts)
          .filter(([activityId]) => siteActivityIds.includes(activityId))
          .map(([activityId, amount]) => ({ activityId, amount: Number(amount) || 0 })),
      }),
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

  const handleOpenDeleteDialog = (site: Site) => {
    setTimeout(() => {
      setDeletingSite(site);
      setDeleteDialogOpen(true);
    }, 0);
  };

  const handleConfirmDelete = async () => {
    if (!deletingSite) return;
    try {
      await deleteSite(deletingSite.id);
      toast({ title: 'Site supprimé', description: `Le site "${deletingSite.name}" a été supprimé.` });
      await reloadData();
    } catch (error) {
      console.error(error);
      toast({ title: 'Erreur', description: 'La suppression a échoué.', variant: 'destructive' });
    } finally {
      setDeleteDialogOpen(false);
      setDeletingSite(null);
    }
  };

  const getFullAddress = (site: Site) => {
    const parts = [site.address, site.postalCode, site.city];
    return parts.filter(Boolean).join(', ');
  }

  type Ligne = Site & { client: string; contrat: Contract | null; montant: number; nbPrestations: number; incompletes: number };
  const lignes: Ligne[] = useMemo(() => {
    const clientMap = new Map(clients.map(c => [c.id, c.name]));
    return sites.map(site => {
      const contrat = contracts.find(c => c.id === site.contractId) || contracts.find(c => c.siteIds?.includes(site.id)) || null;
      const e = etatSite(site, services);
      return {
        ...site,
        client: (site.clientId && clientMap.get(site.clientId)) || site.clientName || '',
        contrat, montant: e.montant, nbPrestations: e.prestations.length, incompletes: e.incompletes.length,
      };
    });
  }, [sites, clients, contracts, services]);

  const colonnes: Colonne<Ligne>[] = useMemo(() => [
    { id: 'code', label: 'Code', tri: r => r.code, exporter: r => r.code, cell: r => <span className="font-mono text-xs">{r.code || '—'}</span> },
    { id: 'nom', label: 'Nom du site', fixe: true, tri: r => r.name, exporter: r => r.name, cell: r => <span className="font-medium">{r.name}</span> },
    { id: 'client', label: 'Client', tri: r => r.client, exporter: r => r.client, cell: r => <span className="block max-w-[220px] truncate" title={r.client}>{r.client || '—'}</span> },
    {
      id: 'contrat', label: 'Contrat', tri: r => r.contrat?.contractNumber, exporter: r => r.contrat?.contractNumber,
      cell: r => r.contrat ? <Link href={`/contracts/${r.contrat.id}`} className="font-mono text-xs text-primary hover:underline">{r.contrat.contractNumber || r.contrat.label || r.contrat.id}</Link> : <span className="text-xs text-muted-foreground">—</span>,
    },
    { id: 'ville', label: 'Ville', tri: r => r.city, exporter: r => r.city, cell: r => r.city || '—' },
    { id: 'adresse', label: 'Adresse', masquee: true, tri: r => r.address, exporter: r => getFullAddress(r), cell: r => getFullAddress(r) },
    { id: 'montant', label: 'Montant annuel HT', align: 'right', tri: r => r.montant, exporter: r => r.montant, cell: r => eur0(r.montant) },
    {
      id: 'etat', label: 'État', tri: r => (r.nbPrestations === 0 ? 0 : r.incompletes ? 1 : 2), exporter: r => (r.nbPrestations === 0 ? 'Sans prestation' : r.incompletes ? 'Incomplet' : 'Complet'),
      cell: r => r.nbPrestations === 0 ? <Badge variant="destructive">Sans prestation</Badge> : r.incompletes ? <Badge variant="destructive">{r.incompletes} incomplète(s)</Badge> : <Badge variant="secondary">Complet</Badge>,
    },
    { id: 'ref', label: 'Réf. externe', masquee: true, tri: r => r.externalRef, exporter: r => r.externalRef, cell: r => r.externalRef || '—' },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  const filtres: FiltreTable<Ligne>[] = useMemo(() => [
    { id: 'etat', label: 'État', valeur: r => (r.nbPrestations === 0 ? 'sans' : r.incompletes ? 'incomplet' : 'complet'),
      options: [{ value: 'complet', label: 'Complet' }, { value: 'incomplet', label: 'Prestation incomplète' }, { value: 'sans', label: 'Sans prestation' }] },
    { id: 'contrat', label: 'Contrat', valeur: r => (r.contrat ? 'oui' : 'non'), options: [{ value: 'oui', label: 'Rattaché' }, { value: 'non', label: 'Sans contrat' }] },
    { id: 'client', label: 'Client', valeur: r => r.client },
    { id: 'ville', label: 'Ville', valeur: r => r.city },
  ], []);

  const recherche = useMemo(() => ({
    placeholder: 'Nom, code SIT, client, ville…', parametreUrl: 'q',
    valeurs: (r: Ligne) => [r.name, r.code, r.client, r.city, r.address, r.postalCode, r.externalRef, r.siteNumber, r.contrat?.contractNumber],
  }), []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Sites</h1>
        <p className="text-muted-foreground">Sites d&apos;intervention, tous clients confondus. Cliquez sur une ligne pour ouvrir la fiche.</p>
      </div>

      <DataTable
        id="sites"
        rows={lignes}
        rowId={r => r.id}
        colonnes={colonnes}
        chargement={isLoading}
        recherche={recherche}
        filtres={filtres}
        triInitial={{ id: 'nom', sens: 'asc' }}
        lien={r => `/sites/${r.id}`}
        export={{ fichier: 'sites.csv' }}
        boutons={
            <Dialog open={addSiteDialogOpen} onOpenChange={setAddSiteDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="h-9 gap-1">
                  <PlusCircle className="h-4 w-4" />
                  Ajouter un site
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
                  <SearchableSelect id="client-select" value={selectedClientId} onValueChange={setSelectedClientId} options={optionsClients(clients)} placeholder="Choisir un client..." searchPlaceholder="Nom, code client, SIRET, ville…" />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAddSiteDialogOpen(false)}>Annuler</Button>
                  <Button onClick={handleGoToCreateSite} disabled={!selectedClientId}>
                    Continuer
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
        }
        vide={{ titre: 'Aucun site.', description: 'Ajoutez un site depuis un client, ou importez vos sites (Administration › Imports).' }}
        actions={site => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Actions pour ${site.name}`}><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem asChild><Link href={`/sites/${site.id}`}>Ouvrir la fiche</Link></DropdownMenuItem>
              {site.clientId && <DropdownMenuItem asChild><Link href={`/clients/${site.clientId}`}>Voir le client</Link></DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => handleOpenEditDialog(site)}>Modifier</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleOpenDeleteDialog(site)} className="text-destructive focus:text-destructive">Supprimer</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />

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
                <CardDescription>
                  {amountsFromServices
                    ? 'Montants calculés à partir des prestations en vigueur du site (fiche du site, onglet prestations, ou import des prestations) : ils ne se saisissent plus ici.'
                    : 'Sélectionnez les activités et saisissez les montants annuels HT.'}
                </CardDescription>
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
                          disabled={amountsFromServices}
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
                          disabled={amountsFromServices}
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

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer le site ?</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer le site <strong>{deletingSite?.name}</strong> ? Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingSite(null)}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
