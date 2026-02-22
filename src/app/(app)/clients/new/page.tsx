
"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import React, { useEffect, useState } from "react"
import { ChevronLeft, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient, getTypologies } from "@/services/firestore"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import type { Typology, Company, Agency, Sector } from "@/lib/types"
import { ClientSchema } from "@/lib/types"
import { useData } from "@/context/data-context"


type ClientFormValues = z.infer<typeof ClientSchema>

export default function NewClientPage() {
  const router = useRouter();
  const { toast } = useToast()
  const { currentUser, companies, agencies, sectors, reloadData } = useData();
  const [typologies, setTypologies] = useState<Typology[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const typologiesData = await getTypologies();
        setTypologies(typologiesData);
      } catch (error) {
        toast({ title: "Erreur", description: "Impossible de charger les données de paramétrage.", variant: "destructive" });
      } finally {
        setIsDataLoading(false);
      }
    }
    fetchData();
  }, [toast]);

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(ClientSchema),
    defaultValues: {
      name: "",
      address: "",
      postalCode: "",
      city: "",
      clientType: "private",
      representedBy: "",
      externalCode: "",
      isBe: false,
      beName: "",
      beEmail: "",
      bePhone: "",
      useChorus: false,
      siret: "",
      chorusServiceCode: "",
      chorusLegalCommitmentNumber: "",
      chorusMarketNumber: "",
      // Pre-fill hierarchy from current user scope if possible, or default to empty/first available
      companyId: currentUser?.scope?.companyIds[0] !== '*' ? currentUser?.scope?.companyIds[0] : "",
      agencyId: currentUser?.scope?.agencyIds[0] !== '*' ? currentUser?.scope?.agencyIds[0] : "",
      sectorId: currentUser?.scope?.sectorIds[0] !== '*' ? currentUser?.scope?.sectorIds[0] : "",
    },
  })

  const watchTypologyId = form.watch("typologyId");
  const watchIsBe = form.watch("isBe");
  const watchUseChorus = form.watch("useChorus");
  const watchCompanyId = form.watch("companyId");
  const watchAgencyId = form.watch("agencyId");

  const selectedTypology = React.useMemo(() =>
    typologies.find(t => t.id === watchTypologyId),
    [typologies, watchTypologyId]
  );
  const showRepresentedBy = selectedTypology?.name === 'Copropriété';

  const filteredAgencies = React.useMemo(() =>
    watchCompanyId ? agencies.filter(a => a.companyId === watchCompanyId) : agencies,
    [agencies, watchCompanyId]
  );
  const filteredSectors = React.useMemo(() =>
    watchAgencyId ? sectors.filter(s => s.agencyId === watchAgencyId) : sectors,
    [sectors, watchAgencyId]
  );

  async function onSubmit(data: ClientFormValues) {
    try {
      const newClient = await createClient(data);
      await reloadData();
      toast({
        title: "Client Créé",
        description: "Le nouveau client a été créé avec succès.",
      });
      // Redirect to the new client's page to allow adding a contract immediately
      router.push(`/clients/${newClient.id}`);
    } catch (error) {
      console.error("Échec de la création du client:", error);
      toast({
        title: "Erreur",
        description: "Échec de la création du client. Veuillez réessayer.",
        variant: "destructive"
      });
    }
  }

  function onInvalid(errors: Record<string, unknown>) {
    const errorFields = Object.keys(errors);
    const fieldLabels: Record<string, string> = {
      name: 'Raison sociale',
      typologyId: 'Typologie',
      companyId: 'Société',
      agencyId: 'Agence',
      sectorId: 'Secteur',
      clientType: 'Type de client',
      siret: 'SIRET',
    };
    const labels = errorFields.map(f => fieldLabels[f] || f).join(', ');
    toast({
      title: "Formulaire incomplet",
      description: `Champs invalides : ${labels}`,
      variant: "destructive",
    });
    console.error('Form validation errors:', errors);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-4">
          <Link href="/clients">
            <Button variant="outline" size="icon">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <CardTitle>Nouveau Client</CardTitle>
            <CardDescription>Remplissez le formulaire pour créer une nouvelle fiche client.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isDataLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-8">

              {/* Hierarchy fields: Company → Agency → Sector */}
              <h2 className="text-xl font-semibold">Rattachement</h2>
              <div className="grid md:grid-cols-3 gap-8">
                <FormField control={form.control} name="companyId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Société</FormLabel>
                    <Select onValueChange={(val) => { field.onChange(val); form.setValue('agencyId', ''); form.setValue('sectorId', ''); }} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Sélectionnez une société" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="agencyId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Agence</FormLabel>
                    <Select onValueChange={(val) => { field.onChange(val); form.setValue('sectorId', ''); }} value={field.value} disabled={!watchCompanyId}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Sélectionnez une agence" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {filteredAgencies.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="sectorId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Secteur</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={!watchAgencyId}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Sélectionnez un secteur" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {filteredSectors.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <Separator />

              <h2 className="text-xl font-semibold">Informations Client</h2>
              <div className="grid md:grid-cols-2 gap-8">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Raison Sociale</FormLabel>
                    <FormControl><Input placeholder="Wayne Enterprises" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="address" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Adresse</FormLabel>
                    <FormControl><Input placeholder="1007 Mountain Drive" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="postalCode" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Code postal</FormLabel>
                      <FormControl><Input placeholder="75000" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="city" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ville</FormLabel>
                      <FormControl><Input placeholder="Gotham" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="clientType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Privé / Public</FormLabel>
                    <FormControl>
                      <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex gap-4 pt-2">
                        <FormItem className="flex items-center space-x-2"><FormControl><RadioGroupItem value="private" id="private" /></FormControl><FormLabel htmlFor="private" className="font-normal">Privé</FormLabel></FormItem>
                        <FormItem className="flex items-center space-x-2"><FormControl><RadioGroupItem value="public" id="public" /></FormControl><FormLabel htmlFor="public" className="font-normal">Public</FormLabel></FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="typologyId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Typologie client</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isDataLoading}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Sélectionnez une typologie" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {typologies.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                {showRepresentedBy && <FormField control={form.control} name="representedBy" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Représenté par</FormLabel>
                    <FormControl><Input placeholder="Syndic de copropriété" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />}
                <FormField control={form.control} name="externalCode" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code externe</FormLabel>
                    <FormControl><Input placeholder="Code informatif" {...field} /></FormControl>
                    <FormDescription>Champ informatif non obligatoire.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <Separator />

              <div className="p-4 border rounded-lg bg-muted/50">
                <h2 className="text-xl font-semibold mb-2">Contacts</h2>
                <p className="text-sm text-muted-foreground">Les contacts seront gérés séparément après la création du client.</p>
              </div>

              <Separator />

              <h2 className="text-xl font-semibold">Options Avancées Client</h2>
              <div className="grid md:grid-cols-2 gap-8 items-start">
                <FormField control={form.control} name="isBe" render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5"><FormLabel>Bureau d'études (BE)</FormLabel><FormDescription>Le client est-il un bureau d'études ?</FormDescription></div>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />
                {watchIsBe && (
                  <div className="space-y-4 p-4 border rounded-lg">
                    <FormField control={form.control} name="beName" render={({ field }) => (<FormItem><FormLabel>Nom BE</FormLabel><FormControl><Input placeholder="Nom du bureau d'étude" {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="beEmail" render={({ field }) => (<FormItem><FormLabel>Mail BE</FormLabel><FormControl><Input placeholder="contact@be.com" {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="bePhone" render={({ field }) => (<FormItem><FormLabel>Tél BE (Optionnel)</FormLabel><FormControl><Input placeholder="0123456789" {...field} /></FormControl><FormMessage /></FormItem>)} />
                  </div>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-8 items-start">
                <FormField control={form.control} name="useChorus" render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5"><FormLabel>Dépôt Chorus</FormLabel><FormDescription>Activer le dépôt des factures sur Chorus Pro ?</FormDescription></div>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />
                <div className="space-y-4 p-4 border rounded-lg">
                  <FormField control={form.control} name="siret" render={({ field }) => (
                    <FormItem>
                      <FormLabel>SIRET</FormLabel>
                      <FormControl><Input placeholder="12345678901234" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  {watchUseChorus && (<>
                    <FormField control={form.control} name="chorusServiceCode" render={({ field }) => (<FormItem><FormLabel>Code service</FormLabel><FormControl><Input placeholder="Code service Chorus" {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="chorusLegalCommitmentNumber" render={({ field }) => (<FormItem><FormLabel>Numéro engagement juridique</FormLabel><FormControl><Input placeholder="Numéro EJ" {...field} /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="chorusMarketNumber" render={({ field }) => (<FormItem><FormLabel>Numéro de marché</FormLabel><FormControl><Input placeholder="Numéro de marché" {...field} /></FormControl><FormMessage /></FormItem>)} />
                  </>)}
                </div>
              </div>



              <Button type="submit">Créer le Client</Button>
            </form>
          </Form>
        )}
      </CardContent>
    </Card>
  )
}
