'use client';

import { useLecturePeriode } from '@/hooks/use-lecture-periode';
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ExternalLink, CheckCircle2, Loader2 } from 'lucide-react';
import { useData } from '@/context/data-context';
import { updateInvoiceStatus } from '@/services/firestore';
import { useToast } from '@/hooks/use-toast';
import { format, differenceInDays, addDays, startOfDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import Link from 'next/link';
import type { Invoice } from '@/lib/types';
import { AFacturer } from '@/components/pilotage/a-facturer';
import { PilotageAdv } from '@/components/pilotage/pilotage-adv';
import { suiviFacturationAction } from '@/lib/pilotage/actions';
import type { SuiviFacturation } from '@/services/pilotage-admin';

// ── Types ─────────────────────────────────────────────────────────────────────
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
    const { isLoading: chargementBase, reloadData: rechargerPartage } = useData();
    // Factures impayées (à payer, en retard), toutes dates : les seules dont cet écran a besoin.
    const { donnees: invoices, chargement, recharger } = useLecturePeriode<Invoice>('facturesImpayees');
    const isLoading = chargementBase || chargement;
    const reloadData = async (collections: Parameters<typeof rechargerPartage>[0]) => { await Promise.all([recharger(), rechargerPartage(collections)]); };
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

    // ── KPIs ──────────────────────────────────────────────────────────────────
    const overdueTotal = overdueInvoices.reduce((s, i) => s + (i.total ?? 0), 0);
    const upcomingDueTotal = upcomingDueInvoices.reduce((s, i) => s + (i.total ?? 0), 0);
    // Échéances à facturer (serveur, même échéancier que la facture).
    const [horizon, setHorizon] = useState(60);
    const [suivi, setSuivi] = useState<SuiviFacturation | null>(null);
    const [suiviLoading, setSuiviLoading] = useState(false);
    useEffect(() => {
        let cancelled = false;
        setSuiviLoading(true);
        suiviFacturationAction(horizon).then(r => {
            if (cancelled) return;
            setSuiviLoading(false);
            if (r.success) setSuivi(r.data);
            else toast({ title: 'Suivi indisponible', description: r.error, variant: 'destructive' });
        });
        return () => { cancelled = true; };
    }, [horizon, invoices, toast]);
    const enRetard = (suivi?.echeances ?? []).filter(e => e.statut !== 'a_venir');

    const handleMarkPaid = async (inv: Invoice) => {
        setMarkingPaid(inv.id);
        try {
            await updateInvoiceStatus(inv.id, 'paid');
            await reloadData(['invoices']);
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
                <h1 className="text-2xl font-bold tracking-tight">Suivi de facturation</h1>
                <p className="text-sm text-muted-foreground">
                    Échéances à facturer (en retard, du jour, à venir), impayés et paiements attendus.
                </p>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="pilotage">
                <TabsList>
                    <TabsTrigger value="pilotage" className="gap-2">
                        Pilotage
                        {enRetard.length > 0 && <Badge variant="destructive" className="h-5 min-w-[1.25rem] px-1 text-xs">{enRetard.length}</Badge>}
                    </TabsTrigger>
                    <TabsTrigger value="facturer">Liste des échéances</TabsTrigger>
                    <TabsTrigger value="overdue" className="gap-2">
                        Impayés{overdueInvoices.length > 0 && <span className="text-xs text-muted-foreground">{formatCurrency(overdueTotal)}</span>}
                        {overdueInvoices.length > 0 && (
                            <Badge variant="destructive" className="h-5 min-w-[1.25rem] px-1 text-xs">
                                {overdueInvoices.length}
                            </Badge>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="upcoming" className="gap-2">
                        Paiements attendus — 30j{upcomingDueInvoices.length > 0 && <span className="text-xs text-muted-foreground">{formatCurrency(upcomingDueTotal)}</span>}
                        {upcomingDueInvoices.length > 0 && (
                            <Badge variant="secondary" className="h-5 min-w-[1.25rem] px-1 text-xs">
                                {upcomingDueInvoices.length}
                            </Badge>
                        )}
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="pilotage">
                    <PilotageAdv data={suivi} loading={suiviLoading} horizon={horizon} onHorizon={setHorizon} />
                </TabsContent>

                <TabsContent value="facturer">
                    <AFacturer data={suivi} loading={suiviLoading} horizon={horizon} onHorizon={setHorizon} />
                </TabsContent>

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

                </TabsContent>
            </Tabs>
        </div>
    );
}
