'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { getQuotes } from '@/services/quotes';
import { QUOTE_STATUSES, QUOTE_STATUS_LABELS, type Quote, type QuoteStatus } from '@/lib/quotes/types';
import { formatEur, formatPct, StatusBadge } from '@/components/quotes/format';

export default function QuotesPage() {
    // useSearchParams exige une frontière Suspense (pré-rendu Next.js).
    return <Suspense><QuotesList /></Suspense>;
}

function QuotesList() {
    const { toast } = useToast();
    const params = useSearchParams();
    const [quotes, setQuotes] = useState<Quote[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState<QuoteStatus | 'all'>('all');
    const siteId = params.get('siteId');
    const clientId = params.get('clientId');

    useEffect(() => {
        getQuotes()
            .then(setQuotes)
            .catch(() => toast({ title: 'Erreur', description: 'Impossible de charger les devis.', variant: 'destructive' }))
            .finally(() => setLoading(false));
    }, [toast]);

    const visible = useMemo(() => {
        const s = search.trim().toLowerCase();
        return quotes
            .filter(q => status === 'all' || q.status === status)
            .filter(q => !siteId || q.siteId === siteId)
            .filter(q => !clientId || q.clientId === clientId)
            .filter(q => !s || [q.number, q.title, q.clientName, q.siteName, q.interventionAddress?.city]
                .some(v => (v ?? '').toLowerCase().includes(s)))
            .sort((a, b) => b.number.localeCompare(a.number));
    }, [quotes, search, status, siteId, clientId]);

    const newHref = `/quotes/new${clientId || siteId ? `?${new URLSearchParams({ ...(clientId && { clientId }), ...(siteId && { siteId }) })}` : ''}`;

    return (
        <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
                <div>
                    <CardTitle>Devis</CardTitle>
                    <CardDescription>
                        Devis sur des sites existants ou pour des prospects.
                        {(siteId || clientId) && <> Filtré sur {siteId ? 'un site' : 'un client'} — <Link className="underline" href="/quotes">tout afficher</Link>.</>}
                    </CardDescription>
                </div>
                <Button asChild><Link href={newHref}><Plus className="mr-2 h-4 w-4" />Nouveau devis</Link></Button>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                    <Input className="max-w-xs" placeholder="Numéro, objet, client, ville…" value={search} onChange={e => setSearch(e.target.value)} />
                    <Select value={status} onValueChange={v => setStatus(v as QuoteStatus | 'all')}>
                        <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Tous les statuts</SelectItem>
                            {QUOTE_STATUSES.map(s => <SelectItem key={s} value={s}>{QUOTE_STATUS_LABELS[s]}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Numéro</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Client</TableHead>
                            <TableHead>Lieu</TableHead>
                            <TableHead>Objet</TableHead>
                            <TableHead>Statut</TableHead>
                            <TableHead className="text-right">Total HT</TableHead>
                            <TableHead className="text-right">Marge</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow><TableCell colSpan={8} className="h-24 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></TableCell></TableRow>
                        ) : visible.length === 0 ? (
                            <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">Aucun devis.</TableCell></TableRow>
                        ) : visible.map(q => (
                            <TableRow key={q.id}>
                                <TableCell className="font-mono text-xs"><Link className="hover:underline" href={`/quotes/${q.id}`}>{q.number}</Link>{q.version > 1 && ` V${q.version}`}</TableCell>
                                <TableCell>{new Date(q.date).toLocaleDateString('fr-FR')}</TableCell>
                                <TableCell>
                                    {q.clientName}
                                    {q.prospect && <Badge variant="outline" className="ml-2">Prospect</Badge>}
                                </TableCell>
                                <TableCell className="text-sm">{q.siteName || [q.interventionAddress?.postalCode, q.interventionAddress?.city].filter(Boolean).join(' ') || '—'}</TableCell>
                                <TableCell>{q.title}</TableCell>
                                <TableCell><StatusBadge status={q.status} /></TableCell>
                                <TableCell className="text-right">{formatEur(q.totals.totalHT)}</TableCell>
                                <TableCell className="text-right">{formatPct(q.totals.marginRate)}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
