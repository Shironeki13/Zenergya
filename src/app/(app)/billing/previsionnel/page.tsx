'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { croiser } from '@/lib/billing/previsionnel';
import { previsionnelFacturationAction } from '@/lib/pilotage/actions';
import type { Previsionnel } from '@/services/previsionnel-admin';

/**
 * Prévisionnel de facturation : ce qui deviendra facturable mois par mois sur 12 mois, par agence ou par activité,
 * d'après les échéanciers des contrats actifs. Les révisions à venir ne sont pas anticipées.
 */

const eur0 = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const moisFr = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
const TOUTES = '__toutes__';
type Axe = 'agence' | 'activite';

export default function PrevisionnelPage() {
    const [p, setP] = useState<Previsionnel | null>(null);
    const [erreur, setErreur] = useState<string | null>(null);
    const [calcul, setCalcul] = useState(false);
    const [axe, setAxe] = useState<Axe>('agence');
    const [agence, setAgence] = useState(TOUTES);

    const charger = useCallback(async () => {
        setCalcul(true); setErreur(null);
        const r = await previsionnelFacturationAction(12);
        setCalcul(false);
        if (r.success) setP(r.data); else setErreur(r.error);
    }, []);
    useEffect(() => { void charger(); }, [charger]);

    const agences = useMemo(() => [...new Set((p?.lignes ?? []).map(l => l.agence))].sort((a, b) => a.localeCompare(b, 'fr')), [p]);
    const lignes = useMemo(() => (p?.lignes ?? []).filter(l => agence === TOUTES || l.agence === agence), [p, agence]);
    const tableau = useMemo(() => (p ? croiser(lignes, axe, p.mois) : null), [p, lignes, axe]);
    const max = Math.max(1, ...(tableau?.totaux ?? []));
    const estimeParMois = useMemo(() => (p ? p.mois.map(m => lignes.filter(l => l.mois === m).reduce((a, l) => a + l.estime, 0)) : []), [p, lignes]);

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Prévisionnel de facturation</h1>
                    <p className="text-sm text-muted-foreground">Ce qui deviendra facturable sur les 12 prochains mois, d'après les échéanciers des contrats actifs (montants HT).</p>
                </div>
                <Button variant="outline" size="sm" disabled={calcul} onClick={charger}><RefreshCw className={`mr-2 h-4 w-4 ${calcul ? 'animate-spin' : ''}`} />Actualiser</Button>
            </div>

            {erreur && <p className="text-sm text-destructive">{erreur}</p>}
            {!p && !erreur && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Calcul des échéanciers…</div>}

            {p && tableau && (
                <>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <Tuile titre="À facturer sur 12 mois" valeur={eur0(tableau.total)} detail={`${p.contrats} contrat${p.contrats > 1 ? 's' : ''} actif${p.contrats > 1 ? 's' : ''}`} />
                        <Tuile titre={`Ce mois-ci (${moisFr(p.mois[0])})`} valeur={eur0(tableau.totaux[0])} detail="devient facturable ce mois" />
                        <Tuile titre="Déjà facturable, non facturé" valeur={eur0(tableau.retard)} detail="en retard, hors des 12 mois" alerte={tableau.retard > 0} lien={{ href: '/billing', libelle: 'Facturer' }} />
                        <Tuile titre="Dont P1 estimé" valeur={eur0(tableau.estime)} detail={p.nonEstimees ? `${p.nonEstimees} échéance(s) P1 non chiffrée(s)` : 'acomptes, compteur, DJU'} />
                    </div>

                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Mois par mois</CardTitle>
                            <CardDescription>Chaque échéance est comptée le mois où elle devient facturable. La partie claire est le P1 estimé.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-6 gap-2 lg:grid-cols-12" role="img" aria-label="Montant facturable par mois">
                                {p.mois.map((m, i) => (
                                    <div key={m} className="flex flex-col items-center gap-1" title={`${moisFr(m)} : ${eur0(tableau.totaux[i])}`}>
                                        <div className="flex h-32 w-full items-end rounded bg-muted/30">
                                            <div className="flex w-full flex-col justify-end overflow-hidden rounded" style={{ height: `${(tableau.totaux[i] / max) * 100}%` }}>
                                                <div className="bg-emerald-300" style={{ height: `${tableau.totaux[i] ? (estimeParMois[i] / tableau.totaux[i]) * 100 : 0}%` }} />
                                                <div className="flex-1 bg-emerald-600" />
                                            </div>
                                        </div>
                                        <span className="text-[11px] tabular-nums text-muted-foreground">{tableau.totaux[i] ? eur0(tableau.totaux[i]) : '—'}</span>
                                        <span className="text-xs capitalize">{moisFr(m)}</span>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
                            <CardTitle className="text-base">Détail par {axe === 'agence' ? 'agence' : 'activité'}</CardTitle>
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="flex gap-1" role="group" aria-label="Axe du détail">
                                    {(['agence', 'activite'] as Axe[]).map(a => <Button key={a} size="sm" variant={axe === a ? 'default' : 'outline'} aria-pressed={axe === a} onClick={() => setAxe(a)}>{a === 'agence' ? 'Par agence' : 'Par activité'}</Button>)}
                                </div>
                                <Select value={agence} onValueChange={setAgence}>
                                    <SelectTrigger className="h-9 w-52" aria-label="Agence"><SelectValue /></SelectTrigger>
                                    <SelectContent><SelectItem value={TOUTES}>Toutes les agences</SelectItem>{agences.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                        </CardHeader>
                        <CardContent className="overflow-x-auto">
                            {tableau.lignes.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Aucune échéance à venir sur ce périmètre.</p> : (
                                <table className="w-full min-w-[900px] text-sm tabular-nums" data-tableau="previsionnel">
                                    <thead>
                                        <tr className="border-b text-xs text-muted-foreground">
                                            <th className="py-2 pr-3 text-left font-medium">{axe === 'agence' ? 'Agence' : 'Activité'}</th>
                                            <th className="px-2 text-right font-medium">En retard</th>
                                            {p.mois.map(m => <th key={m} className="px-2 text-right font-medium capitalize">{moisFr(m)}</th>)}
                                            <th className="pl-3 text-right font-medium">12 mois</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {tableau.lignes.map(r => (
                                            <tr key={r.cle} className="border-b last:border-0">
                                                <td className="py-2 pr-3 font-medium">{r.cle}</td>
                                                <td className={`px-2 text-right ${r.retard ? 'text-amber-700' : 'text-muted-foreground'}`}>{r.retard ? eur0(r.retard) : '—'}</td>
                                                {r.parMois.map((v, i) => <td key={i} className={`px-2 text-right ${v ? '' : 'text-muted-foreground'}`}>{v ? eur0(v) : '—'}</td>)}
                                                <td className="pl-3 text-right font-semibold">{eur0(r.total)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr className="border-t font-semibold">
                                            <td className="py-2 pr-3">Total</td>
                                            <td className="px-2 text-right">{tableau.retard ? eur0(tableau.retard) : '—'}</td>
                                            {tableau.totaux.map((v, i) => <td key={i} className="px-2 text-right">{v ? eur0(v) : '—'}</td>)}
                                            <td className="pl-3 text-right">{eur0(tableau.total)}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            )}
                        </CardContent>
                    </Card>

                    <p className="text-xs text-muted-foreground">
                        Forfaits : montant de l'échéance au dernier coefficient de révision facturé ; les révisions à venir ne sont pas anticipées. P1 au compteur, au DJU ou en acompte : estimé d'après le montant annuel de la prestation. Un contrat qui se termine cesse d'être compté à sa date de fin.
                    </p>

                    {p.contratsEnErreur.length > 0 && (
                        <Card className="border-amber-300">
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-600" />{p.contratsEnErreur.length} contrat{p.contratsEnErreur.length > 1 ? 's' : ''} non compté{p.contratsEnErreur.length > 1 ? 's' : ''}</CardTitle>
                                <CardDescription>Leur paramétrage ne permet pas de calculer l'échéancier.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ul className="space-y-1 text-sm">
                                    {p.contratsEnErreur.map(c => <li key={c.contractId}><Link href={`/contracts/${c.contractId}`} className="font-mono text-xs underline">{c.contractNumber}</Link> {c.clientName} — <span className="text-muted-foreground">{c.erreur}</span></li>)}
                                </ul>
                            </CardContent>
                        </Card>
                    )}
                </>
            )}
        </div>
    );
}

function Tuile({ titre, valeur, detail, alerte, lien }: { titre: string; valeur: string; detail: string; alerte?: boolean; lien?: { href: string; libelle: string } }) {
    return (
        <Card className={alerte ? 'border-amber-300' : ''}>
            <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{titre}</p>
                <p className={`text-2xl font-bold tabular-nums ${alerte ? 'text-amber-700' : ''}`}>{valeur}</p>
                <p className="text-xs text-muted-foreground">{detail}{lien && alerte ? <> · <Link href={lien.href} className="text-primary underline">{lien.libelle}</Link></> : null}</p>
            </CardContent>
        </Card>
    );
}
