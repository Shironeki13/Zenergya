'use client';

import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlusCircle, Trash2, Edit, Loader2, Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { createMeterReading, updateMeterReading, deleteMeterReading } from "@/services/firestore";
import { useData } from "@/context/data-context";
import type { Meter, MeterReading } from "@/lib/types";

interface MeterReadingsDialogProps {
    meter: Meter;
    trigger?: React.ReactNode;
}

export function MeterReadingsDialog({ meter, trigger }: MeterReadingsDialogProps) {
    const { toast } = useToast();
    const { meterReadings, sites, contracts, reloadData, isLoading } = useData();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isFormOpen, setIsFormOpen] = useState(false);

    // Form State
    const [date, setDate] = useState<Date | undefined>(new Date());
    const [value, setValue] = useState('');
    const [type, setType] = useState<MeterReading['type']>('REEL');
    const [source, setSource] = useState<MeterReading['source']>('MANUEL');
    const [comment, setComment] = useState('');

    const readings = useMemo(() => {
        return meterReadings
            .filter(r => r.meterId === meter.id)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [meterReadings, meter.id]);

    const resetForm = () => {
        setDate(new Date());
        setValue('');
        setType('REEL');
        setSource('MANUEL');
        setComment('');
        setEditingId(null);
        setIsFormOpen(false);
    };

    const handleEdit = (reading: MeterReading) => {
        setEditingId(reading.id);
        setDate(new Date(reading.date));
        setValue(reading.value.toString());
        setType(reading.type);
        setSource(reading.source);
        setComment(reading.comment || '');
        setIsFormOpen(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Êtes-vous sûr de vouloir supprimer ce relevé ?")) return;
        try {
            await deleteMeterReading(id);
            toast({ title: "Succès", description: "Relevé supprimé." });
            await reloadData();
        } catch (error) {
            toast({ title: "Erreur", description: "Impossible de supprimer le relevé.", variant: "destructive" });
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!date || !value) return;

        setIsSubmitting(true);
        try {
            // Find contractId
            const site = sites.find(s => s.id === meter.siteId);
            const contract = site ? contracts.find(c => c.siteIds.includes(site.id)) : null;
            const contractId = contract?.id;

            const data = {
                meterId: meter.id,
                contractId, // Add contractId
                date: date.toISOString(),
                value: Number(value),
                type,
                source,
                comment,
                unit: meter.unit
            };

            if (editingId) {
                await updateMeterReading(editingId, data);
                toast({ title: "Succès", description: "Relevé mis à jour." });
            } else {
                await createMeterReading(data);
                toast({ title: "Succès", description: "Relevé ajouté." });
            }
            await reloadData();
            resetForm();
        } catch (error) {
            console.error(error);
            toast({ title: "Erreur", description: "L'opération a échoué.", variant: "destructive" });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog>
            <DialogTrigger asChild>
                {trigger || <Button variant="outline" size="sm">Relevés</Button>}
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Relevés - {meter.code}</DialogTitle>
                    <DialogDescription>
                        Gérez les relevés pour le compteur {meter.name} ({meter.reference || 'Sans référence'}).
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 py-4">
                    {/* Formulaire d'ajout/édition */}
                    {isFormOpen ? (
                        <form onSubmit={handleSubmit} className="p-4 border rounded-lg bg-muted/20 space-y-4">
                            <h3 className="font-semibold text-sm">{editingId ? "Modifier le relevé" : "Nouveau relevé"}</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Date</Label>
                                    <Popover modal={true}>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant={"outline"}
                                                className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}
                                            >
                                                <CalendarIcon className="mr-2 h-4 w-4" />
                                                {date ? format(date, "PPP", { locale: fr }) : <span>Choisir une date</span>}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0">
                                            <Calendar mode="single" selected={date} onSelect={setDate} initialFocus />
                                        </PopoverContent>
                                    </Popover>
                                </div>
                                <div className="space-y-2">
                                    <Label>Index ({meter.unit})</Label>
                                    <Input type="number" step="any" value={value} onChange={e => setValue(e.target.value)} required />
                                </div>
                                <div className="space-y-2">
                                    <Label>Type</Label>
                                    <Select value={type} onValueChange={(v: any) => setType(v)}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="REEL">Réel</SelectItem>
                                            <SelectItem value="ESTIME">Estimé</SelectItem>
                                            <SelectItem value="CORRIGE">Corrigé</SelectItem>
                                            <SelectItem value="AUTO">Automatique</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Source</Label>
                                    <Select value={source} onValueChange={(v: any) => setSource(v)}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="MANUEL">Manuel</SelectItem>
                                            <SelectItem value="IMPORT">Import</SelectItem>
                                            <SelectItem value="API">API</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Commentaire</Label>
                                <Input value={comment} onChange={e => setComment(e.target.value)} placeholder="Optionnel" />
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button type="button" variant="ghost" onClick={resetForm}>Annuler</Button>
                                <Button type="submit" disabled={isSubmitting}>
                                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    {editingId ? "Mettre à jour" : "Ajouter"}
                                </Button>
                            </div>
                        </form>
                    ) : (
                        <div className="flex justify-end">
                            <Button onClick={() => setIsFormOpen(true)} className="gap-2">
                                <PlusCircle className="h-4 w-4" />
                                Ajouter un relevé
                            </Button>
                        </div>
                    )}

                    {/* Liste des relevés */}
                    <div className="border rounded-md">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Index</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Source</TableHead>
                                    <TableHead>Commentaire</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {readings.length === 0 ? (
                                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Aucun relevé.</TableCell></TableRow>
                                ) : (
                                    readings.map(reading => (
                                        <TableRow key={reading.id}>
                                            <TableCell>{format(new Date(reading.date), 'dd/MM/yyyy')}</TableCell>
                                            <TableCell className="font-mono font-medium">{reading.value} {reading.unit}</TableCell>
                                            <TableCell className="text-xs">{reading.type}</TableCell>
                                            <TableCell className="text-xs text-muted-foreground">{reading.source}</TableCell>
                                            <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">{reading.comment}</TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(reading)}>
                                                    <Edit className="h-4 w-4" />
                                                </Button>
                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(reading.id)}>
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
