
'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useData } from '@/context/data-context';
import type { Contract, Invoice } from '@/lib/types';
import { generateInvoice } from '@/ai/flows/generate-invoice-flow';

type BillableItem = {
    id: string;
    contractId: string;
    clientName: string;
    periodStartDate: Date;
    periodEndDate: Date;
    billingSchedule: string;
    amount: number;
};

export default function BatchBillingPage() {
    const { contracts, invoices, sites, activities, isLoading } = useData();
    const { toast } = useToast();
    const [isGenerating, setIsGenerating] = useState(false);
    const [selectedItems, setSelectedItems] = useState<string[]>([]);

    const billableItems = useMemo(() => {
        if (isLoading) return [];
        const today = new Date();
        const results: BillableItem[] = [];

        const activeContracts = contracts.filter(c => c.status === 'Actif');
        const invoicesByContract = invoices.reduce((acc, inv) => {
            if (inv.status !== 'proforma') {
                if (!acc[inv.contractId]) acc[inv.contractId] = [];
                acc[inv.contractId].push(inv);
            }
            return acc;
        }, {} as Record<string, Invoice[]>);

        for (const contract of activeContracts) {
            const contractInvoices = invoicesByContract[contract.id] || [];
            contractInvoices.sort((a, b) => new Date(b.periodEndDate!).getTime() - new Date(a.periodEndDate!).getTime());
            
            const lastInvoice = contractInvoices[0];
            const contractStartDate = new Date(contract.startDate);
            let nextBillingStartDate = lastInvoice ? new Date(lastInvoice.periodEndDate!) : contractStartDate;
            if (lastInvoice) nextBillingStartDate.setDate(nextBillingStartDate.getDate() + 1);

            while (nextBillingStartDate < today && nextBillingStartDate < new Date(contract.endDate)) {
                let billingFactor = 1;
                let nextBillingEndDate = new Date(nextBillingStartDate);

                switch (contract.billingSchedule) {
                    case 'Mensuel':
                        billingFactor = 1 / 12;
                        nextBillingEndDate.setMonth(nextBillingEndDate.getMonth() + 1);
                        nextBillingEndDate.setDate(nextBillingEndDate.getDate() - 1);
                        break;
                    case 'Trimestriel':
                        billingFactor = 1 / 4;
                        nextBillingEndDate.setMonth(nextBillingEndDate.getMonth() + 3);
                        nextBillingEndDate.setDate(nextBillingEndDate.getDate() - 1);
                        break;
                    case 'Semestriel':
                        billingFactor = 1 / 2;
                        nextBillingEndDate.setMonth(nextBillingEndDate.getMonth() + 6);
                        nextBillingEndDate.setDate(nextBillingEndDate.getDate() - 1);
                        break;
                    case 'Annuel': default:
                        billingFactor = 1;
                        nextBillingEndDate.setFullYear(nextBillingEndDate.getFullYear() + 1);
                        nextBillingEndDate.setDate(nextBillingEndDate.getDate() - 1);
                        break;
                }
                
                const contractEndDate = new Date(contract.endDate);
                if (nextBillingEndDate > contractEndDate) {
                    nextBillingEndDate = contractEndDate;
                }

                if (nextBillingStartDate > nextBillingEndDate) break;

                const contractSites = sites.filter(s => contract.siteIds.includes(s.id));
                let totalAmountForPeriod = 0;
                for (const site of contractSites) {
                    if (!site.amounts) continue;
                    for (const amountInfo of site.amounts) {
                        if (contract.activityIds.includes(amountInfo.activityId)) {
                            totalAmountForPeriod += amountInfo.amount;
                        }
                    }
                }
                
                totalAmountForPeriod *= billingFactor;

                results.push({
                    id: `${contract.id}-${nextBillingStartDate.toISOString()}`,
                    contractId: contract.id,
                    clientName: contract.clientName,
                    periodStartDate: new Date(nextBillingStartDate),
                    periodEndDate: nextBillingEndDate,
                    billingSchedule: contract.billingSchedule,
                    amount: totalAmountForPeriod,
                });
                
                nextBillingStartDate = new Date(nextBillingEndDate);
                nextBillingStartDate.setDate(nextBillingStartDate.getDate() + 1);
            }
        }
        return results;
    }, [isLoading, contracts, invoices, sites, activities]);

    const handleSelect = (id: string, checked: boolean) => {
        if (checked) {
            setSelectedItems(prev => [...prev, id]);
        } else {
            setSelectedItems(prev => prev.filter(itemId => itemId !== id));
        }
    };

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedItems(billableItems.map(item => item.id));
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
        
        const itemsToGenerate = billableItems.filter(item => selectedItems.includes(item.id));
        
        const promises = itemsToGenerate.map(item => generateInvoice({
            contractId: item.contractId,
            invoiceDate: new Date().toISOString(),
            isProforma: false,
        }));

        try {
            const results = await Promise.allSettled(promises);
            const successfulGenerations = results.filter(r => r.status === 'fulfilled' && r.value.success);
            const failedGenerations = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success));
            
            if (successfulGenerations.length > 0) {
                toast({
                    title: 'Génération terminée',
                    description: `${successfulGenerations.length} factures sur ${itemsToGenerate.length} ont été générées avec succès.`
                });
            }

            if (failedGenerations.length > 0) {
                const errorMessage = failedGenerations.map(r => {
                    if (r.status === 'fulfilled') return r.value.error;
                    return (r.reason as Error).message;
                }).join(', ');
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
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle>Facturation Groupée</CardTitle>
                        <CardDescription>
                            Générez toutes les factures arrivées à échéance en une seule fois.
                        </CardDescription>
                    </div>
                    <Button onClick={handleGenerate} disabled={isGenerating || selectedItems.length === 0}>
                        {isGenerating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Générer {selectedItems.length > 0 ? `(${selectedItems.length})` : ''}
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[50px]">
                                <Checkbox
                                    checked={selectedItems.length === billableItems.length && billableItems.length > 0}
                                    onCheckedChange={handleSelectAll}
                                />
                            </TableHead>
                            <TableHead>Client</TableHead>
                            <TableHead>Contrat ID</TableHead>
                            <TableHead>Période</TableHead>
                            <TableHead>Échéancier</TableHead>
                            <TableHead className="text-right">Montant HT</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center">
                                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                                </TableCell>
                            </TableRow>
                        ) : billableItems.length > 0 ? (
                            billableItems.map((item) => (
                                <TableRow key={item.id} data-state={selectedItems.includes(item.id) && "selected"}>
                                    <TableCell>
                                        <Checkbox
                                            checked={selectedItems.includes(item.id)}
                                            onCheckedChange={(checked) => handleSelect(item.id, !!checked)}
                                        />
                                    </TableCell>
                                    <TableCell className="font-medium">{item.clientName}</TableCell>
                                    <TableCell>{item.contractId}</TableCell>
                                    <TableCell>
                                        {item.periodStartDate.toLocaleDateString()} - {item.periodEndDate.toLocaleDateString()}
                                    </TableCell>
                                    <TableCell>{item.billingSchedule}</TableCell>
                                    <TableCell className="text-right">{item.amount.toFixed(2)} €</TableCell>
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center h-24">Aucune facture à émettre pour le moment.</TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
