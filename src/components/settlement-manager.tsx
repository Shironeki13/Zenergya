'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Service, ServiceSettlement } from '@/lib/types';
import { getSettlementsByService, deleteSettlement } from '@/services/firestore';
import { format } from 'date-fns';
import { Edit, Trash2, Plus, Calculator } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { SettlementDialog } from './settlement-dialog';

interface SettlementManagerProps {
    service: Service;
}

export function SettlementManager({ service }: SettlementManagerProps) {
    const [settlements, setSettlements] = useState<ServiceSettlement[]>([]);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingSettlement, setEditingSettlement] = useState<ServiceSettlement | null>(null);
    const [loading, setLoading] = useState(true);

    const loadSettlements = async () => {
        setLoading(true);
        try {
            const data = await getSettlementsByService(service.id);
            setSettlements(data.sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime()));
        } catch (error) {
            console.error(error);
            toast({ title: "Erreur", description: "Impossible de charger les décomptes.", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadSettlements();
    }, [service.id]);

    const handleCreate = () => {
        setEditingSettlement(null);
        setIsDialogOpen(true);
    };

    const handleEdit = (settlement: ServiceSettlement) => {
        setEditingSettlement(settlement);
        setIsDialogOpen(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Supprimer ce décompte ?")) return;
        try {
            await deleteSettlement(id);
            toast({ title: "Succès", description: "Décompte supprimé." });
            loadSettlements();
        } catch (error) {
            console.error(error);
            toast({ title: "Erreur", description: "Impossible de supprimer le décompte.", variant: "destructive" });
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium">Décomptes Définitifs</h3>
                <Button onClick={handleCreate} size="sm">
                    <Plus className="mr-2 h-4 w-4" /> Créer un décompte
                </Button>
            </div>

            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Période</TableHead>
                                <TableHead>Méthode</TableHead>
                                <TableHead className="text-right">Montant HT</TableHead>
                                <TableHead>Date Calcul</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow><TableCell colSpan={5} className="text-center">Chargement...</TableCell></TableRow>
                            ) : settlements.length === 0 ? (
                                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Aucun décompte enregistré.</TableCell></TableRow>
                            ) : (
                                settlements.map(s => (
                                    <TableRow key={s.id}>
                                        <TableCell>
                                            {format(new Date(s.startDate), 'dd/MM/yyyy')} - {format(new Date(s.endDate), 'dd/MM/yyyy')}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col">
                                                <span className="font-medium">{s.ruleSnapshot?.label || 'Inconnu'}</span>
                                                <span className="text-xs text-muted-foreground">{s.reason}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right font-bold">
                                            {s.amountHt.toFixed(2)} €
                                        </TableCell>
                                        <TableCell>
                                            {format(new Date(s.calculationDate), 'dd/MM/yyyy')}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" onClick={() => handleEdit(s)}>
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(s.id)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <SettlementDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                service={service}
                settlement={editingSettlement}
                onSaved={loadSettlements}
            />
        </div>
    );
}
