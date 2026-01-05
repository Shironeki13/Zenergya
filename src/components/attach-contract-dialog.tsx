'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2, Link as LinkIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { updateContract } from "@/services/firestore";
import { useData } from "@/context/data-context";
import { Client } from "@/lib/types";

interface AttachContractDialogProps {
    client: Client;
    trigger?: React.ReactNode;
    onContractAttached?: () => void;
}

export function AttachContractDialog({ client, trigger, onContractAttached }: AttachContractDialogProps) {
    const { toast } = useToast();
    const { contracts, reloadData } = useData();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [selectedContractId, setSelectedContractId] = useState<string>('');
    const [isOpen, setIsOpen] = useState(false);

    // Filter out contracts that are already attached to this client
    const availableContracts = contracts.filter(c => c.clientId !== client.id);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedContractId) return;

        setIsSubmitting(true);
        try {
            await updateContract(selectedContractId, {
                clientId: client.id,
                clientName: client.name
            });

            toast({ title: "Succès", description: "Contrat rattaché avec succès." });
            await reloadData();
            if (onContractAttached) onContractAttached();
            setIsOpen(false);
            setSelectedContractId('');
        } catch (error) {
            console.error(error);
            toast({ title: "Erreur", description: "Impossible de rattacher le contrat.", variant: "destructive" });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button size="sm" className="gap-1">
                        <LinkIcon className="h-4 w-4" />
                        Rattacher un contrat
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Rattacher un contrat</DialogTitle>
                    <DialogDescription>
                        Sélectionnez un contrat existant pour le lier au client {client.name}.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="contract">Contrat</Label>
                        <Select value={selectedContractId} onValueChange={setSelectedContractId}>
                            <SelectTrigger>
                                <SelectValue placeholder="Sélectionner un contrat..." />
                            </SelectTrigger>
                            <SelectContent className="max-h-[300px]">
                                {availableContracts.map(contract => (
                                    <SelectItem key={contract.id} value={contract.id}>
                                        {contract.id.substring(0, 8)}... - {contract.clientName || 'Sans client'} ({contract.status})
                                    </SelectItem>
                                ))}
                                {availableContracts.length === 0 && (
                                    <SelectItem value="none" disabled>Aucun contrat disponible</SelectItem>
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    <DialogFooter>
                        <Button type="submit" disabled={isSubmitting || !selectedContractId}>
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Rattacher
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
