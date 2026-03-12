"use client";

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
    Loader2, ArrowLeft, AlertTriangle, Building, Users,
    FileSignature, Euro, MapPin, Plus, Trash2, CalendarIcon
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useData } from "@/context/data-context";
import { ClientBaseSchema } from "@/lib/types";
import {
    getContract, getClient, getContactsByClient, getSitesByContract,
    updateClientAndContract,
} from "@/services/firestore";
import Link from "next/link";

const SiteFormSchema = z.object({
    name: z.string().optional(),
    address: z.string().optional(),
    postalCode: z.string().optional(),
    city: z.string().optional(),
    billingSchedule: z.string().optional(),
    term: z.string().optional(),
    revisionP1: z.string().optional(),
    revisionP2: z.string().optional(),
    revisionP3: z.string().optional(),
    heatingReferenceDju: z.number().optional(),
    heatingWeatherStation: z.string().optional(),
    hasInterest: z.boolean().default(false),
    hasHeating: z.boolean().default(false),
    hasECS: z.boolean().default(false),
    contractualNB: z.number().optional(),
    smallQ: z.number().optional(),
});

const CorrectionSchema = ClientBaseSchema.extend({
    technicalContactName: z.string().optional(),
    technicalContactEmail: z.string().optional(),
    technicalContactPhone: z.string().optional(),
    technicalContactRole: z.string().optional(),
    billingContactName: z.string().optional(),
    billingContactEmail: z.string().optional(),
    billingContactPhone: z.string().optional(),
    billingContactRole: z.string().optional(),
    startDate: z.date().optional(),
    endDate: z.date().optional(),
    contractName: z.string().optional(),
    label: z.string().optional(),
    baseAmountP1: z.number().optional(),
    baseAmountP2: z.number().optional(),
    baseAmountP3: z.number().optional(),
    baseAmountP3R: z.number().optional(),
    renewal: z.boolean().default(false),
    tacitRenewal: z.boolean().default(false),
    renewalDuration: z.string().optional(),
    noticePeriod: z.string().optional(),
    sites: z.array(SiteFormSchema).default([{}]),
});

type CorrectionValues = z.infer<typeof CorrectionSchema>;

