'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Download, Loader2, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TuilesBudget } from '@/components/budgets/budget-contrat';
import { TableauGroupesBudget, csvGroupes } from '@/components/budgets/groupes-budget';
import { cumuler, parAxe, type AxeBudget } from '@/lib/budgets/budget';
import { pilotageBudgetsAction } from '@/lib/budgets/actions';
import type { PilotageBudgets } from '@/services/budgets-admin';

/** Pilotage des budgets : contrats budgétés de l'année, regroupés par contrat, client, agence ou activité. */
export default function BudgetsPage() {
    const [annee, setAnnee] = useState(new Date().getFullYear());
    const [data, setData] = useState<PilotageBudgets | null>(null);
    const [erreur, setErreur] = useState('');
    const [chargement, setChargement] = useState(true);
    const [axe, setAxe] = useState<AxeBudget>('contrat');
    const [agence, setAgence] = useState('toutes');
    const [recherche, setRecherche] = useState('');
    const [derives, setDerives] = useState(false);
    const [voirSans, setVoirSans] = useState(false);

    const charger = useCallback(async (forcer = false) => {
        setChargement(true);
        const r = await pilotageBudgetsAction(annee, forcer);
        setChargement(false);
        if (r.success) { setData(r.data); setErreur(''); } else setErreur(r.error);
    }, [annee]);
    useEffect(() => { void charger(); }, [charger]);

    const agences = useMemo(() => [...new Set((data?.contrats ?? []).map(c => c.agence))].sort((a, b) => a.localeCompare(b, 'fr')), [data]);
    const contrats = useMemo(() => {
        const q = recherche.trim().toLowerCase();
        return (data?.contrats ?? []).filter(c => (agence === 'toutes' || c.agence === agence) && (!q || [c.numero, c.libelle, c.client].some(v => v.toLowerCase().includes(q))));
    }, [data, agence, recherche]);
    const groupes = useMemo(() => parAxe(contrats, axe).filter(g => !derives || g.total.ecartMarge < 0 || g.alertes > 0), [contrats, axe, derives]);
    const total = useMemo(() => cumuler(contrats.map(c => c.total), 'Total'), [contrats]);
    const exporter = () => {
        const url = URL.createObjectURL(new Blob(['﻿' + csvGroupes(groupes, axe, annee)], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a'); a.href = url; a.download = `budgets-${annee}-${axe}.csv`; a.click(); URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Budgets</h1>
                    <p className="text-sm text-muted-foreground">Budget, réalisé et atterrissage de l&apos;année des contrats budgétés : ventes, dépenses et marge, les plus fortes dérives en tête.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center rounded-md border">
                        <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Année précédente" onClick={() => setAnnee(a => a - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                        <span className="px-2 text-sm font-medium tabular-nums">{annee}</span>
                        <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Année suivante" onClick={() => setAnnee(a => a + 1)}><ChevronRight className="h-4 w-4" /></Button>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => charger(true)} disabled={chargement}><RefreshCw className="mr-2 h-4 w-4" />Actualiser</Button>
                    <Button variant="outline" size="sm" onClick={exporter} disabled={!groupes.length}><Download className="mr-2 h-4 w-4" />Exporter</Button>
                </div>
            </div>

            {erreur && <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{erreur}</p>}
            {chargement && !data ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Calcul du réalisé des contrats…</p> : data && (
                <>
                    <TuilesBudget total={total} aBudget={contrats.length > 0} />
                    <div className="flex flex-wrap items-center gap-3">
                        <Tabs value={axe} onValueChange={v => setAxe(v as AxeBudget)}>
                            <TabsList>
                                <TabsTrigger value="contrat">Par contrat</TabsTrigger>
                                <TabsTrigger value="client">Par client</TabsTrigger>
                                <TabsTrigger value="agence">Par agence</TabsTrigger>
                                <TabsTrigger value="activite">Par activité</TabsTrigger>
                            </TabsList>
                        </Tabs>
                        <Select value={agence} onValueChange={setAgence}>
                            <SelectTrigger className="h-9 w-48" aria-label="Agence"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="toutes">Toutes les agences</SelectItem>{agences.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                        </Select>
                        <div className="relative w-64">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input className="h-9 pl-8" placeholder="Client, contrat…" value={recherche} onChange={e => setRecherche(e.target.value)} />
                        </div>
                        <label className="flex items-center gap-2 text-sm"><Switch checked={derives} onCheckedChange={setDerives} aria-label="Seulement les dérives" />Seulement les dérives</label>
                    </div>
                    <TableauGroupesBudget groupes={groupes} axe={axe} />
                    <p className="text-xs text-muted-foreground">Atterrissage : CA réalisé + reste à facturer de l&apos;année ; dépenses : le plus grand du budget et du réalisé. Écart de marge : atterrissage − budget révisé. Le détail par nature est dans l&apos;onglet Budget de chaque contrat.</p>

                    <Card>
                        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                            <div>
                                <CardTitle className="text-base">Contrats actifs sans budget {annee} ({data.sansBudget.length})</CardTitle>
                                <CardDescription>Ils ne figurent pas dans le tableau ci-dessus.</CardDescription>
                            </div>
                            {data.sansBudget.length > 0 && <Button variant="ghost" size="sm" onClick={() => setVoirSans(v => !v)}>{voirSans ? 'Masquer' : 'Afficher'}</Button>}
                        </CardHeader>
                        {voirSans && (
                            <CardContent className="flex flex-wrap gap-2" data-budget="sans">
                                {data.sansBudget.map(c => (
                                    <Button key={c.contractId} asChild size="sm" variant="outline" className="h-auto py-1">
                                        <Link href={`/contracts/${c.contractId}?onglet=budget`}><span className="font-mono text-xs">{c.numero}</span><span className="ml-1.5 text-xs text-muted-foreground">{c.client}</span></Link>
                                    </Button>
                                ))}
                            </CardContent>
                        )}
                    </Card>
                </>
            )}
        </div>
    );
}
