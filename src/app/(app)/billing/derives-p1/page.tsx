'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronRight, Loader2, RefreshCw, Search, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { TableauMarge } from '@/components/sites/marge-p1';
import { useData } from '@/context/data-context';
import { useToast } from '@/hooks/use-toast';
import type { SeuilsDerive, Variation } from '@/lib/energie/derives';
import { derivesP1Action, seuilsDerivesAction } from '@/lib/energie/derives-actions';
import type { DeriveSite, DerivesP1 } from '@/services/derives-p1-admin';

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const pct = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`);
const mois = (m: string) => new Date(`${m}-01T12:00:00`).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
const points = (n: number | null) => (n === null ? <span className="text-muted-foreground">—</span> : <span className={n < 0 ? 'font-medium text-red-700' : 'text-emerald-700'}>{n > 0 ? '+' : ''}{n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} pt</span>);

/** Variation d'un indicateur ; `bon` : sens favorable à la marge (prix d'achat : baisse ; ventes : hausse). */
function Var({ v, bon }: { v: Variation; bon: 'hausse' | 'baisse' }) {
    if (v.ecart === null) return <span className="text-muted-foreground">—</span>;
    const favorable = bon === 'hausse' ? v.ecart >= 0 : v.ecart <= 0;
    const Icone = v.ecart >= 0 ? ArrowUpRight : ArrowDownRight;
    return <span className={`inline-flex items-center gap-0.5 whitespace-nowrap ${Math.abs(v.ecart) < 3 ? 'text-muted-foreground' : favorable ? 'text-emerald-700' : 'font-medium text-red-700'}`}><Icone className="h-3 w-3" />{Math.abs(v.ecart).toLocaleString('fr-FR')} %</span>;
}

/** Dérives P1 : sites dont la marge P1 se dégrade (seuil, an dernier, budget), avec la cause probable. */
export default function DerivesP1Page() {
    const { isAdmin } = useData();
    const { toast } = useToast();
    const [data, setData] = useState<DerivesP1 | null>(null);
    const [erreur, setErreur] = useState('');
    const [chargement, setChargement] = useState(true);
    const [seulement, setSeulement] = useState(true);
    const [recherche, setRecherche] = useState('');
    const [ouverts, setOuverts] = useState<Set<string>>(new Set());
    const [reglage, setReglage] = useState<Record<keyof SeuilsDerive, string> | null>(null);

    const charger = useCallback(async () => {
        setChargement(true);
        const r = await derivesP1Action();
        setChargement(false);
        if (r.success) { setData(r.data); setErreur(''); } else setErreur(r.error);
    }, []);
    useEffect(() => { void charger(); }, [charger]);

    const sites = data?.sites ?? [];
    const enDerive = sites.filter(s => s.analyse.gravite);
    const visibles = useMemo(() => {
        const q = recherche.trim().toLowerCase();
        return sites.filter(s => (!seulement || s.analyse.gravite) && (!q || [s.siteNom, s.client, s.contractNumber].some(v => v.toLowerCase().includes(q))));
    }, [sites, seulement, recherche]);
    const total = useMemo(() => {
        const v = sites.reduce((t, s) => t + s.actuel.ventes, 0), a = sites.reduce((t, s) => t + s.actuel.achats, 0);
        const vN1 = sites.reduce((t, s) => t + s.precedent.ventes, 0), aN1 = sites.reduce((t, s) => t + s.precedent.achats, 0);
        return { taux: v > 0 ? ((v - a) / v) * 100 : null, tauxN1: vN1 > 0 ? ((vN1 - aN1) / vN1) * 100 : null, marge: v - a };
    }, [sites]);
    const basculer = (id: string) => setOuverts(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

    const enregistrerSeuils = async () => {
        if (!reglage) return;
        const r = await seuilsDerivesAction(Object.fromEntries(Object.entries(reglage).map(([k, v]) => [k, Number(v.replace(',', '.'))])) as Partial<SeuilsDerive>);
        if (!r.success) { toast({ variant: 'destructive', title: 'Seuils refusés', description: r.error }); return; }
        toast({ title: 'Seuils enregistrés' }); setReglage(null); await charger();
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Dérives P1</h1>
                    <p className="text-sm text-muted-foreground">Marge P1 par site sur douze mois{data ? ` (${mois(data.de)} à ${mois(data.a)})` : ''} : P1 facturé face aux factures du fournisseur d&apos;énergie, comparée à l&apos;an dernier et au budget du contrat.</p>
                </div>
                <div className="flex gap-2">
                    {isAdmin && data && <Button variant="outline" size="sm" onClick={() => setReglage(Object.fromEntries(Object.entries(data.seuils).map(([k, v]) => [k, String(v)])) as Record<keyof SeuilsDerive, string>)}><SlidersHorizontal className="mr-2 h-4 w-4" />Seuils</Button>}
                    <Button variant="outline" size="sm" onClick={charger} disabled={chargement}><RefreshCw className="mr-2 h-4 w-4" />Actualiser</Button>
                </div>
            </div>

            {erreur && <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{erreur}</p>}
            {chargement && !data ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Calcul des marges P1…</p> : data && (
                <>
                    <div className="grid gap-3 sm:grid-cols-4" data-derives="tuiles">
                        <div className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">Sites suivis</p><p className="text-2xl font-bold">{sites.length}</p><p className="text-xs text-muted-foreground">avec achats d&apos;énergie connus</p></div>
                        <div className={`rounded-lg border p-4 ${enDerive.length ? 'border-red-300 bg-red-50' : 'border-emerald-300 bg-emerald-50'}`}><p className="text-xs text-muted-foreground">En dérive</p><p className="text-2xl font-bold">{enDerive.length}</p><p className="text-xs text-muted-foreground">dont {enDerive.filter(s => s.analyse.gravite === 'forte').length} forte(s)</p></div>
                        <div className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">Marge P1 (12 mois)</p><p className="text-2xl font-bold">{pct(total.taux === null ? null : Math.round(total.taux * 10) / 10)}</p><p className="text-xs text-muted-foreground">{eur(total.marge)} sur les mois complets</p></div>
                        <div className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">An dernier, même période</p><p className="text-2xl font-bold">{pct(total.tauxN1 === null ? null : Math.round(total.tauxN1 * 10) / 10)}</p><p className="text-xs text-muted-foreground">seuils : marge &lt; {data.seuils.tauxMin} %, −{data.seuils.baisseN1} pt sur un an, −{data.seuils.ecartBudget} pt du budget</p></div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-2 text-sm"><Switch checked={seulement} onCheckedChange={setSeulement} aria-label="Seulement les dérives" />Seulement les sites en dérive</label>
                        <div className="relative w-64">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input className="h-9 pl-8" placeholder="Site, client, contrat…" value={recherche} onChange={e => setRecherche(e.target.value)} />
                        </div>
                    </div>
                    <Card>
                        <CardContent className="overflow-x-auto p-0">
                            <table className="w-full min-w-[1100px] text-sm tabular-nums" data-derives="tableau">
                                <thead>
                                    <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
                                        <th className="w-8" /><th className="px-3 py-2 text-left font-medium">Site</th>
                                        <th className="px-2 text-right font-medium">P1 facturé</th><th className="px-2 text-right font-medium">Énergie</th><th className="px-2 text-right font-medium">Marge</th>
                                        <th className="px-2 text-right font-medium">An dernier</th><th className="px-2 text-right font-medium">Budget</th>
                                        <th className="px-2 text-right font-medium" title="Prix moyen d'achat par unité facturée par le fournisseur, contre l'an dernier">Prix achat</th>
                                        <th className="px-2 text-right font-medium" title="Quantité achetée, contre l'an dernier">Conso.</th>
                                        <th className="px-2 text-right font-medium" title="P1 facturé, contre l'an dernier">Ventes</th>
                                        <th className="px-3 py-2 text-left font-medium">Pourquoi</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visibles.length === 0 && <tr><td colSpan={11} className="py-8 text-center text-muted-foreground">{sites.length ? 'Aucun site en dérive.' : 'Aucun site avec des achats d\'énergie connus.'}</td></tr>}
                                    {visibles.map(s => <LigneSite key={s.siteId} s={s} ouvert={ouverts.has(s.siteId)} basculer={() => basculer(s.siteId)} />)}
                                </tbody>
                            </table>
                        </CardContent>
                    </Card>
                    <p className="text-xs text-muted-foreground">Marges calculées sur les mois complets (P1 facturé et factures du fournisseur connus). An dernier : la même fenêtre décalée d&apos;un an. Budget : taux de marge de la ligne P1 (CA − énergie) du budget de l&apos;année du contrat. Un mail récapitulatif part aux acheteurs et aux administrateurs le jour où un site entre en dérive.</p>
                </>
            )}

            <Dialog open={!!reglage} onOpenChange={o => { if (!o) setReglage(null); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader><DialogTitle>Seuils des dérives P1</DialogTitle><DialogDescription>Un site est signalé dès qu&apos;un seuil est franchi ; deux seuils (ou une marge négative) : dérive forte.</DialogDescription></DialogHeader>
                    {reglage && (
                        <div className="grid gap-3">
                            {([['tauxMin', 'Marge P1 minimale (%)'], ['baisseN1', 'Perte maximale sur un an (points)'], ['ecartBudget', 'Écart maximal au budget (points)'], ['moisMin', 'Mois complets minimum pour juger']] as [keyof SeuilsDerive, string][]).map(([k, l]) => (
                                <div key={k} className="flex items-center justify-between gap-3"><Label htmlFor={`seuil-${k}`}>{l}</Label><Input id={`seuil-${k}`} className="w-24 text-right" inputMode="decimal" value={reglage[k]} onChange={e => setReglage(r => r && { ...r, [k]: e.target.value })} /></div>
                            ))}
                        </div>
                    )}
                    <DialogFooter><Button variant="outline" onClick={() => setReglage(null)}>Annuler</Button><Button onClick={enregistrerSeuils}>Enregistrer</Button></DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function LigneSite({ s, ouvert, basculer }: { s: DeriveSite; ouvert: boolean; basculer: () => void }) {
    const a = s.analyse;
    return (
        <Fragment>
            <tr className="cursor-pointer border-b hover:bg-muted/30" onClick={basculer} data-site={s.siteNom}>
                <td className="pl-3">{ouvert ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5">
                        {a.gravite && <Badge variant="outline" className={`shrink-0 whitespace-nowrap py-0 text-[10px] ${a.gravite === 'forte' ? 'border-red-300 bg-red-50 text-red-800' : 'border-amber-300 bg-amber-50 text-amber-800'}`}>{a.gravite === 'forte' ? 'forte' : 'à surveiller'}</Badge>}
                        <Link href={`/sites/${s.siteId}?onglet=factures`} onClick={e => e.stopPropagation()} className="font-medium text-primary hover:underline">{s.siteNom}</Link>
                    </span>
                    <span className="block text-xs text-muted-foreground">{s.client}{s.contractNumber && <> · <Link href={`/contracts/${s.contractId}?onglet=budget`} onClick={e => e.stopPropagation()} className="hover:underline">{s.contractNumber}</Link></>}</span>
                </td>
                <td className="px-2 text-right">{eur(s.actuel.ventes)}</td>
                <td className="px-2 text-right">{eur(s.actuel.achats)}</td>
                <td className={`px-2 text-right font-semibold ${a.taux !== null && a.taux < 0 ? 'text-red-700' : ''}`}>{pct(a.taux)}<span className="block text-[10px] font-normal text-muted-foreground">{eur(s.actuel.marge)} · {s.actuel.moisComplets} mois</span></td>
                <td className="px-2 text-right">{pct(a.tauxN1)}<span className="block text-[10px]">{points(a.ecartN1)}</span></td>
                <td className="px-2 text-right">{pct(a.tauxBudget)}<span className="block text-[10px]">{points(a.ecartBudget)}</span></td>
                <td className="px-2 text-right"><Var v={a.prixAchat} bon="baisse" /></td>
                <td className="px-2 text-right"><Var v={a.quantite} bon="baisse" /></td>
                <td className="px-2 text-right"><Var v={a.ventes} bon="hausse" /></td>
                <td className="max-w-[280px] px-3 py-2 text-xs">
                    {a.motifs.length > 0 && <span className="flex items-start gap-1 text-red-800"><TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />{a.motifs.join(' · ')}</span>}
                    {a.cause && <span className="mt-0.5 block text-muted-foreground">Cause probable : {a.cause}.</span>}
                </td>
            </tr>
            {ouvert && (
                <tr className="border-b bg-muted/20">
                    <td />
                    <td colSpan={10} className="px-3 py-3">
                        <div className="grid gap-6 lg:grid-cols-2">
                            <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Douze derniers mois</p><TableauMarge m={s.actuel} /></div>
                            <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Même période, un an plus tôt</p>{s.precedent.mois.length ? <TableauMarge m={s.precedent} /> : <p className="text-sm text-muted-foreground">Pas de données.</p>}</div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs">
                            <Button asChild size="sm" variant="outline" className="h-7"><Link href={`/sites/${s.siteId}?onglet=factures`}>Factures et marge du site</Link></Button>
                            <Button asChild size="sm" variant="outline" className="h-7"><Link href={`/sites/${s.siteId}?onglet=compteurs`}>Compteurs et relevés</Link></Button>
                            <Button asChild size="sm" variant="outline" className="h-7"><Link href="/purchases/energie">Contrats d&apos;énergie</Link></Button>
                            {s.contractId && <Button asChild size="sm" variant="outline" className="h-7"><Link href={`/contracts/${s.contractId}?onglet=budget`}>Budget du contrat</Link></Button>}
                        </div>
                    </td>
                </tr>
            )}
        </Fragment>
    );
}