export default function EditContractPage() {
    const router = useRouter();
    const params = useParams();
    const id = params.id as string;
    const { toast } = useToast();
    const { typologies, companies, agencies, sectors, reloadData, weatherStations } = useData();

    const [isLoading, setIsLoading] = useState(true);
    const [refusalReason, setRefusalReason] = useState<string>('');
    const [clientName, setClientName] = useState<string>('');

    const form = useForm<CorrectionValues>({
        resolver: zodResolver(CorrectionSchema),
        defaultValues: {
            name: "", address: "", postalCode: "", city: "",
            clientType: "private", representedBy: "", externalCode: "",
            isBe: false, beName: "", beEmail: "", bePhone: "",
            useChorus: false, siret: "", typologyId: "",
            companyId: "", agencyId: "", sectorId: "",
            technicalContactName: "", technicalContactEmail: "",
            technicalContactPhone: "", technicalContactRole: "",
            billingContactName: "", billingContactEmail: "",
            billingContactPhone: "", billingContactRole: "",
            renewal: false, tacitRenewal: false,
            renewalDuration: "", noticePeriod: "",
            sites: [{ name: "", address: "", postalCode: "", city: "", billingSchedule: "Mensuel", term: "" }],
        },
    });

    const { fields: siteFields, append: appendSite, remove: removeSite } = useFieldArray({
        control: form.control,
        name: "sites",
    });

    const watchCompanyId = form.watch("companyId");
    const watchAgencyId = form.watch("agencyId");
    const watchRenewal = form.watch("renewal");
    const filteredAgencies = agencies.filter(a => a.companyId === watchCompanyId);
    const filteredSectors = sectors.filter(s => s.agencyId === watchAgencyId);

    useEffect(() => {
        async function fetchAll() {
            if (!id) return;
            try {
                const [contract, ] = await Promise.all([getContract(id)]);
                if (!contract) { router.push('/contracts'); return; }

                setRefusalReason(contract.refusalReason || '');
                setClientName(contract.clientName || '');

                const [client, contacts, sites] = await Promise.all([
                    getClient(contract.clientId),
                    getContactsByClient(contract.clientId),
                    getSitesByContract(id),
                ]);

                const techContact = contacts.find(c => c.type === 'technique');
                const billContact = contacts.find(c => c.type === 'facturation');

                form.reset({
                    // Client
                    name: client?.name || "",
                    address: client?.address || "",
                    postalCode: client?.postalCode || "",
                    city: client?.city || "",
                    clientType: client?.clientType || "private",
                    typologyId: client?.typologyId || "",
                    representedBy: client?.representedBy || "",
                    externalCode: client?.externalCode || "",
                    isBe: client?.isBe || false,
                    beName: client?.beName || "",
                    beEmail: client?.beEmail || "",
                    bePhone: client?.bePhone || "",
                    useChorus: client?.useChorus || false,
                    siret: client?.siret || "",
                    chorusServiceCode: client?.chorusServiceCode || "",
                    chorusLegalCommitmentNumber: client?.chorusLegalCommitmentNumber || "",
                    chorusMarketNumber: client?.chorusMarketNumber || "",
                    companyId: client?.companyId || "",
                    agencyId: client?.agencyId || "",
                    sectorId: client?.sectorId || "",
                    // Contacts
                    technicalContactName: techContact?.name || "",
                    technicalContactEmail: techContact?.email || "",
                    technicalContactPhone: techContact?.phone || "",
                    technicalContactRole: techContact?.role || "",
                    billingContactName: billContact?.name || "",
                    billingContactEmail: billContact?.email || "",
                    billingContactPhone: billContact?.phone || "",
                    billingContactRole: billContact?.role || "",
                    // Contract
                    contractName: contract.name || "",
                    label: contract.label || "",
                    startDate: contract.startDate ? new Date(contract.startDate) : undefined,
                    endDate: contract.endDate ? new Date(contract.endDate) : undefined,
                    baseAmountP1: contract.baseAmountP1,
                    baseAmountP2: contract.baseAmountP2,
                    baseAmountP3: contract.baseAmountP3,
                    baseAmountP3R: contract.baseAmountP3R,
                    renewal: contract.renewal || false,
                    tacitRenewal: contract.tacitRenewal || false,
                    renewalDuration: contract.renewalDuration || "",
                    noticePeriod: contract.noticePeriod || "",
                    // Sites
                    sites: sites.length > 0
                        ? sites.map(s => ({
                            name: s.name || "",
                            address: s.address || "",
                            postalCode: s.postalCode || "",
                            city: s.city || "",
                            billingSchedule: s.billingSchedule || "Mensuel",
                            term: s.termId || "",
                            revisionP1: (s.revisionP1 as any)?.formula || "",
                            revisionP2: (s.revisionP2 as any)?.formula || "",
                            revisionP3: (s.revisionP3 as any)?.formula || "",
                            heatingReferenceDju: s.heatingReferenceDju,
                            heatingWeatherStation: s.heatingWeatherStation || "",
                            hasInterest: s.hasInterest || false,
                            hasHeating: s.hasHeating || false,
                            hasECS: s.hasECS || false,
                            contractualNB: s.contractualNB,
                            smallQ: s.smallQ,
                        }))
                        : [{ name: "", address: "", postalCode: "", city: "", billingSchedule: "Mensuel", term: "" }],
                });
            } catch (e) {
                console.error(e);
                toast({ title: "Erreur", description: "Impossible de charger les données.", variant: "destructive" });
            } finally {
                setIsLoading(false);
            }
        }
        fetchAll();
    }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

    const onSubmit = async (data: CorrectionValues) => {
        try {
            const contract = await getContract(id);
            if (!contract) return;
            await updateClientAndContract(id, contract.clientId, data);
            toast({ title: "Demande renvoyée", description: "Votre contrat a été renvoyé en validation." });
            await reloadData();
            router.push('/contracts/commerce');
        } catch (e) {
            console.error(e);
            toast({ title: "Erreur", description: "Une erreur est survenue.", variant: "destructive" });
        }
    };

    if (isLoading) {
        return (
            <div className="flex h-96 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-4xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Button variant="outline" size="icon" asChild>
                    <Link href="/contracts/commerce"><ArrowLeft className="h-4 w-4" /></Link>
                </Button>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Corriger la demande</h1>
                    <p className="text-muted-foreground">{clientName}</p>
                </div>
            </div>

            {/* Motif de refus */}
            {refusalReason && (
                <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Motif du refus</AlertTitle>
                    <AlertDescription>{refusalReason}</AlertDescription>
                </Alert>
            )}

            {/* Formulaire */}
            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    <Tabs defaultValue="client">
                        <TabsList className="grid w-full grid-cols-4">
                            <TabsTrigger value="client" className="gap-1.5">
                                <Building className="h-3.5 w-3.5" /> Client
                            </TabsTrigger>
                            <TabsTrigger value="contacts" className="gap-1.5">
                                <Users className="h-3.5 w-3.5" /> Contacts
                            </TabsTrigger>
                            <TabsTrigger value="contrat" className="gap-1.5">
                                <FileSignature className="h-3.5 w-3.5" /> Contrat
                            </TabsTrigger>
                            <TabsTrigger value="site" className="gap-1.5">
                                <MapPin className="h-3.5 w-3.5" /> Sites
                            </TabsTrigger>
                        </TabsList>

                        {/* ===== CLIENT ===== */}
                        <TabsContent value="client" className="space-y-4 pt-4">
                            <div className="grid grid-cols-1 gap-4">
                                <FormField control={form.control} name="name" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Raison sociale *</FormLabel>
                                        <FormControl><Input {...field} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="address" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Adresse *</FormLabel>
                                        <FormControl><Input {...field} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <FormField control={form.control} name="postalCode" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Code Postal *</FormLabel>
                                        <FormControl><Input {...field} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="city" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Ville *</FormLabel>
                                        <FormControl><Input {...field} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <FormField control={form.control} name="typologyId" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Typologie *</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {typologies.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="siret" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>SIRET</FormLabel>
                                        <FormControl><Input {...field} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                            </div>
                            <FormField control={form.control} name="representedBy" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Représenté par (Syndic)</FormLabel>
                                    <FormControl><Input {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <Separator />
                            <Label className="text-sm font-semibold">Hiérarchie</Label>
                            <div className="grid grid-cols-3 gap-4">
                                <FormField control={form.control} name="companyId" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Société *</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger><SelectValue placeholder="Société" /></SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="agencyId" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Agence *</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger><SelectValue placeholder="Agence" /></SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {filteredAgencies.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="sectorId" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Secteur *</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger><SelectValue placeholder="Secteur" /></SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {filteredSectors.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                            </div>
                        </TabsContent>

                        {/* ===== CONTACTS ===== */}
                        <TabsContent value="contacts" className="space-y-6 pt-4">
                            <div className="space-y-3">
                                <Label className="text-sm font-semibold">Contact Technique</Label>
                                <div className="grid grid-cols-2 gap-4">
                                    <FormField control={form.control} name="technicalContactName" render={({ field }) => (
                                        <FormItem><FormLabel>Nom</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                                    )} />
                                    <FormField control={form.control} name="technicalContactRole" render={({ field }) => (
                                        <FormItem><FormLabel>Rôle</FormLabel><FormControl><Input placeholder="Ex: Gardien, Syndic" {...field} /></FormControl></FormItem>
                                    )} />
                                    <FormField control={form.control} name="technicalContactEmail" render={({ field }) => (
                                        <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} /></FormControl></FormItem>
                                    )} />
                                    <FormField control={form.control} name="technicalContactPhone" render={({ field }) => (
                                        <FormItem><FormLabel>Téléphone</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                                    )} />
                                </div>
                            </div>
                            <Separator />
                            <div className="space-y-3">
                                <Label className="text-sm font-semibold">Contact Facturation</Label>
                                <div className="grid grid-cols-2 gap-4">
                                    <FormField control={form.control} name="billingContactName" render={({ field }) => (
                                        <FormItem><FormLabel>Nom</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                                    )} />
                                    <FormField control={form.control} name="billingContactRole" render={({ field }) => (
                                        <FormItem><FormLabel>Rôle</FormLabel><FormControl><Input placeholder="Ex: Comptable" {...field} /></FormControl></FormItem>
                                    )} />
                                    <FormField control={form.control} name="billingContactEmail" render={({ field }) => (
                                        <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} /></FormControl></FormItem>
                                    )} />
                                    <FormField control={form.control} name="billingContactPhone" render={({ field }) => (
                                        <FormItem><FormLabel>Téléphone</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                                    )} />
                                </div>
                            </div>
                        </TabsContent>

                        {/* ===== CONTRAT ===== */}
                        <TabsContent value="contrat" className="space-y-4 pt-4">
                            <div className="grid grid-cols-2 gap-4">
                                <FormField control={form.control} name="startDate" render={({ field }) => (
                                    <FormItem className="flex flex-col">
                                        <FormLabel>Date de début</FormLabel>
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <FormControl>
                                                    <Button variant="outline" className={cn("pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                                                        {field.value ? format(field.value, "PPP", { locale: fr }) : <span>Choisir une date</span>}
                                                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                    </Button>
                                                </FormControl>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0" align="start">
                                                <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
                                            </PopoverContent>
                                        </Popover>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="endDate" render={({ field }) => (
                                    <FormItem className="flex flex-col">
                                        <FormLabel>Date de fin</FormLabel>
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <FormControl>
                                                    <Button variant="outline" className={cn("pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                                                        {field.value ? format(field.value, "PPP", { locale: fr }) : <span>Choisir une date</span>}
                                                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                    </Button>
                                                </FormControl>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0" align="start">
                                                <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
                                            </PopoverContent>
                                        </Popover>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <FormField control={form.control} name="contractName" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Nom du contrat</FormLabel>
                                        <FormControl><Input {...field} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="label" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Libellé</FormLabel>
                                        <FormControl><Input {...field} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                            </div>
                            <Separator />
                            <Label className="text-sm font-semibold">Montants annuels HT</Label>
                            <div className="grid grid-cols-2 gap-4">
                                {(['baseAmountP1', 'baseAmountP2', 'baseAmountP3', 'baseAmountP3R'] as const).map((f) => (
                                    <FormField key={f} control={form.control} name={f} render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="flex items-center gap-1"><Euro className="h-3.5 w-3.5" /> {f.replace('baseAmount', 'Base ')}</FormLabel>
                                            <FormControl>
                                                <Input type="number" {...field}
                                                    onChange={e => field.onChange(e.target.value === '' ? undefined : e.target.valueAsNumber)} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )} />
                                ))}
                            </div>
                            <Separator />
                            <div className="space-y-3">
                                <FormField control={form.control} name="renewal" render={({ field }) => (
                                    <FormItem className="flex items-center space-x-2 space-y-0">
                                        <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                        <FormLabel>Reconduction</FormLabel>
                                    </FormItem>
                                )} />
                                {watchRenewal && (
                                    <div className="grid grid-cols-2 gap-4 pl-8">
                                        <FormField control={form.control} name="renewalDuration" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Durée de reconduction</FormLabel>
                                                <FormControl><Input placeholder="Ex: 1 an" {...field} /></FormControl>
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name="tacitRenewal" render={({ field }) => (
                                            <FormItem className="flex items-center space-x-2 space-y-0 pt-6">
                                                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                                <FormLabel>Tacite</FormLabel>
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name="noticePeriod" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Préavis</FormLabel>
                                                <FormControl><Input placeholder="Ex: 3 mois" {...field} /></FormControl>
                                            </FormItem>
                                        )} />
                                    </div>
                                )}
                            </div>
                        </TabsContent>

                        {/* ===== SITES ===== */}
                        <TabsContent value="site" className="space-y-4 pt-4">
                            {siteFields.map((siteField, index) => (
                                <div key={siteField.id} className="space-y-4 rounded-lg border p-4">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-semibold text-muted-foreground">Site {index + 1}</span>
                                        {siteFields.length > 1 && (
                                            <Button type="button" variant="ghost" size="icon"
                                                className="h-7 w-7 text-destructive hover:text-destructive"
                                                onClick={() => removeSite(index)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>
                                    <FormField control={form.control} name={`sites.${index}.name`} render={({ field }) => (
                                        <FormItem><FormLabel>Nom du Site</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                                    )} />
                                    <FormField control={form.control} name={`sites.${index}.address`} render={({ field }) => (
                                        <FormItem><FormLabel>Adresse</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                                    )} />
                                    <div className="grid grid-cols-2 gap-4">
                                        <FormField control={form.control} name={`sites.${index}.postalCode`} render={({ field }) => (
                                            <FormItem><FormLabel>Code Postal</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                                        )} />
                                        <FormField control={form.control} name={`sites.${index}.city`} render={({ field }) => (
                                            <FormItem><FormLabel>Ville</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                                        )} />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <FormField control={form.control} name={`sites.${index}.billingSchedule`} render={({ field }) => (
                                            <FormItem><FormLabel>Périodicité</FormLabel><FormControl><Input placeholder="Ex: Mensuel" {...field} /></FormControl></FormItem>
                                        )} />
                                        <FormField control={form.control} name={`sites.${index}.term`} render={({ field }) => (
                                            <FormItem><FormLabel>Terme</FormLabel><FormControl><Input placeholder="Ex: Échu" {...field} /></FormControl></FormItem>
                                        )} />
                                    </div>
                                    <Separator />
                                    <div className="space-y-2">
                                        <Label className="text-sm font-semibold">Formules de Révision</Label>
                                        <FormField control={form.control} name={`sites.${index}.revisionP1`} render={({ field }) => (
                                            <FormItem><FormControl><Input placeholder="Formule P1" {...field} /></FormControl></FormItem>
                                        )} />
                                        <FormField control={form.control} name={`sites.${index}.revisionP2`} render={({ field }) => (
                                            <FormItem><FormControl><Input placeholder="Formule P2" {...field} /></FormControl></FormItem>
                                        )} />
                                        <FormField control={form.control} name={`sites.${index}.revisionP3`} render={({ field }) => (
                                            <FormItem><FormControl><Input placeholder="Formule P3" {...field} /></FormControl></FormItem>
                                        )} />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <FormField control={form.control} name={`sites.${index}.heatingReferenceDju`} render={({ field }) => (
                                            <FormItem><FormLabel>DJU Référence</FormLabel>
                                                <FormControl><Input type="number" {...field} onChange={e => field.onChange(e.target.value === '' ? undefined : e.target.valueAsNumber)} /></FormControl>
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name={`sites.${index}.heatingWeatherStation`} render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Station Météo</FormLabel>
                                                <Select value={field.value ?? ''} onValueChange={field.onChange}>
                                                    <FormControl><SelectTrigger><SelectValue placeholder="Sélectionner une station" /></SelectTrigger></FormControl>
                                                    <SelectContent>
                                                        {weatherStations.filter(s => s.isActive).map(s => (
                                                            <SelectItem key={s.code} value={s.code}>{s.name} ({s.code})</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </FormItem>
                                        )} />
                                    </div>
                                    <div className="flex flex-wrap gap-4">
                                        <FormField control={form.control} name={`sites.${index}.hasHeating`} render={({ field }) => (
                                            <FormItem className="flex items-center space-x-2 space-y-0">
                                                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                                <FormLabel>Chauffage</FormLabel>
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name={`sites.${index}.hasECS`} render={({ field }) => (
                                            <FormItem className="flex items-center space-x-2 space-y-0">
                                                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                                <FormLabel>ECS</FormLabel>
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name={`sites.${index}.hasInterest`} render={({ field }) => (
                                            <FormItem className="flex items-center space-x-2 space-y-0">
                                                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                                <FormLabel>Intéressement</FormLabel>
                                            </FormItem>
                                        )} />
                                    </div>
                                </div>
                            ))}
                            <Button type="button" variant="outline" size="sm" className="w-full gap-2"
                                onClick={() => appendSite({
                                    name: "", address: "", postalCode: "", city: "",
                                    billingSchedule: "Mensuel", term: "",
                                    revisionP1: "", revisionP2: "", revisionP3: "",
                                    hasInterest: false, hasHeating: false, hasECS: false,
                                })}>
                                <Plus className="h-4 w-4" /> Ajouter un site
                            </Button>
                        </TabsContent>
                    </Tabs>

                    <div className="flex justify-end gap-3 pt-2">
                        <Button type="button" variant="outline" asChild>
                            <Link href="/contracts/commerce">Annuler</Link>
                        </Button>
                        <Button type="submit">
                            Renvoyer en validation
                        </Button>
                    </div>
                </form>
            </Form>
        </div>
    );
}
