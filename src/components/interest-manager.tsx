'use client';

import { useState, useEffect } from 'react';
import { Interest, Service } from '@/lib/types';
import { getInterestsByService, deleteInterest } from '@/services/firestore';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Trash2, Edit, Calculator } from 'lucide-react';
import { InterestDialog } from './interest-dialog';
import { toast } from '@/hooks/use-toast';

interface InterestManagerProps {
    service: Service;
}

export function InterestManager({ service }: InterestManagerProps) {
    const [interests, setInterests] = useState<Interest[]>([]);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingInterest, setEditingInterest] = useState<Interest | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const loadInterests = async () => {
        setIsLoading(true);
        try {
            const data = await getInterestsByService(service.id);
            setInterests(data.sort((a, b) => b.seasonLabel.localeCompare(a.seasonLabel)));
        } catch (error) {
            console.error(error);
            toast({ title: "Erreur", description: "Impossible de charger les données d'intéressement.", variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (service.id) {
            loadInterests();
        }
    }, [service.id]);

    const handleCreateClick = () => {
        setEditingInterest(null);
        setIsDialogOpen(true);
    };

    const handleEditClick = (interest: Interest) => {
        setEditingInterest(interest);
        setIsDialogOpen(true);
    };

    const handleDeleteClick = async (id: string) => {
        if (!confirm("Supprimer cette campagne d'intéressement ?")) return;
        try {
            await deleteInterest(id);
            toast({ title: "Succès", description: "Campagne supprimée." });
            loadInterests();
        } catch (error) {
            console.error(error);
            toast({ title: "Erreur", description: "Impossible de supprimer.", variant: "destructive" });
        }
    };

    const handleDialogClose = (shouldReload: boolean = false) => {
        setIsDialogOpen(false);
        if (shouldReload) {
            loadInterests();
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium">Historique d'Intéressement</h3>
                <Button onClick={handleCreateClick} size="sm">
                    <Plus className="mr-2 h-4 w-4" /> Nouvelle Campagne
                </Button>
            </div>

            <div className="border rounded-md">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Saison</TableHead>
                            <TableHead>Période</TableHead>
                            <TableHead>Résultat</TableHead>
                            <TableHead>Montant</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow><TableCell colSpan={5} className="text-center">Chargement...</TableCell></TableRow>
                        ) : interests.length === 0 ? (
                            <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Aucune campagne enregistrée.</TableCell></TableRow>
                        ) : (
                            interests.map(interest => (
                                <TableRow key={interest.id}>
                                    <TableCell className="font-medium">{interest.seasonLabel}</TableCell>
                                    <TableCell className="text-sm">
                                        {interest.startDate} au {interest.endDate}
                                    </TableCell>
                                    <TableCell>
                                        <span className={interest.gainLoss >= 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                                            {interest.gainLoss >= 0 ? "Gain" : "Perte"}
                                        </span>
                                    </TableCell>
                                    <TableCell>
                                        {interest.interestAmount.toFixed(2)} €
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="icon" onClick={() => handleEditClick(interest)}>
                                            <Edit className="h-4 w-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDeleteClick(interest.id)}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            {isDialogOpen && (
                <InterestDialog
                    open={isDialogOpen}
                    onOpenChange={setIsDialogOpen}
                    service={service}
                    existingInterest={editingInterest}
                    onSaved={() => handleDialogClose(true)}
                />
            )}
        </div>
    );
}
