'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronRight as Fleche, Loader2, Lock, Pencil, TriangleAlert, Wand2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PastilleActivite } from '@/components/ui/pastilles';
import { useConfirm } from '@/components/confirm-provider';
import { useToast } from '@/hooks/use-toast';
import { LIBELLE_NATURE, NATURES_DEPENSE, NON_AFFECTE, type LigneSynthese, type Montants } from '@/lib/budgets/budget';
import { enregistrerBudgetAction, figerBudgetAction, suiviBudgetAction } from '@/lib/budgets/actions';
import type { SuiviBudget } from '@/services/budgets-admin';

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const dep = (m: Montants) => NATURES_DEPENSE.reduce((s, n) => s + m[n], 0);
const ecart = (n: number) => <span className={n < 0 ? 'font-medium text-red-700' : n > 0 ? 'font-medium text-emerald-700' : 'text-muted-foreground'}>{n > 0 ? '+' : ''}{eur(n)}</span>;
const pct = (marge: number, ca: number) => (ca > 0 ? `${Math.round((marge / ca) * 100)} %` : '—');

/** Budget du contrat par activité : budget (initial et révisé), réalisé, atterrissage de l'année, écarts. */
export function BudgetContrat({ contractId, isAdmin }: { contractId: string; isAdmin: boolean }) {
    const { toast } = useToast();
    const confirm = useConfirm();
    const [annee, setAnnee] = useState(new Date().getFullYear());
    const [data, setData] = useState<SuiviBudget | null>(null);
    const [erreur, setErreur] = useState('');
    const [chargement, setChargement] = useState(true);
    const [ouverts, setOuverts] = useState<Set<string>>(new Set());
    const [edition, setEdition] = useState(false);

    const charger = useCallback(async () => {
        setChargement(true);
        const r = await suiviBudgetAction(contractId, annee);
        setChargement(false);
        if (r.success) { setData(r.data); setErreur(''); } else setErreur(r.error);
    }, [contractId, annee]);
    useEffect(() => { void charger(); }, [charger]);

    const figer = async () => {
        if (!(await confirm({ title: `Figer le budget initial ${annee} ?`, description: 'Il ne pourra plus être modifié : les révisions suivantes se compareront à lui.' }))) return;
        const r = await figerBudgetAction(contractId, annee);
        if (!r.success) { toast({ variant: 'destructive', title: 'Gel impossible', description: r.error }); return; }
        toast({ title: 'Budget initial figé' }); await charger();
    };
    const basculer = (a: string) => setOuverts(s => { const n = new Set(s); if (n.has(a)) n.delete(a); else n.add(a); return n; });
    const fige = !!data?.budget?.initial;
    const aBudget = !!data?.budget?.lignes?.length;
    const alertes = useMemo(() => (data?.lignes ?? []).flatMap(l => l.alertes.map(a => `${l.activite === NON_AFFECTE ? 'Non affecté' : l.activite} — ${a}`)), [data]);

    return (
        <Card>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
                <div>
                    <CardTitle className="flex items-center gap-2 text-base">Budget {annee}{fige ? <Badge variant="outline" className="gap-1 border-slate-300 bg-slate-50 text-slate-700"><Lock className="h-3 w-3" />initial figé</Badge> : aBudget ? <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">en préparation</Badge> : null}</CardTitle>
                    <CardDescription>Chiffre d&apos;affaires et dépenses par activité : budget, réalisé à date et atterrissage de l&apos;année (réalisé + reste à facturer ; dépenses : le plus grand du budget et du réalisé).</CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center rounded-md border">
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Année précédente" onClick={() => setAnnee(a => a - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                        <span className="px-2 text-sm font-medium tabular-nums" data-annee>{annee}</span>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Année suivante" onClick={() => setAnnee(a => a + 1)}><ChevronRight className="h-4 w-4" /></Button>
                    </div>
                    <Button size="sm" variant="outline" className="h-8" onClick={() => setEdition(true)} disabled={!data}><Pencil className="mr-1.5 h-3.5 w-3.5" />{aBudget ? (fige ? 'Réviser' : 'Modifier') : 'Saisir le budget'}</Button>
                    {isAdmin && aBudget && !fige && <Button size="sm" className="h-8" onClick={figer}><Lock className="mr-1.5 h-3.5 w-3.5" />Figer l&apos;initial</Button>}
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {erreur && <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{erreur}</p>}
                {chargement && !data ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : data && (
                    <>
                        <Tuiles total={data.total} aBudget={aBudget} />
                        {!aBudget && (
                            <p className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900" data-budget="vide">
                                Pas encore de budget pour {annee}. « Saisir le budget » propose le chiffre d&apos;affaires de l&apos;échéancier ({eur(Object.values(data.caTheorique).reduce((s, v) => s + v, 0))}) ; les dépenses se saisissent par nature.
                            </p>
                        )}
                        {alertes.length > 0 && (
                            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-budget="alertes">
                                <p className="mb-1 flex items-center gap-1.5 font-medium"><TriangleAlert className="h-4 w-4" />{alertes.length} point(s) d&apos;attention</p>
                                <ul className="list-disc space-y-0.5 pl-5 text-xs">{alertes.map(a => <li key={a}>{a}</li>)}</ul>
                            </div>
                        )}
                        <div className="overflow-x-auto rounded-md border">
                            <table className="w-full text-sm" data-budget="tableau">
                                <thead>
                                    <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
                                        <th rowSpan={2} className="px-3 py-2 text-left font-medium">Activité</th>
                                        <th colSpan={3} className="border-l px-3 py-1.5 text-center font-medium">Chiffre d&apos;affaires</th>
                                        <th colSpan={3} className="border-l px-3 py-1.5 text-center font-medium">Dépenses</th>
                                        <th colSpan={3} className="border-l px-3 py-1.5 text-center font-medium">Marge</th>
                                    </tr>
                                    <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                                        {['Budget', 'Réalisé', 'Atterrissage', 'Budget', 'Réalisé', 'Atterrissage', 'Budget', 'Atterrissage', 'Écart'].map((t, i) => <th key={i} className={`px-3 py-1.5 text-right font-medium ${i % 3 === 0 ? 'border-l' : ''}`}>{t}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.lignes.map(l => (
                                        <Fragment key={l.activite}>
                                            <tr className="cursor-pointer border-b hover:bg-muted/30" onClick={() => basculer(l.activite)} data-activite={l.activite}>
                                                <td className="px-3 py-2">
                                                    <span className="flex items-center gap-1.5">
                                                        {ouverts.has(l.activite) ? <ChevronDown className="h-3.5 w-3.5" /> : <Fleche className="h-3.5 w-3.5" />}
                                                        {l.activite === NON_AFFECTE ? <span className="text-xs text-muted-foreground">Non affecté</span> : <PastilleActivite code={l.activite} />}
                                                        {l.alertes.length > 0 && <TriangleAlert className="h-3.5 w-3.5 text-amber-600" aria-label="Alerte" />}
                                                    </span>
                                                </td>
                                                <Cellule v={l.budget.ca} bord initial={l.budgetInitial?.ca} />
                                                <Cellule v={l.realise.ca} />
                                                <Cellule v={l.atterrissage.ca} fort />
                                                <Cellule v={dep(l.budget)} bord initial={l.budgetInitial ? dep(l.budgetInitial) : undefined} />
                                                <Cellule v={dep(l.realise)} />
                                                <Cellule v={dep(l.atterrissage)} fort />
                                                <td className="border-l px-3 py-2 text-right tabular-nums">{eur(l.marge.budget)}<span className="block text-[10px] text-muted-foreground">{pct(l.marge.budget, l.budget.ca)}</span></td>
                                                <td className="px-3 py-2 text-right font-medium tabular-nums">{eur(l.marge.atterrissage)}<span className="block text-[10px] font-normal text-muted-foreground">{pct(l.marge.atterrissage, l.atterrissage.ca)}</span></td>
                                                <td className="px-3 py-2 text-right tabular-nums">{ecart(l.ecartMarge)}</td>
                                            </tr>
                                            {ouverts.has(l.activite) && (
                                                <tr className="border-b bg-muted/20 text-xs">
                                                    <td />
                                                    <td colSpan={9} className="px-3 py-2">
                                                        <table className="w-full max-w-xl">
                                                            <thead><tr className="text-muted-foreground"><th className="text-left font-medium">Nature</th><th className="pl-4 text-right font-medium">Budget</th><th className="pl-4 text-right font-medium">Réalisé</th><th className="pl-4 text-right font-medium">Atterrissage</th><th className="pl-4 text-left font-medium">Consommé</th></tr></thead>
                                                            <tbody>
                                                                {NATURES_DEPENSE.map(n => (
                                                                    <tr key={n} data-nature={n}>
                                                                        <td className="py-0.5">{LIBELLE_NATURE[n]}{n === 'energie' && l.activite === data.activiteEnergie && <span className="ml-1 text-muted-foreground">(factures fournisseurs des sites)</span>}</td>
                                                                        <td className="pl-4 text-right tabular-nums">{eur(l.budget[n])}</td>
                                                                        <td className={`pl-4 text-right tabular-nums ${l.budget[n] > 0 && l.realise[n] > l.budget[n] ? 'font-medium text-red-700' : ''}`}>{eur(l.realise[n])}</td>
                                                                        <td className="pl-4 text-right tabular-nums">{eur(l.atterrissage[n])}</td>
                                                                        <td className="w-32 pl-4"><Jauge part={l.budget[n] > 0 ? l.realise[n] / l.budget[n] : l.realise[n] > 0 ? 2 : 0} /></td>
                                                                    </tr>
                                                                ))}
                                                                <tr className="text-muted-foreground"><td className="pt-1">Reste à facturer sur l&apos;année</td><td /><td /><td className="pt-1 text-right tabular-nums">{eur(l.resteCA)}</td><td /></tr>
                                                            </tbody>
                                                        </table>
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    ))}
                                    <tr className="bg-muted/40 font-semibold">
                                        <td className="px-3 py-2">Total</td>
                                        <Cellule v={data.total.budget.ca} bord initial={data.total.budgetInitial?.ca} />
                                        <Cellule v={data.total.realise.ca} />
                                        <Cellule v={data.total.atterrissage.ca} fort />
                                        <Cellule v={dep(data.total.budget)} bord initial={data.total.budgetInitial ? dep(data.total.budgetInitial) : undefined} />
                                        <Cellule v={dep(data.total.realise)} />
                                        <Cellule v={dep(data.total.atterrissage)} fort />
                                        <td className="border-l px-3 py-2 text-right tabular-nums">{eur(data.total.marge.budget)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{eur(data.total.marge.atterrissage)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{ecart(data.total.ecartMarge)}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Réalisé : factures moins avoirs (au prorata de la période facturée), commandes engagées, heures validées, factures d&apos;énergie des sites (au prorata de leur période).
                            {fige && data.budget?.initial && ` Budget initial figé le ${new Date(data.budget.initial.figeLe).toLocaleDateString('fr-FR')} par ${data.budget.initial.figePar} ; en petit sous le budget révisé quand il diffère.`}
                            {data.nonEstimees > 0 && ` ${data.nonEstimees} prestation(s) P1 variable(s) sans montant annuel : hors reste à facturer.`}
                        </p>
                        {data.avertissements.map(a => <p key={a} className="text-xs text-amber-700">{a}</p>)}
                    </>
                )}
            </CardContent>
            {data && <EditionBudget open={edition} onOpenChange={setEdition} data={data} onSaved={async () => { setEdition(false); await charger(); }} contractId={contractId} />}
        </Card>
    );
}

function Cellule({ v, bord, fort, initial }: { v: number; bord?: boolean; fort?: boolean; initial?: number }) {
    return (
        <td className={`px-3 py-2 text-right tabular-nums ${bord ? 'border-l' : ''} ${fort ? 'font-medium' : ''}`}>
            {eur(v)}
            {initial !== undefined && Math.round(initial) !== Math.round(v) && <span className="block text-[10px] text-muted-foreground" title="Budget initial">init. {eur(initial)}</span>}
        </td>
    );
}

function Jauge({ part }: { part: number }) {
    const p = Math.min(part, 1.5);
    return (
        <span className="flex h-2 w-full overflow-hidden rounded-full bg-slate-200" title={`${Math.round(part * 100)} % du budget`}>
            <span className={`h-full ${part > 1 ? 'bg-red-500' : part > 0.85 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${(p / 1.5) * 100}%` }} />
        </span>
    );
}

function Tuiles({ total, aBudget }: { total: LigneSynthese; aBudget: boolean }) {
    const t = [
        { l: "CA budget", v: eur(total.budget.ca), d: total.budgetInitial && Math.round(total.budgetInitial.ca) !== Math.round(total.budget.ca) ? `initial ${eur(total.budgetInitial.ca)}` : '' },
        { l: 'CA atterrissage', v: eur(total.atterrissage.ca), d: `dont réalisé ${eur(total.realise.ca)}` },
        { l: 'Dépenses atterrissage', v: eur(dep(total.atterrissage)), d: `dont réalisé ${eur(dep(total.realise))}` },
        { l: 'Marge atterrissage', v: eur(total.marge.atterrissage), d: aBudget ? `budget ${eur(total.marge.budget)}` : 'pas de budget', fort: true, negatif: total.ecartMarge < 0 },
    ];
    return (
        <div className="grid gap-3 sm:grid-cols-4" data-budget="tuiles">
            {t.map(x => (
                <div key={x.l} className={`rounded-lg border p-3 ${x.fort ? (x.negatif ? 'border-red-300 bg-red-50' : 'border-emerald-300 bg-emerald-50') : 'bg-card'}`}>
                    <p className="text-xs text-muted-foreground">{x.l}</p>
                    <p className="text-xl font-bold tabular-nums">{x.v}</p>
                    {x.d && <p className="text-xs text-muted-foreground">{x.d}</p>}
                </div>
            ))}
        </div>
    );
}

type Saisie = Record<string, Record<'ca' | typeof NATURES_DEPENSE[number], string>>;
const texte = (n?: number) => (n ? String(n).replace('.', ',') : '');

function EditionBudget({ open, onOpenChange, data, contractId, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; data: SuiviBudget; contractId: string; onSaved: () => void | Promise<void> }) {
    const { toast } = useToast();
    const [s, setS] = useState<Saisie>({});
    const [envoi, setEnvoi] = useState(false);
    useEffect(() => {
        if (!open) return;
        setS(Object.fromEntries(data.activites.map(a => {
            const l = data.budget?.lignes.find(x => x.activite === a.code);
            return [a.code, { ca: texte(l?.ca), energie: texte(l?.energie), achats: texte(l?.achats), mainOeuvre: texte(l?.mainOeuvre), sousTraitance: texte(l?.sousTraitance) }];
        })));
    }, [open, data]);
    const proposer = () => setS(x => Object.fromEntries(Object.entries(x).map(([a, v]) => [a, { ...v, ca: texte(Math.round(data.caTheorique[a] ?? 0)) }])));
    const num = (v: string) => Number(v.replace(/\s/g, '').replace(',', '.')) || 0;
    const enregistrer = async () => {
        setEnvoi(true);
        const lignes = Object.entries(s).map(([activite, v]) => ({ activite, ca: num(v.ca), energie: num(v.energie), achats: num(v.achats), mainOeuvre: num(v.mainOeuvre), sousTraitance: num(v.sousTraitance) }));
        const r = await enregistrerBudgetAction(contractId, data.annee, lignes);
        setEnvoi(false);
        if (!r.success) { toast({ variant: 'destructive', title: 'Enregistrement impossible', description: r.error }); return; }
        toast({ title: `Budget ${data.annee} enregistré` });
        await onSaved();
    };
    const colonnes = [['ca', "Chiffre d'affaires"], ...NATURES_DEPENSE.map(n => [n, LIBELLE_NATURE[n]])] as [keyof Saisie[string], string][];
    const totalMarge = Object.values(s).reduce((t, v) => t + num(v.ca) - NATURES_DEPENSE.reduce((d, n) => d + num(v[n]), 0), 0);
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl" data-dialogue="budget">
                <DialogHeader>
                    <DialogTitle>Budget {data.annee} — {data.contrat.numero}</DialogTitle>
                    <DialogDescription>{data.budget?.initial ? 'Budget révisé : le budget initial figé reste la référence de comparaison.' : 'Montants HT de l\'année civile, par activité. Le chiffre d\'affaires peut reprendre l\'échéancier.'}</DialogDescription>
                </DialogHeader>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead><tr className="text-xs text-muted-foreground"><th className="py-1 text-left font-medium">Activité</th>{colonnes.map(([k, l]) => <th key={k} className="px-1 py-1 text-right font-medium">{l}</th>)}<th className="py-1 text-right font-medium">Marge</th></tr></thead>
                        <tbody>
                            {data.activites.map(a => {
                                const v = s[a.code] ?? { ca: '', energie: '', achats: '', mainOeuvre: '', sousTraitance: '' };
                                const marge = num(v.ca) - NATURES_DEPENSE.reduce((d, n) => d + num(v[n]), 0);
                                return (
                                    <tr key={a.code} className="border-t" data-saisie={a.code}>
                                        <td className="py-1.5 pr-2"><span className="flex items-center gap-1.5"><PastilleActivite code={a.code} /><span className="hidden text-xs text-muted-foreground lg:inline">{a.libelle}</span></span></td>
                                        {colonnes.map(([k, l]) => (
                                            <td key={k} className="px-1 py-1.5">
                                                <Input aria-label={`${l} ${a.code}`} inputMode="decimal" className="h-8 w-28 text-right tabular-nums" value={v[k]} placeholder={k === 'ca' && data.caTheorique[a.code] ? String(Math.round(data.caTheorique[a.code])) : '0'}
                                                    onChange={e => setS(x => ({ ...x, [a.code]: { ...v, [k]: e.target.value } }))} />
                                            </td>
                                        ))}
                                        <td className={`py-1.5 pl-2 text-right tabular-nums ${marge < 0 ? 'text-red-700' : ''}`}>{eur(marge)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <Button type="button" variant="outline" size="sm" onClick={proposer}><Wand2 className="mr-1.5 h-3.5 w-3.5" />Reprendre le CA de l&apos;échéancier</Button>
                    <span>Marge budgétée : <strong className={totalMarge < 0 ? 'text-red-700' : ''}>{eur(totalMarge)}</strong></span>
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
                    <Button type="button" onClick={enregistrer} disabled={envoi}>{envoi && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Enregistrer</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
