'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useData } from '@/context/data-context';
import { downloadCSV } from '@/lib/utils';
import { NumberField } from '@/components/quotes/number-field';
import { formatEur } from '@/components/quotes/format';
import { ARTICLE_KINDS, type PriceArticle, type PriceWork } from '@/lib/library/types';
import { parseArticlesCsv, planImport, type ImportResult } from '@/lib/library/insert';
import { QUOTE_LINE_KIND_LABELS, type ComponentKind } from '@/lib/quotes/types';
import { applyArticleImport, getArticles, getWorks, saveArticle, saveWork, setActive } from '@/services/library';

const ALL = '__all__';
const emptyArticle = (): Omit<PriceArticle, 'id' | 'createdAt' | 'updatedAt'> => ({ code: '', label: '', kind: 'FOURNITURE', unit: 'u', unitCost: null, active: true });
const emptyWork = (): Omit<PriceWork, 'id' | 'createdAt' | 'updatedAt'> => ({ code: '', label: '', unit: 'u', components: [], active: true });

export default function LibraryPage() {
    const { toast } = useToast();
    const { currentUser } = useData();
    const [articles, setArticles] = useState<PriceArticle[]>([]);
    const [works, setWorks] = useState<PriceWork[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        const [a, w] = await Promise.all([getArticles(), getWorks()]);
        setArticles(a);
        setWorks(w);
        setLoading(false);
    }, []);
    useEffect(() => {
        load().catch(() => { setLoading(false); toast({ title: 'Erreur', description: 'Impossible de charger la bibliothèque.', variant: 'destructive' }); });
    }, [load, toast]);

    if (loading) return <Loader2 className="mx-auto mt-24 h-8 w-8 animate-spin" />;

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Bibliothèque de prix</h1>
                <p className="text-muted-foreground">
                    Articles et ouvrages réutilisables dans les devis. Ils y sont recopiés : modifier la bibliothèque ne change pas les devis existants.
                </p>
            </div>
            <Tabs defaultValue="articles">
                <TabsList>
                    <TabsTrigger value="articles">Articles ({articles.filter(a => a.active).length})</TabsTrigger>
                    <TabsTrigger value="works">Ouvrages ({works.filter(w => w.active).length})</TabsTrigger>
                </TabsList>
                <TabsContent value="articles"><ArticlesTab articles={articles} user={currentUser?.email} onChange={load} toast={toast} /></TabsContent>
                <TabsContent value="works"><WorksTab works={works} articles={articles} user={currentUser?.email} onChange={load} toast={toast} /></TabsContent>
            </Tabs>
        </div>
    );
}

type Toast = ReturnType<typeof useToast>['toast'];

