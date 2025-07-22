
"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, useFieldArray } from "react-hook-form"
import * as z from "zod"
import { CalendarIcon, ChevronLeft } from "lucide-react"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import React, { useState, useEffect } from 'react';

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Checkbox } from "@/components/ui/checkbox"
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createContract, getActivities, getSchedules, getTerms, getClients, getSitesByClient, getMarkets, getRevisionFormulas } from "@/services/firestore"
import type { Activity, Schedule, Term, Client, Site, Market, RevisionFormula } from "@/lib/types"
import { Separator } from "@/components/ui/separator"


const monthlyBillingSchema = z.object({
  month: z.string(),
  date: z.number().min(1).max(31),
  percentage: z.number().min(0).max(100),
});

const contractFormSchema = z.object({
  clientId: z.string({ required_error: "Un client est requis." }),
  siteIds: z.array(z.string()).refine((value) => value.length > 0, {
    message: "Vous devez sélectionner au moins un site.",
  }),
  startDate: z.date({ required_error: "Une date de début est requise." }),
  endDate: z.date({ required_error: "Une date de fin est requise." }),
  billingSchedule: z.string({ required_error: "Un échéancier de facturation est requis." }),
  term: z.string({ required_error: "Un terme de facturation est requis." }),
  activityIds: z.array(z.string()).refine((value) => value.some((item) => item), {
    message: "Vous devez sélectionner au moins une prestation.",
  }),
  marketId: z.string().optional(),
  hasInterest: z.boolean().default(false),
  revisionFormulaId: z.string().optional(),
  revisionDate: z.date().optional(),
  monthlyBilling: z.array(monthlyBillingSchema).optional(),
}).superRefine((data, ctx) => {
    if (data.billingSchedule === 'Variable') {
        const totalPercentage = data.monthlyBilling?.reduce((acc, month) => acc + month.percentage, 0) ?? 0;
        if (totalPercentage !== 100) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "La somme des pourcentages de facturation mensuelle doit être égale à 100.",
                path: ["monthlyBilling"],
            });
        }
    }
});

type ContractFormValues = z.infer<typeof contractFormSchema>

const months = [ "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre" ];

const defaultValues: Partial<ContractFormValues> = {
  activityIds: [],
  siteIds: [],
  hasInterest: false,
  monthlyBilling: months.map(m => ({ month: m, date: 1, percentage: 0 })),
}

