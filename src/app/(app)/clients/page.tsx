'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { MoreHorizontal, PlusCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DataTable, type Colonne } from '@/components/data-table/data-table';
import type { FiltreTable } from '@/components/data-table/logique';
import { useData } from '@/context/data-context';
import { deleteClient } from '@/services/firestore';
import { useToast } from '@/hooks/use-toast';
import type { Client } from '@/lib/types';

/** Liste des clients et prospects : recherche, filtres, tri, colonnes, export (tableau commun). */

type Ligne = Client & { typologie: string; agence: string; societe: string; contratsActifs: number };

export default function ClientsPage() {
  const { clients, contracts, typologies, agencies, companies, isLoading, reloadData } = useData();
  const [clientToDelete, setClientToDelete] = useState<Ligne | null>(null);
  const { toast } = useToast();

  const lignes: Ligne[] = useMemo(() => {
    const typo = new Map(typologies.map(t => [t.id, t.name]));
    const agence = new Map(agencies.map(a => [a.id, a.name]));
    const societe = new Map(companies.map(c => [c.id, c.name]));
    const actifs = new Map<string, number>();
    for (const c of contracts) if (c.status === 'Actif') actifs.set(c.clientId, (actifs.get(c.clientId) ?? 0) + 1);
    return clients.map(c => ({
      ...c,
      typologie: typo.get(c.typologyId) ?? '',
      agence: agence.get(c.agencyId) ?? '',
      societe: societe.get(c.companyId) ?? '',
      contratsActifs: actifs.get(c.id) ?? 0,
    }));
  }, [clients, contracts, typologies, agencies, companies]);

  const colonnes: Colonne<Ligne>[] = useMemo(() => [
    {
      id: 'nom', label: 'Raison sociale', fixe: true, tri: r => r.name, exporter: r => r.name,
      cell: r => <span className="font-medium">{r.name}{r.relation === 'prospect' && <Badge variant="outline" className="ml-2">Prospect</Badge>}</span>,
    },
    { id: 'code', label: 'Code client', tri: r => r.externalCode, exporter: r => r.externalCode, cell: r => <span className="font-mono text-xs">{r.externalCode || '—'}</span> },
    {
      id: 'type', label: 'Type', tri: r => r.clientType, exporter: r => (r.clientType === 'public' ? 'Public' : 'Privé'),
      cell: r => <Badge variant={r.clientType === 'public' ? 'secondary' : 'outline'}>{r.clientType === 'public' ? 'Public' : 'Privé'}</Badge>,
    },
    { id: 'typologie', label: 'Typologie', tri: r => r.typologie, exporter: r => r.typologie, cell: r => r.typologie || '—' },
    { id: 'ville', label: 'Ville', tri: r => r.city, exporter: r => r.city, cell: r => r.city || '—' },
    { id: 'agence', label: 'Agence', tri: r => r.agence, exporter: r => r.agence, cell: r => r.agence || '—' },
    { id: 'societe', label: 'Société', masquee: true, tri: r => r.societe, exporter: r => r.societe, cell: r => r.societe || '—' },
    { id: 'contrats', label: 'Contrats actifs', align: 'right', tri: r => r.contratsActifs, exporter: r => r.contratsActifs, cell: r => r.contratsActifs },
    { id: 'siret', label: 'SIRET', masquee: true, tri: r => r.siret, exporter: r => r.siret, cell: r => <span className="font-mono text-xs">{r.siret || '—'}</span> },
    { id: 'ref', label: 'Réf. externe', masquee: true, tri: r => r.externalRef, exporter: r => r.externalRef, cell: r => r.externalRef || '—' },
  ], []);

  const filtres: FiltreTable<Ligne>[] = useMemo(() => [
    { id: 'type', label: 'Type', valeur: r => r.clientType, options: [{ value: 'private', label: 'Privé' }, { value: 'public', label: 'Public' }] },
    { id: 'relation', label: 'Relation', valeur: r => r.relation ?? 'client', options: [{ value: 'client', label: 'Client' }, { value: 'prospect', label: 'Prospect' }] },
    { id: 'typologie', label: 'Typologie', valeur: r => r.typologie },
    { id: 'agence', label: 'Agence', valeur: r => r.agence },
    { id: 'ville', label: 'Ville', valeur: r => r.city },
  ], []);

  const recherche = useMemo(() => ({
    placeholder: 'Nom, code, SIRET, ville…',
    valeurs: (r: Ligne) => [r.name, r.externalCode, r.siret, r.city, r.postalCode, r.externalRef],
  }), []);

  const handleDeleteClient = async () => {
    if (!clientToDelete) return;
    try {
      await deleteClient(clientToDelete.id);
      toast({ title: "Client supprimé", description: "Le client et toutes ses données associées ont été supprimés." });
      await reloadData();
    } catch (error) {
      console.error("Failed to delete client:", error);
      toast({ title: "Erreur", description: "Impossible de supprimer le client.", variant: "destructive" });
    } finally {
      setClientToDelete(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Clients</h1>
        <p className="text-muted-foreground">Clients et prospects. Cliquez sur une ligne pour ouvrir la fiche.</p>
      </div>

      <DataTable
        id="clients"
        rows={lignes}
        rowId={r => r.id}
        colonnes={colonnes}
        chargement={isLoading}
        recherche={recherche}
        filtres={filtres}
        triInitial={{ id: 'nom', sens: 'asc' }}
        lien={r => `/clients/${r.id}`}
        export={{ fichier: 'clients.csv' }}
        boutons={<Button asChild size="sm" className="h-9 gap-1"><Link href="/clients/new"><PlusCircle className="h-4 w-4" />Nouveau client</Link></Button>}
        vide={{ titre: 'Aucun client.', description: 'Créez un client ou importez votre fichier clients (Administration › Imports).' }}
        actions={r => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Actions pour ${r.name}`}><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem asChild><Link href={`/clients/${r.id}`}>Ouvrir la fiche</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href={`/clients/${r.id}/edit`}>Modifier</Link></DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive" onClick={() => setClientToDelete(r)}>Supprimer</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />

      <AlertDialog open={!!clientToDelete} onOpenChange={() => setClientToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer {clientToDelete?.name} ?</AlertDialogTitle>
            <AlertDialogDescription>
              Action irréversible : le client ainsi que tous les sites et contrats associés seront supprimés définitivement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteClient} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Supprimer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
