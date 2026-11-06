'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { PlusCircle, MoreHorizontal, Calendar as CalendarIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Label } from '@/components/ui/label';
import { DataTable, type Colonne } from '@/components/data-table/data-table';
import type { FiltreTable } from '@/components/data-table/logique';
import { eur0 } from '@/components/fiches/fiche';
import { etatSite } from '@/components/fiches/tableaux';
import { useData } from '@/context/data-context';
import type { Contract } from '@/lib/types';
import { updateContract } from '@/services/firestore';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

/**
 * Liste des contrats du périmètre de l'utilisateur (sociétés, agences, secteurs autorisés) : une seule liste, filtrable
 * par société, agence, secteur, statut, responsable facturation (tableau commun).
 */

type Ligne = Contract & {
  client: string; societe: string; agence: string; secteur: string; nbSites: number; montant: number; responsable: string; fin: string | null;
};

const VALIDATION: Record<string, string> = { validated: 'Validé', pending_validation: 'En attente', refused: 'Refusé' };

const varianteStatut = (status: Contract['status']): 'secondary' | 'destructive' | 'warning' | 'outline' =>
  status === 'Actif' ? 'secondary' : status === 'Résilié' ? 'destructive' : status === 'Terminé' ? 'warning' : 'outline';

export default function ContractsPage() {
  const { contracts, sites, clients, services, users, isLoading, reloadData, currentUser, companies, agencies, sectors } = useData();
  const { toast } = useToast();
  const [contractToUpdate, setContractToUpdate] = useState<Contract | null>(null);
  const [newStatus, setNewStatus] = useState<"Résilié" | "Terminé" | null>(null);
  const [terminationDate, setTerminationDate] = useState<Date | undefined>(new Date());

  // Contrats du périmètre de l'utilisateur (« * » : tout), d'après la société, l'agence et le secteur du client.
  const lignes: Ligne[] = useMemo(() => {
    const scope = currentUser?.scope;
    if (!scope) return [];
    const ok = (liste: string[], id?: string) => liste.includes('*') || (!!id && liste.includes(id));
    const clientsParId = new Map(clients.map(c => [c.id, c]));
    const nom = (m: { id: string; name: string }[], id?: string) => m.find(x => x.id === id)?.name ?? '';
    const nomUtilisateur = (id?: string | null) => { const u = users.find(x => x.id === id); return u ? [u.firstName, u.name].filter(Boolean).join(' ') || u.email : ''; };
    return contracts.flatMap(c => {
      const client = clientsParId.get(c.clientId);
      if (!client || !ok(scope.companyIds, client.companyId) || !ok(scope.agencyIds, client.agencyId) || !ok(scope.sectorIds, client.sectorId)) return [];
      const sitesDuContrat = sites.filter(s => s.contractId === c.id || c.siteIds?.includes(s.id));
      return [{
        ...c,
        client: client.name ?? c.clientName,
        societe: nom(companies, c.companyId || client.companyId),
        agence: nom(agencies, client.agencyId),
        secteur: nom(sectors, client.sectorId),
        nbSites: sitesDuContrat.length,
        montant: sitesDuContrat.reduce((t, s) => t + etatSite(s, services).montant, 0),
        responsable: nomUtilisateur(c.billingManagerId),
        fin: c.status === 'Résilié' && c.terminationDate ? c.terminationDate : c.endDate,
      }];
    });
  }, [contracts, sites, clients, services, users, currentUser, companies, agencies, sectors]);

  const colonnes: Colonne<Ligne>[] = useMemo(() => [
    { id: 'numero', label: 'N° de contrat', fixe: true, tri: r => r.contractNumber, exporter: r => r.contractNumber, cell: r => <span className="font-mono text-xs font-medium">{r.contractNumber ?? '—'}</span> },
    { id: 'client', label: 'Client', tri: r => r.client, exporter: r => r.client, cell: r => <span className="block max-w-[240px] truncate font-medium" title={r.client}>{r.client}</span> },
    { id: 'libelle', label: 'Libellé', tri: r => r.label, exporter: r => r.label, cell: r => <span className="block max-w-[200px] truncate" title={r.label}>{r.label || '—'}</span> },
    { id: 'statut', label: 'Statut', tri: r => r.status, exporter: r => r.status, cell: r => <Badge variant={varianteStatut(r.status)}>{r.status}</Badge> },
    { id: 'sites', label: 'Sites', align: 'right', tri: r => r.nbSites, exporter: r => r.nbSites, cell: r => r.nbSites },
    { id: 'montant', label: 'Montant annuel HT', align: 'right', tri: r => r.montant, exporter: r => r.montant, cell: r => eur0(r.montant) },
    { id: 'debut', label: 'Début', masquee: true, tri: r => new Date(r.startDate), exporter: r => r.startDate?.slice(0, 10), cell: r => new Date(r.startDate).toLocaleDateString('fr-FR') },
    {
      id: 'fin', label: 'Fin / résiliation', tri: r => (r.fin ? new Date(r.fin) : null), exporter: r => r.fin?.slice(0, 10),
      cell: r => r.fin ? <span className={cn(r.status === 'Résilié' && 'text-destructive')}>{new Date(r.fin).toLocaleDateString('fr-FR')}</span> : '—',
    },
    { id: 'responsable', label: 'Responsable', tri: r => r.responsable, exporter: r => r.responsable, cell: r => r.responsable || <span className="text-amber-700">Sans responsable</span> },
    { id: 'agence', label: 'Agence', masquee: true, tri: r => r.agence, exporter: r => r.agence, cell: r => r.agence || '—' },
    { id: 'secteur', label: 'Secteur', masquee: true, tri: r => r.secteur, exporter: r => r.secteur, cell: r => r.secteur || '—' },
    { id: 'societe', label: 'Société', masquee: true, tri: r => r.societe, exporter: r => r.societe, cell: r => r.societe || '—' },
    { id: 'validation', label: 'Validation', masquee: true, tri: r => r.validationStatus, exporter: r => VALIDATION[r.validationStatus] ?? '', cell: r => VALIDATION[r.validationStatus] ?? '—' },
    { id: 'ref', label: 'Réf. externe', masquee: true, tri: r => r.externalRef, exporter: r => r.externalRef, cell: r => r.externalRef || '—' },
  ], []);

  const filtres: FiltreTable<Ligne>[] = useMemo(() => [
    { id: 'statut', label: 'Statut', valeur: r => r.status },
    { id: 'societe', label: 'Société', valeur: r => r.societe },
    { id: 'agence', label: 'Agence', valeur: r => r.agence },
    { id: 'secteur', label: 'Secteur', valeur: r => r.secteur },
    { id: 'responsable', label: 'Responsable', valeur: r => r.responsable },
    { id: 'validation', label: 'Validation', valeur: r => r.validationStatus, libelle: v => VALIDATION[v] ?? v },
  ], []);

  const recherche = useMemo(() => ({
    placeholder: 'N° de contrat, client, libellé…',
    valeurs: (r: Ligne) => [r.contractNumber, r.client, r.label, r.name, r.externalRef],
  }), []);

  const handleOpenStatusDialog = (contract: Contract, status: "Résilié" | "Terminé") => {
    setContractToUpdate(contract);
    setNewStatus(status);
    if (status === 'Résilié') setTerminationDate(new Date());
  };
  const handleCloseStatusDialog = () => { setContractToUpdate(null); setNewStatus(null); setTerminationDate(undefined); };

  const handleStatusUpdate = async () => {
    if (!contractToUpdate || !newStatus) return;
    const updateData: Partial<Contract> = { status: newStatus };
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
    } catch {
      toast({ title: "Erreur", description: "La mise à jour du statut a échoué.", variant: "destructive" });
    } finally {
      handleCloseStatusDialog();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Contrats</h1>
        <p className="text-muted-foreground">Contrats de votre périmètre. Filtrez par société, agence, secteur ou responsable ; cliquez sur une ligne pour ouvrir la fiche.</p>
      </div>

      <DataTable
        id="contrats"
        rows={lignes}
        rowId={r => r.id}
        colonnes={colonnes}
        chargement={isLoading}
        recherche={recherche}
        filtres={filtres}
        triInitial={{ id: 'numero', sens: 'desc' }}
        lien={r => `/contracts/${r.id}`}
        export={{ fichier: 'contrats.csv' }}
        boutons={<Button asChild size="sm" className="h-9 gap-1"><Link href="/contracts/new"><PlusCircle className="h-4 w-4" />Nouveau contrat</Link></Button>}
        vide={{ titre: 'Aucun contrat dans votre périmètre.', description: 'Créez un contrat ou importez vos contrats (Administration › Imports).' }}
        actions={r => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Actions pour ${r.contractNumber ?? r.client}`}><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem asChild><Link href={`/contracts/${r.id}`}>Ouvrir la fiche</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href={`/contracts/${r.id}?onglet=sites`}>Voir les sites</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href={`/contracts/${r.id}/edit`}>Modifier</Link></DropdownMenuItem>
              {r.status === 'Actif' && (<>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => handleOpenStatusDialog(r, 'Résilié')}>Passer à Résilié</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleOpenStatusDialog(r, 'Terminé')}>Passer à Terminé</DropdownMenuItem>
              </>)}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />

      <Dialog open={!!contractToUpdate} onOpenChange={(isOpen) => !isOpen && handleCloseStatusDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier le statut du contrat</DialogTitle>
            <DialogDescription>
              {newStatus === 'Résilié'
                ? `Vous êtes sur le point de résilier le contrat ${contractToUpdate?.contractNumber ?? ''} de ${contractToUpdate?.clientName}. Choisissez la date de résiliation.`
                : `Le contrat ${contractToUpdate?.contractNumber ?? ''} de ${contractToUpdate?.clientName} passera « Terminé » et sa date de fin deviendra aujourd'hui.`}
            </DialogDescription>
          </DialogHeader>
          {newStatus === 'Résilié' && (
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="termination-date" className="text-right">Date de résiliation</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button id="termination-date" variant="outline" className={cn("col-span-3 justify-start text-left font-normal", !terminationDate && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {terminationDate ? format(terminationDate, "PPP", { locale: fr }) : <span>Choisir une date</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={terminationDate} onSelect={setTerminationDate} initialFocus locale={fr} />
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
    </div>
  );
}
