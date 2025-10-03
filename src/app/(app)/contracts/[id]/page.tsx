
'use client';

import { useState, useEffect } from "react";
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
import { getContract, getMeterReadingsByContract, getInvoicesByContract, getActivities, getSites } from "@/services/firestore";
import type { Activity, Contract, Invoice, MeterReading, Site } from "@/lib/types";

export default function ContractDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [contract, setContract] = useState<Contract | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [meterReadings, setMeterReadings] = useState<MeterReading[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    async function fetchData() {
      if (!id) return;
      try {
        const contractData = await getContract(id);
        if (!contractData) {
          notFound();
          return;
        }
        setContract(contractData);

        const [readingsData, invoicesData, activitiesData, allSites] = await Promise.all([
          getMeterReadingsByContract(id),
          getInvoicesByContract(id),
          getActivities(),
          getSites(),
        ]);
        
        const contractSites = allSites.filter(site => contractData.siteIds.includes(site.id));
        
        setSites(contractSites);
        setMeterReadings(readingsData);
        setInvoices(invoicesData);
        setActivities(activitiesData);
      } catch (error) {
        console.error("Failed to fetch contract details:", error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [id]);
  
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
                    {sites.map((site) => (
                      <li key={site.id} className="truncate">{site.name}</li>
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
              Saisissez et consultez les relevés de compteur historiques pour les sites de ce contrat.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex items-end gap-2">
              <div className="grid gap-2 flex-1">
                <Label htmlFor="reading" className="sr-only">
                  Relevé
                </Label>
                <Input id="reading" type="number" placeholder="Saisir le relevé..." />
              </div>
              <Button type="submit">Enregistrer</Button>
            </form>
          </CardContent>
          <CardFooter className="flex flex-col items-start gap-2 text-sm">
             <div className="font-medium">Relevés précédents</div>
             <ul className="w-full">
              {meterReadings.map(r => (
                <li key={r.id} className="flex justify-between py-1 border-b last:border-0">
                  <span>{new Date(r.date).toLocaleDateString()} - {sites.find(s => s.id === r.siteId)?.name || r.siteId}</span>
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
