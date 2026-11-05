'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { EcheanceSuivi } from '@/lib/pilotage/suivi-facturation';
import type { SuiviFacturation } from '@/services/pilotage-admin';

/**
 * Échéances à facturer de tous les contrats actifs : en retard, du jour, à venir (horizon), avec leur montant et ce
 * qui bloque leur facture. Calculées au serveur, avec le même échéancier que la facture.
 */

type Filtre = 'tous' | 'retard' | 'a_venir' | 'bloque';
const fr = (d: string) => d.split('-').reverse().join('/');
const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

function Statut({ e }: { e: EcheanceSuivi }) {
    if (e.statut === 'aujourdhui') return <Badge variant="outline" className="border-orange-500 text-orange-600">Aujourd&apos;hui</Badge>;
    if (e.statut === 'retard') return <Badge variant={e.jours > 30 ? 'destructive' : 'outline'} className={e.jours > 30 ? '' : 'border-red-400 text-red-600'}>Retard {e.jours} j</Badge>;
    return <Badge variant="secondary">Dans {e.jours} j</Badge>;
}

export function AFacturer({ data, loading, horizon, onHorizon }: { data: SuiviFacturation | null; loading: boolean; horizon: number; onHorizon: (h: number) => void }) {
    const [filtre, setFiltre] = useState<Filtre>('tous');
    const [q, setQ] = useState('');
    const rows = useMemo(() => {
        const t = q.trim().toLowerCase();
        return (data?.echeances ?? []).filter(e => {
            if (filtre === 'retard' && e.statut === 'a_venir') return false;
            if (filtre === 'a_venir' && e.statut !== 'a_venir') return false;
            if (filtre === 'bloque' && !e.blocage) return false;
            return !t || [e.clientName, e.contractNumber, e.site, e.prestation].some(x => x.toLowerCase().includes(t));
        });
    }, [data, filtre, q]);

    return (
        <Card>
            <CardHeader className="pb-3 flex-row items-start justify-between space-y-0 gap-4">
                <div>
                    <CardTitle className="text-base">Échéances à facturer</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                        Du dernier facturé jusqu&apos;à {horizon} jours, selon la périodicité et le terme de chaque prestation. Montants « ~ » : estimés
                        (avant révision ; acomptes P1 et ECS au relevé calculés à la facture).
                    </p>
                </div>
                <Link href="/billing/batch"><Button size="sm" variant="outline" className="gap-1 shrink-0">Facturation groupée<ExternalLink className="h-3 w-3" /></Button></Link>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                    <Select value={filtre} onValueChange={v => setFiltre(v as Filtre)}>
                        <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="tous">Toutes</SelectItem>
                            <SelectItem value="retard">En retard et du jour</SelectItem>
                            <SelectItem value="a_venir">À venir</SelectItem>
                            <SelectItem value="bloque">Bloquées</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select value={String(horizon)} onValueChange={v => onHorizon(Number(v))}>
                        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>{[30, 60, 90].map(h => <SelectItem key={h} value={String(h)}>Horizon {h} j</SelectItem>)}</SelectContent>
                    </Select>
                    <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Client, contrat, site…" className="w-64" />
                    {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </div>
                {data && data.contratsEnErreur.length > 0 && (
                    <div className="rounded-md border border-destructive p-3 text-sm">
                        <p className="font-medium text-destructive">Contrats dont l&apos;échéancier ne se calcule pas</p>
                        {data.contratsEnErreur.map(c => (
                            <p key={c.contractId}><Link className="underline" href={`/contracts/${c.contractId}`}>{c.contractNumber}</Link> — {c.clientName} : {c.erreurs.join(' ')}</p>
                        ))}
                    </div>
                )}
                <div className="border rounded-md">
                    <Table>
                        <TableHeader><TableRow>
                            <TableHead>Statut</TableHead><TableHead>Client</TableHead><TableHead>Contrat</TableHead><TableHead>Site</TableHead>
                            <TableHead>Prestation</TableHead><TableHead>Période</TableHead><TableHead>Facturable le</TableHead><TableHead className="text-right">Montant HT</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                            {rows.length === 0 ? (
                                <TableRow><TableCell colSpan={8} className="text-center h-16 text-muted-foreground">{loading ? 'Calcul en cours…' : 'Aucune échéance.'}</TableCell></TableRow>
                            ) : rows.map(e => (
                                <TableRow key={`${e.contractId}-${e.site}-${e.prestation}-${e.start}`}>
                                    <TableCell><Statut e={e} /></TableCell>
                                    <TableCell className="font-medium">{e.clientName}</TableCell>
                                    <TableCell><Link className="font-mono text-xs underline" href={`/contracts/${e.contractId}`}>{e.contractNumber}</Link></TableCell>
                                    <TableCell className="text-sm">{e.site}</TableCell>
                                    <TableCell className="text-sm">{e.prestation}{e.blocage && <span className="block text-xs text-destructive">{e.blocage}</span>}</TableCell>
                                    <TableCell className="text-sm whitespace-nowrap">{fr(e.start)} → {fr(e.end)}</TableCell>
                                    <TableCell className="text-sm">{fr(e.billableOn)}</TableCell>
                                    <TableCell className="text-right whitespace-nowrap">
                                        {e.montant === null ? <span className="text-muted-foreground text-xs">à la facture</span> : <span className={e.estime ? 'text-muted-foreground' : 'font-medium'}>{e.estime ? '~' : ''}{eur(e.montant)}</span>}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}