export default function NewContractPage() {
  const router = useRouter();
  const { toast } = useToast()
  
  const [clients, setClients] = useState<Client[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [revisionFormulas, setRevisionFormulas] = useState<RevisionFormula[]>([]);

  const form = useForm<ContractFormValues>({
    resolver: zodResolver(contractFormSchema),
    defaultValues,
  })

  const { fields } = useFieldArray({
    control: form.control,
    name: "monthlyBilling",
  });

  const selectedClientId = form.watch("clientId");
  const watchBillingSchedule = form.watch("billingSchedule");

  useEffect(() => {
    async function fetchInitialData() {
      try {
        const [
            fetchedClients, 
            fetchedActivities, 
            fetchedSchedules, 
            fetchedTerms,
            fetchedMarkets,
            fetchedRevisionFormulas
        ] = await Promise.all([
            getClients(),
            getActivities(),
            getSchedules(),
            getTerms(),
            getMarkets(),
            getRevisionFormulas()
        ]);
        setClients(fetchedClients);
        setActivities(fetchedActivities);
        setSchedules(fetchedSchedules);
        setTerms(fetchedTerms);
        setMarkets(fetchedMarkets);
        setRevisionFormulas(fetchedRevisionFormulas);
      } catch (error) {
        toast({
          title: "Erreur",
          description: "Impossible de charger les données de paramétrage.",
          variant: "destructive"
        })
      }
    }
    fetchInitialData();
  }, [toast]);

  useEffect(() => {
    async function fetchSites() {
      if (selectedClientId) {
        try {
            const fetchedSites = await getSitesByClient(selectedClientId);
            setSites(fetchedSites);
            form.setValue('siteIds', []); // Reset site selection when client changes
        } catch (error) {
            toast({ title: "Erreur", description: "Impossible de charger les sites du client.", variant: "destructive" });
        }
      } else {
        setSites([]);
      }
    }
    fetchSites();
  }, [selectedClientId, toast, form]);


  async function onSubmit(data: ContractFormValues) {
    try {
        const selectedClient = clients.find(c => c.id === data.clientId);
        if (!selectedClient) throw new Error("Client non trouvé");

        const contractData = {
            ...data,
            startDate: format(data.startDate, "yyyy-MM-dd"),
            endDate: format(data.endDate, "yyyy-MM-dd"),
            revisionDate: data.revisionDate ? format(data.revisionDate, "yyyy-MM-dd") : undefined,
            clientName: selectedClient.name,
        }
      await createContract(contractData);
      toast({
        title: "Contrat Créé",
        description: "Le nouveau contrat a été créé avec succès.",
      });
      router.push('/contracts');
    } catch (error) {
      console.error("Échec de la création du contrat:", error);
      toast({
        title: "Erreur",
        description: "Échec de la création du contrat. Veuillez réessayer.",
        variant: "destructive"
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-4">
            <Link href="/contracts">
                <Button variant="outline" size="icon">
                    <ChevronLeft className="h-4 w-4" />
                </Button>
            </Link>
            <div>
              <CardTitle>Nouveau Contrat</CardTitle>
              <CardDescription>Remplissez le formulaire pour créer un nouveau contrat client.</CardDescription>
            </div>
        </div>
      </CardHeader>
      <CardContent>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          
          <FormField
            control={form.control}
            name="clientId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Client</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionnez un client" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          
          {selectedClientId && (
            <FormField
                control={form.control}
                name="siteIds"
                render={() => (
                <FormItem>
                    <div className="mb-4">
                    <FormLabel className="text-base">Sites</FormLabel>
                    <FormDescription>
                        Sélectionnez les sites à inclure dans ce contrat.
                    </FormDescription>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {sites.map((item) => (
                        <FormField
                            key={item.id}
                            control={form.control}
                            name="siteIds"
                            render={({ field }) => {
                            return (
                                <FormItem
                                key={item.id}
                                className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4"
                                >
                                <FormControl>
                                    <Checkbox
                                    checked={field.value?.includes(item.id)}
                                    onCheckedChange={(checked) => {
                                        return checked
                                        ? field.onChange([...(field.value || []), item.id])
                                        : field.onChange(
                                            field.value?.filter(
                                                (value) => value !== item.id
                                            )
                                            )
                                    }}
                                    />
                                </FormControl>
                                <FormLabel className="font-normal">
                                    {item.name} - <span className="text-muted-foreground">{item.address}</span>
                                </FormLabel>
                                </FormItem>
                            )
                            }}
                        />
                        ))}
                    </div>
                    <FormMessage />
                </FormItem>
                )}
            />
          )}


          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <FormField
              control={form.control}
              name="startDate"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Date de Début</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant={"outline"}
                          className={cn(
                            "w-full pl-3 text-left font-normal",
                            !field.value && "text-muted-foreground"
                          )}
                        >
                          {field.value ? (
                            format(field.value, "PPP", { locale: fr })
                          ) : (
                            <span>Choisir une date</span>
                          )}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        disabled={(date) =>
                          date < new Date("1900-01-01")
                        }
                        initialFocus
                        locale={fr}
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="endDate"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Date de Fin</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant={"outline"}
                          className={cn(
                            "w-full pl-3 text-left font-normal",
                            !field.value && "text-muted-foreground"
                          )}
                        >
                          {field.value ? (
                            format(field.value, "PPP", { locale: fr })
                          ) : (
                            <span>Choisir une date</span>
                          )}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        initialFocus
                        locale={fr}
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <Separator />
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <FormField
              control={form.control}
              name="billingSchedule"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Échéancier de Facturation</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Sélectionnez un échéancier" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {schedules.map((schedule) => (
                        <SelectItem key={schedule.id} value={schedule.name}>
                          {schedule.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="term"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Terme de Facturation</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Sélectionnez un terme" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {terms.map((term) => (
                        <SelectItem key={term.id} value={term.name}>
                          {term.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          
          {watchBillingSchedule === 'Variable' && (
            <Card>
              <CardHeader>
                <CardTitle>Configuration de la facturation mensuelle</CardTitle>
                <FormMessage>{form.formState.errors.monthlyBilling?.message}</FormMessage>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {fields.map((field, index) => (
                  <div key={field.id} className="p-3 border rounded-md space-y-2">
                    <p className="font-medium text-sm">{field.month}</p>
                    <FormField
                        control={form.control}
                        name={`monthlyBilling.${index}.date`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Jour</FormLabel>
                            <FormControl>
                               <Input type="number" {...field} onChange={e => field.onChange(parseInt(e.target.value, 10))}/>
                            </FormControl>
                          </FormItem>
                        )}
                    />
                     <FormField
                        control={form.control}
                        name={`monthlyBilling.${index}.percentage`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Pourcentage</FormLabel>
                            <FormControl>
                                <div className="relative">
                                    <Input type="number" {...field} className="pr-6" onChange={e => field.onChange(parseInt(e.target.value, 10))}/>
                                    <span className="absolute inset-y-0 right-2 flex items-center text-muted-foreground text-sm">%</span>
                                </div>
                            </FormControl>
                          </FormItem>
                        )}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Separator />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
              <FormField
                control={form.control}
                name="marketId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type de marché</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sélectionnez un type de marché" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {markets.map((market) => (
                          <SelectItem key={market.id} value={market.id}>
                            {market.code} - {market.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
               <FormField control={form.control} name="hasInterest" render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5"><FormLabel>Intéressement</FormLabel><FormDescription>Activer l'intéressement pour ce contrat ?</FormDescription></div>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <FormField
                control={form.control}
                name="revisionFormulaId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Formule de révision</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sélectionnez une formule" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {revisionFormulas.map((formula) => (
                          <SelectItem key={formula.id} value={formula.id}>
                            {formula.code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
               <FormField
                  control={form.control}
                  name="revisionDate"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Date de Révision</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant={"outline"}
                              className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}
                            >
                              {field.value ? (format(field.value, "PPP", { locale: fr })) : (<span>Choisir une date</span>)}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus locale={fr}/>
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />
          </div>

          <Separator/>
          
          <FormField
            control={form.control}
            name="activityIds"
            render={() => (
              <FormItem>
                <div className="mb-4">
                  <FormLabel className="text-base">Prestations</FormLabel>
                  <FormDescription>
                    Sélectionnez les prestations incluses dans ce contrat.
                  </FormDescription>
                </div>
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {activities.map((item) => (
                    <FormField
                        key={item.id}
                        control={form.control}
                        name="activityIds"
                        render={({ field }) => {
                        return (
                            <FormItem
                            key={item.id}
                            className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4"
                            >
                            <FormControl>
                                <Checkbox
                                checked={field.value?.includes(item.id)}
                                onCheckedChange={(checked) => {
                                    return checked
                                    ? field.onChange([...(field.value || []), item.id])
                                    : field.onChange(
                                        field.value?.filter(
                                            (value) => value !== item.id
                                        )
                                        )
                                }}
                                />
                            </FormControl>
                            <FormLabel className="font-normal">
                                {item.label} ({item.code})
                            </FormLabel>
                            </FormItem>
                        )
                        }}
                    />
                    ))}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit">Créer le Contrat</Button>
        </form>
      </Form>
      </CardContent>
    </Card>
  )
}
