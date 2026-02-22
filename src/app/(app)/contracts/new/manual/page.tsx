"use client"

import React, { useState, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, Loader2, Check, ChevronsUpDown, Search } from "lucide-react"
import { z } from "zod"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Badge } from "@/components/ui/badge"
import {
    Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription,
} from "@/components/ui/form"
import { useToast } from "@/hooks/use-toast"
import { useData } from "@/context/data-context"
import { createContract } from "@/services/firestore"
import type { Contract } from "@/lib/types"
import { cn } from "@/lib/utils"

const P1_SUB_TYPES = [
    { value: "chauffage", label: "Chauffage" },
    { value: "ecs", label: "ECS" },
    { value: "refac", label: "Refac €/€" },
    { value: "abonnement", label: "Abonnement" },
] as const

const ManualContractSchema = z.object({
    clientId: z.string().min(1, "Le client est requis."),
    name: z.string().optional(),
    label: z.string().optional(),
    startDate: z.string().min(1, "La date de début est requise."),
    endDate: z.string().min(1, "La date de fin est requise."),
    activityIds: z.array(z.string()).min(1, "Au moins une activité est requise."),
    invoicingType: z.enum(["multi-site", "global"]),
    marketType: z.enum(["Marché Public", "Marché Privé"]).optional(),
    renewal: z.boolean().default(false),
    tacitRenewal: z.boolean().default(false),
    renewalDuration: z.string().optional(),
    noticePeriod: z.string().optional(),
    baseAmountP1: z.coerce.number().optional(),
    baseAmountP2: z.coerce.number().optional(),
    baseAmountP3: z.coerce.number().optional(),
    p1SubTypes: z.array(z.string()).optional(),
})

type ManualContractFormValues = z.infer<typeof ManualContractSchema>

