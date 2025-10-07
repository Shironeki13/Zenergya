
'use client';

import { useState, useEffect, useCallback, useMemo } from "react";
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
} from "lucide-react";
import { createMeterReading } from "@/services/firestore";
import type { Activity, Contract, Invoice, MeterReading, Site, Meter } from "@/lib/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useData } from "@/context/data-context";


export default function ContractDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const { toast } = useToast();

  const { contracts, sites: allSites, meters: allMeters, meterReadings: allReadings, invoices: allInvoices, activities, reloadData, isLoading } = useData();

  const [contract, setContract] = useState<Contract | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [meterReadings, setMeterReadings] = useState<MeterReading[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  
  const [selectedMeterId, setSelectedMeterId] = useState<string | null>(null);
  const [readingValue, setReadingValue] = useState('');

  useEffect(() => {
    if (!isLoading) {
      const contractData = contracts.find(c => c.id === id);
      if (!contractData) {
        notFound();
        return;
      }
      setContract(contractData);
      
      const contractSites = allSites.filter(site => contractData.siteIds.includes(site.id));
      setSites(contractSites);

      const contractSiteIds = contractSites.map(s => s.id);
      const contractMeters = allMeters.filter(meter => contractSiteIds.includes(meter.siteId));
      setMeters(contractMeters);

      const contractReadings = allReadings.filter(r => r.contractId === id);
      setMeterReadings(contractReadings);

      const contractInvoices = allInvoices.filter(i => i.contractId === id);
      setInvoices(contractInvoices);

    }
  }, [id, isLoading, contracts, allSites, allMeters, allReadings, allInvoices]);


  const handleSaveReading = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedMeterId || !readingValue) {
          toast({ title: "Erreur", description: "Veuillez sélectionner un compteur et saisir une valeur.", variant: "destructive"});
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
          await reloadData();
      } catch (error) {
          toast({ title: "Erreur", description: "Impossible d'enregistrer le relevé.", variant: "destructive" });
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

  const activityMap = new Map(activities.map((a: Activity) => [a.id, a.label]));
  const contractActivities = contract.activityIds.map(id => activityMap.get(id) || 'Activité inconnue');
  const meterMap = new Map(meters.map(m => [m.id, m.name]));
  const siteMap = new Map(sites.map(s => [s.id, s.name]));

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
        <Badge variant="outline" className="ml-auto sm:ml-0">
          {contract.status.charAt(0).toUpperCase() + contract.status.slice(1)}
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
                <CheckCircle className="mr-2 h-4 w-4 mt-1 text-muted-foreground" />
                <div>
                  <span className="font-medium">Prestations :</span>
                  <ul className="list-disc pl-5">
                    {contractActivities.map((activity) => (
                      <li key={activity}>{activity}</li>
                    ))}
                  </ul>
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
                  <Input id="reading" type="number" placeholder="Saisir le relevé..." value={readingValue} onChange={e => setReadingValue(e.target.value)}/>
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
    </div>
  );
}

    