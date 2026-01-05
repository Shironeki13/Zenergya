"use client"

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { CalendarIcon } from "lucide-react"

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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

import { getContract, updateContract } from '@/services/firestore'
import { Contract } from '@/lib/types'
import { cn } from "@/lib/utils"

const activities = [
    { id: "P1", label: "Fourniture d'énergie", code: "P1" },
    { id: "P2", label: "Maintenance", code: "P2" },
    { id: "P3", label: "Gros Entretien Renouvellement", code: "P3" },
    { id: "P4", label: "Financement", code: "P4" },
]

const contractFormSchema = z.object({
    startDate: z.date({ required_error: "La date de début est requise." }),
    endDate: z.date({ required_error: "La date de fin est requise." }),
    billingSchedule: z.enum(['Mensuel', 'Trimestriel', 'Annuel'], { required_error: "La périodicité est requise." }),
    term: z.enum(['Echu', 'Echoir'], { required_error: "Le terme est requis." }),
    invoicingType: z.enum(['global', 'multi-site'], { required_error: "Le type de facturation est requis." }),
    renewal: z.boolean().default(false),
    renewalDuration: z.string().optional(),
    tacitRenewal: z.boolean().default(true),
    activityIds: z.array(z.string()).refine((value) => value.length > 0, {
        message: "Vous devez sélectionner au moins une prestation.",
    }),
    hasHeating: z.boolean().default(false),
    hasECS: z.boolean().default(false),
    marketType: z.enum(['Marché Public', 'Marché Privé']).optional(),
    hasInterest: z.boolean().default(false),
    consumptionBase: z.number().optional(),
    shareRate: z.array(z.number()).optional(), // [clientShare, operatorShare]
    revisionFormula: z.string().optional(),

    // P1 Specifics
    baseDJU: z.number().optional(),
    weatherStationCode: z.string().optional(),
    flatRateAmount: z.number().optional(),
    managementFees: z.number().optional(),
    unitPriceUsefulMWh: z.number().optional(),
    unitPricePrimaryMWh: z.number().optional(),

    // Monthly Billing
    monthlyBilling: z.array(z.object({
        month: z.number(),
        percentage: z.number().min(0).max(100)
    })).optional(),
})

type ContractFormValues = z.infer<typeof contractFormSchema>

