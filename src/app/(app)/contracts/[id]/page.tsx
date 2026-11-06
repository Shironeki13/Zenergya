'use client';

import { EtatValidation, LienPiece } from "@/components/contracts/events/etat-document";
import { AFaire, Indicateur, eur0, CompteurAFaire, useOngletUrl, type PointAFaire } from "@/components/fiches/fiche";
import { CarteContacts, TableauFactures, TableauSites, etatSite } from "@/components/fiches/tableaux";
import { enRetard, periodesDuContrat } from "@/lib/billing/echeances-fiche";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { notFound, useRouter, useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ChevronLeft,
  Calendar,
  FileClock,
  FileText,
  PlusCircle,
  MapPin,
  Loader2,
  Paperclip,
  Edit,
  Trash2,
  CreditCard,
  Upload,
  User,
  Phone,
  Mail,
  Building2,
  TrendingUp,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getContract, getSitesByContract,
  getInvoicesByContract, getActivities, getClient, getContactsByClient,
  createSite, updateSite, deleteSite, updateContract,
  getAmendmentsByContract, getTerminationsByContract, getRenewalsByContract, getTrusteeChangesByContract, getBeChangesByContract
} from "@/services/firestore";
import type { Activity, Contract, Invoice, Site, RevisionInfo, Amendment, Termination, Renewal, TrusteeChange, BeChange, Client, Contact } from "@/lib/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useData } from "@/context/data-context";
import { ResponsableFacturation } from "@/components/pilotage/responsable-facturation";
import { P1ContratPanel } from "@/components/p1/p1-parametrage-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { AmendmentDialog } from "@/components/contracts/events/AmendmentDialog";
import { TerminationDialog } from "@/components/contracts/events/TerminationDialog";
import { RenewalDialog } from "@/components/contracts/events/RenewalDialog";
import { TrusteeChangeDialog } from "@/components/contracts/events/TrusteeChangeDialog";
import { BeChangeDialog } from "@/components/contracts/events/BeChangeDialog";
import { SiteImportDialog } from "@/components/contracts/SiteImportDialog";
import { ContractEInvoicingCard } from "@/components/contracts/EInvoicingCard";

const ONGLETS_CONTRAT = ['synthese', 'sites', 'factures', 'rfe', 'p1', 'historique'] as const;
type OngletContrat = typeof ONGLETS_CONTRAT[number];

