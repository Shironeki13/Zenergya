
"use client"

import Link from "next/link"
import { useRouter, useParams } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import React, { useEffect, useState } from "react"
import { ChevronLeft, Loader2, CalendarIcon } from "lucide-react"
import { format } from "date-fns"
import { fr } from "date-fns/locale"

import { cn } from "@/lib/utils"
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
import { updateClient, getClient, getTypologies, getActivities } from "@/services/firestore"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { Checkbox } from "@/components/ui/checkbox"
import type { Typology, Client, Activity } from "@/lib/types"
import { ClientSchema } from "@/lib/types"

type ClientFormValues = z.infer<typeof ClientSchema>

export default function EditClientPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const { toast } = useToast()
  
  const [client, setClient] = React.useState<Client | null>(null);
  const [typologies, setTypologies] = useState<Typology[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);

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
      invoicingType: "multi-site",
      renewal: false,
      tacitRenewal: false,
      activityIds: [],
    },
  })

  useEffect(() => {
    if (!id) return;
    async function fetchData() {
        try {
            const [clientData, typologiesData, activitiesData] = await Promise.all([
                getClient(id),
                getTypologies(),
                getActivities(),
            ]);

            if (!clientData) {
                toast({ title: "Erreur", description: "Client non trouvé.", variant: "destructive" });
                router.push('/clients');
                return;
            }
            setClient(clientData);
            setTypologies(typologiesData);
            setActivities(activitiesData);
            
            form.reset({
                ...clientData,
                startDate: clientData.startDate ? new Date(clientData.startDate) : undefined,
                endDate: clientData.endDate ? new Date(clientData.endDate) : undefined,
            });
        } catch (error) {
            toast({ title: "Erreur", description: "Impossible de charger les données du client.", variant: "destructive" });
        } finally {
            setIsDataLoading(false);
        }
    }
    fetchData();
  }, [id, router, toast, form]);


  const watchTypologyId = form.watch("typologyId");
  const watchIsBe = form.watch("isBe");
  const watchUseChorus = form.watch("useChorus");
  const watchRenewal = form.watch("renewal");

  
  const selectedTypology = React.useMemo(() => 
    typologies.find(t => t.id === watchTypologyId),
    [typologies, watchTypologyId]
  );
  const showRepresentedBy = selectedTypology?.name === 'Copropriété';


  async function onSubmit(data: ClientFormValues) {
    try {
      await updateClient(id, data);
      toast({
        title: "Client Mis à Jour",
        description: "Le client a été mis à jour avec succès.",
      });
      router.push('/clients');
    } catch (error) {
      console.error("Échec de la mise à jour du client:", error);
      toast({
        title: "Erreur",
        description: "Échec de la mise à jour du client. Veuillez réessayer.",
        variant: "destructive"
      });
    }
  }

  if (isDataLoading || !client) {
    return <div className="flex justify-center items-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div>;
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
            <CardTitle>Modifier le Client: {client?.name}</CardTitle>
            <CardDescription>Mettez à jour le formulaire pour modifier la fiche client et son contrat.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
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
                  <Select onValueChange={field.onChange} value={field.value} disabled={isDataLoading}>
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
              )}/>}
               <FormField control={form.control} name="externalCode" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code externe</FormLabel>
                    <FormControl><Input placeholder="Code informatif" {...field} /></FormControl>
                    <FormDescription>Champ informatif non obligatoire.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                 <FormField control={form.control} name="invoicingType" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Type de facturation</FormLabel>
                         <FormControl>
                            <RadioGroup onValueChange={field.onChange} value={field.value} className="flex gap-4 pt-2">
                                <FormItem className="flex items-center space-x-2"><FormControl><RadioGroupItem value="multi-site" id="multi-site" /></FormControl><FormLabel htmlFor="multi-site" className="font-normal">Détaillée par site</FormLabel></FormItem>
                                <FormItem className="flex items-center space-x-2"><FormControl><RadioGroupItem value="global" id="global" /></FormControl><FormLabel htmlFor="global" className="font-normal">Globale</FormLabel></FormItem>
                            </RadioGroup>
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )} />
            </div>

            <Separator />
            <h2 className="text-xl font-semibold">Informations Contrat</h2>
            
             <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <FormField control={form.control} name="startDate" render={({ field }) => (
                    <FormItem className="flex flex-col"><FormLabel>Date de Démarrage</FormLabel>
                    <Popover><PopoverTrigger asChild><FormControl>
                        <Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                        {field.value ? format(field.value, "PPP", { locale: fr }) : <span>Choisir une date</span>}
                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                    </FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus locale={fr}/>
                    </PopoverContent></Popover><FormMessage />
                    </FormItem>
                )} />
                <FormField control={form.control} name="endDate" render={({ field }) => (
                    <FormItem className="flex flex-col"><FormLabel>Date de Fin</FormLabel>
                    <Popover><PopoverTrigger asChild><FormControl>
                        <Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                        {field.value ? format(field.value, "PPP", { locale: fr }) : <span>Choisir une date</span>}
                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                    </FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus locale={fr}/>
                    </PopoverContent></Popover><FormMessage />
                    </FormItem>
                )} />
            </div>

            <FormField
                control={form.control} name="activityIds" render={() => (
                <FormItem>
                    <div className="mb-4"><FormLabel className="text-base">Type de prestation</FormLabel></div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {activities.map((item) => (
                        <FormField
                            key={item.id} control={form.control} name="activityIds"
                            render={({ field }) => {
                            return (
                                <FormItem key={item.id} className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                                <FormControl>
                                    <Checkbox
                                    checked={field.value?.includes(item.id)}
                                    onCheckedChange={(checked) => {
                                        return checked
                                        ? field.onChange([...(field.value || []), item.id])
                                        : field.onChange(field.value?.filter((value) => value !== item.id))
                                    }}
                                    />
                                </FormControl>
                                <FormLabel className="font-normal">{item.label} ({item.code})</FormLabel>
                                </FormItem>
                            )}}
                        />
                        ))}
                    </div><FormMessage />
                </FormItem>
            )} />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                <FormField control={form.control} name="renewal" render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                        <div className="space-y-0.5"><FormLabel>Reconduction</FormLabel><FormDescription>Le contrat est-il à reconduction ?</FormDescription></div>
                        <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                )} />
                {watchRenewal && (
                    <div className="space-y-4">
                        <FormField control={form.control} name="renewalDuration" render={({ field }) => (<FormItem><FormLabel>Durée de reconduction</FormLabel><FormControl><Input placeholder="Ex: 1 an" {...field} /></FormControl><FormMessage /></FormItem>)} />
                        <FormField control={form.control} name="tacitRenewal" render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                <div className="space-y-0.5"><FormLabel>Tacite reconduction</FormLabel></div>
                                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                            </FormItem>
                        )} />
                    </div>
                )}
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

            <Button type="submit">Enregistrer les modifications</Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
