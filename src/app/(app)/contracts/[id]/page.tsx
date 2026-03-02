'use client';

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
} from "lucide-react";
import {
  getContract, getSitesByContract,
  getInvoicesByContract, getActivities, getClient, getContactsByClient,
  createSite, updateSite, deleteSite, updateContract,
  getAmendmentsByContract, getTerminationsByContract, getRenewalsByContract, getTrusteeChangesByContract, getBeChangesByContract
} from "@/services/firestore";
import type { Activity, Contract, Invoice, Site, RevisionInfo, Amendment, Termination, Renewal, TrusteeChange, BeChange, Client, Contact } from "@/lib/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useData } from "@/context/data-context";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { AmendmentDialog } from "@/components/contracts/events/AmendmentDialog";
import { TerminationDialog } from "@/components/contracts/events/TerminationDialog";
import { RenewalDialog } from "@/components/contracts/events/RenewalDialog";
import { TrusteeChangeDialog } from "@/components/contracts/events/TrusteeChangeDialog";
import { BeChangeDialog } from "@/components/contracts/events/BeChangeDialog";
import { SiteImportDialog } from "@/components/contracts/SiteImportDialog";

export default function ContractDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const { toast } = useToast();
  const { revisionRules } = useData();

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

  // Revision state per activity type
  const [revP1, setRevP1] = useState<Partial<RevisionInfo>>({});
  const [revP2, setRevP2] = useState<Partial<RevisionInfo>>({});
  const [revP3, setRevP3] = useState<Partial<RevisionInfo>>({});

  const reloadData = useCallback(async () => {
    if (!id) return;
    try {
      const sitesData = await getSitesByContract(id);
      setSites(sitesData);
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
      activityIds: siteActivityIds,
      amounts: Object.entries(siteAmounts)
        .filter(([activityId]) => siteActivityIds.includes(activityId))
        .map(([activityId, amount]) => ({ activityId, amount: Number(amount) || 0 })),
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

  const getBadgeVariant = (status: Contract['status']): 'secondary' | 'destructive' | 'warning' | 'outline' => {
    switch (status) {
      case 'Actif': return 'secondary';
      case 'Résilié': return 'destructive';
      case 'Terminé': return 'warning';
      case 'Brouillon': return 'outline';
      default: return 'secondary';
    }
  };

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

  // KPI calculations
  const totalContractualise = sites.reduce(
    (sum, site) => sum + (site.amounts?.reduce((s, a) => s + a.amount, 0) ?? 0),
    0
  );
  const totalFacture = invoices.reduce((sum, i) => sum + i.total, 0);
  const totalPaye = invoices.filter(i => i.status === 'paid').reduce((sum, i) => sum + i.total, 0);
  const soldeDu = invoices.filter(i => i.status === 'due' || i.status === 'overdue').reduce((sum, i) => sum + i.total, 0);

  // Reconduction alert
  const daysUntilEnd = contract.endDate
    ? Math.ceil((new Date(contract.endDate).getTime() - Date.now()) / 86400000)
    : null;
  const showRenewAlert = daysUntilEnd !== null && daysUntilEnd <= 90 && contract.status === 'Actif';

  const fmt = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="grid gap-4 md:gap-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/contracts">
          <Button variant="outline" size="icon" className="h-7 w-7">
            <ChevronLeft className="h-4 w-4" />
            <span className="sr-only">Retour</span>
          </Button>
        </Link>
        <h1 className="flex-1 shrink-0 whitespace-nowrap text-xl font-semibold tracking-tight sm:grow-0">
          Contrat pour {contract.clientName}
        </h1>
        <Badge variant={getBadgeVariant(contract.status)} className="ml-auto sm:ml-0">
          {contract.status}
        </Badge>
        <Button size="sm" asChild>
          <Link href={`/contracts/${id}/edit`}>Modifier</Link>
        </Button>
      </div>

      {/* Reconduction alert */}
      {showRenewAlert && (
        <Alert className="border-amber-500/50 bg-amber-50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-400 [&>svg]:text-amber-600">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Reconduction imminente</AlertTitle>
          <AlertDescription>
            Ce contrat arrive à échéance dans <strong>{daysUntilEnd} jour{daysUntilEnd > 1 ? 's' : ''}</strong> (le {new Date(contract.endDate).toLocaleDateString('fr-FR')}).
            {contract.tacitRenewal && " La reconduction tacite est activée."}
          </AlertDescription>
        </Alert>
      )}

      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5" /> Montant contractualisé
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{fmt(totalContractualise)} €</p>
            <p className="text-xs text-muted-foreground mt-1">Somme des montants sites</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <FileText className="h-3.5 w-3.5" /> Total facturé
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{fmt(totalFacture)} €</p>
            <p className="text-xs text-muted-foreground mt-1">{invoices.length} facture{invoices.length !== 1 ? 's' : ''}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <CreditCard className="h-3.5 w-3.5" /> Payé
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600">{fmt(totalPaye)} €</p>
            <p className="text-xs text-muted-foreground mt-1">Factures réglées</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> Solde dû
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${soldeDu > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
              {fmt(soldeDu)} €
            </p>
            <p className="text-xs text-muted-foreground mt-1">Due + en retard</p>
          </CardContent>
        </Card>
      </div>

      {/* Main 3-col grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Contract Details */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle>Détails du Contrat</CardTitle>
            <CardDescription>{contract.id}</CardDescription>
          </CardHeader>
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

        {/* Sites Management Card */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2"><MapPin className="h-5 w-5" /> Sites</CardTitle>
                <CardDescription>Sites rattachés à ce contrat.</CardDescription>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setImportDialogOpen(true)} title="Importer des sites">
                  <Upload className="h-5 w-5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => handleOpenSiteDialog()} title="Ajouter un site">
                  <PlusCircle className="h-5 w-5" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Ville</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sites.length > 0 ? (
                  sites.map(site => (
                    <TableRow key={site.id}>
                      <TableCell className="font-medium">
                        <Link href={`/sites/${site.id}`} className="hover:underline">{site.name}</Link>
                      </TableCell>
                      <TableCell>{site.city}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleOpenSiteDialog(site)}>
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => setSiteToDelete(site)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">Aucun site</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Client & Contacts Card */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" /> Client
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Link href={`/clients/${contract.clientId}`} className="font-semibold hover:underline text-sm">
                {client?.name || contract.clientName}
              </Link>
              <p className="text-xs text-muted-foreground mt-0.5">
                {[client?.address, client?.postalCode, client?.city].filter(Boolean).join(', ') || 'Adresse non renseignée'}
              </p>
            </div>
            <Separator />
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Contacts</p>
              {contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun contact renseigné.</p>
              ) : (
                contacts.map(contact => (
                  <div key={contact.id} className="text-sm space-y-1">
                    <p className="font-medium flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                      {contact.name}
                      <Badge variant="outline" className="ml-1 text-xs py-0">{contact.type}</Badge>
                    </p>
                    {contact.role && (
                      <p className="text-xs text-muted-foreground pl-5">{contact.role}</p>
                    )}
                    {contact.phone && (
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground pl-5">
                        <Phone className="h-3 w-3" /> {contact.phone}
                      </p>
                    )}
                    {contact.email && (
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground pl-5">
                        <Mail className="h-3 w-3" />
                        <a href={`mailto:${contact.email}`} className="hover:underline">{contact.email}</a>
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Invoices — full width */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" /> Factures
          </CardTitle>
          <CardDescription>
            Générez et suivez les factures pour ce contrat.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Facture</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Période</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.length > 0 ? invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-medium">
                    <Link href={`/invoices/${invoice.id}`} className="hover:underline">
                      {invoice.invoiceNumber || invoice.id}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{invoice.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {invoice.periodStartDate && invoice.periodEndDate
                      ? `${new Date(invoice.periodStartDate).toLocaleDateString('fr-FR')} – ${new Date(invoice.periodEndDate).toLocaleDateString('fr-FR')}`
                      : invoice.date ? new Date(invoice.date).toLocaleDateString('fr-FR') : '—'}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {invoice.total.toFixed(2)} €
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground h-16">Aucune facture</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
        <CardFooter>
          <Button size="sm" variant="outline" className="w-full gap-1" onClick={() => router.push('/billing')}>
            <PlusCircle className="h-4 w-4" />
            Générer une Facture
          </Button>
        </CardFooter>
      </Card>

      {/* Tabs */}
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
                <div><CardTitle>Avenants</CardTitle><CardDescription>Historique des avenants au contrat.</CardDescription></div>
                <Button size="sm" onClick={() => setAmendmentDialogOpen(true)}><PlusCircle className="mr-2 h-4 w-4" /> Nouvel Avenant</Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead>Montant</TableHead><TableHead>Signé</TableHead></TableRow></TableHeader>
                <TableBody>
                  {amendments.length > 0 ? amendments.map(a => (
                    <TableRow key={a.id}>
                      <TableCell>{new Date(a.effectiveDate).toLocaleDateString('fr-FR')}</TableCell>
                      <TableCell>{a.description}</TableCell>
                      <TableCell>{a.impactP1 ? `${a.impactP1} (P1)` : ''} {a.impactP2 ? `${a.impactP2} (P2)` : ''}</TableCell>
                      <TableCell>{a.signed ? 'Oui' : 'Non'}</TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={4} className="text-center">Aucun avenant</TableCell></TableRow>}
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
                <TableHeader><TableRow><TableHead>Date Demande</TableHead><TableHead>Date Effective</TableHead><TableHead>Motif</TableHead></TableRow></TableHeader>
                <TableBody>
                  {terminations.length > 0 ? terminations.map(t => (
                    <TableRow key={t.id}>
                      <TableCell>{new Date(t.createdAt).toLocaleDateString('fr-FR')}</TableCell>
                      <TableCell>{t.effectiveDate ? new Date(t.effectiveDate).toLocaleDateString('fr-FR') : '-'}</TableCell>
                      <TableCell>{t.reason}</TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={3} className="text-center">Aucune résiliation</TableCell></TableRow>}
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
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Nouvelle Date Fin</TableHead><TableHead>Durée</TableHead></TableRow></TableHeader>
                <TableBody>
                  {renewals.length > 0 ? renewals.map(r => (
                    <TableRow key={r.id}>
                      <TableCell>{new Date(r.createdAt).toLocaleDateString('fr-FR')}</TableCell>
                      <TableCell>{new Date(r.newEndDate).toLocaleDateString('fr-FR')}</TableCell>
                      <TableCell>{r.duration}</TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={3} className="text-center">Aucune reconduction</TableCell></TableRow>}
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
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Nouveau Syndic</TableHead><TableHead>Contact</TableHead></TableRow></TableHeader>
                <TableBody>
                  {trusteeChanges.length > 0 ? trusteeChanges.map(t => (
                    <TableRow key={t.id}>
                      <TableCell>{new Date(t.effectiveDate).toLocaleDateString('fr-FR')}</TableCell>
                      <TableCell>{t.newRepresentative}</TableCell>
                      <TableCell>{t.contactEmail}</TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={3} className="text-center">Aucun changement</TableCell></TableRow>}
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
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Nouveau BE</TableHead><TableHead>Contact</TableHead></TableRow></TableHeader>
                <TableBody>
                  {beChanges.length > 0 ? beChanges.map(b => (
                    <TableRow key={b.id}>
                      <TableCell>{new Date(b.effectiveDate).toLocaleDateString('fr-FR')}</TableCell>
                      <TableCell>{b.newBe}</TableCell>
                      <TableCell>{b.contactEmail}</TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={3} className="text-center">Aucun changement</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Event Dialogs */}
      <AmendmentDialog contractId={id} open={amendmentDialogOpen} onOpenChange={setAmendmentDialogOpen} onSuccess={reloadData} />
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
