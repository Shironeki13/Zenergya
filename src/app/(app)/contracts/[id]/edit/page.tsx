
"use client"

import Link from "next/link"
import { useRouter, useParams } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, useFieldArray } from "react-hook-form"
import * as z from "zod"
import { CalendarIcon, ChevronLeft } from "lucide-react"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import React, { useState, useEffect, useMemo } from 'react';

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
import { updateContract, getContract, getActivities, getSchedules, getTerms, getClients, getSitesByClient, getMarkets, getRevisionFormulas } from "@/services/firestore"
import type { Contract, Activity, Schedule, Term, Client, Site, Market, RevisionFormula } from "@/lib/types"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"


const monthlyBillingSchema = z.object({
  month: z.string(),
  date: z.number().min(1).max(31),
  percentage: z.number().min(0).max(100),
});

const revisionSchema = z.object({
  formulaId: z.string().optional().or(z.literal("")).or(z.literal(null)),
  date: z.date().optional(),
}).optional();

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
  revisionP1: revisionSchema,
  revisionP2: revisionSchema,
  revisionP3: revisionSchema,
  monthlyBilling: z.array(monthlyBillingSchema).optional(),
  // Conditional fields
  heatingDays: z.number().optional(),
  baseDJU: z.number().optional(),
  weatherStationCode: z.string().optional(),
  consumptionBase: z.number().optional(),
  shareRate: z.array(z.number()).optional(),
  flatRateAmount: z.number().optional(),
  managementFees: z.number().optional(),
  unitPriceUsefulMWh: z.number().optional(),
  unitPricePrimaryMWh: z.number().optional(),
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
    if (data.endDate < data.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "La date de fin ne peut pas être antérieure à la date de début.",
        path: ["endDate"],
      });
    }
});

type ContractFormValues = z.infer<typeof contractFormSchema>

const months = [ "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre" ];

