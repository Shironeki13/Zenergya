'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertTriangle, Clock, CalendarDays, Activity, ExternalLink, CheckCircle2, Loader2 } from 'lucide-react';
import { useData } from '@/context/data-context';
import { updateInvoiceStatus } from '@/services/firestore';
import { useToast } from '@/hooks/use-toast';
import { format, differenceInDays, addDays, startOfDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import Link from 'next/link';
import type { Invoice } from '@/lib/types';

// ── Types ─────────────────────────────────────────────────────────────────────
type UpcomingPeriod = {
    id: string;
    contractId: string;
    contractRef: string;
    clientName: string;
    periodStart: Date;
    periodEnd: Date;
    schedule: string;
    estimatedAmount: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function DelayBadge({ days }: { days: number }) {
    if (days <= 7) return <Badge variant="outline" className="border-yellow-500 text-yellow-600">{days}j</Badge>;
    if (days <= 30) return <Badge variant="outline" className="border-orange-500 text-orange-600">{days}j</Badge>;
    return <Badge variant="destructive">{days}j</Badge>;
}

function DaysLeftBadge({ days }: { days: number }) {
    if (days === 0) return <Badge variant="outline" className="border-red-500 text-red-600">Aujourd'hui</Badge>;
    if (days <= 7) return <Badge variant="outline" className="border-orange-400 text-orange-600">{days}j</Badge>;
    return <Badge variant="secondary">{days}j</Badge>;
}

function formatCurrency(n: number) {
    return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

function periodLabel(start: Date, end: Date) {
    return `${format(start, 'dd MMM yy', { locale: fr })} → ${format(end, 'dd MMM yy', { locale: fr })}`;
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function SuiviFacturationPage() {
    const { invoices, contracts, sites, isLoading, reloadData } = useData();
    const { toast } = useToast();
    const [markingPaid, setMarkingPaid] = useState<string | null>(null);

    const today = useMemo(() => startOfDay(new Date()), []);
    const in30Days = useMemo(() => addDays(today, 30), [today]);

    // ── Factures en retard ────────────────────────────────────────────────────
    const overdueInvoices = useMemo(() => {
        return invoices
            .filter(inv => {
                if (['paid', 'cancelled', 'proforma'].includes(inv.status)) return false;
                if (inv.status === 'overdue') return true;
                return inv.status === 'due' && startOfDay(new Date(inv.dueDate)) < today;
            })
            .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    }, [invoices, today]);

    // ── Factures émises, échéance dans 30j ───────────────────────────────────
    const upcomingDueInvoices = useMemo(() => {
        return invoices
            .filter(inv => {
                if (inv.status !== 'due') return false;
                const due = startOfDay(new Date(inv.dueDate));
                return due >= today && due <= in30Days;
            })
            .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    }, [invoices, today, in30Days]);

    // ── Périodes à facturer dans 30j ─────────────────────────────────────────
    // Algorithme : génère TOUTES les périodes depuis le début du contrat et
    // matche chacune par periodStartDate ± 3j (même logique que le calendrier site).
    // Cela évite le bug de "lastInvoice.periodEndDate" qui peut pointer loin dans
    // le futur si une facture couvre une période non alignée avec le découpage.
    const upcomingPeriods = useMemo<UpcomingPeriod[]>(() => {
        if (isLoading) return [];

        const results: UpcomingPeriod[] = [];
        const activeContracts = contracts.filter(c => c.status === 'Actif');
        const THREE_DAYS_MS = 3 * 86_400_000;

        // Index des factures non-proforma par contrat
        const invoicesByContract = invoices.reduce<Record<string, Invoice[]>>((acc, inv) => {
            if (inv.status !== 'proforma' && inv.status !== 'cancelled') {
                if (!acc[inv.contractId]) acc[inv.contractId] = [];
                acc[inv.contractId].push(inv);
            }
            return acc;
        }, {});

        const scheduleMonths: Record<string, number> = {
            'Mensuel': 1, 'Trimestriel': 3, 'Semestriel': 6, 'Annuel': 12,
        };

        for (const contract of activeContracts) {
            const intervalMonths = scheduleMonths[contract.billingSchedule ?? ''] ?? 0;
            if (!intervalMonths) continue;

            const contractInvoices = invoicesByContract[contract.id] ?? [];
            const contractEnd = new Date(contract.endDate);
            let cursor = startOfDay(new Date(contract.startDate));

            // Parcourir toutes les périodes depuis le début du contrat
            while (cursor <= contractEnd && cursor <= in30Days) {
                const periodStart = new Date(cursor);
                const periodEnd = new Date(cursor);
                periodEnd.setMonth(periodEnd.getMonth() + intervalMonths);
                periodEnd.setDate(periodEnd.getDate() - 1);
                if (periodEnd > contractEnd) periodEnd.setTime(contractEnd.getTime());

                // Chercher une facture dont le periodStartDate est à ±3j de ce début de période
                const matched = contractInvoices.find(inv =>
                    inv.periodStartDate &&
                    Math.abs(new Date(inv.periodStartDate).getTime() - periodStart.getTime()) < THREE_DAYS_MS
                );

                // N'inclure que les périodes qui se terminent dans les 30 prochains jours et sans facture
                if (!matched && periodEnd >= today && periodEnd <= in30Days) {
                    const contractSites = sites.filter(s => contract.siteIds?.includes(s.id));
                    let amount = 0;
                    for (const site of contractSites) {
                        if (!site.amounts) continue;
                        for (const a of site.amounts) {
                            if (contract.activityIds?.includes(a.activityId)) amount += a.amount;
                        }
                    }
                    amount /= (12 / intervalMonths); // prorata

                    results.push({
                        id: `${contract.id}-${periodStart.toISOString()}`,
                        contractId: contract.id,
                        contractRef: contract.contractNumber ?? contract.id.substring(0, 8),
                        clientName: contract.clientName ?? '—',
                        periodStart,
                        periodEnd,
                        schedule: contract.billingSchedule ?? 'Annuel',
                        estimatedAmount: amount,
                    });
                }

                cursor.setMonth(cursor.getMonth() + intervalMonths);
            }
        }

        return results.sort((a, b) => a.periodEnd.getTime() - b.periodEnd.getTime());
    }, [isLoading, contracts, invoices, sites, today, in30Days]);

    // ── KPIs ──────────────────────────────────────────────────────────────────
    const overdueTotal = overdueInvoices.reduce((s, i) => s + (i.total ?? 0), 0);
    const upcomingDueTotal = upcomingDueInvoices.reduce((s, i) => s + (i.total ?? 0), 0);
    const upcomingPeriodsTotal = upcomingPeriods.reduce((s, p) => s + p.estimatedAmount, 0);
    const activeContractsCount = contracts.filter(c => c.status === 'Actif').length;

    const handleMarkPaid = async (inv: Invoice) => {
        setMarkingPaid(inv.id);
        try {
            await updateInvoiceStatus(inv.id, 'paid');
            await reloadData();
            toast({ title: 'Payée', description: `Facture ${inv.invoiceNumber ?? inv.id} marquée comme payée.` });
        } catch {
            toast({ title: 'Erreur', description: 'Impossible de mettre à jour le statut.', variant: 'destructive' });
        } finally {
            setMarkingPaid(null);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* En-tête */}
            <div>
                <h1 className="text-lg font-medium">Suivi de facturation</h1>
                <p className="text-sm text-muted-foreground">
                    Retards de paiement, échéances à venir et périodes à facturer dans les 30 prochains jours.
                </p>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className={overdueInvoices.length > 0 ? 'border-red-200' : ''}>
                    <CardHeader className="pb-2 pt-4 px-4">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-sm font-medium text-muted-foreground">En retard</CardTitle>
                            <AlertTriangle className={`h-4 w-4 ${overdueInvoices.length > 0 ? 'text-red-500' : 'text-muted-foreground'}`} />
                        </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                        <p className={`text-2xl font-bold ${overdueInvoices.length > 0 ? 'text-red-600' : ''}`}>{overdueInvoices.length}</p>
                        <p className="text-sm text-muted-foreground">{formatCurrency(overdueTotal)}</p>
                    </CardContent>
                </Card>

                <Card className={upcomingDueInvoices.length > 0 ? 'border-amber-200' : ''}>
                    <CardHeader className="pb-2 pt-4 px-4">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Échéances 30j</CardTitle>
                            <Clock className={`h-4 w-4 ${upcomingDueInvoices.length > 0 ? 'text-amber-500' : 'text-muted-foreground'}`} />
                        </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                        <p className={`text-2xl font-bold ${upcomingDueInvoices.length > 0 ? 'text-amber-600' : ''}`}>{upcomingDueInvoices.length}</p>
                        <p className="text-sm text-muted-foreground">{formatCurrency(upcomingDueTotal)}</p>
                    </CardContent>
                </Card>

                <Card className={upcomingPeriods.length > 0 ? 'border-blue-200' : ''}>
                    <CardHeader className="pb-2 pt-4 px-4">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-sm font-medium text-muted-foreground">À facturer 30j</CardTitle>
                            <CalendarDays className={`h-4 w-4 ${upcomingPeriods.length > 0 ? 'text-blue-500' : 'text-muted-foreground'}`} />
                        </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                        <p className={`text-2xl font-bold ${upcomingPeriods.length > 0 ? 'text-blue-600' : ''}`}>{upcomingPeriods.length}</p>
                        <p className="text-sm text-muted-foreground">~{formatCurrency(upcomingPeriodsTotal)}</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-2 pt-4 px-4">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Contrats actifs</CardTitle>
                            <Activity className="h-4 w-4 text-green-500" />
                        </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                        <p className="text-2xl font-bold">{activeContractsCount}</p>
                        <p className="text-sm text-muted-foreground">en cours</p>
                    </CardContent>
                </Card>
            </div>

            {/* Tabs */}
            <Tabs defaultValue={overdueInvoices.length > 0 ? 'overdue' : 'upcoming'}>
                <TabsList>
                    <TabsTrigger value="overdue" className="gap-2">
                        Retards
                        {overdueInvoices.length > 0 && (
                            <Badge variant="destructive" className="h-5 min-w-[1.25rem] px-1 text-xs">
                                {overdueInvoices.length}
                            </Badge>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="upcoming" className="gap-2">
                        À venir — 30j
                        {(upcomingDueInvoices.length + upcomingPeriods.length) > 0 && (
                            <Badge variant="secondary" className="h-5 min-w-[1.25rem] px-1 text-xs">
                                {upcomingDueInvoices.length + upcomingPeriods.length}
                            </Badge>
                        )}
                    </TabsTrigger>
                </TabsList>

                {/* ── Tab Retards ─────────────────────────────────────────────── */}
                <TabsContent value="overdue">
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Factures en retard</CardTitle>
                            <p className="text-sm text-muted-foreground">
                                Factures dont la date d'échéance est dépassée, triées de la plus ancienne à la plus récente.
                            </p>
                        </CardHeader>
                        <CardContent>
                            <div className="border rounded-md">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Client</TableHead>
                                            <TableHead>N° Facture</TableHead>
                                            <TableHead>Période couverte</TableHead>
                                            <TableHead>Date limite</TableHead>
                                            <TableHead>Retard</TableHead>
                                            <TableHead className="text-right">Montant TTC</TableHead>
                                            <TableHead className="w-[120px] text-right">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {overdueInvoices.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={7} className="text-center h-24 text-muted-foreground">
                                                    Aucune facture en retard. Tout est à jour !
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            overdueInvoices.map(inv => {
                                                const daysLate = differenceInDays(today, startOfDay(new Date(inv.dueDate)));
                                                return (
                                                    <TableRow key={inv.id}>
                                                        <TableCell className="font-medium">{inv.clientName}</TableCell>
                                                        <TableCell className="font-mono text-sm text-muted-foreground">
                                                            {inv.invoiceNumber ?? '—'}
                                                        </TableCell>
                                                        <TableCell className="text-sm text-muted-foreground">
                                                            {inv.periodStartDate && inv.periodEndDate
                                                                ? periodLabel(new Date(inv.periodStartDate), new Date(inv.periodEndDate))
                                                                : '—'}
                                                        </TableCell>
                                                        <TableCell className="text-sm">
                                                            {format(new Date(inv.dueDate), 'dd MMM yyyy', { locale: fr })}
                                                        </TableCell>
                                                        <TableCell>
                                                            <DelayBadge days={daysLate} />
                                                        </TableCell>
                                                        <TableCell className="text-right font-medium">
                                                            {formatCurrency(inv.total ?? 0)}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            <div className="flex items-center justify-end gap-1">
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-7 text-xs gap-1"
                                                                    onClick={() => handleMarkPaid(inv)}
                                                                    disabled={markingPaid === inv.id}
                                                                >
                                                                    {markingPaid === inv.id
                                                                        ? <Loader2 className="h-3 w-3 animate-spin" />
                                                                        : <CheckCircle2 className="h-3 w-3" />
                                                                    }
                                                                    Payée
                                                                </Button>
                                                                <Link href={`/contracts/${inv.contractId}`}>
                                                                    <Button size="icon" variant="ghost" className="h-7 w-7">
                                                                        <ExternalLink className="h-3 w-3" />
                                                                    </Button>
                                                                </Link>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ── Tab À venir ─────────────────────────────────────────────── */}
                <TabsContent value="upcoming" className="space-y-4">

                    {/* Section A : Factures émises, échéance dans 30j */}
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Factures en attente de paiement</CardTitle>
                            <p className="text-sm text-muted-foreground">
                                Factures déjà émises dont l'échéance arrive dans les 30 prochains jours.
                            </p>
                        </CardHeader>
                        <CardContent>
                            <div className="border rounded-md">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Client</TableHead>
                                            <TableHead>N° Facture</TableHead>
                                            <TableHead>Période couverte</TableHead>
                                            <TableHead>Échéance</TableHead>
                                            <TableHead>Dans</TableHead>
                                            <TableHead className="text-right">Montant TTC</TableHead>
                                            <TableHead className="w-[48px]" />
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {upcomingDueInvoices.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={7} className="text-center h-16 text-muted-foreground">
                                                    Aucune facture à encaisser dans les 30 prochains jours.
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            upcomingDueInvoices.map(inv => {
                                                const daysLeft = differenceInDays(startOfDay(new Date(inv.dueDate)), today);
                                                return (
                                                    <TableRow key={inv.id}>
                                                        <TableCell className="font-medium">{inv.clientName}</TableCell>
                                                        <TableCell className="font-mono text-sm text-muted-foreground">
                                                            {inv.invoiceNumber ?? '—'}
                                                        </TableCell>
                                                        <TableCell className="text-sm text-muted-foreground">
                                                            {inv.periodStartDate && inv.periodEndDate
                                                                ? periodLabel(new Date(inv.periodStartDate), new Date(inv.periodEndDate))
                                                                : '—'}
                                                        </TableCell>
                                                        <TableCell className="text-sm">
                                                            {format(new Date(inv.dueDate), 'dd MMM yyyy', { locale: fr })}
                                                        </TableCell>
                                                        <TableCell>
                                                            <DaysLeftBadge days={daysLeft} />
                                                        </TableCell>
                                                        <TableCell className="text-right font-medium">
                                                            {formatCurrency(inv.total ?? 0)}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            <Link href={`/contracts/${inv.contractId}`}>
                                                                <Button size="icon" variant="ghost" className="h-7 w-7">
                                                                    <ExternalLink className="h-3 w-3" />
                                                                </Button>
                                                            </Link>
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Section B : Périodes à facturer dans 30j */}
                    <Card>
                        <CardHeader className="pb-3 flex-row items-start justify-between space-y-0">
                            <div>
                                <CardTitle className="text-base">Périodes à facturer</CardTitle>
                                <p className="text-sm text-muted-foreground mt-1">
                                    Périodes de facturation arrivant à terme dans les 30 prochains jours, sans facture émise.
                                </p>
                            </div>
                            <Link href="/billing/batch">
                                <Button size="sm" variant="outline" className="gap-1 shrink-0">
                                    Facturation groupée
                                    <ExternalLink className="h-3 w-3" />
                                </Button>
                            </Link>
                        </CardHeader>
                        <CardContent>
                            <div className="border rounded-md">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Client</TableHead>
                                            <TableHead>Contrat</TableHead>
                                            <TableHead>Période</TableHead>
                                            <TableHead>Périodicité</TableHead>
                                            <TableHead>Fin dans</TableHead>
                                            <TableHead className="text-right">Montant estimé HT</TableHead>
                                            <TableHead className="w-[48px]" />
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {upcomingPeriods.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={7} className="text-center h-16 text-muted-foreground">
                                                    Aucune période à facturer dans les 30 prochains jours.
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            upcomingPeriods.map(period => {
                                                const daysLeft = differenceInDays(startOfDay(period.periodEnd), today);
                                                return (
                                                    <TableRow key={period.id}>
                                                        <TableCell className="font-medium">{period.clientName}</TableCell>
                                                        <TableCell className="font-mono text-sm text-muted-foreground">
                                                            {period.contractRef}
                                                        </TableCell>
                                                        <TableCell className="text-sm">
                                                            {periodLabel(period.periodStart, period.periodEnd)}
                                                        </TableCell>
                                                        <TableCell>
                                                            <Badge variant="secondary">{period.schedule}</Badge>
                                                        </TableCell>
                                                        <TableCell>
                                                            <DaysLeftBadge days={daysLeft} />
                                                        </TableCell>
                                                        <TableCell className="text-right font-medium">
                                                            {period.estimatedAmount > 0
                                                                ? formatCurrency(period.estimatedAmount)
                                                                : <span className="text-muted-foreground">—</span>
                                                            }
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            <Link href={`/contracts/${period.contractId}`}>
                                                                <Button size="icon" variant="ghost" className="h-7 w-7">
                                                                    <ExternalLink className="h-3 w-3" />
                                                                </Button>
                                                            </Link>
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
