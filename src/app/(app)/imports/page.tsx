'use client';

import { useConfirm } from '@/components/confirm-provider';
import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { CheckCircle2, ChevronDown, ChevronUp, Download, FileSpreadsheet, KeyRound, Loader2, Upload } from 'lucide-react';
import { db } from '@/lib/firebase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useData } from '@/context/data-context';
import { GROUPES_IMPORT, IMPORT_ENTITIES, IMPORT_ENTITY_LIST, type ImportEntity, type ImportEntityKey, type RefList } from '@/lib/imports/definitions';
import { csvTemplate, csvToTable, errorsCsv, FORMATS } from '@/lib/imports/engine';
import { readXlsxTable, xlsxTemplate } from '@/lib/imports/xlsx';
import { applyImportAction, previewImportAction } from '@/lib/imports/actions';

type Preview = Extract<Awaited<ReturnType<typeof previewImportAction>>, { success: true }>['data'];
type Report = Extract<Awaited<ReturnType<typeof applyImportAction>>, { success: true }>['data'];
type Filter = 'all' | 'create' | 'update' | 'unchanged' | 'error';
type LogEntry = { id: string; entity: ImportEntityKey; fileName: string; at: string; by?: string; created: number; updated: number; unchanged: number; rejected: number };

const ACTION_LABELS = { create: 'Création', update: 'Mise à jour', unchanged: 'Inchangé', error: 'Erreur' } as const;

function download(content: BlobPart, name: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
}

