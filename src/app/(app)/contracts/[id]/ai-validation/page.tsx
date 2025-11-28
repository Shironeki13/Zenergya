'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Loader2, Save, ArrowLeft, CheckCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useData } from '@/context/data-context';
import { updateContract } from '@/services/firestore';
import type { Contract, ActivityDetail } from '@/lib/types';

const activityDetailSchema = z.object({
    activityId: z.string(),
    amount: z.number().optional(),
    termId: z.string().optional(),
    scheduleId: z.string().optional(),
    revisionFormula: z.string().optional(),
    // Add other fields as needed based on ActivityDetail type
});

const formSchema = z.object({
    activitiesDetails: z.array(activityDetailSchema),
});

type FormValues = z.infer<typeof formSchema>;

export default function AIValidationPage() {
    const router = useRouter();
    const params = useParams();
    const id = params.id as string;
    const { toast } = useToast();
    const { contracts, activities, terms, schedules, revisionFormulas, isLoading } = useData();
    const [contract, setContract] = useState<Contract | null>(null);

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            activitiesDetails: [],
        },
    });

    const { fields } = useFieldArray({
        control: form.control,
        name: "activitiesDetails",
    });

    useEffect(() => {
        if (isLoading || !id) return;
        const foundContract = contracts.find(c => c.id === id);
        if (foundContract) {
            setContract(foundContract);
            // Initialize form with existing details or create default entries for selected activities
            const existingDetails = foundContract.activitiesDetails || [];
            const selectedActivityIds = foundContract.activityIds || [];

            const mergedDetails = selectedActivityIds.map(actId => {
                const existing = existingDetails.find(d => d.activityId === actId);
                return existing || { activityId: actId };
            });

            form.reset({ activitiesDetails: mergedDetails });
        }
    }, [id, contracts, isLoading, form]);

    const onSubmit = async (data: FormValues) => {
        if (!id) return;
        try {
            await updateContract(id, {
                activitiesDetails: data.activitiesDetails,
                // Optionally update validationStatus here if this is the final step
            });
            toast({ title: "Succès", description: "Détails mis à jour avec succès." });
            router.push('/contracts/validation');
        } catch (error) {
            console.error(error);
            toast({ title: "Erreur", description: "Échec de la mise à jour.", variant: "destructive" });
        }
    };

    if (isLoading || !contract) {
        return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" onClick={() => router.back()}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Retour
                </Button>
                <h1 className="text-2xl font-bold">Validation IA - {contract.clientName}</h1>
            </div>

            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    {fields.map((field, index) => {
                        const activity = activities.find(a => a.id === field.activityId);
                        const activityCode = activity?.code || 'Unknown';
                        const relevantFormulas = revisionFormulas.filter(f => f.activityCode === activityCode);

                        return (
                            <Card key={field.id}>
                                <CardHeader>
                                    <CardTitle>{activity?.label || 'Activité Inconnue'} ({activityCode})</CardTitle>
                                </CardHeader>
                                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <FormField
                                        control={form.control}
                                        name={`activitiesDetails.${index}.amount`}
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Montant Annuel HT</FormLabel>
                                                <FormControl>
                                                    <Input type="number" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name={`activitiesDetails.${index}.termId`}
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Terme de Facturation</FormLabel>
                                                <Select onValueChange={field.onChange} value={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Sélectionner..." />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {terms.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name={`activitiesDetails.${index}.scheduleId`}
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Échéancier</FormLabel>
                                                <Select onValueChange={field.onChange} value={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Sélectionner..." />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {schedules.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name={`activitiesDetails.${index}.revisionFormula`}
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Formule de Révision</FormLabel>
                                                <Select onValueChange={field.onChange} value={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Sélectionner..." />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        <SelectItem value="none">Aucune</SelectItem>
                                                        {relevantFormulas.map(f => (
                                                            <SelectItem key={f.id} value={f.id}>{f.code} - {f.formula}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </CardContent>
                            </Card>
                        );
                    })}

                    <div className="flex justify-end gap-4">
                        <Button type="submit">
                            <Save className="mr-2 h-4 w-4" /> Enregistrer et Valider
                        </Button>
                    </div>
                </form>
            </Form>
        </div>
    );
}