export default function EditContractPage() {
    const router = useRouter();
    const params = useParams();
    const id = params.id as string;
    const { toast } = useToast()

    const [contract, setContract] = useState<Contract | null>(null);
    const [clients, setClients] = useState<Client[]>([]);
    const [sites, setSites] = useState<Site[]>([]);
    const [activities, setActivities] = useState<Activity[]>([]);
    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [terms, setTerms] = useState<Term[]>([]);
    const [markets, setMarkets] = useState<Market[]>([]);
    const [revisionFormulas, setRevisionFormulas] = useState<RevisionFormula[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    
    const [activityMap, setActivityMap] = useState<Map<string, string>>(new Map());

    const form = useForm<ContractFormValues>({
        resolver: zodResolver(contractFormSchema),
        defaultValues: {
            activityIds: [],
            siteIds: [],
            hasInterest: false,
            monthlyBilling: months.map(m => ({ month: m, date: 1, percentage: 0 })),
            shareRate: [50, 50],
        },
    })

    const { fields } = useFieldArray({
        control: form.control,
        name: "monthlyBilling",
    });

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
            
            const newActivityMap = new Map(fetchedActivities.map(a => [a.code, a.id]));
            setActivityMap(newActivityMap);

        } catch (error) {
            toast({ title: "Erreur", description: "Impossible de charger les données de paramétrage.", variant: "destructive" })
        }
        }
        fetchInitialData();
    }, [toast]);

    useEffect(() => {
        async function fetchContractData() {
            if (!id) return;
            try {
                const contractData = await getContract(id);
                if (!contractData) {
                    toast({ title: "Erreur", description: "Contrat non trouvé.", variant: "destructive" });
                    router.push('/contracts');
                    return;
                }
                setContract(contractData);
                
                form.reset({
                    clientId: contractData.clientId,
                    siteIds: contractData.siteIds,
                    startDate: new Date(contractData.startDate),
                    endDate: new Date(contractData.endDate),
                    billingSchedule: contractData.billingSchedule,
                    term: contractData.term,
                    activityIds: contractData.activityIds,
                    marketId: contractData.marketId,
                    hasInterest: contractData.hasInterest,
                    revisionP1: contractData.revisionP1 ? { ...contractData.revisionP1, formulaId: contractData.revisionP1.formulaId || "", date: contractData.revisionP1.date ? new Date(contractData.revisionP1.date) : undefined } : undefined,
                    revisionP2: contractData.revisionP2 ? { ...contractData.revisionP2, formulaId: contractData.revisionP2.formulaId || "", date: contractData.revisionP2.date ? new Date(contractData.revisionP2.date) : undefined } : undefined,
                    revisionP3: contractData.revisionP3 ? { ...contractData.revisionP3, formulaId: contractData.revisionP3.formulaId || "", date: contractData.revisionP3.date ? new Date(contractData.revisionP3.date) : undefined } : undefined,
                    monthlyBilling: contractData.monthlyBilling || months.map(m => ({ month: m, date: 1, percentage: 0 })),
                    heatingDays: contractData.heatingDays,
                    baseDJU: contractData.baseDJU,
                    weatherStationCode: contractData.weatherStationCode,
                    consumptionBase: contractData.consumptionBase,
                    shareRate: [contractData.shareRateClient || 50, contractData.shareRateOperator || 50],
                    flatRateAmount: contractData.flatRateAmount,
                    managementFees: contractData.managementFees,
                    unitPriceUsefulMWh: contractData.unitPriceUsefulMWh,
                    unitPricePrimaryMWh: contractData.unitPricePrimaryMWh,
                });

                const fetchedSites = await getSitesByClient(contractData.clientId);
                setSites(fetchedSites);

            } catch (error) {
                toast({ title: "Erreur", description: "Impossible de charger le contrat.", variant: "destructive" });
            } finally {
                setIsLoading(false);
            }
        }
        fetchContractData();
    }, [id, toast, router, form]);


    const selectedClientId = form.watch("clientId");
    const watchBillingSchedule = form.watch("billingSchedule");
    const watchMarketId = form.watch("marketId");
    const watchActivityIds = form.watch("activityIds");
    const watchHasInterest = form.watch("hasInterest");


    useEffect(() => {
        async function fetchSites() {
        if (selectedClientId) {
            try {
                const fetchedSites = await getSitesByClient(selectedClientId);
                setSites(fetchedSites);
                // Don't reset siteIds if it's the initial load for an existing contract
                if (contract?.clientId !== selectedClientId) {
                   form.setValue('siteIds', []);
                }
            } catch (error) {
                toast({ title: "Erreur", description: "Impossible de charger les sites du client.", variant: "destructive" });
            }
        } else {
            setSites([]);
        }
        }
        fetchSites();
    }, [selectedClientId, toast, form, contract]);

    const selectedMarket = markets.find(m => m.id === watchMarketId);

    const isActivitySelected = (code: string) => {
        const activityId = activityMap.get(code);
        return activityId ? watchActivityIds.includes(activityId) : false;
    }

    const p1IsSelected = isActivitySelected('P1');
    const p2IsSelected = isActivitySelected('P2');
    const p3IsSelected = isActivitySelected('P3');

    const showHeatingDays = selectedMarket?.code === 'MF' && p1IsSelected;
    const showMeteoStation = selectedMarket?.code === 'MT' && p1IsSelected;
    const showBaseDJU = selectedMarket?.code === 'MT' && p1IsSelected;
    const showFlatRate = (selectedMarket?.code === 'CP' || selectedMarket?.code === 'PF') && p1IsSelected;
    const showUsefulMWhPrice = selectedMarket?.code === 'MC' && p1IsSelected;
    const showPrimaryMWhPrice = selectedMarket?.code === 'CP' && p1IsSelected;

    async function onSubmit(data: ContractFormValues) {
        try {
            const shareRates = data.shareRate ? { shareRateClient: data.shareRate[0], shareRateOperator: data.shareRate[1] } : {};
            
            const contractData = { ...data, ...shareRates };
            delete (contractData as any).shareRate;

            await updateContract(id, contractData);
            toast({
                title: "Contrat Mis à Jour",
                description: "Le contrat a été mis à jour avec succès.",
            });
            router.push('/contracts');
        } catch (error) {
            console.error("Échec de la mise à jour du contrat:", error);
            toast({
                title: "Erreur",
                description: "Échec de la mise à jour du contrat. Veuillez réessayer.",
                variant: "destructive"
            });
        }
    }
  
    const p1RevisionFormulas = useMemo(() => revisionFormulas.filter(f => f.activityCode === 'P1'), [revisionFormulas]);
    const p2RevisionFormulas = useMemo(() => revisionFormulas.filter(f => f.activityCode === 'P2'), [revisionFormulas]);
    const p3RevisionFormulas = useMemo(() => revisionFormulas.filter(f => f.activityCode === 'P3'), [revisionFormulas]);

    const renderRevisionFields = (code: 'P1' | 'P2' | 'P3') => {
        let formulas: RevisionFormula[] = [];
        if (code === 'P1') formulas = p1RevisionFormulas;
        else if (code === 'P2') formulas = p2RevisionFormulas;
        else if (code === 'P3') formulas = p3RevisionFormulas;

        return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 p-4 border rounded-lg mt-4">
            <FormField
            control={form.control}
            name={`revision${code}.formulaId`}
            render={({ field }) => (
                <FormItem>
                <FormLabel>Formule de révision {code}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? undefined}>
                    <FormControl>
                    <SelectTrigger>
                        <SelectValue placeholder="Sélectionnez une formule" />
                    </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                    <SelectItem value="">Aucune</SelectItem>
                    {formulas.map((formula) => (
                        <SelectItem key={formula.id} value={formula.id}>
                        {formula.code} - {formula.formula}
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
                name={`revision${code}.date`}
                render={({ field }) => (
                <FormItem className="flex flex-col">
                    <FormLabel>Date de Révision {code}</FormLabel>
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
        );
    }

    if (isLoading) {
        return <div className="flex justify-center items-center h-full">Chargement...</div>;
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
                <CardTitle>Modifier le Contrat</CardTitle>
                <CardDescription>Pour le client : {contract?.clientName}</CardDescription>
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
                    <Select onValueChange={field.onChange} value={field.value} disabled>
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
                    <Select onValueChange={field.onChange} value={field.value}>
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
                    <Select onValueChange={field.onChange} value={field.value}>
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

            {p1IsSelected && renderRevisionFields('P1')}
            {p2IsSelected && renderRevisionFields('P2')}
            {p3IsSelected && renderRevisionFields('P3')}

            <Separator />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                <FormField
                    control={form.control}
                    name="marketId"
                    render={({ field }) => (
                    <FormItem>
                        <FormLabel>Type de marché</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
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
            
            {(showHeatingDays || showBaseDJU || watchHasInterest || showFlatRate || showUsefulMWhPrice || showPrimaryMWhPrice) && <Separator />}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                {showHeatingDays && (
                <FormField control={form.control} name="heatingDays" render={({ field }) => (
                    <FormItem>
                    <FormLabel>Nombre de jours de chauffe contractuels</FormLabel>
                    <FormControl><Input type="number" placeholder="ex: 232" {...field} onChange={e => field.onChange(parseInt(e.target.value, 10))} /></FormControl>
                    <FormMessage />
                    </FormItem>
                )} />
                )}
                {showBaseDJU && (<>
                <FormField control={form.control} name="baseDJU" render={({ field }) => (
                    <FormItem>
                    <FormLabel>DJU de base</FormLabel>
                    <FormControl><Input type="number" placeholder="ex: 2350" {...field} onChange={e => field.onChange(parseInt(e.target.value, 10))} /></FormControl>
                    <FormMessage />
                    </FormItem>
                )} />
                <FormField control={form.control} name="weatherStationCode" render={({ field }) => (
                    <FormItem>
                    <FormLabel>Station météo / Code INSEE</FormLabel>
                    <FormControl><Input placeholder="ex: 75114001" {...field} /></FormControl>
                    <FormMessage />
                    </FormItem>
                )} />
                </>)}
                {showFlatRate && (<>
                <FormField control={form.control} name="flatRateAmount" render={({ field }) => (
                    <FormItem>
                    <FormLabel>Montant forfaitaire</FormLabel>
                    <FormControl><Input type="number" placeholder="ex: 5000" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} /></FormControl>
                    <FormMessage />
                    </FormItem>
                )} />
                <FormField control={form.control} name="managementFees" render={({ field }) => (
                    <FormItem>
                    <FormLabel>Frais de gestion</FormLabel>
                    <FormControl><Input type="number" placeholder="ex: 250" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} /></FormControl>
                    <FormMessage />
                    </FormItem>
                )} />
                </>)}
                {showUsefulMWhPrice && (
                <FormField control={form.control} name="unitPriceUsefulMWh" render={({ field }) => (
                    <FormItem>
                    <FormLabel>Prix unitaire (€/MWh utile)</FormLabel>
                    <FormControl><Input type="number" placeholder="ex: 120" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} /></FormControl>
                    <FormMessage />
                    </FormItem>
                )} />
                )}
                {showPrimaryMWhPrice && (
                <FormField control={form.control} name="unitPricePrimaryMWh" render={({ field }) => (
                    <FormItem>
                    <FormLabel>Prix unitaire (€/MWh primaire)</FormLabel>
                    <FormControl><Input type="number" placeholder="ex: 90" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} /></FormControl>
                    <FormMessage />
                    </FormItem>
                )} />
                )}

                {watchHasInterest && (<>
                <FormField control={form.control} name="consumptionBase" render={({ field }) => (
                    <FormItem>
                    <FormLabel>Base de consommation théorique NB</FormLabel>
                    <FormControl><Input type="number" placeholder="ex: 10000" {...field} onChange={e => field.onChange(parseInt(e.target.value, 10))} /></FormControl>
                    <FormMessage />
                    </FormItem>
                )} />
                <FormField control={form.control} name="shareRate" render={({ field: { value, onChange } }) => (
                    <FormItem>
                    <FormLabel>Taux de partage (%) Client / Exploitant</FormLabel>
                        <div className="flex items-center gap-4 pt-2">
                            <span className="text-sm text-muted-foreground w-24">Client: {value?.[0]}%</span>
                            <Slider
                                value={[value?.[0] || 50]}
                                onValueChange={(newVal) => {
                                    const clientShare = newVal[0];
                                    onChange([clientShare, 100 - clientShare]);
                                }}
                                max={100}
                                step={1}
                            />
                            <span className="text-sm text-muted-foreground w-28 text-right">Exploitant: {value?.[1]}%</span>
                        </div>
                    <FormDescription>Faites glisser pour ajuster le partage.</FormDescription>
                    <FormMessage />
                    </FormItem>
                )} />
                </>)}
            </div>

            <Button type="submit">Enregistrer les Modifications</Button>
            </form>
        </Form>
        </CardContent>
        </Card>
    )
}