export default function ContractDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const { toast } = useToast();
  const { revisionRules, services, vatRates, schedules, terms } = useData();

  const [isLoading, setIsLoading] = useState(true);
  const [contract, setContract] = useState<Contract | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);

  // Contract Events State
  const [amendments, setAmendments] = useState<Amendment[]>([]);
  const [terminations, setTerminations] = useState<Termination[]>([]);
  const [renewals, setRenewals] = useState<Renewal[]>([]);
  const [trusteeChanges, setTrusteeChanges] = useState<TrusteeChange[]>([]);
  const [beChanges, setBeChanges] = useState<BeChange[]>([]);

  // Event Dialogs State
  const [amendmentDialogOpen, setAmendmentDialogOpen] = useState(false);
  const [osDialogOpen, setOsDialogOpen] = useState(false);
  const [terminationDialogOpen, setTerminationDialogOpen] = useState(false);
  const [renewalDialogOpen, setRenewalDialogOpen] = useState(false);
  const [trusteeChangeDialogOpen, setTrusteeChangeDialogOpen] = useState(false);
  const [beChangeDialogOpen, setBeChangeDialogOpen] = useState(false);

  // Site Dialog State
  const [siteDialogOpen, setSiteDialogOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [siteToDelete, setSiteToDelete] = useState<Site | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  // Site Form State
  const [siteName, setSiteName] = useState('');
  const [siteNumber, setSiteNumber] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [sitePostalCode, setSitePostalCode] = useState('');
  const [siteCity, setSiteCity] = useState('');
  const [siteActivityIds, setSiteActivityIds] = useState<string[]>([]);
  const [siteAmounts, setSiteAmounts] = useState<Record<string, number>>({});
  const amountsFromServices = editingSite?.amountsSource === 'services';

  // Revision state per activity type
  const [revP1, setRevP1] = useState<Partial<RevisionInfo>>({});
  const [revP2, setRevP2] = useState<Partial<RevisionInfo>>({});
  const [revP3, setRevP3] = useState<Partial<RevisionInfo>>({});

  const reloadData = useCallback(async () => {
    if (!id) return;
    try {
      // Sites et documents du contrat (avenants, OS, reconductions, résiliations, changements de syndic et de BE).
      const [sitesData, am, te, re, tr, be] = await Promise.all([
        getSitesByContract(id), getAmendmentsByContract(id), getTerminationsByContract(id), getRenewalsByContract(id),
        getTrusteeChangesByContract(id), getBeChangesByContract(id),
      ]);
      setSites(sitesData);
      setAmendments(am); setTerminations(te); setRenewals(re); setTrusteeChanges(tr); setBeChanges(be);
    } catch (error) {
      console.error("Failed to reload data", error);
      toast({ title: "Erreur", description: "Impossible de rafraîchir les données.", variant: "destructive" });
    }
  }, [id, toast]);

  useEffect(() => {
    if (!id) return;
    async function fetchData() {
      setIsLoading(true);
      try {
        const contractData = await getContract(id);
        if (!contractData) {
          notFound();
          return;
        }
        setContract(contractData);

        const [
          sitesData,
          invoicesData,
          activitiesData,
          clientData,
          contactsData,
          amendmentsData,
          terminationsData,
          renewalsData,
          trusteeChangesData,
          beChangesData
        ] = await Promise.all([
          getSitesByContract(id),
          getInvoicesByContract(id),
          getActivities(),
          getClient(contractData.clientId),
          getContactsByClient(contractData.clientId),
          getAmendmentsByContract(id),
          getTerminationsByContract(id),
          getRenewalsByContract(id),
          getTrusteeChangesByContract(id),
          getBeChangesByContract(id),
        ]);

        setSites(sitesData);

        setInvoices(invoicesData);
        setActivities(activitiesData);
        setClient(clientData);
        setContacts(contactsData);

        setAmendments(amendmentsData);
        setTerminations(terminationsData);
        setRenewals(renewalsData);
        setTrusteeChanges(trusteeChangesData);
        setBeChanges(beChangesData);

      } catch (error) {
        console.error("Failed to fetch contract details:", error);
        toast({ title: "Erreur", description: "Impossible de charger les détails du contrat.", variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [id, toast]);


  // Site Management Handlers
  const resetSiteForm = () => {
    setSiteName('');
    setSiteNumber('');
    setSiteAddress('');
    setSitePostalCode('');
    setSiteCity('');
    setSiteActivityIds([]);
    setSiteAmounts({});
    setRevP1({});
    setRevP2({});
    setRevP3({});
    setEditingSite(null);
  };

  const handleOpenSiteDialog = (site: Site | null = null) => {
    resetSiteForm();
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
      setRevP1(site.revisionP1 || {});
      setRevP2(site.revisionP2 || {});
      setRevP3(site.revisionP3 || {});
    }
    setSiteDialogOpen(true);
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
      // Site piloté par ses prestations : activités et montants calculés, jamais écrits depuis ce formulaire.
      ...(!amountsFromServices && {
        activityIds: siteActivityIds,
        amounts: Object.entries(siteAmounts)
          .filter(([activityId]) => siteActivityIds.includes(activityId))
          .map(([activityId, amount]) => ({ activityId, amount: Number(amount) || 0 })),
      }),
      revisionP1: Object.keys(revP1).length > 0 ? revP1 as RevisionInfo : undefined,
      revisionP2: Object.keys(revP2).length > 0 ? revP2 as RevisionInfo : undefined,
      revisionP3: Object.keys(revP3).length > 0 ? revP3 as RevisionInfo : undefined,
    };

    try {
      if (editingSite) {
        await updateSite(editingSite.id, siteData);
        toast({ title: "Site mis à jour", description: "Le site a été mis à jour avec succès." });
      } else {
        const newSite = await createSite({ ...siteData, contractId: id, clientId: contract?.clientId } as Omit<Site, 'id'>);
        // Synchronise contract.siteIds
        const currentSiteIds = contract?.siteIds || [];
        if (newSite?.id && !currentSiteIds.includes(newSite.id)) {
          await updateContract(id, { siteIds: [...currentSiteIds, newSite.id] });
        }
        toast({ title: "Site créé", description: "Le nouveau site a été ajouté avec succès." });
      }
      await reloadData();
      setSiteDialogOpen(false);
      resetSiteForm();
    } catch (error) {
      console.error(error);
      toast({ title: "Erreur", description: "L'opération a échoué.", variant: "destructive" });
    }
  };

  const handleDeleteSite = async () => {
    if (!siteToDelete) return;
    try {
      await deleteSite(siteToDelete.id);
      // Synchronise contract.siteIds
      const currentSiteIds = contract?.siteIds || [];
      await updateContract(id, { siteIds: currentSiteIds.filter(sid => sid !== siteToDelete.id) });
      toast({ title: "Succès", description: "Le site a été supprimé." });
      await reloadData();
      setSiteToDelete(null);
    } catch (error) {
      toast({ title: "Erreur", description: "Impossible de supprimer le site.", variant: "destructive" });
    }
  };

  const handleSiteActivityChange = (activityId: string, checked: boolean) => {
    setSiteActivityIds(prev =>
      checked ? [...prev, activityId] : prev.filter(id => id !== activityId)
    );
  };

  const handleStatusChange = async (newStatus: Contract['status']) => {
    if (!contract || newStatus === contract.status) return;
    try {
      await updateContract(id, { status: newStatus });
      setContract(prev => prev ? { ...prev, status: newStatus } : prev);
      toast({ title: 'Statut mis à jour', description: `Contrat passé en "${newStatus}".` });
    } catch {
      toast({ title: 'Erreur', description: 'Impossible de mettre à jour le statut.', variant: 'destructive' });
    }
  };

  const getBadgeVariant = (status: Contract['status']): 'secondary' | 'destructive' | 'warning' | 'outline' => {
    switch (status) {
      case 'Actif': return 'secondary';
      case 'Résilié': return 'destructive';
      case 'Terminé': return 'warning';
      case 'Brouillon': return 'outline';
      default: return 'secondary';
    }
  };

  const [onglet, changerOnglet] = useOngletUrl<OngletContrat>(ONGLETS_CONTRAT, 'synthese');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!contract) {
    return notFound();
  }

  // ── Synthèse du contrat : indicateurs et points à traiter ──
  const daysUntilEnd = contract.endDate ? Math.ceil((new Date(contract.endDate).getTime() - Date.now()) / 86400000) : null;
  const showRenewAlert = daysUntilEnd !== null && daysUntilEnd <= 90 && daysUntilEnd >= 0 && contract.status === 'Actif';
  const etats = sites.map(site => ({ site, ...etatSite(site, services) }));
  const montantAnnuel = etats.reduce((t, e) => t + e.montant, 0);
  const sansPrestation = etats.filter(e => e.prestations.length === 0);
  const incompletes = etats.flatMap(e => e.incompletes);
  const facturesEmises = invoices.filter(i => i.status !== 'proforma' && i.status !== 'cancelled');
  const totalFacture = facturesEmises.reduce((t, i) => t + (Number(i.total) || 0), 0);
  const aPayer = invoices.filter(i => i.status === 'due' || i.status === 'overdue');
  const soldeDu = aPayer.reduce((t, i) => t + (Number(i.total) || 0), 0);
  const enRetardPaiement = invoices.filter(i => i.status === 'overdue' || (i.status === 'due' && i.dueDate && new Date(i.dueDate) < new Date()));
  const echeances = enRetard(periodesDuContrat(contract, sites, { services, activities, vatRates, schedules, terms, invoices }).values());
  const contactFacturation = contacts.find(c => c.type === 'facturation');
  const aDuP1 = activities.some(a => contract.activityIds?.includes(a.id) && a.type === 'P1');
  const pointsAFaire: PointAFaire[] = [
    ...(contract.validationStatus === 'refused' ? [{ id: 'refus', gravite: 'bloquant' as const, texte: `Contrat refusé à la validation${contract.refusalReason ? ` : ${contract.refusalReason}` : ''}.`, action: { label: 'Corriger', onClick: () => router.push(`/contracts/${id}/edit`) } }] : []),
    ...(contract.validationStatus === 'pending_validation' ? [{ id: 'validation', gravite: 'attention' as const, texte: 'Contrat en attente de validation : il n\'est pas encore facturé.' }] : []),
    ...(sites.length === 0 ? [{ id: 'sites', gravite: 'bloquant' as const, texte: 'Aucun site rattaché : rien n\'est facturé.', action: { label: 'Ajouter un site', onClick: () => handleOpenSiteDialog() } }] : []),
    ...(sansPrestation.length ? [{ id: 'sans', gravite: 'bloquant' as const, texte: `${sansPrestation.length} site(s) sans prestation : ${sansPrestation.slice(0, 3).map(e => e.site.name).join(', ')}${sansPrestation.length > 3 ? '…' : ''}.`, action: { label: 'Sites', onClick: () => changerOnglet('sites') } }] : []),
    ...(incompletes.length ? [{ id: 'inc', gravite: 'bloquant' as const, texte: `${incompletes.length} prestation(s) incomplète(s) (TVA, périodicité, terme ou montant manquant).`, action: { label: 'Sites', onClick: () => changerOnglet('sites') } }] : []),
    ...(echeances.length ? [{ id: 'echeances', gravite: 'attention' as const, texte: `${echeances.length} échéance(s) facturable(s) non facturée(s), la plus ancienne le ${echeances[0].dueDate.toLocaleDateString('fr-FR')}.`, action: { label: 'Suivi facturation', onClick: () => router.push('/billing/suivi') } }] : []),
    ...(enRetardPaiement.length ? [{ id: 'impayes', gravite: 'attention' as const, texte: `${enRetardPaiement.length} facture(s) en retard de paiement (${eur0(enRetardPaiement.reduce((t, i) => t + (Number(i.total) || 0), 0))} TTC).`, action: { label: 'Factures', onClick: () => changerOnglet('factures') } }] : []),
    ...(!contract.billingManagerId ? [{ id: 'responsable', gravite: 'attention' as const, texte: 'Aucun responsable facturation : le contrat n\'apparaît dans le portefeuille d\'aucun ADV (à choisir dans les informations ci-dessous).' }] : []),
    ...(!contactFacturation ? [{ id: 'contact', gravite: 'attention' as const, texte: 'Aucun contact de facturation chez le client.', action: { label: 'Fiche client', onClick: () => router.push(`/clients/${contract.clientId}`) } }] : []),
    ...(showRenewAlert ? [{ id: 'echeance', gravite: 'attention' as const, texte: `Le contrat arrive à échéance dans ${daysUntilEnd} jour(s), le ${new Date(contract.endDate).toLocaleDateString('fr-FR')}${contract.tacitRenewal ? ' (reconduction tacite)' : ''}.`, action: { label: 'Reconductions', onClick: () => changerOnglet('historique') } }] : []),
  ];
  const nbEvenements = amendments.length + terminations.length + renewals.length + trusteeChanges.length + beChanges.length;

  return (
    <div className="space-y-6">
      {/* Bandeau : identité du contrat, client, période, actions */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{contract.contractNumber ?? 'Contrat'}{contract.label ? ` — ${contract.label}` : ''}</h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Badge variant={getBadgeVariant(contract.status)} className="ml-auto sm:ml-0 cursor-pointer gap-1 hover:opacity-80">
              {contract.status}
              <ChevronDown className="h-3 w-3" />
            </Badge>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {(['Brouillon', 'Actif', 'Terminé', 'Résilié'] as Contract['status'][]).map(s => (
              <DropdownMenuItem
                key={s}
                onClick={() => handleStatusChange(s)}
                className={contract.status === s ? 'font-semibold' : ''}
              >
                {s}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            <Link href={`/clients/${contract.clientId}`} className="hover:text-foreground hover:underline">{client?.name || contract.clientName}</Link>
            <span aria-hidden>·</span>
            <span>{new Date(contract.startDate).toLocaleDateString('fr-FR')} → {new Date(contract.endDate).toLocaleDateString('fr-FR')}</span>
            <span aria-hidden>·</span>
            <span>{sites.length} site{sites.length > 1 ? 's' : ''}</span>
            <span aria-hidden>·</span>
            <span>{contract.invoicingType === 'global' ? 'Facturation globale' : 'Facturation par site'}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" asChild><Link href={`/contracts/${id}/edit`}>Modifier</Link></Button>
          <Button onClick={() => router.push('/billing')}><PlusCircle className="mr-2 h-4 w-4" />Générer une facture</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicateur titre="Montant annuel HT" valeur={eur0(montantAnnuel)} detail={`prestations en vigueur de ${sites.length} site(s)`} onClick={() => changerOnglet('sites')} />
        <Indicateur titre="Facturé TTC" valeur={eur0(totalFacture)} detail={`${facturesEmises.length} facture(s) émise(s)`} onClick={() => changerOnglet('factures')} />
        <Indicateur titre="Solde dû TTC" valeur={eur0(soldeDu)} detail={enRetardPaiement.length ? `${enRetardPaiement.length} en retard de paiement` : `${aPayer.length} facture(s) à payer`} alerte={enRetardPaiement.length > 0} onClick={() => changerOnglet('factures')} />
        <Indicateur titre="Échéances à facturer" valeur={`${echeances.length}`} detail={echeances.length ? `depuis le ${echeances[0].dueDate.toLocaleDateString('fr-FR')}` : 'facturation à jour'} alerte={echeances.length > 0} onClick={() => router.push('/billing/suivi')} />
      </div>

      <Tabs value={onglet} onValueChange={v => changerOnglet(v as OngletContrat)}>
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="synthese" className="gap-1.5">
            Synthèse
            <CompteurAFaire points={pointsAFaire} />
          </TabsTrigger>
          <TabsTrigger value="sites">Sites ({sites.length})</TabsTrigger>
          <TabsTrigger value="factures">Factures ({invoices.length})</TabsTrigger>
          <TabsTrigger value="rfe">Facturation électronique</TabsTrigger>
          {aDuP1 && <TabsTrigger value="p1">Paramétrage P1</TabsTrigger>}
          <TabsTrigger value="historique">Historique ({nbEvenements})</TabsTrigger>
        </TabsList>

        <TabsContent value="synthese" className="mt-4 space-y-6">
          <AFaire points={pointsAFaire} description="Ce qui empêche ou fragilise la facturation de ce contrat." />
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Informations</CardTitle></CardHeader>
              <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex items-center">
                <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>
                  {new Date(contract.startDate).toLocaleDateString('fr-FR')} —{" "}
                  {new Date(contract.endDate).toLocaleDateString('fr-FR')}
                </span>
              </div>
              <div className="flex items-center">
                <FileClock className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>
                  Facturé {sites[0]?.billingSchedule || contract.billingSchedule || 'Non défini'}
                </span>
              </div>
              <div className="flex items-center">
                <CreditCard className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>
                  Facturation : {contract.invoicingType === 'global' ? 'Globale' : 'Détaillée par site'}
                </span>
              </div>
              <ResponsableFacturation contractId={contract.id} value={contract.billingManagerId} />
              <div className="flex items-center gap-2">
                <MapPin className="mr-2 h-4 w-4 text-muted-foreground" />
                <Badge variant={sites.length > 1 ? "default" : "secondary"}>
                  {sites.length > 1 ? `Multi-sites (${sites.length})` : 'Mono-site'}
                </Badge>
              </div>
              <div className="flex items-start">
                <Paperclip className="mr-2 h-4 w-4 mt-1 text-muted-foreground" />
                <div>
                  <span className="font-medium">Documents :</span>
                  {contract.documents && contract.documents.length > 0 ? (
                    <ul className="list-disc pl-5">
                      {contract.documents.map((doc, index) => (
                        <li key={index} className="truncate">
                          <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                            {doc.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-muted-foreground ml-2">Aucun document</span>
                  )}
                </div>
              </div>
              <div className="flex items-center">
                <FileText className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>Libellé : {contract.label || 'N/A'}</span>
              </div>
              <div className="flex items-center">
                <FileText className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>Réf. Externe : {contract.externalRef || 'N/A'}</span>
              </div>
              <Separator className="my-2" />
              <div className="grid grid-cols-2 gap-2">
                <div><span className="font-medium">Base P1:</span> {contract.baseAmountP1?.toFixed(2) || '-'} €</div>
                <div><span className="font-medium">Base P2:</span> {contract.baseAmountP2?.toFixed(2) || '-'} €</div>
                <div><span className="font-medium">Base P3:</span> {contract.baseAmountP3?.toFixed(2) || '-'} €</div>
                <div><span className="font-medium">Base P3R:</span> {contract.baseAmountP3R?.toFixed(2) || '-'} €</div>
              </div>
              <Separator className="my-2" />
              <div className="grid grid-cols-2 gap-2">
                <div><span className="font-medium">Reconduction:</span> {contract.renewal ? 'Oui' : 'Non'}</div>
                <div><span className="font-medium">Tacite:</span> {contract.tacitRenewal ? 'Oui' : 'Non'}</div>
                <div><span className="font-medium">Durée:</span> {contract.renewalDuration || 'N/A'}</div>
              </div>
              <Separator className="my-2" />
              <div className="grid grid-cols-2 gap-2">
                <div><span className="font-medium">Signé Zenergya:</span> {contract.signedByCompany ? 'Oui' : 'Non'}</div>
                <div><span className="font-medium">Signé Client:</span> {contract.signedByClient ? 'Oui' : 'Non'}</div>
              </div>
            </div>
              </CardContent>
            </Card>
            <CarteContacts contacts={contacts} lienClient={`/clients/${contract.clientId}`} />
          </div>
        </TabsContent>

        <TabsContent value="sites" className="mt-4">
          <TableauSites sites={sites} services={services} onAjouter={() => handleOpenSiteDialog()} onImporter={() => setImportDialogOpen(true)}
            onModifier={site => handleOpenSiteDialog(site)} onSupprimer={site => setSiteToDelete(site)} />
        </TabsContent>

        <TabsContent value="factures" className="mt-4">
          <TableauFactures factures={invoices} onGenerer={() => router.push('/billing')} description="Factures et proformas du contrat, du plus récent au plus ancien." />
        </TabsContent>

        <TabsContent value="rfe" className="mt-4">
          <ContractEInvoicingCard contract={contract} client={client} onSaved={reloadData} />
        </TabsContent>

        {aDuP1 && (
          <TabsContent value="p1" className="mt-4">
            <P1ContratPanel contractId={contract.id} />
          </TabsContent>
        )}

        <TabsContent value="historique" className="mt-4">
      <Tabs defaultValue="amendments" className="w-full">
        <TabsList>
          <TabsTrigger value="amendments">Avenants ({amendments.length})</TabsTrigger>
          <TabsTrigger value="terminations">Résiliations ({terminations.length})</TabsTrigger>
          <TabsTrigger value="renewals">Reconductions ({renewals.length})</TabsTrigger>
          <TabsTrigger value="trustee">Chgts Syndic ({trusteeChanges.length})</TabsTrigger>
          <TabsTrigger value="be">Chgts BE ({beChanges.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="amendments">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div><CardTitle>Avenants et ordres de service</CardTitle><CardDescription>Chaque document est validé par un administrateur ; sa pièce fait foi.</CardDescription></div>
                <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setOsDialogOpen(true)}><PlusCircle className="mr-2 h-4 w-4" /> Ordre de service</Button><Button size="sm" onClick={() => setAmendmentDialogOpen(true)}><PlusCircle className="mr-2 h-4 w-4" /> Nouvel avenant</Button></div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead>Montant</TableHead><TableHead>Signé</TableHead><TableHead>Validation</TableHead><TableHead>Document</TableHead></TableRow></TableHeader>
                <TableBody>
                  {amendments.length > 0 ? amendments.map(a => (
                    <TableRow key={a.id}>
                      <TableCell>{new Date(a.effectiveDate).toLocaleDateString('fr-FR')}</TableCell>
                      <TableCell>{a.description}</TableCell>
                      <TableCell>{a.impactP1 ? `${a.impactP1} (P1)` : ''} {a.impactP2 ? `${a.impactP2} (P2)` : ''}</TableCell>
                      <TableCell>{a.signed ? 'Oui' : 'Non'}</TableCell>
                      <TableCell><EtatValidation doc={a} /></TableCell>
                      <TableCell><LienPiece doc={a} /></TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={6} className="text-center">Aucun avenant</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="terminations">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div><CardTitle>Résiliations</CardTitle><CardDescription>Historique des résiliations.</CardDescription></div>
                <Button size="sm" variant="destructive" onClick={() => setTerminationDialogOpen(true)}><PlusCircle className="mr-2 h-4 w-4" /> Résilier</Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Date Demande</TableHead><TableHead>Date Effective</TableHead><TableHead>Motif</TableHead><TableHead>Validation</TableHead><TableHead>Document</TableHead></TableRow></TableHeader>
                <TableBody>
                  {terminations.length > 0 ? terminations.map(t => (
                    <TableRow key={t.id}>
                      <TableCell>{new Date(t.createdAt).toLocaleDateString('fr-FR')}</TableCell>
                      <TableCell>{t.effectiveDate ? new Date(t.effectiveDate).toLocaleDateString('fr-FR') : '-'}</TableCell>
                      <TableCell>{t.reason}</TableCell>
                      <TableCell><EtatValidation doc={t} /></TableCell>
                      <TableCell><LienPiece doc={t} /></TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={5} className="text-center">Aucune résiliation</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="renewals">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div><CardTitle>Reconductions</CardTitle><CardDescription>Historique des reconductions.</CardDescription></div>
                <Button size="sm" onClick={() => setRenewalDialogOpen(true)}><PlusCircle className="mr-2 h-4 w-4" /> Reconduire</Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Nouvelle Date Fin</TableHead><TableHead>Durée</TableHead><TableHead>Validation</TableHead><TableHead>Document</TableHead></TableRow></TableHeader>
                <TableBody>
                  {renewals.length > 0 ? renewals.map(r => (
                    <TableRow key={r.id}>
                      <TableCell>{new Date(r.createdAt).toLocaleDateString('fr-FR')}</TableCell>
                      <TableCell>{new Date(r.newEndDate).toLocaleDateString('fr-FR')}</TableCell>
                      <TableCell>{r.duration}</TableCell>
                      <TableCell><EtatValidation doc={r} /></TableCell>
                      <TableCell><LienPiece doc={r} /></TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={5} className="text-center">Aucune reconduction</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="trustee">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div><CardTitle>Changements de Syndic</CardTitle><CardDescription>Historique des changements de syndic.</CardDescription></div>
                <Button size="sm" onClick={() => setTrusteeChangeDialogOpen(true)}><PlusCircle className="mr-2 h-4 w-4" /> Changer Syndic</Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Nouveau Syndic</TableHead><TableHead>Contact</TableHead><TableHead>Validation</TableHead><TableHead>Document</TableHead></TableRow></TableHeader>
                <TableBody>
                  {trusteeChanges.length > 0 ? trusteeChanges.map(t => (
                    <TableRow key={t.id}>
                      <TableCell>{new Date(t.effectiveDate).toLocaleDateString('fr-FR')}</TableCell>
                      <TableCell>{t.newRepresentative}</TableCell>
                      <TableCell>{t.contactEmail}</TableCell>
                      <TableCell><EtatValidation doc={t} /></TableCell>
                      <TableCell><LienPiece doc={t} /></TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={5} className="text-center">Aucun changement</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="be">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div><CardTitle>Changements de BE</CardTitle><CardDescription>Historique des changements de Bureau d'Études.</CardDescription></div>
                <Button size="sm" onClick={() => setBeChangeDialogOpen(true)}><PlusCircle className="mr-2 h-4 w-4" /> Changer BE</Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Nouveau BE</TableHead><TableHead>Contact</TableHead><TableHead>Validation</TableHead><TableHead>Document</TableHead></TableRow></TableHeader>
                <TableBody>
                  {beChanges.length > 0 ? beChanges.map(b => (
                    <TableRow key={b.id}>
                      <TableCell>{new Date(b.effectiveDate).toLocaleDateString('fr-FR')}</TableCell>
                      <TableCell>{b.newBe}</TableCell>
                      <TableCell>{b.contactEmail}</TableCell>
                      <TableCell><EtatValidation doc={b} /></TableCell>
                      <TableCell><LienPiece doc={b} /></TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={5} className="text-center">Aucun changement</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

        </TabsContent>
      </Tabs>

      {/* Event Dialogs */}
      <AmendmentDialog contractId={id} open={amendmentDialogOpen} onOpenChange={setAmendmentDialogOpen} onSuccess={reloadData} />
      <AmendmentDialog nature="os" contractId={id} open={osDialogOpen} onOpenChange={setOsDialogOpen} onSuccess={reloadData} />
      <TerminationDialog contractId={id} open={terminationDialogOpen} onOpenChange={setTerminationDialogOpen} onSuccess={reloadData} />
      <RenewalDialog contractId={id} open={renewalDialogOpen} onOpenChange={setRenewalDialogOpen} onSuccess={reloadData} />
      <TrusteeChangeDialog contractId={id} open={trusteeChangeDialogOpen} onOpenChange={setTrusteeChangeDialogOpen} onSuccess={reloadData} />
      <BeChangeDialog contractId={id} open={beChangeDialogOpen} onOpenChange={setBeChangeDialogOpen} onSuccess={reloadData} />

      {/* Site Dialog */}
      <Dialog open={siteDialogOpen} onOpenChange={setSiteDialogOpen}>
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
                          id={`activity-${activity.id}`}
                          checked={siteActivityIds.includes(activity.id)}
                          disabled={amountsFromServices}
                          onCheckedChange={(checked) => handleSiteActivityChange(activity.id, !!checked)}
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
                          disabled={amountsFromServices}
                          onChange={(e) => setSiteAmounts(prev => ({ ...prev, [activity.id]: parseFloat(e.target.value) || 0 }))}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Revision fields */}
            {siteActivityIds.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Révisions de prix</CardTitle>
                  <CardDescription>Configurez la règle de calcul, la périodicité et les montants de base pour chaque activité.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {activities.filter(a => siteActivityIds.includes(a.id)).map(activity => {
                    const rev = activity.type === 'P1' ? revP1 : activity.type === 'P2' ? revP2 : revP3;
                    const setRev = activity.type === 'P1' ? setRevP1 : activity.type === 'P2' ? setRevP2 : setRevP3;
                    const filteredRules = revisionRules.filter(r => !r.activityId || r.activityId === activity.id);
                    return (
                      <div key={`rev-${activity.id}`} className="space-y-3 p-3 border rounded-lg">
                        <h4 className="font-medium text-sm">{activity.label} ({activity.code})</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label>Règle de révision</Label>
                            <Select value={rev.ruleId || ''} onValueChange={(v) => setRev(prev => ({ ...prev, ruleId: v || undefined }))}>
                              <SelectTrigger><SelectValue placeholder="Aucune règle" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">— Aucune —</SelectItem>
                                {filteredRules.map(rule => (
                                  <SelectItem key={rule.id} value={rule.id}>{rule.name} ({rule.code})</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label>Périodicité</Label>
                            <Select value={rev.periodicity || ''} onValueChange={(v) => setRev(prev => ({ ...prev, periodicity: (v || undefined) as RevisionInfo['periodicity'] }))}>
                              <SelectTrigger><SelectValue placeholder="Non définie" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="annual">Annuelle</SelectItem>
                                <SelectItem value="semi-annual">Semestrielle</SelectItem>
                                <SelectItem value="quarterly">Trimestrielle</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label>Date anniversaire (JJ/MM)</Label>
                            <Input
                              placeholder="ex: 01-01"
                              value={rev.anniversaryDate || ''}
                              onChange={(e) => setRev(prev => ({ ...prev, anniversaryDate: e.target.value || undefined }))}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>Date de base</Label>
                            <Input
                              type="date"
                              value={rev.baseDate || ''}
                              onChange={(e) => setRev(prev => ({ ...prev, baseDate: e.target.value || undefined }))}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>Montant de base (€ HT)</Label>
                            <Input
                              type="number"
                              placeholder="Montant à réviser"
                              value={rev.baseAmount || ''}
                              onChange={(e) => setRev(prev => ({ ...prev, baseAmount: parseFloat(e.target.value) || undefined }))}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>Formule contractuelle (texte libre)</Label>
                            <Input
                              placeholder="ex: P0 × (0.15 + 0.85 × S/S0)"
                              value={rev.formula || ''}
                              onChange={(e) => setRev(prev => ({ ...prev, formula: e.target.value || undefined }))}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
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

      {/* Delete Site Dialog */}
      <Dialog open={!!siteToDelete} onOpenChange={(isOpen) => !isOpen && setSiteToDelete(null)}>
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

      {/* Site Import Dialog */}
      <SiteImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        contractId={id}
        clientId={contract?.clientId || ''}
        activities={activities}
        onComplete={reloadData}
      />
    </div>
  );
}
