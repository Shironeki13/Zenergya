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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
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
    invoicingType: z.enum(['global', 'multi-site'], { required_error: "Le type de facturation est requis." }),
    renewal: z.boolean().default(false),
    renewalDuration: z.string().optional(),
    tacitRenewal: z.boolean().default(true),
    activityIds: z.array(z.string()).refine((value) => value.length > 0, {
        message: "Vous devez sélectionner au moins une prestation.",
    }),
    marketType: z.enum(['Marché Public', 'Marché Privé']).optional(),
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
            invoicingType: 'multi-site',
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
                        invoicingType: data.invoicingType || 'multi-site',
                        renewal: data.renewal,
                        renewalDuration: data.renewalDuration,
                        tacitRenewal: data.tacitRenewal,
                        activityIds: data.activityIds,
                        marketType: data.marketType as any,
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
                // If refused, reset to pending_validation
                validationStatus: contract.validationStatus === 'refused' ? 'pending_validation' : contract.validationStatus,
                refusalReason: contract.validationStatus === 'refused' ? '' : contract.refusalReason,
            })
            router.push(`/contracts/${contract.id}`)
            router.refresh()
        } catch (error) {
            console.error("Error updating contract:", error)
        }
    }



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

                        <Separator />

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

                        <div className="flex justify-end">
                            <Button type="submit">Enregistrer les Modifications</Button>
                        </div>
                    </form>
                </Form>
            </CardContent>
        </Card>
    )
}