export default function ManualContractPage() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const { toast } = useToast()
    const { clients, activities, reloadData } = useData()
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [clientSearchOpen, setClientSearchOpen] = useState(false)

    const preselectedClientId = searchParams.get("clientId") || ""

    const form = useForm<ManualContractFormValues>({
        resolver: zodResolver(ManualContractSchema),
        defaultValues: {
            clientId: preselectedClientId,
            name: "",
            label: "",
            startDate: "",
            endDate: "",
            activityIds: [],
            invoicingType: "multi-site",
            marketType: undefined,
            renewal: false,
            tacitRenewal: false,
            renewalDuration: "",
            noticePeriod: "",
            p1SubTypes: [],
        },
    })

    const watchClientId = form.watch("clientId")
    const selectedClient = useMemo(() => clients.find(c => c.id === watchClientId), [clients, watchClientId])
    const watchActivityIds = form.watch("activityIds")
    const watchP1SubTypes = form.watch("p1SubTypes") || []

    const getActivityType = (a: { type?: string; code: string }) => a.type || (a.code.toUpperCase().startsWith('P1') ? 'P1' : a.code.toUpperCase().startsWith('P2') ? 'P2' : a.code.toUpperCase().startsWith('P3') ? 'P3' : '')
    const hasP1 = activities.some(a => getActivityType(a) === 'P1' && watchActivityIds.includes(a.id))
    const hasP2 = activities.some(a => getActivityType(a) === 'P2' && watchActivityIds.includes(a.id))
    const hasP3 = activities.some(a => getActivityType(a) === 'P3' && watchActivityIds.includes(a.id))

    const handleActivityToggle = (activityId: string, checked: boolean) => {
        const current = form.getValues("activityIds")
        if (checked) {
            form.setValue("activityIds", [...current, activityId], { shouldValidate: true })
        } else {
            form.setValue("activityIds", current.filter(id => id !== activityId), { shouldValidate: true })
        }
    }

    const handleP1SubTypeToggle = (value: string, checked: boolean) => {
        const current = form.getValues("p1SubTypes") || []
        if (checked) {
            form.setValue("p1SubTypes", [...current, value])
        } else {
            form.setValue("p1SubTypes", current.filter(v => v !== value))
        }
    }

    async function onSubmit(data: ManualContractFormValues) {
        setIsSubmitting(true)
        try {
            const contractData: Omit<Contract, 'id' | 'status' | 'validationStatus'> = {
                clientId: data.clientId,
                clientName: selectedClient?.name || "",
                siteIds: [],
                startDate: data.startDate,
                endDate: data.endDate,
                activityIds: data.activityIds,
                invoicingType: data.invoicingType,
                renewal: data.renewal,
                tacitRenewal: data.tacitRenewal,
                renewalDuration: data.renewalDuration,
                noticePeriod: data.noticePeriod,
                name: data.name,
                label: data.label,
                marketType: data.marketType,
                baseAmountP1: data.baseAmountP1,
                baseAmountP2: data.baseAmountP2,
                baseAmountP3: data.baseAmountP3,
                p1SubTypes: data.p1SubTypes,
            }

            const newContract = await createContract(contractData)
            await reloadData()
            toast({ title: "Contrat créé", description: "Le contrat a été créé avec succès." })
            router.push(`/contracts/${newContract.id}`)
        } catch (error) {
            console.error("Failed to create contract:", error)
            toast({ title: "Erreur", description: "Impossible de créer le contrat.", variant: "destructive" })
        } finally {
            setIsSubmitting(false)
        }
    }

    function onInvalid(errors: Record<string, unknown>) {
        const errorFields = Object.keys(errors)
        toast({
            title: "Formulaire incomplet",
            description: `Champs invalides : ${errorFields.join(", ")}`,
            variant: "destructive",
        })
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center gap-4">
                    <Link href="/contracts/new">
                        <Button variant="outline" size="icon">
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                    </Link>
                    <div>
                        <CardTitle>Nouveau Contrat (Manuel)</CardTitle>
                        <CardDescription>Créez un contrat manuellement en remplissant les champs ci-dessous.</CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-8">

                        {/* Client Selection with Smart Search */}
                        <h2 className="text-xl font-semibold">Client</h2>
                        <FormField control={form.control} name="clientId" render={({ field }) => (
                            <FormItem className="flex flex-col">
                                <FormLabel>Client rattaché</FormLabel>
                                <Popover open={clientSearchOpen} onOpenChange={setClientSearchOpen}>
                                    <PopoverTrigger asChild>
                                        <FormControl>
                                            <Button
                                                variant="outline"
                                                role="combobox"
                                                aria-expanded={clientSearchOpen}
                                                className={cn(
                                                    "w-full justify-between",
                                                    !field.value && "text-muted-foreground"
                                                )}
                                            >
                                                {field.value
                                                    ? clients.find(c => c.id === field.value)?.name || "Client sélectionné"
                                                    : "Rechercher un client..."}
                                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                            </Button>
                                        </FormControl>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                                        <Command>
                                            <CommandInput placeholder="Rechercher par nom..." />
                                            <CommandList>
                                                <CommandEmpty>Aucun client trouvé.</CommandEmpty>
                                                <CommandGroup>
                                                    {clients.map(client => (
                                                        <CommandItem
                                                            key={client.id}
                                                            value={client.name}
                                                            onSelect={() => {
                                                                field.onChange(client.id)
                                                                setClientSearchOpen(false)
                                                            }}
                                                        >
                                                            <Check className={cn(
                                                                "mr-2 h-4 w-4",
                                                                field.value === client.id ? "opacity-100" : "opacity-0"
                                                            )} />
                                                            <div className="flex flex-col">
                                                                <span>{client.name}</span>
                                                                {client.city && (
                                                                    <span className="text-xs text-muted-foreground">{client.city}</span>
                                                                )}
                                                            </div>
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            </CommandList>
                                        </Command>
                                    </PopoverContent>
                                </Popover>
                                {selectedClient && (
                                    <p className="text-sm text-muted-foreground">
                                        {selectedClient.address && `${selectedClient.address}, `}{selectedClient.postalCode} {selectedClient.city}
                                    </p>
                                )}
                                <FormMessage />
                            </FormItem>
                        )} />

                        <Separator />

                        {/* Contract Identification */}
                        <h2 className="text-xl font-semibold">Informations Contrat</h2>
                        <div className="grid md:grid-cols-2 gap-6">
                            <FormField control={form.control} name="name" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Nom du contrat</FormLabel>
                                    <FormControl><Input placeholder="ex: Contrat Maintenance - Le Bastion" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="label" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Libellé</FormLabel>
                                    <FormControl><Input placeholder="ex: Chauffage & ECS" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="startDate" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Date de début</FormLabel>
                                    <FormControl><Input type="date" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="endDate" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Date de fin</FormLabel>
                                    <FormControl><Input type="date" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="marketType" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Type de marché</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                            <SelectTrigger><SelectValue placeholder="Sélectionnez" /></SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="Marché Privé">Marché Privé</SelectItem>
                                            <SelectItem value="Marché Public">Marché Public</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="invoicingType" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Type de facturation</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="global">Globale</SelectItem>
                                            <SelectItem value="multi-site">Multi-site</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        </div>

                        <Separator />

                        {/* Activities */}
                        <h2 className="text-xl font-semibold">Activités</h2>
                        <FormField control={form.control} name="activityIds" render={() => (
                            <FormItem>
                                <FormLabel>Activités du contrat</FormLabel>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                    {activities.map(activity => (
                                        <div key={activity.id} className="flex items-center space-x-2">
                                            <Checkbox
                                                id={`act-${activity.id}`}
                                                checked={watchActivityIds.includes(activity.id)}
                                                onCheckedChange={(checked) => handleActivityToggle(activity.id, !!checked)}
                                            />
                                            <label htmlFor={`act-${activity.id}`} className="text-sm font-medium leading-none">
                                                {activity.label} ({activity.code})
                                            </label>
                                        </div>
                                    ))}
                                </div>
                                <FormMessage />
                            </FormItem>
                        )} />

                        {/* Amounts per activity type */}
                        {(hasP1 || hasP2 || hasP3) && (
                            <Card className="border-dashed">
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base">Montants globaux annuels HT</CardTitle>
                                    <CardDescription>Renseignez le montant annuel global pour chaque type d'activité sélectionnée.</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-6">
                                    {hasP1 && (
                                        <div className="space-y-4 p-4 rounded-lg border bg-muted/30">
                                            <FormField control={form.control} name="baseAmountP1" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-base font-semibold">Montant P1 HT/AN (€)</FormLabel>
                                                    <FormControl><Input type="number" placeholder="ex: 45000" {...field} /></FormControl>
                                                </FormItem>
                                            )} />

                                            {/* P1 Sub-Types */}
                                            <div className="space-y-2">
                                                <FormLabel>Type(s) de P1</FormLabel>
                                                <FormDescription>Sélectionnez les types de prestations P1 incluses dans ce contrat.</FormDescription>
                                                <div className="flex flex-wrap gap-2 pt-1">
                                                    {P1_SUB_TYPES.map(sub => {
                                                        const isSelected = watchP1SubTypes.includes(sub.value)
                                                        return (
                                                            <Badge
                                                                key={sub.value}
                                                                variant={isSelected ? "default" : "outline"}
                                                                className={cn(
                                                                    "cursor-pointer transition-all text-sm px-3 py-1.5",
                                                                    isSelected
                                                                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                                                                        : "hover:bg-accent hover:text-accent-foreground"
                                                                )}
                                                                onClick={() => handleP1SubTypeToggle(sub.value, !isSelected)}
                                                            >
                                                                {isSelected && <Check className="mr-1 h-3 w-3" />}
                                                                {sub.label}
                                                            </Badge>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {hasP2 && (
                                        <div className="p-4 rounded-lg border bg-muted/30">
                                            <FormField control={form.control} name="baseAmountP2" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-base font-semibold">Montant P2 HT/AN (€)</FormLabel>
                                                    <FormControl><Input type="number" placeholder="ex: 12000" {...field} /></FormControl>
                                                </FormItem>
                                            )} />
                                        </div>
                                    )}

                                    {hasP3 && (
                                        <div className="p-4 rounded-lg border bg-muted/30">
                                            <FormField control={form.control} name="baseAmountP3" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-base font-semibold">Montant P3 HT/AN (€)</FormLabel>
                                                    <FormControl><Input type="number" placeholder="ex: 8000" {...field} /></FormControl>
                                                </FormItem>
                                            )} />
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        )}

                        <Separator />

                        {/* Contract Conditions */}
                        <h2 className="text-xl font-semibold">Conditions</h2>
                        <div className="grid md:grid-cols-2 gap-6">
                            <FormField control={form.control} name="tacitRenewal" render={({ field }) => (
                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                                    <div className="space-y-0.5">
                                        <FormLabel>Reconduction tacite</FormLabel>
                                        <FormDescription>Le contrat se renouvelle automatiquement ?</FormDescription>
                                    </div>
                                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="noticePeriod" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Préavis de résiliation</FormLabel>
                                    <FormControl><Input placeholder="ex: 6 mois" {...field} /></FormControl>
                                </FormItem>
                            )} />
                        </div>

                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Créer le Contrat
                        </Button>
                    </form>
                </Form>
            </CardContent>
        </Card>
    )
}