export default function EditContractPage() {
    const router = useRouter()
    const params = useParams()
    const id = params.id as string
    const [contract, setContract] = useState<Contract | null>(null)
    const [loading, setLoading] = useState(true)

    const form = useForm<ContractFormValues>({
        resolver: zodResolver(contractFormSchema),
        defaultValues: {
            renewal: false,
            tacitRenewal: true,
            activityIds: [],
            hasHeating: false,
            hasECS: false,
            hasInterest: false,
            shareRate: [50, 50],
            invoicingType: 'multi-site',
            monthlyBilling: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, percentage: 0 }))
        },
    })

    useEffect(() => {
        async function fetchContract() {
            if (!id) return
            try {
                const data = await getContract(id)
                if (data) {
                    setContract(data)
                    form.reset({
                        startDate: new Date(data.startDate),
                        endDate: new Date(data.endDate),
                        billingSchedule: data.billingSchedule as any,
                        term: data.term as any,
                        invoicingType: data.invoicingType || 'multi-site',
                        renewal: data.renewal,
                        renewalDuration: data.renewalDuration,
                        tacitRenewal: data.tacitRenewal,
                        activityIds: data.activityIds,
                        hasHeating: data.hasHeating,
                        hasECS: data.hasECS,
                        marketType: data.marketType as any,
                        hasInterest: data.hasInterest,
                        consumptionBase: data.consumptionBase,
                        shareRate: data.shareRate,
                        revisionFormula: data.revisionFormula,
                        baseDJU: data.baseDJU,
                        weatherStationCode: data.weatherStationCode,
                        flatRateAmount: data.flatRateAmount,
                        managementFees: data.managementFees,
                        unitPriceUsefulMWh: data.unitPriceUsefulMWh,
                        unitPricePrimaryMWh: data.unitPricePrimaryMWh,
                        monthlyBilling: data.monthlyBilling || Array.from({ length: 12 }, (_, i) => ({ month: i + 1, percentage: 0 }))
                    })
                }
            } catch (error) {
                console.error("Error fetching contract:", error)
            } finally {
                setLoading(false)
            }
        }
        fetchContract()
    }, [id, form])

    async function onSubmit(data: ContractFormValues) {
        if (!contract) return
        try {
            await updateContract(contract.id, {
                ...data,
                startDate: data.startDate.toISOString(),
                endDate: data.endDate.toISOString(),
            })
            router.push(`/contracts/${contract.id}`)
            router.refresh()
        } catch (error) {
            console.error("Error updating contract:", error)
        }
    }

    const p1IsSelected = form.watch("activityIds")?.includes("P1")
    const watchHasHeating = form.watch("hasHeating")
    const watchHasECS = form.watch("hasECS")
    const watchHasInterest = form.watch("hasInterest")

    // Derived states for P1 fields visibility
    const showBaseDJU = p1IsSelected && watchHasHeating
    const showFlatRate = p1IsSelected && (watchHasHeating || watchHasECS) // Simplified logic, adjust as needed
    const showUsefulMWhPrice = p1IsSelected && (watchHasHeating || watchHasECS) // Simplified
    const showPrimaryMWhPrice = p1IsSelected && (watchHasHeating || watchHasECS) // Simplified

    if (loading) return <div>Chargement...</div>
    if (!contract) return <div>Contrat introuvable</div>

    return (
        <Card className="w-full max-w-4xl mx-auto my-8">
            <CardHeader>
                <CardTitle>Modifier le Contrat: {contract.clientName}</CardTitle>
            </CardHeader>
            <CardContent>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">

                        {/* Dates */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="startDate"
                                render={({ field }) => (
                                    <FormItem className="flex flex-col">
                                        <FormLabel>Date de début</FormLabel>
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
                                        <FormLabel>Date de fin</FormLabel>
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
                                                />
                                            </PopoverContent>
                                        </Popover>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <Separator />

                        {/* Billing & Term */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="billingSchedule"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Périodicité de facturation</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Sélectionner" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="Mensuel">Mensuel</SelectItem>
                                                <SelectItem value="Trimestriel">Trimestriel</SelectItem>
                                                <SelectItem value="Annuel">Annuel</SelectItem>
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
                                        <FormLabel>Terme de paiement</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Sélectionner" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="Echu">Echu</SelectItem>
                                                <SelectItem value="Echoir">Echoir</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <FormField
                            control={form.control}
                            name="invoicingType"
                            render={({ field }) => (
                                <FormItem className="space-y-3">
                                    <FormLabel>Type de facturation</FormLabel>
                                    <FormControl>
                                        <RadioGroup
                                            onValueChange={field.onChange}
                                            defaultValue={field.value}
                                            className="flex flex-col space-y-1"
                                        >
                                            <FormItem className="flex items-center space-x-3 space-y-0">
                                                <FormControl>
                                                    <RadioGroupItem value="multi-site" />
                                                </FormControl>
                                                <FormLabel className="font-normal">
                                                    Détaillée par site
                                                </FormLabel>
                                            </FormItem>
                                            <FormItem className="flex items-center space-x-3 space-y-0">
                                                <FormControl>
                                                    <RadioGroupItem value="global" />
                                                </FormControl>
                                                <FormLabel className="font-normal">
                                                    Globale
                                                </FormLabel>
                                            </FormItem>
                                        </RadioGroup>
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {/* Monthly Billing Percentages if Annual/Trimestrial? Or always? 
                            Usually this is for 'Forfait' or specific billing schedules. 
                            Let's keep it if it was there. 
                        */}
                        {/* Assuming it's always shown or based on some logic. 
                            In the previous file it was just mapped. 
                            I'll add it back.
                        */}
                        <Card>
                            <CardHeader><CardTitle className="text-base">Répartition Mensuelle (Si applicable)</CardTitle></CardHeader>
                            <CardContent className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                                {form.watch('monthlyBilling')?.map((item, index) => (
                                    <div key={item.month} className="space-y-2">
                                        <span className="text-sm font-medium">Mois {item.month}</span>
                                        <FormField
                                            control={form.control}
                                            name={`monthlyBilling.${index}.percentage`}
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormControl>
                                                        <div className="relative">
                                                            <Input
                                                                type="number"
                                                                {...field}
                                                                className="pr-6"
                                                                onChange={e => field.onChange(parseInt(e.target.value, 10) || 0)}
                                                            />
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

                        <Separator />

                        {/* Activities */}
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

                        {p1IsSelected && (
                            <Card>
                                <CardHeader><CardTitle>Détails Prestation P1</CardTitle></CardHeader>
                                <CardContent className="space-y-6">
                                    <div className="flex gap-8">
                                        <FormField
                                            control={form.control}
                                            name="hasHeating"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                                                    <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                                    <FormLabel className="font-normal">Chauffage</FormLabel>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="hasECS"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                                                    <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                                    <FormLabel className="font-normal">ECS</FormLabel>
                                                </FormItem>
                                            )}
                                        />
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {showBaseDJU && (
                                            <FormField control={form.control} name="baseDJU" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>DJU de base</FormLabel>
                                                    <FormControl><Input type="number" placeholder="ex: 2350" {...field} value={field.value ?? ''} onChange={e => field.onChange(parseInt(e.target.value, 10))} /></FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )} />
                                        )}
                                        {showBaseDJU && (
                                            <FormField control={form.control} name="weatherStationCode" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Station météo / Code INSEE</FormLabel>
                                                    <FormControl><Input placeholder="ex: 75114001" {...field} value={field.value ?? ''} /></FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )} />
                                        )}
                                        {showFlatRate && (
                                            <FormField control={form.control} name="flatRateAmount" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Montant forfaitaire</FormLabel>
                                                    <FormControl><Input type="number" placeholder="ex: 5000" {...field} value={field.value ?? ''} onChange={e => field.onChange(parseFloat(e.target.value))} /></FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )} />
                                        )}
                                        {showFlatRate && (
                                            <FormField control={form.control} name="managementFees" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Frais de gestion</FormLabel>
                                                    <FormControl><Input type="number" placeholder="ex: 250" {...field} value={field.value ?? ''} onChange={e => field.onChange(parseFloat(e.target.value))} /></FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )} />
                                        )}
                                        {showUsefulMWhPrice && (
                                            <FormField control={form.control} name="unitPriceUsefulMWh" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Prix unitaire (€/MWh utile)</FormLabel>
                                                    <FormControl><Input type="number" placeholder="ex: 120" {...field} value={field.value ?? ''} onChange={e => field.onChange(parseFloat(e.target.value))} /></FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )} />
                                        )}
                                        {showPrimaryMWhPrice && (
                                            <FormField control={form.control} name="unitPricePrimaryMWh" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Prix unitaire (€/MWh primaire)</FormLabel>
                                                    <FormControl><Input type="number" placeholder="ex: 90" {...field} value={field.value ?? ''} onChange={e => field.onChange(parseFloat(e.target.value))} /></FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )} />
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        <Separator />

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="marketType"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Type de Marché</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Sélectionner" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="Marché Public">Marché Public</SelectItem>
                                                <SelectItem value="Marché Privé">Marché Privé</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="hasInterest"
                                render={({ field }) => (
                                    <FormItem className="flex flex-row items-center space-x-3 space-y-0 pt-8">
                                        <FormControl>
                                            <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                                        </FormControl>
                                        <FormLabel className="font-normal">
                                            Intéressement
                                        </FormLabel>
                                    </FormItem>
                                )}
                            />
                        </div>

                        {watchHasInterest && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 border rounded-md">
                                <FormField control={form.control} name="consumptionBase" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Base de consommation théorique NB</FormLabel>
                                        <FormControl><Input type="number" placeholder="ex: 10000" {...field} value={field.value ?? ''} onChange={e => field.onChange(parseInt(e.target.value, 10))} /></FormControl>
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
                            </div>
                        )}

                        <FormField
                            control={form.control}
                            name="revisionFormula"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Formule de révision</FormLabel>
                                    <FormControl>
                                        <Input placeholder="ex: P1 = P0 * (0.15 + 0.85 * (E/E0))" {...field} value={field.value ?? ''} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="flex justify-end">
                            <Button type="submit">Enregistrer les Modifications</Button>
                        </div>
                    </form>
                </Form>
            </CardContent>
        </Card>
    )
}