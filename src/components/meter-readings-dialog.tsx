'use client';

import { useConfirm } from '@/components/confirm-provider';
import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlusCircle, Trash2, Edit, Loader2, Lock, Calendar as CalendarIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { deleteReadingAction, readingLocksAction, saveReadingAction } from "@/lib/readings/actions";
import type { ReadingLocks } from "@/services/readings-admin";
import { useData } from "@/context/data-context";
import type { Meter, MeterReading } from "@/lib/types";

interface MeterReadingsDialogProps {
    meter: Meter;
    trigger?: React.ReactNode;
}

export function MeterReadingsDialog({ meter, trigger }: MeterReadingsDialogProps) {
    const confirmer = useConfirm();
    const { toast } = useToast();
    const { meterReadings, reloadData } = useData();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isFormOpen, setIsFormOpen] = useState(false);
    /** Relevés figés (facture, intéressement, régularisation) et dernier relevé facturé : lus au serveur. */
    const [locks, setLocks] = useState<ReadingLocks>({ locked: {}, lastBilled: null });

    // Form State
    const [date, setDate] = useState<Date | undefined>(new Date());
    const [value, setValue] = useState('');
    const [type, setType] = useState<MeterReading['type']>('REEL');
    const [comment, setComment] = useState('');

    const readings = useMemo(() => {
        return meterReadings
            .filter(r => r.meterId === meter.id)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [meterReadings, meter.id]);

    const loadLocks = async () => {
        const r = await readingLocksAction(meter.id);
        if (r.success) setLocks(r.data);
    };
    const editingLocked = editingId ? locks.locked[editingId] : undefined;

    const resetForm = () => {
        setDate(new Date());
        setValue('');
        setType('REEL');
        setComment('');
        setEditingId(null);
        setIsFormOpen(false);
    };

    const handleEdit = (reading: MeterReading) => {
        setEditingId(reading.id);
        setDate(new Date(reading.date));
        setValue(reading.value.toString());
        setType(reading.type);
        setComment(reading.comment || '');
        setIsFormOpen(true);
    };

    const handleDelete = async (id: string) => {
        if (!(await confirmer({ title: "Supprimer ce relevé ?", confirmLabel: 'Supprimer', destructive: true }))) return;
        const r = await deleteReadingAction(id);
        if (!r.success) { toast({ title: "Suppression refusée", description: r.error, variant: "destructive" }); return; }
        toast({ title: "Succès", description: "Relevé supprimé." });
        await reloadData();
        await loadLocks();
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!date || value === '') return;
        setIsSubmitting(true);
        // Écrit par le serveur : contrôles (index, date), relevés figés, période déjà facturée.
        const r = await saveReadingAction({ ...(editingId && { id: editingId }), meterId: meter.id, date: date.toISOString(), value: Number(value), type, comment });
        setIsSubmitting(false);
        if (!r.success) { toast({ title: "Enregistrement refusé", description: r.error, variant: "destructive" }); return; }
        toast({ title: "Succès", description: editingId ? "Relevé mis à jour." : "Relevé ajouté." });
        await reloadData();
        await loadLocks();
        resetForm();
    };

    return (
        <Dialog onOpenChange={open => { if (open) loadLocks(); }}>
            <DialogTrigger asChild>
                {trigger || <Button variant="outline" size="sm">Relevés</Button>}
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Relevés - {meter.code}</DialogTitle>
                    <DialogDescription>
                        Gérez les relevés pour le compteur {meter.name} ({meter.reference || 'Sans référence'}).
                        {locks.lastBilled && <> Relevés facturés jusqu&apos;au {format(new Date(locks.lastBilled.date), 'dd/MM/yyyy')} (facture {locks.lastBilled.invoice}) : un relevé antérieur ne s&apos;ajoute plus.</>}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 py-4">
                    {/* Formulaire d'ajout/édition */}
                    {isFormOpen ? (
                        <form onSubmit={handleSubmit} className="p-4 border rounded-lg bg-muted/20 space-y-4">
                            <h3 className="font-semibold text-sm">{editingId ? "Modifier le relevé" : "Nouveau relevé"}</h3>
                            {editingLocked && <p className="text-xs text-amber-700">Relevé repris dans {editingLocked} : seul le commentaire se modifie (une correction passe par un avoir).</p>}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Date</Label>
                                    <Popover modal={true}>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant={"outline"}
                                                disabled={!!editingLocked}
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
                                    <Input type="number" step="any" min={0} value={value} onChange={e => setValue(e.target.value)} required disabled={!!editingLocked} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Type</Label>
                                    <Select value={type} onValueChange={(v: any) => setType(v)} disabled={!!editingLocked}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="REEL">Réel</SelectItem>
                                            <SelectItem value="ESTIME">Estimé</SelectItem>
                                            <SelectItem value="CORRIGE">Corrigé</SelectItem>
                                            <SelectItem value="AUTO">Automatique</SelectItem>
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
                                                {locks.locked[reading.id] && (
                                                    <Badge variant="outline" className="mr-1 gap-1 text-[10px]" title={`Repris dans ${locks.locked[reading.id]}`}><Lock className="h-3 w-3" />Figé</Badge>
                                                )}
                                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(reading)} title={locks.locked[reading.id] ? 'Modifier le commentaire' : 'Modifier'}>
                                                    <Edit className="h-4 w-4" />
                                                </Button>
                                                {!locks.locked[reading.id] && (
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(reading.id)}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                )}
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
