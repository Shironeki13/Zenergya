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
import {
  ChevronLeft,
  Calendar,
  FileClock,
  CheckCircle,
  Gauge,
  FileText,
  PlusCircle,
  ClipboardList,
  MapPin,
  Loader2,
  Settings,
  Flame,
  Droplets,
  Clock,
  CalendarDays,
  Paperclip
} from "lucide-react";
import { createMeterReading, getContract, getSitesByClient, getMeters, getMeterReadingsByContract, getInvoicesByContract, getActivities, getRevisionFormulas, getTerms, getSchedules } from "@/services/firestore";
import type { Activity, Contract, Invoice, MeterReading, Site, Meter, RevisionFormula, Term, Schedule } from "@/lib/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

export default function ContractDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const { toast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [contract, setContract] = useState<Contract | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [meterReadings, setMeterReadings] = useState<MeterReading[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [revisionFormulas, setRevisionFormulas] = useState<RevisionFormula[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);

  const [selectedMeterId, setSelectedMeterId] = useState<string | null>(null);
  const [readingValue, setReadingValue] = useState('');

  const reloadReadings = useCallback(async () => {
    if (!id) return;
    try {
      const readingsData = await getMeterReadingsByContract(id);
      setMeterReadings(readingsData);
    } catch (error) {
      console.error("Failed to reload meter readings", error);
      toast({ title: "Erreur", description: "Impossible de rafraîchir les relevés.", variant: "destructive" });
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

        const [sitesData, metersData, readingsData, invoicesData, activitiesData, formulasData, termsData, schedulesData] = await Promise.all([
          getSitesByClient(contractData.clientId),
          getMeters(),
          getMeterReadingsByContract(id),
          getInvoicesByContract(id),
          getActivities(),
          getRevisionFormulas(),
          getTerms(),
          getSchedules(),
        ]);

        const contractSites = sitesData.filter(site => contractData.siteIds.includes(site.id));
        setSites(contractSites);

        const contractSiteIds = contractSites.map(s => s.id);
        const contractMeters = metersData.filter(meter => contractSiteIds.includes(meter.siteId));
        setMeters(contractMeters);

        setMeterReadings(readingsData);
        setInvoices(invoicesData);
        setActivities(activitiesData);
        setRevisionFormulas(formulasData);
        setTerms(termsData);
        setSchedules(schedulesData);

      } catch (error) {
        console.error("Failed to fetch contract details:", error);
        toast({ title: "Erreur", description: "Impossible de charger les détails du contrat.", variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [id, toast]);


  const handleSaveReading = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMeterId || !readingValue) {
      toast({ title: "Erreur", description: "Veuillez sélectionner un compteur et saisir une valeur.", variant: "destructive" });
      return;
    }

    const selectedMeter = meters.find(m => m.id === selectedMeterId);
    if (!selectedMeter) return;

    const readingData = {
      meterId: selectedMeterId,
      contractId: id,
      date: new Date().toISOString(),
      reading: parseFloat(readingValue),
      unit: selectedMeter.unit,
    };

    try {
      await createMeterReading(readingData);
      toast({ title: "Relevé enregistré", description: "Le relevé a été enregistré avec succès." });
      setSelectedMeterId(null);
      setReadingValue('');
      await reloadReadings();
    } catch (error) {
      toast({ title: "Erreur", description: "Impossible d'enregistrer le relevé.", variant: "destructive" });
    }
  }

  const getBadgeVariant = (status: Contract['status']): 'secondary' | 'destructive' | 'warning' | 'outline' => {
    switch (status) {
      case 'Actif':
        return 'secondary';
      case 'Résilié':
        return 'destructive';
      case 'Terminé':
        return 'warning';
      case 'Brouillon':
        return 'outline';
      default:
        return 'secondary';
    }
  }

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

  const activityMap = new Map(activities.map((a: Activity) => [a.id, { label: a.label, code: a.code }]));
  const revisionFormulaMap = new Map(revisionFormulas.map(f => [f.id, f.code]));
  const termMap = new Map(terms.map(t => [t.id, t.name]));
  const scheduleMap = new Map(schedules.map(s => [s.id, s.name]));

  const getActivitiesByCode = (code: string) => {
    return activities.find(a => a.code === code);
  }

  const p1Activity = getActivitiesByCode('P1');
  const p2Activity = getActivitiesByCode('P2');
  const p3Activity = getActivitiesByCode('P3');

  // Helper to get detail for an activity
  const getDetail = (activityId?: string) => {
    if (!activityId || !contract.activitiesDetails) return null;
    return contract.activitiesDetails.find(d => d.activityId === activityId);
  }

  const p1Detail = getDetail(p1Activity?.id);
  const p2Detail = getDetail(p2Activity?.id);
  const p3Detail = getDetail(p3Activity?.id);


  const meterMap = new Map(meters.map(m => [m.id, m.name]));
  const siteMap = new Map(sites.map(s => [s.id, s.name]));

  const renderRevisionInfo = (revision?: { formulaId?: string | null, date?: string }) => {
    if (!revision || !revision.formulaId) return "N/A";
    const formulaCode = revisionFormulaMap.get(revision.formulaId);
    const date = revision.date ? ` (depuis le ${new Date(revision.date).toLocaleDateString()})` : '';
    return `${formulaCode}${date}`;
  };


  return (
    <div className="grid gap-4 md:gap-8">
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
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
                  {new Date(contract.startDate).toLocaleDateString()} -{" "}
                  {new Date(contract.endDate).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center">
                <FileClock className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>
                  Facturé {contract.billingSchedule}
                </span>
              </div>
              <div className="flex items-center">
                <ClipboardList className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>
                  Terme : {contract.term}
                </span>
              </div>
              <div className="flex items-start">
                <MapPin className="mr-2 h-4 w-4 mt-1 text-muted-foreground" />
                <div>
                  <span className="font-medium">Sites ({sites.length}) :</span>
                  <ul className="list-disc pl-5">
                    {contract.siteIds.map((siteId) => (
                      <li key={siteId} className="truncate">{siteMap.get(siteId) || siteId}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="flex items-start">
                <Paperclip className="mr-2 h-4 w-4 mt-1 text-muted-foreground" />
                <div>
                  <span className="font-medium">Documents :</span>
                  {contract.documents && contract.documents.length > 0 ? (
                    <ul className="list-disc pl-5">
                      {contract.documents.map((docUrl, index) => (
                        <li key={index} className="truncate">
                          <a href={docUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                            Contrat PDF {index + 1}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-muted-foreground ml-2">Aucun document</span>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-5 w-5" /> Relevés de Compteur
            </CardTitle>
            <CardDescription>
              Saisissez les relevés pour les compteurs des sites de ce contrat.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveReading} className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label htmlFor="meter-select">Compteur</Label>
                <Select onValueChange={setSelectedMeterId} value={selectedMeterId || ''}>
                  <SelectTrigger id="meter-select">
                    <SelectValue placeholder="Sélectionner un compteur..." />
                  </SelectTrigger>
                  <SelectContent>
                    {meters.map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.name} ({m.code}) - {sites.find(s => s.id === m.siteId)?.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <div className="grid gap-2 flex-1">
                  <Label htmlFor="reading" className="sr-only">Relevé</Label>
                  <Input id="reading" type="number" placeholder="Saisir le relevé..." value={readingValue} onChange={e => setReadingValue(e.target.value)} />
                </div>
                <Button type="submit">Enregistrer</Button>
              </div>
            </form>
          </CardContent>
          <CardFooter className="flex flex-col items-start gap-2 text-sm">
            <div className="font-medium">Relevés précédents</div>
            <ul className="w-full">
              {meterReadings.map(r => (
                <li key={r.id} className="flex justify-between py-1 border-b last:border-0">
                  <span>{new Date(r.date).toLocaleDateString()} - {meterMap.get(r.meterId) || r.meterId}</span>
                  <span>{r.reading} {r.unit}</span>
                </li>
              ))}
            </ul>
          </CardFooter>
        </Card>

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
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium"><Link href={`/invoices/${invoice.id}`} className="hover:underline">{invoice.invoiceNumber || invoice.id}</Link></TableCell>
                    <TableCell>
                      <Badge variant="outline">{invoice.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {invoice.total.toFixed(2)} €
                    </TableCell>
                  </TableRow>
                ))}
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
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {p1Activity && contract.activityIds.includes(p1Activity.id) && (
          <Card className="lg:col-span-1">
            <CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle className="h-5 w-5 text-green-500" /> Prestation P1</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              {/* Prefer activitiesDetails if available, else fallback to legacy */}
              {p1Detail ? (
                <>
                  <div className="flex items-center"><Settings className="mr-2 h-4 w-4" /> Révision: {p1Detail.revisionFormula || 'Non définie'}</div>
                  {p1Detail.termId && <div className="flex items-center"><Clock className="mr-2 h-4 w-4" /> Terme: {termMap.get(p1Detail.termId) || p1Detail.termId}</div>}
                  {p1Detail.scheduleId && <div className="flex items-center"><CalendarDays className="mr-2 h-4 w-4" /> Échéancier: {scheduleMap.get(p1Detail.scheduleId) || p1Detail.scheduleId}</div>}

                  {/* P1 Specifics from Detail */}
                  <div className="p-3 border rounded-md space-y-2">
                    <h4 className="font-semibold flex items-center gap-2"><Flame className="h-4 w-4 text-orange-500" /> Détails Techniques</h4>
                    {p1Detail.contractualDJU !== undefined && <p>DJU Contractuel: {p1Detail.contractualDJU}</p>}
                    {p1Detail.weatherStation && <p>Station Météo: {p1Detail.weatherStation}</p>}
                    {p1Detail.contractualTemperature !== undefined && <p>Temp. Contractuelle: {p1Detail.contractualTemperature}°C</p>}
                    {p1Detail.contractualNB !== undefined && <p>NB Contractuel: {p1Detail.contractualNB}</p>}
                    {p1Detail.ecsSmallQ !== undefined && <p>Petit q (ECS): {p1Detail.ecsSmallQ}</p>}
                  </div>
                </>
              ) : (
                // Legacy Fallback
                <>
                  <div className="flex items-center"><Settings className="mr-2 h-4 w-4" /> Révision: {renderRevisionInfo(contract.revisionP1)}</div>
                  {contract.hasHeating && (
                    <div className="p-3 border rounded-md">
                      <h4 className="font-semibold mb-2 flex items-center gap-2"><Flame className="h-4 w-4 text-orange-500" /> Chauffage</h4>
                      <p>Forfait HT: {contract.heatingFlatRateHT?.toFixed(2) ?? 'N/A'} €/an</p>
                      <p>PU kWh: {contract.heatingUnitPriceKwh?.toFixed(4) ?? 'N/A'} €</p>
                      <p>DJU Réf: {contract.heatingReferenceDju ?? 'N/A'}</p>
                      <p>Station Météo: {contract.heatingWeatherStation || 'N/A'}</p>
                    </div>
                  )}
                  {contract.hasECS && (
                    <div className="p-3 border rounded-md">
                      <h4 className="font-semibold mb-2 flex items-center gap-2"><Droplets className="h-4 w-4 text-blue-500" /> Eau Chaude Sanitaire</h4>
                      <p>Forfait HT: {contract.ecsFlatRateHT?.toFixed(2) ?? 'N/A'} €/an</p>
                      <p>PU m³: {contract.ecsUnitPriceM3?.toFixed(2) ?? 'N/A'} €</p>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
        {p2Activity && contract.activityIds.includes(p2Activity.id) && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle className="h-5 w-5 text-green-500" /> Prestation P2</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {p2Detail ? (
                <>
                  <div className="flex items-center"><Settings className="mr-2 h-4 w-4" /> Révision: {p2Detail.revisionFormula || 'Non définie'}</div>
                  {p2Detail.termId && <div className="flex items-center"><Clock className="mr-2 h-4 w-4" /> Terme: {termMap.get(p2Detail.termId) || p2Detail.termId}</div>}
                  {p2Detail.scheduleId && <div className="flex items-center"><CalendarDays className="mr-2 h-4 w-4" /> Échéancier: {scheduleMap.get(p2Detail.scheduleId) || p2Detail.scheduleId}</div>}
                  {p2Detail.amount !== undefined && <div className="font-medium mt-2">Montant: {p2Detail.amount.toFixed(2)} €</div>}
                </>
              ) : (
                <div className="flex items-center"><Settings className="mr-2 h-4 w-4" /> Révision: {renderRevisionInfo(contract.revisionP2)}</div>
              )}
            </CardContent>
          </Card>
        )}
        {p3Activity && contract.activityIds.includes(p3Activity.id) && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle className="h-5 w-5 text-green-500" /> Prestation P3</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {p3Detail ? (
                <>
                  <div className="flex items-center"><Settings className="mr-2 h-4 w-4" /> Révision: {p3Detail.revisionFormula || 'Non définie'}</div>
                  {p3Detail.termId && <div className="flex items-center"><Clock className="mr-2 h-4 w-4" /> Terme: {termMap.get(p3Detail.termId) || p3Detail.termId}</div>}
                  {p3Detail.scheduleId && <div className="flex items-center"><CalendarDays className="mr-2 h-4 w-4" /> Échéancier: {scheduleMap.get(p3Detail.scheduleId) || p3Detail.scheduleId}</div>}
                  {p3Detail.amount !== undefined && <div className="font-medium mt-2">Montant: {p3Detail.amount.toFixed(2)} €</div>}
                </>
              ) : (
                <div className="flex items-center"><Settings className="mr-2 h-4 w-4" /> Révision: {renderRevisionInfo(contract.revisionP3)}</div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

    </div>
  );
}
