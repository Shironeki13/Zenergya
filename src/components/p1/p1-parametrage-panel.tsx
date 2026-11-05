'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, History, Loader2, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useData } from '@/context/data-context';
import { EXIGENCES_MARCHE, TYPES_MARCHE, type TermeNc, type TypeMarche } from '@/lib/p1/parametrage';
import {
    P1_PARAMS, REPARTITIONS, formatFormuleNc, valeurAu, type InteressementMarche, type P1Params, type P1Scope, type P1Version,
} from '@/lib/p1/stockage';
import { addP1PosteAction, addP1VersionAction, getP1SiteAction, retireP1PosteAction, retireP1VersionAction } from '@/lib/p1/actions';
import type { P1SiteView, P1Target } from '@/services/p1-admin';

/**
 * Paramétrage P1 daté d'un site : ce qui manque pour calculer (selon le type de marché), la valeur en vigueur à une
 * date, l'historique de chaque paramètre, l'ajout d'une version (date d'effet, motif) et son retrait tracé.
 */

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
const frDay = (d?: string | null) => (d ? d.split('-').reverse().join('/') : 'origine');
const fmtNum = (n: number, unit?: string) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 6 })}${unit ? ` ${unit}` : ''}`;

function formatValue(scope: P1Scope, key: string, value: unknown): string {
    if (value === null || value === undefined) return '—';
    const def = P1_PARAMS[scope][key];
    if (def.kind === 'formule') return formatFormuleNc(value as TermeNc[]);
    if (def.kind === 'interessement') {
        return (value as InteressementMarche[]).map(i => `${i.marche} (${i.repartition === 'contrat' ? 'au contrat' : 'prorata NB'}${i.plafondPct !== null ? `, plafond ${i.plafondPct} % P2${i.plafonne ? '' : ' non plafonné'}` : ''})`).join(' ; ');
    }
    if (typeof value === 'number') return fmtNum(value, def.unit);
    return String(value).replace(/_/g, ' ');
}

type Editing = { target: P1Target; key: string; title: string; meterCodes?: string[] } | null;

export function P1ParametragePanel({ siteId }: { siteId: string }) {
    const { toast } = useToast();
    const { weatherStations } = useData();
    const [date, setDate] = useState(today());
    const [view, setView] = useState<P1SiteView | null>(null);
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<Editing>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        const r = await getP1SiteAction(siteId, date);
        if (r.success) setView(r.data);
        else toast({ title: 'Paramétrage P1', description: r.error, variant: 'destructive' });
    }, [siteId, date, toast]);
    useEffect(() => { load(); }, [load]);

    const run = async (fn: () => Promise<{ success: boolean; error?: string }>, ok: string) => {
        setBusy(true);
        const r = await fn();
        setBusy(false);
        if (!r.success) { toast({ title: 'Opération refusée', description: r.error, variant: 'destructive' }); return false; }
        toast({ title: ok });
        await load();
        return true;
    };

    const retire = (target: P1Target, key: string, v: P1Version<unknown>) => {
        const motif = window.prompt(`Retirer la version ${frDay(v.dateEffet)} (${v.motif}) : motif du retrait ?`);
        if (motif) run(() => retireP1VersionAction(target, key, v.id, motif), 'Version retirée');
    };

    if (!view) return <Card><CardContent className="py-6"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></CardContent></Card>;
    const { reste } = view;
    const meterCodes = view.meters.map(m => m.code);
    const postes = Object.values(view.siteDoc?.postes ?? {}).filter(p => !p.retireLe);

    const rows = (scope: P1Scope, target: P1Target, params: P1Params | undefined, keys = Object.keys(P1_PARAMS[scope]), meterCodesForFormula?: string[]) => (
        <div className="divide-y rounded-md border">
            {keys.map(key => (
                <ParamRow key={key} scope={scope} paramKey={key} params={params} date={date}
                    onAdd={() => setEditing({ target, key, title: P1_PARAMS[scope][key].label, meterCodes: meterCodesForFormula })}
                    onRetire={v => retire(target, key, v)} />
            ))}
        </div>
    );

    return (
        <Card>
            <CardHeader className="cursor-pointer pb-3" onClick={() => setOpen(o => !o)}>
                <CardTitle className="flex items-center justify-between text-base">
                    <span>Paramétrage P1 (daté)</span>
                    <span className="flex items-center gap-2">
                        {reste.typeMarche ? <Badge variant="outline">{reste.typeMarche}</Badge> : null}
                        {!reste.suivi ? <Badge variant="secondary">Hors suivi P1</Badge>
                            : reste.calculable ? <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" />Calculable</Badge>
                            : <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />{reste.manque.length} à renseigner</Badge>}
                        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </span>
                </CardTitle>
                <CardDescription>Décisions contractuelles du suivi P1 : chaque valeur a une date d'effet et un motif ; un avenant ajoute une version, il n'écrase rien.</CardDescription>
            </CardHeader>
            {open && (
                <CardContent className="space-y-6">
                    <div className="flex flex-wrap items-end gap-4">
                        <div className="space-y-1"><Label htmlFor="p1-date">Valeurs en vigueur au</Label><Input id="p1-date" type="date" value={date} onChange={e => setDate(e.target.value || today())} className="w-44" /></div>
                        {(reste.manque.length > 0 || reste.aVenir.length > 0) && (
                            <div className="flex-1 rounded-md border border-dashed p-3 text-sm">
                                {reste.manque.length > 0 && <p><span className="font-medium">Reste à faire :</span> {reste.manque.join(' · ')}</p>}
                                {reste.aVenir.length > 0 && <p className="text-muted-foreground">Prochain lot : {reste.aVenir.join(' · ')}</p>}
                            </div>
                        )}
                    </div>

                    <section className="space-y-2">
                        <h3 className="text-sm font-semibold">Site {view.site.code}</h3>
                        {rows('site', { scope: 'site', id: siteId }, view.siteDoc?.params)}
                    </section>

                    <section className="space-y-2">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold">Postes de consommation</h3>
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => {
                                const name = window.prompt('Désignation du poste (ex. « Chaufferie gaz ») ?');
                                if (name) run(() => addP1PosteAction(siteId, name), 'Poste créé');
                            }}><Plus className="mr-1 h-3 w-3" />Poste</Button>
                        </div>
                        {postes.length === 0 && <p className="text-sm text-muted-foreground">Aucun poste : la formule de NC (compteurs signés) et l'engagement (cible, DJU) se saisissent par poste.</p>}
                        {postes.map(p => (
                            <div key={p.id} className="space-y-1">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="font-medium">{p.designation}</span>
                                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
                                        const motif = window.prompt(`Retirer le poste « ${p.designation} » : motif ?`);
                                        if (motif) run(() => retireP1PosteAction(siteId, p.id, motif), 'Poste retiré');
                                    }}>Retirer</Button>
                                </div>
                                {rows('poste', { scope: 'poste', id: siteId, posteId: p.id }, p.params, undefined, meterCodes)}
                            </div>
                        ))}
                    </section>

                    <section className="space-y-2">
                        <h3 className="text-sm font-semibold">Compteurs</h3>
                        {view.meters.length === 0 && <p className="text-sm text-muted-foreground">Aucun compteur sur ce site.</p>}
                        {view.meters.map(m => (
                            <div key={m.id} className="space-y-1">
                                <p className="text-sm"><span className="font-mono">{m.code}</span> — {m.name}{m.unit ? ` (${m.unit})` : ''}</p>
                                {rows('meter', { scope: 'meter', id: m.id }, m.doc?.params)}
                            </div>
                        ))}
                    </section>

                    {view.contract && (
                        <section className="space-y-2">
                            <h3 className="text-sm font-semibold">Contrat {view.contract.code} <span className="font-normal text-muted-foreground">(commun à tous ses sites)</span></h3>
                            {rows('contract', { scope: 'contract', id: view.contract.id }, view.contractDoc?.params)}
                        </section>
                    )}
                </CardContent>
            )}

            <VersionDialog editing={editing} onClose={() => setEditing(null)} busy={busy} stations={weatherStations.map(s => s.code)}
                onSubmit={async (valeur, dateEffet, motif, document) => {
                    if (!editing) return;
                    const ok = await run(() => addP1VersionAction(editing.target, editing.key, { valeur, dateEffet, motif, document }), 'Version enregistrée');
                    if (ok) setEditing(null);
                }} />
        </Card>
    );
}

function ParamRow({ scope, paramKey, params, date, onAdd, onRetire }: {
    scope: P1Scope; paramKey: string; params: P1Params | undefined; date: string; onAdd: () => void; onRetire: (v: P1Version<unknown>) => void;
}) {
    const [history, setHistory] = useState(false);
    const def = P1_PARAMS[scope][paramKey];
    const versions = (params?.[paramKey] ?? []) as P1Version<unknown>[];
    const current = valeurAu(params, paramKey, date);
    return (
        <div className="px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
                <span className="w-56 text-muted-foreground" title={def.help}>{def.label}</span>
                <span className={`flex-1 ${current === null ? 'italic text-muted-foreground' : 'font-medium'}`}>{current === null ? 'non renseigné' : formatValue(scope, paramKey, current)}</span>
                {versions.length > 0 && <Button size="sm" variant="ghost" className="h-7 gap-1 px-2" onClick={() => setHistory(h => !h)}><History className="h-3 w-3" />{versions.length}</Button>}
                <Button size="sm" variant="outline" className="h-7 px-2" onClick={onAdd}><Plus className="h-3 w-3" /></Button>
            </div>
            {history && (
                <ul className="mt-2 space-y-1 border-l pl-3 text-xs">
                    {versions.map(v => (
                        <li key={v.id} className={v.retireLe ? 'text-muted-foreground line-through' : ''}>
                            <span className="font-medium">{frDay(v.dateEffet)}</span> : {formatValue(scope, paramKey, v.valeur)} — {v.motif}
                            {v.document ? <> — <a href={v.document} target="_blank" rel="noopener noreferrer" className="underline">pièce</a></> : null}
                            <span className="text-muted-foreground"> (saisi le {new Date(v.saisiLe).toLocaleDateString('fr-FR')} par {v.saisiPar})</span>
                            {v.retireLe
                                ? <span className="no-underline"> — retiré le {new Date(v.retireLe).toLocaleDateString('fr-FR')} par {v.retirePar} : {v.motifRetrait}</span>
                                : <Button size="sm" variant="link" className="h-auto p-0 pl-2 text-xs" onClick={() => onRetire(v)}>retirer</Button>}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function VersionDialog({ editing, onClose, onSubmit, busy, stations }: {
    editing: Editing; onClose: () => void; busy: boolean; stations: string[];
    onSubmit: (valeur: unknown, dateEffet: string | null, motif: string, document: string | null) => void;
}) {
    const [value, setValue] = useState('');
    const [dateEffet, setDateEffet] = useState('');
    const [motif, setMotif] = useState('');
    const [document, setDocument] = useState('');
    const [interessement, setInteressement] = useState<InteressementMarche[]>([]);
    useEffect(() => { setValue(''); setDateEffet(''); setMotif(''); setDocument(''); setInteressement([]); }, [editing]);
    const scope = editing?.target.scope;
    const def = editing && scope ? P1_PARAMS[scope][editing.key] : null;
    const marchesAvecInteressement = useMemo(() => TYPES_MARCHE.filter(m => EXIGENCES_MARCHE[m].bareme), []);
    if (!editing || !def) return null;

    const valeur = def.kind === 'interessement' ? interessement : value;
    return (
        <Dialog open onOpenChange={o => !o && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Nouvelle version : {editing.title}</DialogTitle>
                    <DialogDescription>{def.help ?? 'La version vaut à partir de sa date d\'effet ; les précédentes restent dans l\'historique.'}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-1">
                        <Label>Valeur{def.unit ? ` (${def.unit})` : ''}</Label>
                        {def.kind === 'enum' || def.kind === 'station' ? (
                            <Select value={value} onValueChange={setValue}>
                                <SelectTrigger><SelectValue placeholder="Choisir" /></SelectTrigger>
                                <SelectContent>{(def.kind === 'station' ? stations : def.options!).map(o => <SelectItem key={o} value={o}>{o.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
                            </Select>
                        ) : def.kind === 'interessement' ? (
                            <div className="space-y-2">
                                {interessement.map((i, k) => (
                                    <div key={k} className="grid grid-cols-4 items-center gap-2">
                                        <Select value={i.marche} onValueChange={v => setInteressement(l => l.map((x, n) => (n === k ? { ...x, marche: v as TypeMarche } : x)))}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>{marchesAvecInteressement.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                                        </Select>
                                        <Select value={i.repartition} onValueChange={v => setInteressement(l => l.map((x, n) => (n === k ? { ...x, repartition: v as InteressementMarche['repartition'] } : x)))}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>{REPARTITIONS.map(r => <SelectItem key={r} value={r}>{r === 'contrat' ? 'reste au contrat' : 'prorata NB'}</SelectItem>)}</SelectContent>
                                        </Select>
                                        <Input type="number" placeholder="plafond % P2" value={i.plafondPct ?? ''} onChange={e => setInteressement(l => l.map((x, n) => (n === k ? { ...x, plafondPct: e.target.value === '' ? null : Number(e.target.value) } : x)))} />
                                        <label className="flex items-center gap-1 text-xs"><Checkbox checked={i.plafonne} onCheckedChange={v => setInteressement(l => l.map((x, n) => (n === k ? { ...x, plafonne: !!v } : x)))} />plafonné</label>
                                    </div>
                                ))}
                                <Button type="button" size="sm" variant="outline" onClick={() => setInteressement(l => [...l, { marche: marchesAvecInteressement[0], repartition: 'contrat', plafondPct: null, plafonne: false }])}><Plus className="mr-1 h-3 w-3" />Marché</Button>
                            </div>
                        ) : (
                            <Input value={value} onChange={e => setValue(e.target.value)} placeholder={def.kind === 'formule' ? 'CPT-00012 + CPT-00013 - CPT-00020' : ''} inputMode={def.kind === 'text' || def.kind === 'formule' ? 'text' : 'decimal'} />
                        )}
                        {def.kind === 'formule' && editing.meterCodes && <p className="text-xs text-muted-foreground">Compteurs du site : {editing.meterCodes.join(', ') || 'aucun'}.</p>}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1"><Label htmlFor="p1-effet">Date d'effet</Label><Input id="p1-effet" type="date" value={dateEffet} onChange={e => setDateEffet(e.target.value)} /><p className="text-xs text-muted-foreground">Vide : valeur d'origine du marché.</p></div>
                        <div className="space-y-1"><Label htmlFor="p1-motif">Motif *</Label><Input id="p1-motif" value={motif} onChange={e => setMotif(e.target.value)} placeholder="contrat d'origine, avenant n°2…" /></div>
                    </div>
                    <div className="space-y-1"><Label htmlFor="p1-doc">Pièce justificative (lien)</Label><Input id="p1-doc" value={document} onChange={e => setDocument(e.target.value)} placeholder="facultatif" /></div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Annuler</Button>
                    <Button disabled={busy || !motif.trim()} onClick={() => onSubmit(valeur, dateEffet || null, motif, document.trim() || null)}>
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Enregistrer
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
