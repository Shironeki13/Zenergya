import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createAmendment } from "@/services/firestore";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { useData } from "@/context/data-context";

const formSchema = z.object({
    description: z.string().min(1, "Description requise"),
    effectiveDate: z.string().min(1, "Date requise"),
    signed: z.boolean().default(false),
    impactP1: z.number().optional(),
    impactP2: z.number().optional(),
    impactP3: z.number().optional(),
    impactP3R: z.number().optional(),
    impactsDuration: z.boolean().default(false),
    newEndDate: z.string().optional(),
});

interface AmendmentDialogProps {
    contractId?: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}

export function AmendmentDialog({ contractId, open, onOpenChange, onSuccess }: AmendmentDialogProps) {
    const { toast } = useToast();
    const { clients, contracts } = useData();
    const [isLoading, setIsLoading] = useState(false);

    const [selectedClientId, setSelectedClientId] = useState<string>("");
    const [selectedContractId, setSelectedContractId] = useState<string>(contractId || "");

    // Update selectedContractId when prop changes
    useEffect(() => {
        if (contractId) {
            setSelectedContractId(contractId);
        } else {
            setSelectedContractId("");
            setSelectedClientId("");
        }
    }, [contractId, open]);

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            description: "",
            effectiveDate: new Date().toISOString().split('T')[0],
            signed: false,
            impactsDuration: false,
        },
    });

    const watchImpactsDuration = form.watch("impactsDuration");

    async function onSubmit(values: z.infer<typeof formSchema>) {
        if (!selectedContractId) return;

        setIsLoading(true);
        try {
            await createAmendment({
                contractId: selectedContractId,
                description: values.description,
                effectiveDate: values.effectiveDate,
                signed: values.signed,
                impactP1: values.impactP1,
                impactP2: values.impactP2,
                impactP3: values.impactP3,
                impactP3R: values.impactP3R,
                impactsDuration: values.impactsDuration,
                newEndDate: values.newEndDate,
                createdAt: new Date().toISOString(),
                createdBy: "System", // TODO: Replace with actual user
                impactsServices: false, // Not implemented yet in UI
            });
            toast({ title: "Avenant créé", description: "L'avenant a été ajouté avec succès." });
            form.reset();
            onSuccess();
            onOpenChange(false);
        } catch (error) {
            console.error(error);
            toast({ title: "Erreur", description: "Impossible de créer l'avenant.", variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    }

    const filteredContracts = contracts.filter(c => c.clientId === selectedClientId && c.status === 'Actif');

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>Nouvel Avenant</DialogTitle>
                </DialogHeader>

                {!contractId && !selectedContractId ? (
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Client</label>
                            <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Sélectionner un client" />
                                </SelectTrigger>
                                <SelectContent>
                                    {clients.map(client => (
                                        <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {selectedClientId && (
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Contrat</label>
                                <Select value={selectedContractId} onValueChange={setSelectedContractId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Sélectionner un contrat" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {filteredContracts.length > 0 ? (
                                            filteredContracts.map(contract => (
                                                <SelectItem key={contract.id} value={contract.id}>{contract.contractNumber || contract.name || 'Contrat sans nom'}</SelectItem>
                                            ))
                                        ) : (
                                            <SelectItem value="none" disabled>Aucun contrat actif</SelectItem>
                                        )}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    </div>
                ) : (
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            <FormField
                                control={form.control}
                                name="description"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Description</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Ex: Ajout de prestation P2" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <div className="grid grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="effectiveDate"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Date d'effet</FormLabel>
                                            <FormControl>
                                                <Input type="date" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="signed"
                                    render={({ field }) => (
                                        <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4 mt-8">
                                            <FormControl>
                                                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                                            </FormControl>
                                            <div className="space-y-1 leading-none">
                                                <FormLabel>Signé ?</FormLabel>
                                            </div>
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <div className="space-y-4 border p-4 rounded-md">
                                <h4 className="font-medium">Impacts Financiers (HT/An)</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <FormField control={form.control} name="impactP1" render={({ field }) => (<FormItem><FormLabel>Impact P1</FormLabel><FormControl><Input type="number" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} /></FormControl></FormItem>)} />
                                    <FormField control={form.control} name="impactP2" render={({ field }) => (<FormItem><FormLabel>Impact P2</FormLabel><FormControl><Input type="number" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} /></FormControl></FormItem>)} />
                                    <FormField control={form.control} name="impactP3" render={({ field }) => (<FormItem><FormLabel>Impact P3</FormLabel><FormControl><Input type="number" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} /></FormControl></FormItem>)} />
                                    <FormField control={form.control} name="impactP3R" render={({ field }) => (<FormItem><FormLabel>Impact P3R</FormLabel><FormControl><Input type="number" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} /></FormControl></FormItem>)} />
                                </div>
                            </div>

                            <FormField
                                control={form.control}
                                name="impactsDuration"
                                render={({ field }) => (
                                    <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4">
                                        <FormControl>
                                            <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                                        </FormControl>
                                        <div className="space-y-1 leading-none">
                                            <FormLabel>Modifie la durée du contrat ?</FormLabel>
                                        </div>
                                    </FormItem>
                                )}
                            />

                            {watchImpactsDuration && (
                                <FormField
                                    control={form.control}
                                    name="newEndDate"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Nouvelle Date de Fin</FormLabel>
                                            <FormControl>
                                                <Input type="date" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            )}

                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
                                <Button type="submit" disabled={isLoading}>
                                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Créer
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                )}
            </DialogContent>
        </Dialog>
    );
}