export default function ImportsPage() {
    const confirmer = useConfirm();
    const { toast } = useToast();
    const { isAdmin, companies, agencies, sectors, typologies, meterTypes, activities, markets, schedules, terms, vatRates, paymentTerms, revisionRules, reloadData } = useData();
    const [entityKey, setEntityKey] = useState<ImportEntityKey>('clients');
    const [file, setFile] = useState<{ name: string; table: unknown[][] } | null>(null);
    const [preview, setPreview] = useState<Preview | null>(null);
    const [report, setReport] = useState<Report | null>(null);
    const [filter, setFilter] = useState<Filter>('all');
    const [busy, setBusy] = useState(false);
    const [history, setHistory] = useState<LogEntry[]>([]);
    const entity = IMPORT_ENTITIES[entityKey];

    const loadHistory = () => getDocs(query(collection(db, 'imports'), orderBy('at', 'desc'), limit(15)))
        .then(s => setHistory(s.docs.map(d => ({ id: d.id, ...d.data() }) as LogEntry)))
        .catch(() => setHistory([]));
    useEffect(() => { loadHistory(); }, []);

    const lists: Partial<Record<RefList, string[]>> = useMemo(() => ({
        companies: companies.map(c => c.code || c.name),
        agencies: [...new Set(agencies.map(a => a.name))].sort(),
        sectors: [...new Set(sectors.map(s => s.name))].sort(),
        typologies: typologies.map(t => t.name).sort(),
        meterTypes: meterTypes.map(t => t.code || t.label),
        activities: activities.map(a => a.code || a.label),
        markets: markets.map(m => m.code || m.label),
        schedules: schedules.map(s => s.name).sort(),
        terms: terms.map(t => t.name).sort(),
        vatRates: vatRates.map(v => v.code),
        paymentTerms: paymentTerms.map(t => t.code),
        revisionRules: revisionRules.map(r => r.code),
    }), [companies, agencies, sectors, typologies, meterTypes, activities, markets, schedules, terms, vatRates, paymentTerms, revisionRules]);

    const reset = () => { setFile(null); setPreview(null); setReport(null); setFilter('all'); };

    const onFile = async (f: File) => {
        reset();
        setBusy(true);
        try {
            const table = /\.xlsx$/i.test(f.name) ? await readXlsxTable(await f.arrayBuffer()) : csvToTable(await f.text());
            setFile({ name: f.name, table });
            const result = await previewImportAction(entityKey, table);
            if (!result.success) throw new Error(result.error);
            setPreview(result.data);
        } catch (e) {
            toast({ title: 'Lecture impossible', description: (e as Error).message, variant: 'destructive' });
        } finally {
            setBusy(false);
        }
    };

    const apply = async () => {
        if (!file || !preview) return;
        const n = preview.counts.create + preview.counts.update;
        if (!(await confirmer({
            title: `Importer ${n} ligne(s) ?`,
            description: `${preview.counts.create} création(s), ${preview.counts.update} mise(s) à jour.${preview.counts.error ? ` ${preview.counts.error} ligne(s) en erreur seront ignorées.` : ''}`,
            confirmLabel: 'Importer',
        }))) return;
        setBusy(true);
        const result = await applyImportAction(entityKey, file.table, file.name);
        setBusy(false);
        if (!result.success) {
            toast({ title: 'Import impossible', description: result.error, variant: 'destructive' });
            return;
        }
        setReport(result.data);
        setPreview(null);
        loadHistory();
        await reloadData();
        toast({ title: 'Import terminé', description: `${result.data.created} créé(s), ${result.data.updated} mis à jour.` });
    };

    if (!isAdmin) return <p className="text-muted-foreground">Les imports sont réservés aux administrateurs.</p>;

    const items = preview?.items.filter(i => filter === 'all' || i.action === filter) ?? [];
    const errorItems = preview?.items.filter(i => i.action === 'error') ?? [];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Imports</h1>
                <p className="text-muted-foreground">
                    Import en masse depuis un fichier CSV ou Excel : téléchargez le modèle, remplissez-le, déposez-le, vérifiez l'aperçu, puis importez.
                    Une cellule vide conserve la valeur existante.
                </p>
            </div>

            <div className="space-y-4">
                {GROUPES_IMPORT.map(g => (
                    <div key={g} className="space-y-2">
                        <h2 className="text-sm font-semibold text-muted-foreground">{g}</h2>
                        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                            {IMPORT_ENTITY_LIST.filter(e => e.groupe === g).map(e => (
                                <button key={e.key} type="button" onClick={() => { setEntityKey(e.key); reset(); }}
                                    className={`rounded-lg border p-3 text-left transition-colors ${e.key === entityKey ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}>
                                    <p className="font-medium">{e.label}</p>
                                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{e.resume}</p>
                                    <p className="mt-1 text-[11px] text-muted-foreground">{e.fields.length} colonnes · {e.fields.filter(f => f.required === 'create').length} obligatoires</p>
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{entity.label}</CardTitle>
                    <CardDescription>{entity.resume}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2 text-sm">
                        <div>
                            <p className="font-medium mb-1">Mode d&apos;emploi</p>
                            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">{entity.usage.map(u => <li key={u}>{u}</li>)}</ul>
                        </div>
                        <div>
                            <p className="font-medium mb-1">Création ou mise à jour ?</p>
                            <p className="text-muted-foreground">{entity.matching}</p>
                            <p className="mt-2 text-muted-foreground">
                                <span className="font-medium text-foreground">Clés</span> (par priorité) : {entity.cles.map(k => entity.fields.find(f => f.key === k)?.label ?? k).join(', ')}.
                                {' '}Les colonnes <Badge variant="destructive" className="px-1 py-0 text-[10px]">Obligatoire</Badge> sont nécessaires pour créer ; en mise à jour, une clé suffit et une cellule vide conserve la valeur.
                                {' '}Dans les modèles, elles sont marquées « * ».
                            </p>
                        </div>
                    </div>
                    <Colonnes entity={entity} />
                    <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" onClick={() => download(csvTemplate(entity), `modele-import-${entity.key}.csv`, 'text/csv;charset=utf-8')}>
                        <Download className="mr-2 h-4 w-4" />Modèle CSV
                    </Button>
                    <Button variant="outline" onClick={async () => {
                        try {
                            download(await xlsxTemplate(entity, lists), `modele-import-${entity.key}.xlsx`,
                                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                        } catch (e) {
                            toast({ title: 'Modèle indisponible', description: (e as Error).message, variant: 'destructive' });
                        }
                    }}>
                        <FileSpreadsheet className="mr-2 h-4 w-4" />Modèle Excel (avec notice et listes)
                    </Button>
                    <Button asChild disabled={busy}>
                        <label className="cursor-pointer">
                            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Déposer un fichier
                            <input type="file" accept=".csv,.xlsx,text/csv" className="hidden"
                                onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
                        </label>
                    </Button>
                    {file && <span className="text-sm text-muted-foreground">{file.name}</span>}
                    </div>
                </CardContent>
            </Card>

            {preview && (
                <Card>
                    <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
                        <div>
                            <CardTitle className="text-base">Aperçu</CardTitle>
                            <CardDescription>Rien n'est encore écrit. Les lignes en erreur seront ignorées.</CardDescription>
                        </div>
                        <div className="flex gap-2">
                            {errorItems.length > 0 && (
                                <Button variant="outline" onClick={() => download(errorsCsv(errorItems), `erreurs-${entity.key}.csv`, 'text/csv;charset=utf-8')}>
                                    <Download className="mr-2 h-4 w-4" />Erreurs (CSV)
                                </Button>
                            )}
                            <Button disabled={busy || preview.counts.create + preview.counts.update === 0} onClick={apply}>
                                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Importer
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {preview.fileErrors.map(m => <p key={m} className="text-sm text-destructive">{m}</p>)}
                        {preview.missingColumns.length > 0 && (
                            <p className="text-sm text-amber-600">Colonnes absentes (création impossible, mise à jour seulement) : {preview.missingColumns.join(', ')}.</p>
                        )}
                        {preview.ignoredColumns.length > 0 && (
                            <p className="text-sm text-muted-foreground">Colonnes ignorées (non reconnues) : {preview.ignoredColumns.join(', ')}.</p>
                        )}
                        <div className="flex flex-wrap gap-2">
                            {(['all', 'create', 'update', 'unchanged', 'error'] as Filter[]).map(f => (
                                <Button key={f} size="sm" variant={filter === f ? 'default' : 'outline'} onClick={() => setFilter(f)}>
                                    {f === 'all' ? `Tout (${preview.items.length})` : `${ACTION_LABELS[f]} (${preview.counts[f]})`}
                                </Button>
                            ))}
                        </div>
                        <Table>
                            <TableHeader><TableRow><TableHead className="w-16">Ligne</TableHead><TableHead className="w-32">Action</TableHead><TableHead>Élément</TableHead><TableHead>Détail</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {items.slice(0, 500).map(i => (
                                    <TableRow key={i.line}>
                                        <TableCell>{i.line}</TableCell>
                                        <TableCell><Badge variant={i.action === 'error' ? 'destructive' : i.action === 'create' ? 'default' : 'secondary'}>{ACTION_LABELS[i.action]}</Badge></TableCell>
                                        <TableCell>{i.label}</TableCell>
                                        <TableCell className="text-sm">
                                            {i.messages.map(m => <p key={m} className="text-destructive">{m}</p>)}
                                            {i.warnings.map(m => <p key={m} className="text-amber-600">{m}</p>)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        {items.length > 500 && <p className="text-xs text-muted-foreground">500 premières lignes affichées.</p>}
                    </CardContent>
                </Card>
            )}

            {report && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-5 w-5 text-green-600" />Import terminé</CardTitle>
                        <CardDescription>
                            {report.created} créé(s), {report.updated} mis à jour, {report.unchanged} inchangé(s), {report.errors.length} ligne(s) ignorée(s).
                        </CardDescription>
                    </CardHeader>
                    {report.errors.length > 0 && (
                        <CardContent>
                            <Button variant="outline" onClick={() => download(errorsCsv(report.errors), `erreurs-${entity.key}.csv`, 'text/csv;charset=utf-8')}>
                                <Download className="mr-2 h-4 w-4" />Lignes ignorées (CSV)
                            </Button>
                        </CardContent>
                    )}
                </Card>
            )}

            <Card>
                <CardHeader><CardTitle className="text-base">Derniers imports</CardTitle></CardHeader>
                <CardContent>
                    {history.length === 0 ? <p className="text-sm text-muted-foreground">Aucun import.</p> : (
                        <Table>
                            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Données</TableHead><TableHead>Fichier</TableHead><TableHead>Par</TableHead><TableHead className="text-right">Créés / mis à jour / ignorés</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {history.map(h => (
                                    <TableRow key={h.id}>
                                        <TableCell className="text-sm">{new Date(h.at).toLocaleString('fr-FR')}</TableCell>
                                        <TableCell>{IMPORT_ENTITIES[h.entity]?.label ?? h.entity}</TableCell>
                                        <TableCell className="text-sm">{h.fileName}</TableCell>
                                        <TableCell className="text-sm">{h.by ?? ''}</TableCell>
                                        <TableCell className="text-right">{h.created} / {h.updated} / {h.rejected}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

/** Colonnes d'un import : statut (obligatoire, clé), format, valeurs possibles, exemple, aide. */
function Colonnes({ entity }: { entity: ImportEntity }) {
    const [ouvert, setOuvert] = useState(false);
    const [essentielles, setEssentielles] = useState(false);
    useEffect(() => { setOuvert(false); setEssentielles(false); }, [entity.key]);
    const cles = new Set(entity.cles);
    const champs = entity.fields.filter(f => !essentielles || f.required === 'create' || cles.has(f.key));
    return (
        <div className="rounded-md border">
            <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium" onClick={() => setOuvert(o => !o)}>
                <span>Colonnes du modèle ({entity.fields.length}) : rôle, format et exemple de chacune</span>
                {ouvert ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {ouvert && (
                <div className="border-t p-3 space-y-2">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input type="checkbox" checked={essentielles} onChange={e => setEssentielles(e.target.checked)} />
                        Seulement les colonnes obligatoires et les clés
                    </label>
                    <Table>
                        <TableHeader><TableRow>
                            <TableHead className="w-64">Colonne</TableHead><TableHead className="w-40">Format</TableHead><TableHead>Rôle et valeurs</TableHead><TableHead className="w-40">Exemple</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                            {champs.map(f => (
                                <TableRow key={f.key}>
                                    <TableCell className="align-top">
                                        <span className="font-medium">{f.label}</span>
                                        <span className="mt-1 flex flex-wrap gap-1">
                                            {f.required === 'create' && <Badge variant="destructive" className="px-1 py-0 text-[10px]">Obligatoire</Badge>}
                                            {cles.has(f.key) && <Badge variant="outline" className="gap-0.5 px-1 py-0 text-[10px]"><KeyRound className="h-2.5 w-2.5" />Clé</Badge>}
                                        </span>
                                    </TableCell>
                                    <TableCell className="align-top text-xs text-muted-foreground">{FORMATS[f.type]}</TableCell>
                                    <TableCell className="align-top text-xs">
                                        {f.help && <p>{f.help}</p>}
                                        {f.options && <p className="text-muted-foreground">Valeurs : {f.options.map(o => o.label).join(', ')}.</p>}
                                        {f.refList && <p className="text-muted-foreground">Valeurs du paramétrage : onglet « Listes » du modèle Excel.</p>}
                                    </TableCell>
                                    <TableCell className="align-top font-mono text-xs">{f.example ?? ''}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}

