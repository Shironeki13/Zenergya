'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Loader2, Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { simulationRevisionAction } from '@/lib/pilotage/actions';
import type { SimulationRevision } from '@/services/simulation-revision-admin';

/**
 * Simulation de révision : effet d'une variation des indices sur les forfaits révisables, sur 12 mois, par rapport à
 * des indices qui resteraient à leur dernière valeur connue.
 */

const eur0 = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const signe = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${eur0(Math.abs(n)).replace('-', '')}`;
const pct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
const coef = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const jourFr = (d: string) => d.split('-').reverse().join('/');
const moisFr = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
const nombre = (t: string) => { const n = Number(t.replace(',', '.').replace(/\s/g, '')); return Number.isFinite(n) ? n : 0; };

export default function SimulationRevisionPage() {
    const [s, setS] = useState<SimulationRevision | null>(null);
    const [erreur, setErreur] = useState<string | null>(null);
    const [calcul, setCalcul] = useState(false);
    const [saisie, setSaisie] = useState<Record<string, string>>({});
    const [tous, setTous] = useState('');

    const simuler = useCallback(async (h: Record<string, number>) => {
        setCalcul(true); setErreur(null);
        const r = await simulationRevisionAction(h);
        setCalcul(false);
        if (r.success) setS(r.data); else setErreur(r.error);
    }, []);
    useEffect(() => { void simuler({}); }, [simuler]);

    const hypotheses = useMemo(() => Object.fromEntries(Object.entries(saisie).map(([k, v]) => [k, nombre(v)]).filter(([, v]) => v !== 0)) as Record<string, number>, [saisie]);
    const canon = (h: Record<string, number>) => JSON.stringify(Object.entries(h).sort(([a], [b]) => a.localeCompare(b)));
    const aJour = s ? canon(s.hypotheses) === canon(hypotheses) : false;

    const total = useMemo(() => {
        const l = (s?.lignes ?? []).filter(x => x.mois !== 'retard');
        const base = l.reduce((a, x) => a + x.base, 0), simule = l.reduce((a, x) => a + x.simule, 0);
        return { base, simule, ecart: simule - base, pct: base ? (simule / base - 1) * 100 : 0 };
    }, [s]);
    const parActivite = useMemo(() => {
        const m = new Map<string, { base: number; simule: number }>();
        for (const l of s?.lignes ?? []) { if (l.mois === 'retard') continue; const c = m.get(l.activite) ?? { base: 0, simule: 0 }; c.base += l.base; c.simule += l.simule; m.set(l.activite, c); }
        return [...m].map(([activite, c]) => ({ activite, ...c })).sort((a, b) => b.base - a.base);
    }, [s]);
    const parMois = useMemo(() => (s ? s.mois.map(m => { const l = s.lignes.filter(x => x.mois === m); return { m, base: l.reduce((a, x) => a + x.base, 0), simule: l.reduce((a, x) => a + x.simule, 0) }; }) : []), [s]);
    const max = Math.max(1, ...parMois.map(x => Math.max(x.base, x.simule)));
    const simulee = s ? Object.keys(s.hypotheses).length > 0 : false;

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Simulation de révision</h1>
                <p className="text-sm text-muted-foreground">Ce que rapporteront les forfaits révisables sur 12 mois si les indices varient, comparé à des indices qui resteraient à leur dernière valeur (montants HT). Rien n'est enregistré.</p>
            </div>

            {erreur && <p className="text-sm text-destructive">{erreur}</p>}
            {!s && !erreur && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Lecture des contrats et des indices…</div>}

            {s && (
                <>
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">1. Hypothèse sur les indices</CardTitle>
                            <CardDescription>Variation appliquée à la dernière valeur publiée de chaque indice, pour les mois non encore publiés. Les valeurs déjà publiées ne changent pas.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {s.indices.length === 0 ? <p className="text-sm text-muted-foreground">Aucune prestation révisable sur les contrats actifs de votre périmètre.</p> : (
                                <>
                                    <div className="divide-y rounded-md border" data-liste="indices">
                                        {s.indices.map(i => (
                                            <div key={i.id} className="flex flex-wrap items-center gap-3 p-3">
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm font-medium">{i.code}{i.libelle ? <span className="font-normal text-muted-foreground"> — {i.libelle}</span> : null}</p>
                                                    <p className="text-xs text-muted-foreground">Dernière valeur : {i.valeur.toLocaleString('fr-FR', { maximumFractionDigits: 4 })} ({i.periode ? moisFr(i.periode) : 'aucune'}) · {i.contrats} contrat{i.contrats > 1 ? 's' : ''}</p>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <Input aria-label={`Variation de ${i.code} en %`} inputMode="decimal" placeholder="0" value={saisie[i.id] ?? ''} onChange={e => setSaisie(x => ({ ...x, [i.id]: e.target.value }))} className="h-9 w-24 text-right tabular-nums" />
                                                    <span className="text-sm text-muted-foreground">%</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="flex flex-wrap items-end justify-between gap-3">
                                        <div className="flex items-end gap-2">
                                            <div className="space-y-1">
                                                <Label htmlFor="tous" className="text-xs text-muted-foreground">Même variation pour tous</Label>
                                                <Input id="tous" inputMode="decimal" placeholder="ex. 3" value={tous} onChange={e => setTous(e.target.value)} className="h-9 w-24 text-right" />
                                            </div>
                                            <Button variant="outline" size="sm" className="h-9" onClick={() => setSaisie(Object.fromEntries(s.indices.map(i => [i.id, tous])))}>Appliquer</Button>
                                            <Button variant="ghost" size="sm" className="h-9" onClick={() => { setSaisie({}); setTous(''); void simuler({}); }}><RotateCcw className="mr-2 h-4 w-4" />Remettre à zéro</Button>
                                        </div>
                                        <Button disabled={calcul || aJour} onClick={() => simuler(hypotheses)}>{calcul ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}Simuler</Button>
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>

                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-bloc="resultat">
                        <Tuile titre="Forfaits révisables, indices constants" valeur={eur0(total.base)} detail="sur 12 mois" />
                        <Tuile titre="Avec votre hypothèse" valeur={simulee ? eur0(total.simule) : '—'} detail={simulee ? 'sur 12 mois' : 'saisissez une variation puis « Simuler »'} />
                        <Tuile titre="Écart" valeur={simulee ? signe(total.ecart) : '—'} detail={simulee ? pct(total.pct) : ''} ton={total.ecart > 0 ? 'text-emerald-700' : total.ecart < 0 ? 'text-red-700' : ''} />
                        <Tuile titre="Révisions à venir" valeur={String(s.revisions.length)} detail={s.revisions.length ? `la prochaine le ${jourFr(s.revisions[0].date)}` : 'aucune sur 12 mois'} />
                    </div>

                    {parActivite.length > 0 && (
                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base">2. Effet mois par mois</CardTitle>
                                <CardDescription>Barre foncée : indices constants. Barre claire : votre hypothèse. L'effet n'apparaît qu'à partir de la date de révision de chaque prestation.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-6 gap-2 lg:grid-cols-12" role="img" aria-label="Montant révisable par mois, indices constants et hypothèse">
                                    {parMois.map(x => (
                                        <div key={x.m} className="flex flex-col items-center gap-1" title={`${moisFr(x.m)} : ${eur0(x.base)} → ${eur0(x.simule)}`}>
                                            <div className="flex h-28 w-full items-end gap-0.5 rounded bg-muted/30 px-0.5">
                                                <div className="flex-1 rounded-t bg-slate-600" style={{ height: `${(x.base / max) * 100}%` }} />
                                                <div className={`flex-1 rounded-t ${x.simule >= x.base ? 'bg-emerald-400' : 'bg-red-400'}`} style={{ height: `${(x.simule / max) * 100}%` }} />
                                            </div>
                                            <span className={`text-[11px] tabular-nums ${x.simule !== x.base ? (x.simule > x.base ? 'text-emerald-700' : 'text-red-700') : 'text-muted-foreground'}`}>{x.simule !== x.base ? signe(x.simule - x.base) : '—'}</span>
                                            <span className="text-xs capitalize">{moisFr(x.m)}</span>
                                        </div>
                                    ))}
                                </div>
                                <table className="w-full max-w-xl text-sm tabular-nums" data-tableau="activites">
                                    <thead><tr className="border-b text-xs text-muted-foreground"><th className="py-2 text-left font-medium">Activité</th><th className="px-2 text-right font-medium">Indices constants</th><th className="px-2 text-right font-medium">Hypothèse</th><th className="pl-2 text-right font-medium">Écart</th></tr></thead>
                                    <tbody>{parActivite.map(a => (
                                        <tr key={a.activite} className="border-b last:border-0"><td className="py-2 font-medium">{a.activite}</td><td className="px-2 text-right">{eur0(a.base)}</td><td className="px-2 text-right">{eur0(a.simule)}</td><td className={`pl-2 text-right ${a.simule > a.base ? 'text-emerald-700' : a.simule < a.base ? 'text-red-700' : 'text-muted-foreground'}`}>{a.simule !== a.base ? signe(a.simule - a.base) : '—'}</td></tr>
                                    ))}</tbody>
                                </table>
                            </CardContent>
                        </Card>
                    )}

                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">3. Révisions à venir ({s.revisions.length})</CardTitle>
                            <CardDescription>Par date. Le coefficient « constant » est celui qui s'appliquerait si les indices ne bougeaient plus ; l'effet annuel est l'écart entre les deux coefficients sur le montant de base.</CardDescription>
                        </CardHeader>
                        <CardContent className="overflow-x-auto">
                            {s.revisions.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">Aucune révision à venir sur les 12 prochains mois.</p> : (
                                <table className="w-full min-w-[820px] text-sm tabular-nums" data-tableau="revisions">
                                    <thead><tr className="border-b text-xs text-muted-foreground">
                                        <th className="py-2 pr-2 text-left font-medium">Date</th><th className="px-2 text-left font-medium">Contrat</th><th className="px-2 text-left font-medium">Prestation</th>
                                        <th className="px-2 text-right font-medium">Base annuelle</th><th className="px-2 text-right font-medium">Coef. actuel</th><th className="px-2 text-right font-medium">Constant</th><th className="px-2 text-right font-medium">Hypothèse</th><th className="pl-2 text-right font-medium">Effet annuel</th>
                                    </tr></thead>
                                    <tbody>{s.revisions.map(r => {
                                        const effet = r.annuel * (r.simule - r.constant);
                                        return (
                                            <tr key={`${r.cle}|${r.date}`} className="border-b last:border-0">
                                                <td className="py-2 pr-2">{jourFr(r.date)}</td>
                                                <td className="px-2"><Link href={`/contracts/${r.contractId}`} className="font-mono text-xs underline">{r.contractNumber}</Link> <span className="text-muted-foreground">{r.clientName}</span></td>
                                                <td className="px-2">{r.activite} <span className="text-muted-foreground">{r.site}</span></td>
                                                <td className="px-2 text-right">{eur0(r.annuel)}</td>
                                                <td className="px-2 text-right text-muted-foreground">{coef(r.avant)}</td>
                                                <td className="px-2 text-right">{coef(r.constant)}</td>
                                                <td className="px-2 text-right font-medium">{coef(r.simule)}</td>
                                                <td className={`pl-2 text-right ${effet > 0 ? 'text-emerald-700' : effet < 0 ? 'text-red-700' : 'text-muted-foreground'}`}>{Math.abs(effet) >= 0.5 ? signe(effet) : '—'}</td>
                                            </tr>
                                        );
                                    })}</tbody>
                                </table>
                            )}
                        </CardContent>
                    </Card>

                    <p className="text-xs text-muted-foreground">
                        Seuls les forfaits révisables sont simulés : le prix ferme ne bouge pas, et le P1 au compteur, au DJU ou en acompte suit ses propres formules. Une révision déjà facturée garde son coefficient. Un contrat cesse d'être compté à sa date de fin.
                    </p>

                    {s.nonSimulables.length > 0 && (
                        <Card className="border-amber-300">
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-600" />{s.nonSimulables.length} prestation{s.nonSimulables.length > 1 ? 's' : ''} non simulée{s.nonSimulables.length > 1 ? 's' : ''}</CardTitle>
                                <CardDescription>Une donnée manque pour calculer leur coefficient.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ul className="space-y-1 text-sm">{s.nonSimulables.map((n, i) => <li key={i}><Link href={`/contracts/${n.contractId}`} className="font-mono text-xs underline">{n.contractNumber}</Link> {n.clientName} — <span className="text-muted-foreground">{n.message}</span></li>)}</ul>
                            </CardContent>
                        </Card>
                    )}
                </>
            )}
        </div>
    );
}

function Tuile({ titre, valeur, detail, ton = '' }: { titre: string; valeur: string; detail: string; ton?: string }) {
    return (
        <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{titre}</p>
            <p className={`text-2xl font-bold tabular-nums ${ton}`}>{valeur}</p>
            <p className="text-xs text-muted-foreground">{detail || ' '}</p>
        </CardContent></Card>
    );
}