function ArticlesTab({ articles, user, onChange, toast }: { articles: PriceArticle[]; user?: string; onChange: () => Promise<void>; toast: Toast }) {
    const [search, setSearch] = useState('');
    const [kind, setKind] = useState<ComponentKind | typeof ALL>(ALL);
    const [family, setFamily] = useState(ALL);
    const [showInactive, setShowInactive] = useState(false);
    const [editing, setEditing] = useState<{ previous: PriceArticle | null; draft: ReturnType<typeof emptyArticle> } | null>(null);
    const [importing, setImporting] = useState<ImportResult | null>(null);
    const [busy, setBusy] = useState(false);

    const families = useMemo(() => [...new Set(articles.map(a => a.family).filter(Boolean) as string[])].sort(), [articles]);
    const visible = useMemo(() => {
        const s = search.trim().toLowerCase();
        return articles
            .filter(a => showInactive || a.active)
            .filter(a => kind === ALL || a.kind === kind)
            .filter(a => family === ALL || a.family === family)
            .filter(a => !s || [a.code, a.label, a.supplier, a.supplierRef, a.family].some(v => (v ?? '').toLowerCase().includes(s)));
    }, [articles, search, kind, family, showInactive]);
    const plan = useMemo(() => (importing ? planImport(importing.rows, articles) : null), [importing, articles]);

    const save = async () => {
        if (!editing) return;
        const d = editing.draft;
        if (!d.label.trim() || !d.unit.trim()) { toast({ title: 'Libellé et unité obligatoires', variant: 'destructive' }); return; }
        if (d.kind !== 'MAIN_OEUVRE' && d.unitCost === null) { toast({ title: "Déboursé obligatoire (sauf main-d'œuvre)", variant: 'destructive' }); return; }
        setBusy(true);
        try {
            await saveArticle({ ...d, code: d.code.trim(), label: d.label.trim(), unit: d.unit.trim(),
                family: d.family?.trim() || undefined, supplier: d.supplier?.trim() || undefined,
                supplierRef: d.supplierRef?.trim() || undefined, description: d.description?.trim() || undefined }, editing.previous, user);
            setEditing(null);
            await onChange();
            toast({ title: 'Article enregistré' });
        } catch (e) {
            toast({ title: 'Enregistrement impossible', description: (e as Error).message, variant: 'destructive' });
        } finally { setBusy(false); }
    };

    const readFile = async (file: File) => setImporting(parseArticlesCsv(await file.text()));
    const runImport = async () => {
        if (!plan) return;
        setBusy(true);
        try {
            const r = await applyArticleImport(plan, user);
            setImporting(null);
            await onChange();
            toast({ title: 'Import terminé', description: `${r.created} créé(s), ${r.updated} mis à jour.` });
        } catch (e) {
            toast({ title: 'Import impossible', description: (e as Error).message, variant: 'destructive' });
        } finally { setBusy(false); }
    };

    const exportCsv = () => downloadCSV(visible.map(a => ({
        code: a.code, libelle: a.label, nature: QUOTE_LINE_KIND_LABELS[a.kind], unite: a.unit,
        debourse: a.unitCost === null ? '' : String(a.unitCost).replace('.', ','),
        famille: a.family ?? '', fournisseur: a.supplier ?? '', ref_fournisseur: a.supplierRef ?? '', actif: a.active ? 'oui' : 'non',
    })), `articles-${new Date().toISOString().slice(0, 10)}.csv`);

    const d = editing?.draft;
    const setD = (patch: Partial<ReturnType<typeof emptyArticle>>) => setEditing(e => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

    return (
        <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
                <div>
                    <CardTitle className="text-base">Articles</CardTitle>
                    <CardDescription>Fournitures, main-d'œuvre, sous-traitance, divers : déboursé HT (coût), le prix de vente se calcule dans chaque devis.</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={exportCsv}><Download className="mr-2 h-4 w-4" />Exporter</Button>
                    <Button variant="outline" asChild>
                        <label className="cursor-pointer"><Upload className="mr-2 h-4 w-4" />Importer un CSV
                            <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ''; }} />
                        </label>
                    </Button>
                    <Button onClick={() => setEditing({ previous: null, draft: emptyArticle() })}><Plus className="mr-2 h-4 w-4" />Nouvel article</Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                    <Input className="max-w-xs" placeholder="Code, libellé, fournisseur…" value={search} onChange={e => setSearch(e.target.value)} />
                    <Select value={kind} onValueChange={v => setKind(v as ComponentKind | typeof ALL)}>
                        <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL}>Toutes natures</SelectItem>
                            {ARTICLE_KINDS.map(k => <SelectItem key={k} value={k}>{QUOTE_LINE_KIND_LABELS[k]}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    {families.length > 0 && (
                        <Select value={family} onValueChange={setFamily}>
                            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL}>Toutes familles</SelectItem>
                                {families.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    )}
                    <label className="flex items-center gap-2 text-sm"><Checkbox checked={showInactive} onCheckedChange={v => setShowInactive(v === true)} />Inactifs</label>
                </div>
                <Table>
                    <TableHeader><TableRow>
                        <TableHead>Code</TableHead><TableHead>Libellé</TableHead><TableHead>Nature</TableHead><TableHead>Unité</TableHead>
                        <TableHead className="text-right">Déboursé</TableHead><TableHead>Famille</TableHead><TableHead>Fournisseur</TableHead><TableHead />
                    </TableRow></TableHeader>
                    <TableBody>
                        {visible.length === 0 && <TableRow><TableCell colSpan={8} className="h-20 text-center text-muted-foreground">Aucun article.</TableCell></TableRow>}
                        {visible.map(a => (
                            <TableRow key={a.id} className={a.active ? '' : 'text-muted-foreground'}>
                                <TableCell className="font-mono text-xs">{a.code}</TableCell>
                                <TableCell>{a.label}{!a.active && <Badge variant="outline" className="ml-2">Inactif</Badge>}</TableCell>
                                <TableCell className="text-xs">{QUOTE_LINE_KIND_LABELS[a.kind]}</TableCell>
                                <TableCell>{a.unit}</TableCell>
                                <TableCell className="text-right">{a.unitCost === null ? <span className="text-xs text-muted-foreground">coût horaire du devis</span> : formatEur(a.unitCost)}</TableCell>
                                <TableCell className="text-xs">{a.family ?? ''}</TableCell>
                                <TableCell className="text-xs">{[a.supplier, a.supplierRef].filter(Boolean).join(' — ')}</TableCell>
                                <TableCell className="whitespace-nowrap text-right">
                                    <Button size="icon" variant="ghost" aria-label="Modifier" onClick={() => setEditing({ previous: a, draft: { ...a } })}><Pencil className="h-4 w-4" /></Button>
                                    <Button size="sm" variant="ghost" onClick={async () => { await setActive('article', a.id, !a.active, user); await onChange(); }}>
                                        {a.active ? 'Désactiver' : 'Réactiver'}
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>

            <Dialog open={!!editing} onOpenChange={o => !o && setEditing(null)}>
                <DialogContent>
                    <DialogHeader><DialogTitle>{editing?.previous ? `Article ${editing.previous.code}` : 'Nouvel article'}</DialogTitle></DialogHeader>
                    {d && (
                        <div className="grid gap-3 md:grid-cols-2">
                            <div className="space-y-1"><Label htmlFor="a-code">Code</Label>
                                <Input id="a-code" placeholder="Vide : attribué (ART-00001)" value={d.code} onChange={e => setD({ code: e.target.value })} /></div>
                            <div className="space-y-1"><Label>Nature</Label>
                                <Select value={d.kind} onValueChange={v => setD({ kind: v as ComponentKind })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>{ARTICLE_KINDS.map(k => <SelectItem key={k} value={k}>{QUOTE_LINE_KIND_LABELS[k]}</SelectItem>)}</SelectContent>
                                </Select></div>
                            <div className="space-y-1 md:col-span-2"><Label htmlFor="a-label">Libellé *</Label>
                                <Input id="a-label" value={d.label} onChange={e => setD({ label: e.target.value })} /></div>
                            <div className="space-y-1"><Label htmlFor="a-unit">Unité *</Label>
                                <Input id="a-unit" placeholder="u, m, m², h, ens…" value={d.unit} onChange={e => setD({ unit: e.target.value })} /></div>
                            <div className="space-y-1"><Label>Déboursé HT {d.kind === 'MAIN_OEUVRE' ? '(vide : coût horaire du devis)' : '*'}</Label>
                                <NumberField value={d.unitCost} onChange={v => setD({ unitCost: v })} /></div>
                            <div className="space-y-1"><Label htmlFor="a-family">Famille</Label>
                                <Input id="a-family" list="families" value={d.family ?? ''} onChange={e => setD({ family: e.target.value })} />
                                <datalist id="families">{families.map(f => <option key={f} value={f} />)}</datalist></div>
                            <div className="space-y-1"><Label htmlFor="a-supplier">Fournisseur</Label>
                                <Input id="a-supplier" value={d.supplier ?? ''} onChange={e => setD({ supplier: e.target.value })} /></div>
                            <div className="space-y-1"><Label htmlFor="a-ref">Réf. fournisseur</Label>
                                <Input id="a-ref" value={d.supplierRef ?? ''} onChange={e => setD({ supplierRef: e.target.value })} /></div>
                            <div className="space-y-1 md:col-span-2"><Label htmlFor="a-desc">Description (reprise sur le devis)</Label>
                                <Textarea id="a-desc" rows={2} value={d.description ?? ''} onChange={e => setD({ description: e.target.value })} /></div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditing(null)}>Annuler</Button>
                        <Button disabled={busy} onClick={save}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Enregistrer</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!importing} onOpenChange={o => !o && setImporting(null)}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Importer des articles</DialogTitle>
                        <DialogDescription>
                            Colonnes : code, libellé, unité (obligatoires), déboursé, nature, famille, fournisseur, réf. fournisseur, description.
                            Un code existant est mis à jour ; une colonne facultative vide conserve la valeur actuelle.
                        </DialogDescription>
                    </DialogHeader>
                    {importing && plan && (
                        <div className="space-y-3 text-sm">
                            <p>
                                <strong>{plan.creates.length}</strong> à créer, <strong>{plan.updates.length}</strong> à mettre à jour
                                {plan.updates.some(u => u.costChange) && <> (dont <strong>{plan.updates.filter(u => u.costChange).length}</strong> changements de déboursé)</>},
                                {' '}<strong>{plan.unchanged}</strong> inchangé(s).
                            </p>
                            {plan.updates.filter(u => u.costChange).slice(0, 8).map(u => (
                                <p key={u.article.id} className="text-muted-foreground">
                                    {u.article.code} : {u.article.unitCost === null ? '—' : formatEur(u.article.unitCost)} → {u.row.unitCost === null ? '—' : formatEur(u.row.unitCost)}
                                </p>
                            ))}
                            {importing.errors.length > 0 && (
                                <div className="max-h-40 overflow-auto rounded-md border p-2">
                                    <p className="font-medium text-destructive">{importing.errors.length} ligne(s) ignorée(s) :</p>
                                    {importing.errors.map(e => <p key={`${e.line}-${e.message}`} className="text-destructive">Ligne {e.line} : {e.message}</p>)}
                                </div>
                            )}
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setImporting(null)}>Annuler</Button>
                        <Button disabled={busy || !plan || plan.creates.length + plan.updates.length === 0} onClick={runImport}>
                            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Importer
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}

function WorksTab({ works, articles, user, onChange, toast }: { works: PriceWork[]; articles: PriceArticle[]; user?: string; onChange: () => Promise<void>; toast: Toast }) {
    const [search, setSearch] = useState('');
    const [showInactive, setShowInactive] = useState(false);
    const [editing, setEditing] = useState<{ previous: PriceWork | null; draft: ReturnType<typeof emptyWork> } | null>(null);
    const [pick, setPick] = useState('');
    const [busy, setBusy] = useState(false);
    const byId = useMemo(() => new Map(articles.map(a => [a.id, a])), [articles]);

    const visible = useMemo(() => {
        const s = search.trim().toLowerCase();
        return works.filter(w => showInactive || w.active)
            .filter(w => !s || [w.code, w.label, w.family].some(v => (v ?? '').toLowerCase().includes(s)));
    }, [works, search, showInactive]);

    /** Déboursé des fournitures (et sous-traitance, divers) et heures de main-d'œuvre, par unité d'ouvrage. */
    const summary = (w: Pick<PriceWork, 'components'>) => {
        let cost = 0, hours = 0, missing = 0;
        for (const c of w.components) {
            const a = byId.get(c.articleId);
            if (!a) { missing++; continue; }
            if (a.kind === 'MAIN_OEUVRE' && a.unitCost === null) hours += c.quantity;
            else cost += c.quantity * (a.unitCost ?? 0);
        }
        return { cost: Math.round(cost * 100) / 100, hours: Math.round(hours * 100) / 100, missing };
    };

    const matches = useMemo(() => {
        const s = pick.trim().toLowerCase();
        if (!s) return [];
        return articles.filter(a => a.active && [a.code, a.label].some(v => v.toLowerCase().includes(s))).slice(0, 8);
    }, [articles, pick]);

    const d = editing?.draft;
    const setD = (patch: Partial<ReturnType<typeof emptyWork>>) => setEditing(e => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

    const save = async () => {
        if (!editing) return;
        const w = editing.draft;
        if (!w.label.trim() || !w.unit.trim()) { toast({ title: 'Libellé et unité obligatoires', variant: 'destructive' }); return; }
        setBusy(true);
        try {
            await saveWork({ ...w, code: w.code.trim(), label: w.label.trim(), unit: w.unit.trim(),
                family: w.family?.trim() || undefined, description: w.description?.trim() || undefined }, editing.previous, user);
            setEditing(null);
            await onChange();
            toast({ title: 'Ouvrage enregistré' });
        } catch (e) {
            toast({ title: 'Enregistrement impossible', description: (e as Error).message, variant: 'destructive' });
        } finally { setBusy(false); }
    };

    return (
        <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
                <div>
                    <CardTitle className="text-base">Ouvrages</CardTitle>
                    <CardDescription>Un ouvrage regroupe des articles pour une unité (ex. « Pose d'un radiateur ») ; il apparaît sur une seule ligne du devis.</CardDescription>
                </div>
                <Button onClick={() => setEditing({ previous: null, draft: emptyWork() })}><Plus className="mr-2 h-4 w-4" />Nouvel ouvrage</Button>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                    <Input className="max-w-xs" placeholder="Code, libellé, famille…" value={search} onChange={e => setSearch(e.target.value)} />
                    <label className="flex items-center gap-2 text-sm"><Checkbox checked={showInactive} onCheckedChange={v => setShowInactive(v === true)} />Inactifs</label>
                </div>
                <Table>
                    <TableHeader><TableRow>
                        <TableHead>Code</TableHead><TableHead>Libellé</TableHead><TableHead>Unité</TableHead><TableHead>Composition</TableHead>
                        <TableHead className="text-right">Déboursé / unité</TableHead><TableHead />
                    </TableRow></TableHeader>
                    <TableBody>
                        {visible.length === 0 && <TableRow><TableCell colSpan={6} className="h-20 text-center text-muted-foreground">Aucun ouvrage.</TableCell></TableRow>}
                        {visible.map(w => {
                            const s = summary(w);
                            return (
                                <TableRow key={w.id} className={w.active ? '' : 'text-muted-foreground'}>
                                    <TableCell className="font-mono text-xs">{w.code}</TableCell>
                                    <TableCell>{w.label}{!w.active && <Badge variant="outline" className="ml-2">Inactif</Badge>}</TableCell>
                                    <TableCell>{w.unit}</TableCell>
                                    <TableCell className="text-xs">{w.components.length} article(s){s.missing > 0 && <span className="text-destructive"> — {s.missing} introuvable(s)</span>}</TableCell>
                                    <TableCell className="text-right text-sm">{formatEur(s.cost)}{s.hours > 0 && ` + ${s.hours.toLocaleString('fr-FR')} h`}</TableCell>
                                    <TableCell className="whitespace-nowrap text-right">
                                        <Button size="icon" variant="ghost" aria-label="Modifier" onClick={() => setEditing({ previous: w, draft: { ...w, components: [...w.components] } })}><Pencil className="h-4 w-4" /></Button>
                                        <Button size="sm" variant="ghost" onClick={async () => { await setActive('work', w.id, !w.active, user); await onChange(); }}>{w.active ? 'Désactiver' : 'Réactiver'}</Button>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </CardContent>

            <Dialog open={!!editing} onOpenChange={o => !o && setEditing(null)}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader><DialogTitle>{editing?.previous ? `Ouvrage ${editing.previous.code}` : 'Nouvel ouvrage'}</DialogTitle></DialogHeader>
                    {d && (
                        <div className="space-y-4">
                            <div className="grid gap-3 md:grid-cols-3">
                                <div className="space-y-1"><Label htmlFor="w-code">Code</Label>
                                    <Input id="w-code" placeholder="Vide : OUV-00001" value={d.code} onChange={e => setD({ code: e.target.value })} /></div>
                                <div className="space-y-1 md:col-span-2"><Label htmlFor="w-label">Libellé *</Label>
                                    <Input id="w-label" value={d.label} onChange={e => setD({ label: e.target.value })} /></div>
                                <div className="space-y-1"><Label htmlFor="w-unit">Unité *</Label>
                                    <Input id="w-unit" value={d.unit} onChange={e => setD({ unit: e.target.value })} /></div>
                                <div className="space-y-1 md:col-span-2"><Label htmlFor="w-family">Famille</Label>
                                    <Input id="w-family" value={d.family ?? ''} onChange={e => setD({ family: e.target.value })} /></div>
                                <div className="space-y-1 md:col-span-3"><Label htmlFor="w-desc">Description (reprise sur le devis)</Label>
                                    <Textarea id="w-desc" rows={2} value={d.description ?? ''} onChange={e => setD({ description: e.target.value })} /></div>
                            </div>
                            <div className="space-y-2">
                                <Label>Composition (quantités pour 1 {d.unit || 'unité'})</Label>
                                {d.components.map((c, i) => {
                                    const a = byId.get(c.articleId);
                                    return (
                                        <div key={`${c.articleId}-${i}`} className="grid grid-cols-[1fr_7rem_auto] items-center gap-2 text-sm">
                                            <span>{a ? <><span className="font-mono text-xs">{a.code}</span> {a.label} <span className="text-muted-foreground">({QUOTE_LINE_KIND_LABELS[a.kind]}, {a.unit})</span></> : <span className="text-destructive">Article introuvable</span>}</span>
                                            <NumberField ariaLabel="Quantité" value={c.quantity} onChange={v => setD({ components: d.components.map((x, j) => (j === i ? { ...x, quantity: v ?? 0 } : x)) })} />
                                            <Button size="icon" variant="ghost" aria-label="Retirer" onClick={() => setD({ components: d.components.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
                                        </div>
                                    );
                                })}
                                <Input placeholder="Ajouter un article : code ou libellé…" value={pick} onChange={e => setPick(e.target.value)} />
                                {matches.length > 0 && (
                                    <ul className="rounded-md border divide-y text-sm">
                                        {matches.map(a => (
                                            <li key={a.id}><button type="button" className="w-full px-3 py-1.5 text-left hover:bg-muted"
                                                onClick={() => { setD({ components: [...d.components, { articleId: a.id, quantity: 1 }] }); setPick(''); }}>
                                                <span className="font-mono text-xs">{a.code}</span> {a.label} — {a.unitCost === null ? 'coût horaire' : formatEur(a.unitCost)} / {a.unit}
                                            </button></li>
                                        ))}
                                    </ul>
                                )}
                                {d.components.length > 0 && (() => { const s = summary(d); return (
                                    <p className="text-sm text-muted-foreground">Déboursé par {d.unit || 'unité'} : {formatEur(s.cost)}{s.hours > 0 && ` + ${s.hours.toLocaleString('fr-FR')} h de main-d'œuvre (coût horaire du devis)`}</p>
                                ); })()}
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditing(null)}>Annuler</Button>
                        <Button disabled={busy || !d?.components.length} onClick={save}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Enregistrer</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
