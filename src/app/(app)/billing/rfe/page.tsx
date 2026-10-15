'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Download, FileText, MoreHorizontal, RefreshCw, Send, ShieldOff, XCircle } from 'lucide-react';
import { useData } from '@/context/data-context';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
    buildEInvoicingRows, canRecompute, canTransition, CHANNEL_LABELS, REGIME_SHORT_LABELS, resolveEInvoicing, STATUS_LABELS,
    type EInvoicingRow,
} from '@/lib/einvoicing';
import { recomputeEInvoicing, updateEInvoicingStatus, type BatchResult } from '@/lib/billing/einvoicing-actions';
import type { EInvoicingChannel, EInvoicingStatus } from '@/lib/types';
import { downloadCSV } from '@/lib/utils';

type StatusFilter = 'actionable' | 'blocked' | EInvoicingStatus | 'all';
type PendingAction = { status: 'sent' | 'rejected' | 'to_send' } | null;

const STATUS_VARIANTS: Record<EInvoicingStatus, 'default' | 'secondary' | 'destructive' | 'outline' | 'warning'> = {
    to_send: 'default',
    sent: 'secondary',
    rejected: 'destructive',
    not_applicable: 'outline',
};

const ADDRESS_SOURCE_LABELS = { contract: 'contrat', client: 'client', siren: 'SIREN' } as const;

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const day = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'UTC' });

