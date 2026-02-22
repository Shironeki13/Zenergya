"use client"

import Link from "next/link"
import { useRouter, useParams } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import React, { useEffect, useState, useCallback } from "react"
import { ChevronLeft, Loader2, PlusCircle, Eye } from "lucide-react"

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
import { updateClient, getClient, getTypologies, getContractsByClient } from "@/services/firestore"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import type { Typology, Client, Contract } from "@/lib/types"
import { ClientSchema } from "@/lib/types"
import { AttachContractDialog } from "@/components/attach-contract-dialog"

type ClientFormValues = z.infer<typeof ClientSchema>

export default function EditClientPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const { toast } = useToast()

  const [client, setClient] = React.useState<Client | null>(null);
  const [typologies, setTypologies] = useState<Typology[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
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
      companyId: "",
      agencyId: "",
      sectorId: "",
    },
  })

  const refreshContracts = useCallback(async () => {
    if (!id) return;
    try {
      const contractsData = await getContractsByClient(id);
      setContracts(contractsData);
    } catch (error) {
      console.error("Failed to refresh contracts", error);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    async function fetchData() {
      try {
        const [clientData, typologiesData, contractsData] = await Promise.all([
          getClient(id),
          getTypologies(),
          getContractsByClient(id),
        ]);

        if (!clientData) {
          toast({ title: "Erreur", description: "Client non trouvé.", variant: "destructive" });
          router.push('/clients');
          return;
        }
        setClient(clientData);
        setTypologies(typologiesData);
        setContracts(contractsData);

        form.reset({
          ...clientData,
        });
      } catch (error) {
        console.error(error);
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
            <CardDescription>Mettez à jour les informations du client.</CardDescription>
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
              <div className="space-y-2">
                <FormLabel>Numéro Client</FormLabel>
                <Input value={client?.clientNumber || "Non défini"} disabled readOnly className="bg-muted" />
              </div>
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
              <p className="text-sm text-muted-foreground">Les contacts sont gérés séparément de la fiche client.</p>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Contrats Associés</h2>
                <div className="flex gap-2">
                  {client && <AttachContractDialog client={client} onContractAttached={refreshContracts} />}
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/contracts/new?clientId=${id}`}>
                      <PlusCircle className="mr-2 h-4 w-4" />
                      Nouveau
                    </Link>
                  </Button>
                </div>
              </div>

              {contracts.length > 0 ? (
                <div className="grid gap-4">
                  {contracts.map(contract => (
                    <div key={contract.id} className="flex items-center justify-between p-4 border rounded-lg bg-card text-card-foreground shadow-sm">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">Contrat {contract.id.substring(0, 8)}...</span>
                          <Badge variant={contract.status === 'Actif' ? 'default' : 'secondary'}>{contract.status}</Badge>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Du {new Date(contract.startDate).toLocaleDateString()} au {new Date(contract.endDate).toLocaleDateString()}
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" asChild>
                        <Link href={`/contracts/${contract.id}`}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed">
                  Aucun contrat associé.
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
