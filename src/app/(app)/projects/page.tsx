'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { formatEur } from '@/components/quotes/format';
import { PROJECT_STATUS_LABELS, type Project } from '@/lib/projects/types';
import { getProjects } from '@/services/projects';

export default function ProjectsPage() {
    const { toast } = useToast();
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');

    useEffect(() => {
        getProjects()
            .then(setProjects)
            .catch(() => toast({ title: 'Erreur', description: 'Impossible de charger les affaires.', variant: 'destructive' }))
            .finally(() => setLoading(false));
    }, [toast]);

    const visible = useMemo(() => {
        const s = search.trim().toLowerCase();
        return projects
            .filter(p => !s || [p.code, p.title, p.clientName, p.siteName, p.quoteNumber].some(v => (v ?? '').toLowerCase().includes(s)))
            .sort((a, b) => b.code.localeCompare(a.code));
    }, [projects, search]);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Affaires de travaux</CardTitle>
                <CardDescription>Une affaire par devis accepté (P5 : facturation directe ; P6 : par situations) ; les devis complémentaires s&apos;y rattachent. Budget, analytique et rentabilité se suivent par affaire.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <Input className="max-w-xs" placeholder="Code, objet, client, devis…" value={search} onChange={e => setSearch(e.target.value)} />
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Affaire</TableHead>
                            <TableHead>Client</TableHead>
                            <TableHead>Objet</TableHead>
                            <TableHead>Devis</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Statut</TableHead>
                            <TableHead className="text-right">Vente HT</TableHead>
                            <TableHead className="text-right">Marge prévue</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow><TableCell colSpan={8} className="h-24 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></TableCell></TableRow>
                        ) : visible.length === 0 ? (
                            <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">Aucune affaire.</TableCell></TableRow>
                        ) : visible.map(p => (
                            <TableRow key={p.id}>
                                <TableCell className="font-mono text-xs"><Link className="hover:underline" href={`/projects/${p.id}`}>{p.code}</Link></TableCell>
                                <TableCell>{p.clientName}</TableCell>
                                <TableCell>{p.title}</TableCell>
                                <TableCell className="font-mono text-xs"><Link className="hover:underline" href={`/quotes/${p.quoteId}`}>{p.quoteNumber}</Link></TableCell>
                                <TableCell className="whitespace-nowrap text-xs">{p.mode ?? 'P6'} · {(p.billing ?? 'situations') === 'situations' ? 'situations' : 'directe'}{(p.quotes?.length ?? 1) > 1 ? ` · ${p.quotes!.length} devis` : ''}</TableCell>
                                <TableCell><Badge variant={p.status === 'en_cours' ? 'secondary' : 'outline'}>{PROJECT_STATUS_LABELS[p.status]}</Badge></TableCell>
                                <TableCell className="text-right">{formatEur(p.totalHT)}</TableCell>
                                <TableCell className="text-right">{p.budget ? `${formatEur(p.budget.marge)}${p.budget.tauxMarge != null ? ` (${(p.budget.tauxMarge * 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} %)` : ''}` : '—'}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
