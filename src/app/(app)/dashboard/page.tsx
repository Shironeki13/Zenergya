
'use client';

import Link from 'next/link';
import {
  ArrowUpRight,
  CircleDollarSign,
  FileSignature,
  Users,
  Clock,
  Loader2,
  TrendingUp,
  FileClock
} from 'lucide-react';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Pie, PieChart, Cell } from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { InvoiceStatus, Invoice, Contract } from '@/lib/types';
import { useData } from '@/context/data-context';
import { useMemo } from 'react';
import { ChartContainer, ChartTooltipContent, ChartLegend, ChartLegendContent } from '@/components/ui/chart';

export default function Dashboard() {
  const { clients, contracts, invoices, isLoading } = useData();

  const dashboardData = useMemo(() => {
    if (isLoading) return null;

    const activeContracts = contracts.filter((c) => c.status === 'Actif').length;
    const totalClients = clients.length;
    const totalBilledHT = invoices
      .filter(i => i.status !== 'proforma')
      .reduce((sum, i) => sum + i.subtotal, 0);

    const invoicesPerContract = invoices.reduce((acc, inv) => {
      if (inv.status !== 'proforma') {
        if (!acc[inv.contractId]) acc[inv.contractId] = [];
        acc[inv.contractId].push(inv);
      }
      return acc;
    }, {} as Record<string, Invoice[]>);

    const invoicesToBeIssued = contracts.filter(contract => {
      if (contract.status !== 'Actif') return false;

      const contractInvoices = invoicesPerContract[contract.id] || [];
      contractInvoices.sort((a, b) => new Date(b.periodEndDate!).getTime() - new Date(a.periodEndDate!).getTime());

      const lastInvoice = contractInvoices[0];
      const contractStartDate = new Date(contract.startDate);

      let nextBillingDate = lastInvoice ? new Date(lastInvoice.periodEndDate!) : contractStartDate;
      if (lastInvoice) nextBillingDate.setDate(nextBillingDate.getDate() + 1);

      switch (contract.billingSchedule) {
        case 'Mensuel': nextBillingDate.setMonth(nextBillingDate.getMonth() + 1); break;
        case 'Trimestriel': nextBillingDate.setMonth(nextBillingDate.getMonth() + 3); break;
        case 'Semestriel': nextBillingDate.setMonth(nextBillingDate.getMonth() + 6); break;
        case 'Annuel': nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1); break;
        default: break;
      }

      const contractEndDate = new Date(contract.endDate);
      return new Date() > nextBillingDate && nextBillingDate < contractEndDate;
    }).length;


    // Chart Data
    const monthlyRevenue: { month: string, total: number }[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStr = date.toLocaleString('fr-FR', { month: 'short', year: '2-digit' }).replace('.', '');
      monthlyRevenue.push({ month: monthStr, total: 0 });
    }

    invoices.filter(i => i.status !== 'proforma').forEach(invoice => {
      const invoiceDate = new Date(invoice.date);
      const monthIndex = 11 - ((now.getFullYear() - invoiceDate.getFullYear()) * 12 + (now.getMonth() - invoiceDate.getMonth()));
      if (monthIndex >= 0 && monthIndex < 12) {
        monthlyRevenue[monthIndex].total += invoice.subtotal;
      }
    });

    const contractStatusData = contracts.reduce((acc, contract) => {
      const status = contract.status;
      const existing = acc.find(item => item.name === status);
      if (existing) {
        existing.value++;
      } else {
        acc.push({ name: status, value: 1, fill: `hsl(var(--chart-${acc.length + 1}))` });
      }
      return acc;
    }, [] as { name: string, value: number, fill: string }[]);


    const recentInvoices = [...invoices].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5);

    return { activeContracts, totalClients, totalBilledHT, invoicesToBeIssued, recentInvoices, monthlyRevenue, contractStatusData };
  }, [isLoading, contracts, invoices, clients]);

  if (isLoading || !dashboardData) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const { activeContracts, totalClients, totalBilledHT, invoicesToBeIssued, recentInvoices, monthlyRevenue, contractStatusData } = dashboardData;
  const chartConfig = {
    total: { label: "Total" },
  } as const;

  const contractChartConfig = Object.fromEntries(
    contractStatusData.map((d, i) => [d.name, { label: d.name, color: `hsl(var(--chart-${i + 1}))` }])
  );

  const translateStatus = (status: InvoiceStatus) => {
    switch (status) {
      case 'paid': return 'Payée';
      case 'due': return 'Due';
      case 'overdue': return 'En retard';
      default: return status;
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">Tableau de bord</h1>
          <p className="text-muted-foreground mt-1">Vue d'ensemble de votre activité énergétique.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="hidden sm:flex">
            <Clock className="mr-2 h-4 w-4" />
            Dernière mise à jour: {new Date().toLocaleDateString()}
          </Button>
          <Button size="sm" className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20">
            <ArrowUpRight className="mr-2 h-4 w-4" />
            Nouvelle Facture
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 md:gap-8 lg:grid-cols-4">
        <Card className="border-none shadow-md bg-gradient-to-br from-card to-muted/50 hover:shadow-lg transition-all duration-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total HT Facturé
            </CardTitle>
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <CircleDollarSign className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{totalBilledHT.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Sur toutes les factures émises
            </p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-md bg-gradient-to-br from-card to-muted/50 hover:shadow-lg transition-all duration-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Contrats Actifs
            </CardTitle>
            <div className="h-8 w-8 rounded-full bg-secondary/10 flex items-center justify-center">
              <FileSignature className="h-4 w-4 text-secondary" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-secondary">+{activeContracts}</div>
            <p className="text-xs text-muted-foreground mt-1">
              sur un total de {contracts.length} contrats
            </p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-md bg-gradient-to-br from-card to-muted/50 hover:shadow-lg transition-all duration-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Factures à Émettre</CardTitle>
            <div className="h-8 w-8 rounded-full bg-warning/10 flex items-center justify-center">
              <FileClock className="h-4 w-4 text-warning" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{invoicesToBeIssued}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Contrats nécessitant une facturation
            </p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-md bg-gradient-to-br from-card to-muted/50 hover:shadow-lg transition-all duration-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Clients</CardTitle>
            <div className="h-8 w-8 rounded-full bg-accent/10 flex items-center justify-center">
              <Users className="h-4 w-4 text-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalClients}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Total des clients gérés
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="lg:col-span-4 border-none shadow-md">
          <CardHeader>
            <CardTitle>Chiffre d'Affaires Mensuel (HT)</CardTitle>
            <CardDescription>Total facturé sur les 12 derniers mois.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyRevenue} margin={{ top: 20, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={10}
                    tickFormatter={(value) => value.charAt(0).toUpperCase() + value.slice(1)}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickMargin={10}
                    tickFormatter={(value) => (value as number / 1000) + 'k'}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <Tooltip
                    cursor={{ fill: 'hsl(var(--muted)/0.2)' }}
                    content={<ChartTooltipContent
                      formatter={(value) => value.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                      indicator="dot"
                    />}
                  />
                  <Bar
                    dataKey="total"
                    fill="hsl(var(--primary))"
                    radius={[4, 4, 0, 0]}
                    barSize={32}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>
        <Card className="lg:col-span-3 border-none shadow-md">
          <CardHeader>
            <CardTitle>Répartition des Contrats</CardTitle>
            <CardDescription>Statut de tous les contrats.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            <ChartContainer config={contractChartConfig} className="h-[300px] w-full max-w-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip
                    content={<ChartTooltipContent
                      nameKey="name"
                      hideIndicator
                    />}
                  />
                  <Pie
                    data={contractStatusData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {contractStatusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} strokeWidth={0} />
                    ))}
                  </Pie>
                  <ChartLegend
                    content={<ChartLegendContent />}
                    nameKey="name"
                    className="-translate-y-2 flex-wrap gap-2 [&>*]:basis-1/4 [&>*]:justify-center"
                  />
                </PieChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>


      <Card className="border-none shadow-md">
        <CardHeader className="flex flex-row items-center">
          <div className="grid gap-2">
            <CardTitle>Factures Récentes</CardTitle>
            <CardDescription>
              Liste des dernières factures créées.
            </CardDescription>
          </div>
          <Button asChild size="sm" variant="ghost" className="ml-auto gap-1 text-primary hover:text-primary/80">
            <Link href="/invoices">
              Voir tout
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-b border-border/50">
                <TableHead className="text-muted-foreground">Client</TableHead>
                <TableHead className="hidden md:table-cell text-muted-foreground">
                  Statut
                </TableHead>
                <TableHead className="hidden md:table-cell text-muted-foreground">Date</TableHead>
                <TableHead className="text-right text-muted-foreground">Montant</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentInvoices.map((invoice) => (
                <TableRow key={invoice.id} className="hover:bg-muted/30 border-b border-border/50 last:border-0">
                  <TableCell>
                    <div className="font-medium">{invoice.clientName}</div>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {invoice.total.toFixed(2)} €
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
