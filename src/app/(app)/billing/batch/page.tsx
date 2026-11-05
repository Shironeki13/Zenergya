
'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, CalendarIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useData } from '@/context/data-context';
import { frDay } from '@/lib/billing/contract-billing';
import { previewBatchBillingAction } from '@/lib/billing/actions';
import { toDay } from '@/lib/services/site-amounts';

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
import { generateInvoice } from '@/ai/flows/generate-invoice-flow';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Label } from '@/components/ui/label';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';

type BillableItem = {
    id: string;
    contractId: string;
    contractNumber: string;
    clientName: string;
    /** Première et dernière dates des échéances facturées. */
    periodStart: string;
    periodEnd: string;
    echeances: number;
    subtotal: number;
    tax: number;
    warnings: string[];
    /** Facture impossible (TVA manquante, périodicité inconnue…) : ligne non sélectionnable. */
    error?: string;
};

export default function BatchBillingPage() {
    const { invoices, isLoading } = useData();
    const { toast } = useToast();
    const [isGenerating, setIsGenerating] = useState(false);
    const [selectedItems, setSelectedItems] = useState<string[]>([]);
    const [dueDate, setDueDate] = useState<Date>(new Date());

    // Aperçu calculé au serveur, exactement comme la facture (acomptes P1 compris) : une ligne par contrat.
    const [billableItems, setBillableItems] = useState<BillableItem[]>([]);
    const [previewing, setPreviewing] = useState(false);
    const [refresh, setRefresh] = useState(0);
    useEffect(() => {
        if (isLoading) return;
        let cancelled = false;
        setPreviewing(true);
        previewBatchBillingAction(toDay(dueDate)!).then(r => {
            if (cancelled) return;
            setPreviewing(false);
            if (r.success) setBillableItems(r.data.map(row => ({ ...row, id: row.contractId })));
            else toast({ title: 'Aperçu impossible', description: r.error, variant: 'destructive' });
        });
        return () => { cancelled = true; };
    }, [isLoading, dueDate, invoices, toast, refresh]);
    const selectable = billableItems.filter(item => !item.error);

    const handleSelect = (id: string, checked: boolean) => {
        if (checked) {
            setSelectedItems(prev => [...prev, id]);
        } else {
            setSelectedItems(prev => prev.filter(itemId => itemId !== id));
        }
    };

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedItems(selectable.map(item => item.id));
        } else {
            setSelectedItems([]);
        }
    };

    const handleGenerate = async () => {
        if (selectedItems.length === 0) {
            toast({ title: 'Aucune sélection', description: 'Veuillez sélectionner au moins une facture à générer.', variant: 'destructive' });
            return;
        }
        setIsGenerating(true);

        const itemsToGenerate = selectable.filter(item => selectedItems.includes(item.id));
        const invoiceDate = toDay(new Date())!;
        const until = toDay(dueDate)!;
        // Une facture par contrat, avec toutes ses échéances facturables à la date choisie. Le serveur refuse une
        // facture si le contrat a été facturé entre-temps (pas de double facturation).
        const promises = itemsToGenerate.map(async (item) => {
            const r = await generateInvoice({ contractId: item.contractId, invoiceDate, isProforma: false, until });
            return [r.success ? r : { success: false, error: `${item.contractNumber} : ${r.error}` }];
        });

        try {
            const results = (await Promise.all(promises)).flat();
            const successfulGenerations = results.filter(r => r.success);
            const failedGenerations = results.filter(r => !r.success);

            if (successfulGenerations.length > 0) {
                toast({
                    title: 'Génération terminée',
                    description: `${successfulGenerations.length} factures sur ${itemsToGenerate.length} ont été générées avec succès.`
                });
            }

            if (failedGenerations.length > 0) {
                const errorMessage = failedGenerations.map(r => r.error).join(' ; ');
                toast({
                    title: 'Échecs de génération',
                    description: `Erreurs pour ${failedGenerations.length} factures: ${errorMessage}`,
                    variant: 'destructive',
                    duration: 10000,
                });
            }
            setSelectedItems([]);
        } catch (error) {
            toast({
                title: 'Erreur inattendue',
                description: 'Une erreur inattendue est survenue lors de la génération.',
                variant: 'destructive',
            });
        } finally {
            setIsGenerating(false);
            setRefresh(r => r + 1);
        }
    };


    return (
        <Card>
            <CardHeader>
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div>
                        <CardTitle>Facturation Groupée</CardTitle>
                        <CardDescription>
                            Une facture par contrat, avec toutes les échéances facturables à la date choisie (terme et périodicité de chaque prestation).
                        </CardDescription>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="grid gap-2">
                            <Label>Facturer jusqu'au</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant={"outline"}
                                        className={cn(
                                            "w-[240px] justify-start text-left font-normal",
                                            !dueDate && "text-muted-foreground"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {dueDate ? format(dueDate, "PPP", { locale: fr }) : <span>Choisir une date</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                    <Calendar
                                        mode="single"
                                        selected={dueDate}
                                        onSelect={(date) => setDueDate(date || new Date())}
                                        initialFocus
                                        locale={fr}
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>
                        <Button onClick={handleGenerate} disabled={isGenerating || selectedItems.length === 0} className="self-end">
                            {isGenerating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Générer {selectedItems.length > 0 ? `(${selectedItems.length})` : ''}
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[50px]">
                                <Checkbox
                                    checked={selectedItems.length === selectable.length && selectable.length > 0}
                                    onCheckedChange={handleSelectAll}
                                />
                            </TableHead>
                            <TableHead>Client</TableHead>
                            <TableHead>Contrat</TableHead>
                            <TableHead>Échéances</TableHead>
                            <TableHead>Périodes</TableHead>
                            <TableHead className="text-right">Montant HT</TableHead>
                            <TableHead className="text-right">TVA</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading || previewing ? (
                            <TableRow>
                                <TableCell colSpan={7} className="h-24 text-center">
                                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                                </TableCell>
                            </TableRow>
                        ) : billableItems.length > 0 ? (
                            billableItems.map((item) => (
                                <TableRow key={item.id} data-state={selectedItems.includes(item.id) && "selected"}>
                                    <TableCell>
                                        <Checkbox
                                            checked={selectedItems.includes(item.id)}
                                            disabled={!!item.error}
                                            onCheckedChange={(checked) => handleSelect(item.id, !!checked)}
                                        />
                                    </TableCell>
                                    <TableCell className="font-medium">{item.clientName}</TableCell>
                                    <TableCell className="font-mono text-xs">{item.contractNumber}</TableCell>
                                    {item.error ? (
                                        <TableCell colSpan={4} className="text-sm text-destructive">{item.error}</TableCell>
                                    ) : (<>
                                        <TableCell>
                                            {item.echeances}
                                            {item.warnings.length > 0 && <span className="block text-xs text-amber-600" title={item.warnings.join('\n')}>{item.warnings.length} avertissement(s)</span>}
                                        </TableCell>
                                        <TableCell>{frDay(item.periodStart)} - {frDay(item.periodEnd)}</TableCell>
                                        <TableCell className="text-right">{eur(item.subtotal)}</TableCell>
                                        <TableCell className="text-right">{eur(item.tax)}</TableCell>
                                    </>)}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={7} className="text-center h-24">Aucune facture à émettre pour le moment.</TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
