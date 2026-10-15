'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Edit, Loader2, PlusCircle, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useData } from '@/context/data-context';
import { createTypology, deleteTypology, updateTypology } from '@/services/firestore';
import { REGIME_LABELS } from '@/lib/einvoicing';
import { EINVOICING_REGIMES, type EInvoicingRegime, type Typology } from '@/lib/types';

const NO_REGIME = 'none';

/** Typologies de clients, avec leur régime de facturation électronique par défaut. */
export function TypologiesSection() {
    const { typologies, isLoading, reloadData } = useData();
    const { toast } = useToast();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<Typology | null>(null);
    const [toDelete, setToDelete] = useState<Typology | null>(null);
    const [name, setName] = useState('');
    const [regime, setRegime] = useState<string>(NO_REGIME);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const open = (typology: Typology | null) => {
        setEditing(typology);
        setName(typology?.name ?? '');
        setRegime(typology?.einvoicingRegime ?? NO_REGIME);
        setDialogOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        setIsSubmitting(true);
        const extra = { einvoicingRegime: regime === NO_REGIME ? null : regime as EInvoicingRegime };
        try {
            if (editing) await updateTypology(editing.id, name.trim(), extra);
            else await createTypology(name.trim(), extra);
            toast({ title: 'Succès', description: 'Typologie enregistrée.' });
            await reloadData();
            setDialogOpen(false);
        } catch {
            toast({ title: 'Erreur', description: "L'opération a échoué.", variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!toDelete) return;
        try {
            await deleteTypology(toDelete.id);
            toast({ title: 'Succès', description: 'Typologie supprimée.' });
            await reloadData();
        } catch {
            toast({ title: 'Erreur', description: 'Impossible de supprimer la typologie.', variant: 'destructive' });
        } finally {
            setToDelete(null);
        }
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center gap-4">
                    <div>
                        <CardTitle>Typologies</CardTitle>
                        <CardDescription>
                            Typologies de clients et leur régime de facturation électronique par défaut
                            (ex. Particulier → B2C : pas de facture électronique). Un client public relève toujours de Chorus Pro ;
                            chaque fiche client peut forcer un autre régime.
                        </CardDescription>
                    </div>
                    <Button size="sm" className="gap-1" onClick={() => open(null)}><PlusCircle className="h-4 w-4" /> Créer</Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="border rounded-md">
                    <Table>
                        <TableHeader><TableRow><TableHead>Nom</TableHead><TableHead>Facturation électronique</TableHead><TableHead className="w-[100px] text-right">Actions</TableHead></TableRow></TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow><TableCell colSpan={3} className="text-center h-24"><Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" /></TableCell></TableRow>
                            ) : typologies.length === 0 ? (
                                <TableRow><TableCell colSpan={3} className="text-center">Aucune typologie.</TableCell></TableRow>
                            ) : typologies.map(t => (
                                <TableRow key={t.id}>
                                    <TableCell className="font-medium">{t.name}</TableCell>
                                    <TableCell className="text-muted-foreground">{t.einvoicingRegime ? REGIME_LABELS[t.einvoicingRegime] : 'Par défaut (B2B si client privé)'}</TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => open(t)}><Edit className="h-4 w-4" /></Button>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setToDelete(t)}><Trash2 className="h-4 w-4" /></Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>

                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogContent>
                        <DialogHeader><DialogTitle>{editing ? 'Modifier la typologie' : 'Nouvelle typologie'}</DialogTitle></DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="typologyName">Nom</Label>
                                <Input id="typologyName" value={name} onChange={e => setName(e.target.value)} required />
                            </div>
                            <div className="space-y-2">
                                <Label>Régime de facturation électronique par défaut</Label>
                                <Select value={regime} onValueChange={setRegime}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={NO_REGIME}>Par défaut (B2B si client privé)</SelectItem>
                                        {EINVOICING_REGIMES.map(r => <SelectItem key={r} value={r}>{REGIME_LABELS[r]}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <DialogFooter>
                                <DialogClose asChild><Button type="button" variant="outline">Annuler</Button></DialogClose>
                                <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Enregistrement...' : 'Enregistrer'}</Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>

                <Dialog open={!!toDelete} onOpenChange={o => !o && setToDelete(null)}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Supprimer {toDelete?.name}</DialogTitle>
                            <DialogDescription>Cette action est irréversible.</DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setToDelete(null)}>Annuler</Button>
                            <Button variant="destructive" onClick={handleDelete}>Confirmer</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
}
