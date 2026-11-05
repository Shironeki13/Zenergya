
'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, CalendarIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useData } from '@/context/data-context';
import { contractInvoiceLines, frDay, nextBillingPeriod, vatTotals, type BillingPeriod } from '@/lib/billing/contract-billing';
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
    periodStart: string;
    periodEnd: string;
    billingSchedule: string;
    subtotal: number;
    tax: number;
    /** Facture impossible (TVA manquante, échéancier inconnu…) : ligne non sélectionnable. */
    error?: string;
};

export default function BatchBillingPage() {
    const { contracts, invoices, sites, services, activities, vatRates, isLoading } = useData();
    const { toast } = useToast();
    const [isGenerating, setIsGenerating] = useState(false);
    const [selectedItems, setSelectedItems] = useState<string[]>([]);
    const [dueDate, setDueDate] = useState<Date>(new Date());

    // Même calcul que le serveur (lib/billing/contract-billing) : périodes, prorata au jour près, TVA par ligne.
    const billableItems = useMemo(() => {
        if (isLoading) return [];
        const until = toDay(dueDate)!;
        const results: BillableItem[] = [];
        for (const contract of contracts.filter(c => c.status === 'Actif')) {
            const base = { contractId: contract.id, contractNumber: contract.contractNumber ?? contract.id, clientName: contract.clientName };
            let last = invoices
                .filter(inv => inv.contractId === contract.id && inv.status !== 'cancelled' && !inv.cancelledByCreditNoteId && inv.periodEndDate)
                .map(inv => toDay(inv.periodEndDate)!)
                .sort()
                .pop() ?? null;
            for (let guard = 0; guard < 120; guard++) {
                let period: BillingPeriod | null;
                try {
                    period = nextBillingPeriod(contract, last);
                } catch (e) {
                    results.push({ ...base, id: `${contract.id}-erreur`, periodStart: '', periodEnd: '', billingSchedule: contract.billingSchedule ?? '', subtotal: 0, tax: 0, error: (e as Error).message });
                    break;
                }
                if (!period || period.start > until) break;
                const { lines, errors } = contractInvoiceLines({
                    contract: { id: contract.id, siteIds: contract.siteIds ?? [], activityIds: contract.activityIds ?? [], invoicingType: contract.invoicingType },
                    sites, services, activities, vatRates,
                }, period);
                const totals = vatTotals(lines);
                results.push({
                    ...base, id: `${contract.id}-${period.start}`, periodStart: period.start, periodEnd: period.end, billingSchedule: period.label,
                    subtotal: totals.subtotal, tax: totals.tax,
                    ...(errors.length ? { error: errors.join(' ') } : lines.length === 0 ? { error: 'Aucune prestation facturable sur cette période.' } : {}),
                });
                // Une période en erreur bloque les suivantes (elles se facturent dans l'ordre).
                if (errors.length) break;
                last = period.end;
            }
        }
        return results;
    }, [isLoading, contracts, invoices, sites, services, activities, vatRates, dueDate]);
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
        // Les périodes d'un même contrat se facturent l'une après l'autre, dans l'ordre (chacune vérifie qu'elle
        // est bien la suivante) ; les contrats sont traités en parallèle.
        const byContract = new Map<string, BillableItem[]>();
        for (const item of itemsToGenerate) byContract.set(item.contractId, [...(byContract.get(item.contractId) ?? []), item]);
        const promises = [...byContract.values()].map(async (items) => {
            const outcomes: { success: boolean; error?: string }[] = [];
            for (const item of items.sort((a, b) => a.periodStart.localeCompare(b.periodStart))) {
                const r = await generateInvoice({ contractId: item.contractId, invoiceDate, isProforma: false, periodStartDate: item.periodStart });
                outcomes.push(r.success ? r : { success: false, error: `${item.contractNumber} : ${r.error}` });
                if (!r.success) break;
            }
            return outcomes;
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
        }
    };


    return (
        <Card>
            <CardHeader>
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div>
                        <CardTitle>Facturation Groupée</CardTitle>
                        <CardDescription>
                            Générez toutes les factures arrivées à échéance jusqu'à la date sélectionnée.
                        </CardDescription>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="grid gap-2">
                            <Label>Date d'échéance</Label>
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
                            <TableHead>Période</TableHead>
                            <TableHead>Échéancier</TableHead>
                            <TableHead className="text-right">Montant HT</TableHead>
                            <TableHead className="text-right">TVA</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
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
                                        <TableCell colSpan={4} className="text-sm text-destructive">{item.periodStart ? `${frDay(item.periodStart)} - ${frDay(item.periodEnd)} : ` : ''}{item.error}</TableCell>
                                    ) : (<>
                                        <TableCell>{frDay(item.periodStart)} - {frDay(item.periodEnd)}</TableCell>
                                        <TableCell>{item.billingSchedule}</TableCell>
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
