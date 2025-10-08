
"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import React from "react"
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
import { createClient } from "@/services/firestore"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import type { Typology } from "@/lib/types"
import { useData } from "@/context/data-context"


const clientFormSchema = z.object({
  name: z.string().min(2, "La raison sociale est requise."),
  address: z.string().optional(),
  postalCode: z.string().optional(),
  city: z.string().optional(),
  clientType: z.enum(["private", "public"], { required_error: "Le type de client est requis." }),
  typologyId: z.string({ required_error: "La typologie est requise." }),
  representedBy: z.string().optional(),
  externalCode: z.string().optional(),
  isBe: z.boolean().default(false),
  beName: z.string().optional(),
  beEmail: z.string().email({ message: "Email BE invalide." }).optional().or(z.literal('')),
  bePhone: z.string().optional(),
  useChorus: z.boolean().default(false),
  siret: z.string().optional(),
  chorusServiceCode: z.string().optional(),
  chorusLegalCommitmentNumber: z.string().optional(),
  chorusMarketNumber: z.string().optional(),
  invoicingType: z.enum(['multi-site', 'global'], { required_error: "Le type de facturation est requis."}),
}).superRefine((data, ctx) => {
    if (data.useChorus && (!data.siret || data.siret.length === 0)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Le SIRET est obligatoire si le dépôt Chorus est activé.",
            path: ["siret"],
        });
    }
});

type ClientFormValues = z.infer<typeof clientFormSchema>

export default function NewClientPage() {
  const router = useRouter();
  const { toast } = useToast()
  const { typologies, isLoading: isDataLoading, reloadData } = useData();

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientFormSchema),
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
    },
  })

  const watchTypologyId = form.watch("typologyId");
  const watchIsBe = form.watch("isBe");
  const watchUseChorus = form.watch("useChorus");
  
  const selectedTypology = React.useMemo(() => 
    typologies.find(t => t.id === watchTypologyId),
    [typologies, watchTypologyId]
  );
  const showRepresentedBy = selectedTypology?.name === 'Copropriété';

  async function onSubmit(data: ClientFormValues) {
    try {
      await createClient(data);
      toast({
        title: "Client Créé",
        description: "Le nouveau client a été créé avec succès.",
      });
      await reloadData();
      router.push('/clients');
    } catch (error) {
      console.error("Échec de la création du client:", error);
      toast({
        title: "Erreur",
        description: "Échec de la création du client. Veuillez réessayer.",
        variant: "destructive"
      });
    }
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
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
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
                            <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex gap-4 pt-2">
                                <FormItem className="flex items-center space-x-2"><FormControl><RadioGroupItem value="multi-site" id="multi-site" /></FormControl><FormLabel htmlFor="multi-site" className="font-normal">Détaillée par site</FormLabel></FormItem>
                                <FormItem className="flex items-center space-x-2"><FormControl><RadioGroupItem value="global" id="global" /></FormControl><FormLabel htmlFor="global" className="font-normal">Globale</FormLabel></FormItem>
                            </RadioGroup>
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )} />
            </div>

            <Separator />
            
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

            <Separator />

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

    