export default function EInvoicingDashboardPage() {
    const { invoices, creditNotes, clients, contracts, typologies, companies, isLoading, reloadData } = useData();
    const { toast } = useToast();

    const [companyId, setCompanyId] = useState('all');
    const [channel, setChannel] = useState<EInvoicingChannel | 'all'>('all');
    const [status, setStatus] = useState<StatusFilter>('actionable');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [pending, setPending] = useState<PendingAction>(null);
    const [reference, setReference] = useState('');
    const [comment, setComment] = useState('');
    const [isRunning, setIsRunning] = useState(false);

    const rows = useMemo(
        () => buildEInvoicingRows({ invoices, creditNotes, clients, contracts, typologies, companies }),
        [invoices, creditNotes, clients, contracts, typologies, companies],
    );
    const companyNames = useMemo(() => new Map(companies.map(c => [c.id, c.name])), [companies]);

    // Filtres hors statut : servent aussi aux indicateurs.
    const scoped = useMemo(() => rows.filter(r =>
        (companyId === 'all' || r.companyId === companyId)
        && (channel === 'all' || r.state.channel === channel)
        && (!from || r.date.slice(0, 10) >= from)
        && (!to || r.date.slice(0, 10) <= to)
        && (!search || `${r.number} ${r.clientName} ${r.state.address ?? ''}`.toLowerCase().includes(search.toLowerCase()))
    ), [rows, companyId, channel, from, to, search]);

    const visible = useMemo(() => scoped.filter(r => {
        switch (status) {
            case 'all': return true;
            case 'actionable': return r.state.status === 'to_send' || r.state.status === 'rejected';
            case 'blocked': return r.blocked;
            default: return r.state.status === status;
        }
    }), [scoped, status]);

    const stats = useMemo(() => {
        const sum = (list: EInvoicingRow[]) => ({ count: list.length, total: list.reduce((a, r) => a + r.total, 0) });
        return {
            toSend: sum(scoped.filter(r => r.state.status === 'to_send' && !r.blocked)),
            blocked: sum(scoped.filter(r => r.blocked)),
            rejected: sum(scoped.filter(r => r.state.status === 'rejected')),
            sent: sum(scoped.filter(r => r.state.status === 'sent')),
            notApplicable: sum(scoped.filter(r => r.state.status === 'not_applicable')),
            ereporting: scoped.filter(r => r.state.channel === 'ereporting').length,
        };
    }, [scoped]);

    // Clients dont la configuration empêche ou fragilise la transmission.
    const clientIssues = useMemo(() => clients.map(client => {
        const company = companies.find(c => c.id === client.companyId);
        const r = resolveEInvoicing({ client, typology: typologies.find(t => t.id === client.typologyId), company });
        const warnings = r.warnings.filter(w => !w.includes("Date d'entrée en vigueur"));
        return { client, resolution: r, issues: [...r.blocking, ...warnings], blocking: r.blocking.length > 0 };
    }).filter(c => c.issues.length > 0 && (companyId === 'all' || c.client.companyId === companyId))
        .sort((a, b) => Number(b.blocking) - Number(a.blocking) || a.client.name.localeCompare(b.client.name)),
    [clients, companies, typologies, companyId]);

    const companiesWithoutDate = companies.filter(c => !c.einvoicingStartDate);

    const selectedRows = visible.filter(r => selected.has(r.key));
    const allVisibleSelected = visible.length > 0 && visible.every(r => selected.has(r.key));
    const toggleAll = (checked: boolean) => setSelected(checked ? new Set(visible.map(r => r.key)) : new Set());
    const toggle = (key: string, checked: boolean) => setSelected(prev => {
        const next = new Set(prev);
        if (checked) next.add(key); else next.delete(key);
        return next;
    });

    const report = (label: string, result: BatchResult) => {
        if (result.failed.length === 0) {
            toast({ title: label, description: `${result.succeeded} document(s) mis à jour.` });
        } else {
            toast({
                title: `${label} : ${result.failed.length} échec(s)`,
                description: result.failed.slice(0, 3).map(f => f.error).join(' · '),
                variant: 'destructive',
            });
        }
    };

    const run = async (label: string, action: () => Promise<BatchResult>) => {
        setIsRunning(true);
        try {
            report(label, await action());
            setSelected(new Set());
            await reloadData();
        } catch (error) {
            toast({ title: 'Erreur', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
        } finally {
            setIsRunning(false);
        }
    };

    const confirmStatus = async () => {
        if (!pending) return;
        const targets = selectedRows.filter(r => canTransition(r.state.status, pending.status)).map(r => ({ kind: r.kind, id: r.id }));
        const skipped = selectedRows.length - targets.length;
        setPending(null);
        await run(STATUS_LABELS[pending.status], () => updateEInvoicingStatus(targets, pending.status, {
            ...(reference.trim() && { platformReference: reference.trim() }),
            ...(comment.trim() && { comment: comment.trim() }),
        }));
        if (skipped > 0) toast({ title: `${skipped} document(s) ignoré(s)`, description: 'Statut actuel incompatible avec cette action.' });
        setReference('');
        setComment('');
    };

    const recompute = () => run("Recalcul de l'adressage", () =>
        recomputeEInvoicing(selectedRows.filter(r => canRecompute(r.state)).map(r => ({ kind: r.kind, id: r.id }))));

    const exportCsv = () => {
        const list = selectedRows.length ? selectedRows : visible;
        downloadCSV(list.map(r => ({
            type: r.kind === 'invoice' ? 'Facture' : 'Avoir',
            numero: r.number,
            date: r.date.slice(0, 10),
            societe: companyNames.get(r.companyId ?? '') ?? '',
            client: r.clientName,
            siren_client: r.clientSiren ?? '',
            regime: REGIME_SHORT_LABELS[r.state.regime],
            canal: CHANNEL_LABELS[r.state.channel],
            adresse_facturation: r.state.address ?? '',
            statut: STATUS_LABELS[r.state.status],
            anomalies: (r.state.blocking ?? []).join(' | '),
            total_ht: r.subtotal.toFixed(2),
            tva: r.tax.toFixed(2),
            total_ttc: r.total.toFixed(2),
            reference_plateforme: r.state.platformReference ?? '',
        })), `facturation-electronique-${new Date().toISOString().slice(0, 10)}.csv`);
    };

    const Kpi = ({ title, value, amount, icon: Icon, filter, tone }: { title: string; value: number; amount?: number; icon: typeof Send; filter: StatusFilter; tone?: string }) => (
        <button type="button" onClick={() => setStatus(filter)} className="text-left">
            <Card className={status === filter ? 'ring-2 ring-primary' : ''}>
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                    <CardTitle className="text-sm font-medium">{title}</CardTitle>
                    <Icon className={`h-4 w-4 ${tone ?? 'text-muted-foreground'}`} />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{value}</div>
                    {amount !== undefined && <p className="text-xs text-muted-foreground">{eur(amount)} TTC</p>}
                </CardContent>
            </Card>
        </button>
    );

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-lg font-semibold md:text-2xl">Facturation électronique</h1>
                <p className="text-sm text-muted-foreground">
                    Factures et avoirs à transmettre via la plateforme agréée ou Chorus Pro, selon la typologie et le paramétrage de chaque client.
                    Les particuliers et clients non assujettis relèvent de l'e-reporting.
                </p>
            </div>

            {companiesWithoutDate.length > 0 && (
                <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Date d'entrée en vigueur non paramétrée</AlertTitle>
                    <AlertDescription>
                        {companiesWithoutDate.map(c => c.name).join(', ')} : sans date, toutes leurs factures B2B sont considérées comme à transmettre.
                        Renseignez-la dans <Link className="underline" href="/settings">Paramétrage → Sociétés</Link>.
                    </AlertDescription>
                </Alert>
            )}

            <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
                <Kpi title="À transmettre" value={stats.toSend.count} amount={stats.toSend.total} icon={Send} filter="to_send" tone="text-primary" />
                <Kpi title="Bloquées (adressage)" value={stats.blocked.count} amount={stats.blocked.total} icon={AlertTriangle} filter="blocked" tone="text-destructive" />
                <Kpi title="Rejetées" value={stats.rejected.count} amount={stats.rejected.total} icon={XCircle} filter="rejected" tone="text-destructive" />
                <Kpi title="Transmises" value={stats.sent.count} amount={stats.sent.total} icon={CheckCircle2} filter="sent" tone="text-green-600" />
                <Kpi title="Non concernées" value={stats.notApplicable.count} amount={stats.notApplicable.total} icon={ShieldOff} filter="not_applicable" />
            </div>

            <Tabs defaultValue="documents">
                <TabsList>
                    <TabsTrigger value="documents">Documents ({visible.length})</TabsTrigger>
                    <TabsTrigger value="clients">Clients à compléter ({clientIssues.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="documents" className="space-y-4">
                    <Card>
                        <CardContent className="pt-6 grid gap-4 md:grid-cols-3 lg:grid-cols-6">
                            <div className="space-y-1">
                                <Label>Société</Label>
                                <Select value={companyId} onValueChange={setCompanyId}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">Toutes</SelectItem>
                                        {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1">
                                <Label>Canal</Label>
                                <Select value={channel} onValueChange={v => setChannel(v as EInvoicingChannel | 'all')}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">Tous</SelectItem>
                                        {(Object.keys(CHANNEL_LABELS) as EInvoicingChannel[]).map(c => <SelectItem key={c} value={c}>{CHANNEL_LABELS[c]}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1">
                                <Label>Statut</Label>
                                <Select value={status} onValueChange={v => setStatus(v as StatusFilter)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="actionable">À traiter (à transmettre + rejetées)</SelectItem>
                                        <SelectItem value="blocked">Bloquées (adressage)</SelectItem>
                                        {(Object.keys(STATUS_LABELS) as EInvoicingStatus[]).map(s => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
                                        <SelectItem value="all">Tous</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor="rfe-from">Du</Label>
                                <Input id="rfe-from" type="date" value={from} onChange={e => setFrom(e.target.value)} />
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor="rfe-to">Au</Label>
                                <Input id="rfe-to" type="date" value={to} onChange={e => setTo(e.target.value)} />
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor="rfe-search">Recherche</Label>
                                <Input id="rfe-search" placeholder="N°, client, adresse…" value={search} onChange={e => setSearch(e.target.value)} />
                            </div>
                        </CardContent>
                    </Card>

                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-muted-foreground mr-2">{selectedRows.length} sélectionné(s)</span>
                        <Button size="sm" disabled={!selectedRows.length || isRunning} onClick={() => setPending({ status: 'sent' })}>
                            <CheckCircle2 className="h-4 w-4 mr-1" /> Marquer transmises
                        </Button>
                        <Button size="sm" variant="outline" disabled={!selectedRows.length || isRunning} onClick={() => setPending({ status: 'rejected' })}>
                            <XCircle className="h-4 w-4 mr-1" /> Marquer rejetées
                        </Button>
                        <Button size="sm" variant="outline" disabled={!selectedRows.length || isRunning} onClick={() => setPending({ status: 'to_send' })}>
                            <Send className="h-4 w-4 mr-1" /> Remettre à transmettre
                        </Button>
                        <Button size="sm" variant="outline" disabled={!selectedRows.length || isRunning} onClick={recompute}>
                            <RefreshCw className="h-4 w-4 mr-1" /> Recalculer l'adressage
                        </Button>
                        <Button size="sm" variant="outline" disabled={!visible.length} onClick={exportCsv} className="ml-auto">
                            <Download className="h-4 w-4 mr-1" /> Exporter CSV {selectedRows.length ? '(sélection)' : ''}
                        </Button>
                    </div>

                    <Card>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-10"><Checkbox checked={allVisibleSelected} onCheckedChange={c => toggleAll(c === true)} aria-label="Tout sélectionner" /></TableHead>
                                        <TableHead>N°</TableHead>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Client</TableHead>
                                        <TableHead>Canal</TableHead>
                                        <TableHead>Adresse de facturation</TableHead>
                                        <TableHead>Statut</TableHead>
                                        <TableHead className="text-right">TTC</TableHead>
                                        <TableHead className="w-10" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {isLoading ? (
                                        <TableRow><TableCell colSpan={9} className="text-center h-24 text-muted-foreground">Chargement…</TableCell></TableRow>
                                    ) : visible.length === 0 ? (
                                        <TableRow><TableCell colSpan={9} className="text-center h-24 text-muted-foreground">Aucun document pour ces filtres.</TableCell></TableRow>
                                    ) : visible.map(r => (
                                        <TableRow key={r.key} data-state={selected.has(r.key) ? 'selected' : undefined}>
                                            <TableCell><Checkbox checked={selected.has(r.key)} onCheckedChange={c => toggle(r.key, c === true)} aria-label={`Sélectionner ${r.number}`} /></TableCell>
                                            <TableCell className="font-medium whitespace-nowrap">
                                                {r.number}
                                                {r.kind === 'creditNote' && <Badge variant="outline" className="ml-2">Avoir</Badge>}
                                            </TableCell>
                                            <TableCell className="whitespace-nowrap">{day(r.date)}</TableCell>
                                            <TableCell className="min-w-[180px]">
                                                <Link className="hover:underline" href={`/clients/${r.clientId}`}>{r.clientName}</Link>
                                                <div className="text-xs text-muted-foreground">{REGIME_SHORT_LABELS[r.state.regime]}{r.clientSiren ? ` · SIREN ${r.clientSiren}` : ''}</div>
                                            </TableCell>
                                            <TableCell className="whitespace-nowrap">{CHANNEL_LABELS[r.state.channel]}</TableCell>
                                            <TableCell>
                                                {r.state.address
                                                    ? <><span className="font-mono text-xs">{r.state.address}</span>{r.state.addressSource && <span className="text-xs text-muted-foreground"> ({ADDRESS_SOURCE_LABELS[r.state.addressSource]})</span>}</>
                                                    : <span className="text-muted-foreground">—</span>}
                                                {(r.state.blocking ?? []).map(m => <div key={m} className="text-xs text-destructive">{m}</div>)}
                                            </TableCell>
                                            <TableCell>
                                                <Badge className="whitespace-nowrap" variant={r.blocked ? 'destructive' : STATUS_VARIANTS[r.state.status]}>
                                                    {r.blocked ? 'Bloquée' : STATUS_LABELS[r.state.status]}
                                                </Badge>
                                                {!r.frozen && <div className="text-xs text-muted-foreground">calculé (antérieur)</div>}
                                                {r.state.platformReference && <div className="text-xs text-muted-foreground">Réf. {r.state.platformReference}</div>}
                                            </TableCell>
                                            <TableCell className="text-right whitespace-nowrap">{eur(r.total)}</TableCell>
                                            <TableCell>
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild><Button size="icon" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem asChild>
                                                            <a href={`/api/documents/${r.kind === 'invoice' ? 'invoices' : 'credit-notes'}/${r.id}`} target="_blank" rel="noopener noreferrer">
                                                                <FileText className="h-4 w-4 mr-2" /> PDF
                                                            </a>
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem asChild><Link href={`/clients/${r.clientId}/edit`}>Paramétrage du client</Link></DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                    {stats.ereporting > 0 && (
                        <p className="text-sm text-muted-foreground">
                            {stats.ereporting} document(s) relèvent de l'e-reporting (particuliers, non-assujettis, international) : pas de facture électronique,
                            les données de transaction sont déclarées par la plateforme agréée.
                        </p>
                    )}
                </TabsContent>

                <TabsContent value="clients">
                    <Card>
                        <CardHeader>
                            <CardTitle>Clients à compléter</CardTitle>
                            <CardDescription>Paramétrage empêchant (en rouge) ou fragilisant la transmission électronique de leurs factures.</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow><TableHead>Client</TableHead><TableHead>Régime</TableHead><TableHead>Canal</TableHead><TableHead>À corriger</TableHead><TableHead /></TableRow>
                                </TableHeader>
                                <TableBody>
                                    {clientIssues.length === 0 ? (
                                        <TableRow><TableCell colSpan={5} className="text-center h-24 text-muted-foreground">Aucun client à compléter.</TableCell></TableRow>
                                    ) : clientIssues.map(({ client, resolution, issues }) => (
                                        <TableRow key={client.id}>
                                            <TableCell className="font-medium">{client.name}</TableCell>
                                            <TableCell>{REGIME_SHORT_LABELS[resolution.regime]}</TableCell>
                                            <TableCell>{CHANNEL_LABELS[resolution.channel]}</TableCell>
                                            <TableCell>{issues.map(m => <div key={m} className={resolution.blocking.includes(m) ? 'text-sm text-destructive' : 'text-sm text-amber-600'}>{m}</div>)}</TableCell>
                                            <TableCell className="text-right"><Button asChild size="sm" variant="outline"><Link href={`/clients/${client.id}/edit`}>Compléter</Link></Button></TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            <Dialog open={!!pending} onOpenChange={o => !o && setPending(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{pending && STATUS_LABELS[pending.status]} — {selectedRows.length} document(s)</DialogTitle>
                        <DialogDescription>
                            {pending?.status === 'sent' && 'À utiliser une fois les documents déposés sur la plateforme agréée ou Chorus Pro.'}
                            {pending?.status === 'rejected' && 'Indiquez le motif du rejet communiqué par la plateforme.'}
                            {pending?.status === 'to_send' && 'Les documents rejetés repassent dans la liste à transmettre.'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        {pending?.status === 'sent' && (
                            <div className="space-y-1">
                                <Label htmlFor="rfe-ref">Référence de dépôt (facultatif)</Label>
                                <Input id="rfe-ref" value={reference} onChange={e => setReference(e.target.value)} placeholder="Identifiant attribué par la plateforme" />
                            </div>
                        )}
                        <div className="space-y-1">
                            <Label htmlFor="rfe-comment">Commentaire (facultatif)</Label>
                            <Input id="rfe-comment" value={comment} onChange={e => setComment(e.target.value)} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPending(null)}>Annuler</Button>
                        <Button onClick={confirmStatus} disabled={isRunning}>Confirmer</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
