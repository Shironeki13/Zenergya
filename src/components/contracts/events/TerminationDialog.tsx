import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createTermination } from "@/services/firestore";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { useData } from "@/context/data-context";

const formSchema = z.object({
    reason: z.string().min(1, "Motif requis"),
    effectiveDate: z.string().min(1, "Date requise"),
});

interface TerminationDialogProps {
    contractId?: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}

export function TerminationDialog({ contractId, open, onOpenChange, onSuccess }: TerminationDialogProps) {
    const { toast } = useToast();
    const { clients, contracts } = useData();
    const [isLoading, setIsLoading] = useState(false);

    const [selectedClientId, setSelectedClientId] = useState<string>("");
    const [selectedContractId, setSelectedContractId] = useState<string>(contractId || "");

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
            reason: "",
            effectiveDate: new Date().toISOString().split('T')[0],
        },
    });

    async function onSubmit(values: z.infer<typeof formSchema>) {
        if (!selectedContractId) return;

        setIsLoading(true);
        try {
            await createTermination({
                contractId: selectedContractId,
                reason: values.reason,
                effectiveDate: values.effectiveDate,
                createdAt: new Date().toISOString(),
                createdBy: "System",
            });
            toast({ title: "Résiliation enregistrée", description: "La résiliation a été ajoutée avec succès." });
            form.reset();
            onSuccess();
            onOpenChange(false);
        } catch (error) {
            console.error(error);
            toast({ title: "Erreur", description: "Impossible d'enregistrer la résiliation.", variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    }

    const filteredContracts = contracts.filter(c => c.clientId === selectedClientId && c.status === 'Actif');

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Enregistrer une Résiliation</DialogTitle>
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
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
                            <Button type="button" variant="destructive" disabled={!selectedContractId} onClick={form.handleSubmit(onSubmit)}>
                                Résilier
                            </Button>
                        </DialogFooter>
                    </div>
                ) : (
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            <FormField
                                control={form.control}
                                name="reason"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Motif</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Ex: Vente, Insatisfaction..." {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="effectiveDate"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Date Effective</FormLabel>
                                        <FormControl>
                                            <Input type="date" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
                                <Button type="submit" variant="destructive" disabled={isLoading}>
                                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Résilier
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                )}
            </DialogContent>
        </Dialog>
    );
}
