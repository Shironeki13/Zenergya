'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { alertesCompteursAction } from '@/lib/pilotage/actions';
import { SEUILS, type Alerte, type Gravite, type TypeAlerte } from '@/lib/pilotage/alertes-compteurs';

/** Alertes des compteurs : index en baisse, relevé ECS manquant, dérive, relevés contradictoires, sans relevé… */

const TYPES: Record<TypeAlerte, string> = {
    index_baisse: 'Index en baisse', releve_ecs_manquant: 'Relevé ECS manquant', derive: 'Dérive de consommation',
    doublon: 'Relevés contradictoires', sans_releve: 'Sans relevé', estime: 'Relevé estimé', conso_nulle: 'Consommation nulle',
};
const GRAVITES: Record<Gravite, { label: string; className: string }> = {
    critique: { label: 'Critique', className: 'bg-red-600 text-white hover:bg-red-600' },
    attention: { label: 'Attention', className: 'bg-amber-500 text-white hover:bg-amber-500' },
    info: { label: 'Info', className: 'bg-slate-200 text-slate-700 hover:bg-slate-200' },
};
const fr = (d: string) => d.split('-').reverse().join('/');

export default function AlertesCompteursPage() {
    const { toast } = useToast();
    const [alertes, setAlertes] = useState<Alerte[] | null>(null);
    const [compteurs, setCompteurs] = useState(0);
    const [loading, setLoading] = useState(false);
    const [gravite, setGravite] = useState<'toutes' | Gravite>('toutes');
    const [type, setType] = useState<'tous' | TypeAlerte>('tous');
    const [q, setQ] = useState('');

    const load = async () => {
        setLoading(true);
        const r = await alertesCompteursAction();
        setLoading(false);
        if (r.success) { setAlertes(r.data.alertes); setCompteurs(r.data.compteurs); }
        else toast({ title: 'Alertes indisponibles', description: r.error, variant: 'destructive' });
    };
    useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const rows = useMemo(() => {
        const t = q.trim().toLowerCase();
        return (alertes ?? []).filter(a => (gravite === 'toutes' || a.gravite === gravite) && (type === 'tous' || a.type === type)
            && (!t || [a.code, a.site, a.client, a.message].some(x => x.toLowerCase().includes(t))));
    }, [alertes, gravite, type, q]);
    const count = (g: Gravite) => (alertes ?? []).filter(a => a.gravite === g).length;

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-lg font-medium">Alertes compteurs</h1>
                    <p className="text-sm text-muted-foreground">
                        Calculées sur les relevés de {compteurs} compteur(s). Dérive : consommation journalière du dernier intervalle hors de ×{String(SEUILS.facteurBas).replace('.', ',')} à ×{SEUILS.facteurHaut}
                        {' '}par rapport à la même période l&apos;an passé (sinon à la médiane des intervalles précédents) ; sans relevé : plus de {SEUILS.sansReleveJours} jours.
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1">
                    {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}Recalculer
                </Button>
            </div>

            <div className="grid grid-cols-3 gap-4">
                {(['critique', 'attention', 'info'] as Gravite[]).map(g => (
                    <Card key={g} className="cursor-pointer" onClick={() => setGravite(gravite === g ? 'toutes' : g)}>
                        <CardHeader className="pb-1 pt-4 px-4"><CardDescription>{GRAVITES[g].label}</CardDescription></CardHeader>
                        <CardContent className="px-4 pb-4"><CardTitle className="text-2xl">{alertes ? count(g) : '…'}</CardTitle></CardContent>
                    </Card>
                ))}
            </div>

            <Card>
                <CardContent className="space-y-3 pt-4">
                    <div className="flex flex-wrap gap-2">
                        <Select value={gravite} onValueChange={v => setGravite(v as typeof gravite)}>
                            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="toutes">Toutes gravités</SelectItem>
                                {(Object.keys(GRAVITES) as Gravite[]).map(g => <SelectItem key={g} value={g}>{GRAVITES[g].label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Select value={type} onValueChange={v => setType(v as typeof type)}>
                            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="tous">Tous les types</SelectItem>
                                {(Object.keys(TYPES) as TypeAlerte[]).map(t => <SelectItem key={t} value={t}>{TYPES[t]}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Compteur, site, client…" className="w-64" />
                    </div>
                    <div className="border rounded-md">
                        <Table>
                            <TableHeader><TableRow>
                                <TableHead>Gravité</TableHead><TableHead>Type</TableHead><TableHead>Compteur</TableHead><TableHead>Site</TableHead>
                                <TableHead>Client</TableHead><TableHead>Constat</TableHead><TableHead>Date</TableHead>
                            </TableRow></TableHeader>
                            <TableBody>
                                {rows.length === 0 ? (
                                    <TableRow><TableCell colSpan={7} className="h-16 text-center text-muted-foreground">{loading ? 'Calcul en cours…' : 'Aucune alerte.'}</TableCell></TableRow>
                                ) : rows.map((a, i) => (
                                    <TableRow key={`${a.meterId}-${a.type}-${a.date}-${i}`}>
                                        <TableCell><Badge className={GRAVITES[a.gravite].className}>{GRAVITES[a.gravite].label}</Badge></TableCell>
                                        <TableCell className="text-sm">{TYPES[a.type]}</TableCell>
                                        <TableCell className="font-mono text-xs">{a.code}</TableCell>
                                        <TableCell className="text-sm">{a.siteId ? <Link className="underline" href={`/sites/${a.siteId}`}>{a.site}</Link> : a.site}</TableCell>
                                        <TableCell className="text-sm">{a.client}</TableCell>
                                        <TableCell className="text-sm">{a.message}</TableCell>
                                        <TableCell className="text-sm whitespace-nowrap">{fr(a.date)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
