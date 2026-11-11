'use client';

import { AccesRefuse, useHorsPerimetre } from '@/components/perimetre/acces';
import { useConfirm } from '@/components/confirm-provider';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft, Loader2, Plus, Receipt, Save, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress as ProgressBar } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { NumberField } from '@/components/quotes/number-field';
import { formatEur } from '@/components/quotes/format';
import { computeSituation, latestSnapshot, situationIssues } from '@/lib/projects/situations';
import { PROJECT_STATUS_LABELS, type Progress, type Project, type ProjectSituation } from '@/lib/projects/types';
import {
    deleteSituationAction, invoiceSituationAction, projectMilestoneAction, saveSituationAction,
} from '@/lib/projects/actions';
import { sumCents } from '@/lib/money';
import type { Invoice } from '@/lib/types';
import { getProject, getProjectInvoices, getProjectSituations } from '@/services/projects';
import { AffaireSynthese } from '@/components/projects/affaire-synthese';
import { AffaireRentabilite } from '@/components/projects/affaire-rentabilite';

const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);
const frDate = (d?: string) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
const frPeriod = (p: string) => `${p.slice(5, 7)}/${p.slice(0, 4)}`;

export default function ProjectPage() {
    const confirmer = useConfirm();
    const { id } = useParams<{ id: string }>();
    const { toast } = useToast();
    const [project, setProject] = useState<Project | null>(null);
    const [situations, setSituations] = useState<ProjectSituation[]>([]);
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    // Situation en préparation (édition locale).
    const [period, setPeriod] = useState(thisMonth());
    const [progress, setProgress] = useState<Progress | null>(null);
    const [milestoneDate, setMilestoneDate] = useState(today());

    const load = useCallback(async () => {
        const [p, s, inv] = await Promise.all([getProject(id), getProjectSituations(id), getProjectInvoices(id)]);
        setProject(p);
        setSituations(s);
        setInvoices(inv);
        const draft = s.find(x => x.status === 'brouillon');
        setPeriod(draft?.period ?? thisMonth());
        setProgress(draft ? draft.progress : null);
        setLoading(false);
    }, [id]);
    useEffect(() => { load().catch(() => setLoading(false)); }, [load]);

    const previous = useMemo(() => latestSnapshot(invoices), [invoices]);
    const draft = situations.find(s => s.status === 'brouillon');
    const computed = useMemo(() => (project && progress ? computeSituation(project, progress, previous) : null), [project, progress, previous]);
    const issues = useMemo(() => (project && progress ? situationIssues(project, progress, previous) : []), [project, progress, previous]);
    const dirty = !!progress && (!draft || draft.period !== period || JSON.stringify(draft.progress) !== JSON.stringify(progress));

    // Périmètre : la fiche d'un client hors des sociétés, agences et secteurs de l'utilisateur ne s'affiche pas.
    const horsPerimetre = useHorsPerimetre(project?.clientId);
    if (horsPerimetre) return <AccesRefuse objet="Cette affaire" />;
    if (loading) return <Loader2 className="mx-auto mt-24 h-8 w-8 animate-spin" />;
    if (!project) return <p className="text-muted-foreground">Affaire introuvable. <Link className="underline" href="/projects">Retour</Link></p>;

    // Par situations : factures de situation ; directe : factures des devis de l'affaire (acompte, solde, totalité).
    const parSituations = (project.billing ?? 'situations') === 'situations';
    const counted = invoices.filter(i => i.status !== 'cancelled' && i.status !== 'proforma' && (parSituations ? i.situation : true));
    const billedHT = sumCents(counted.map(i => i.subtotal));
    const billedTTC = sumCents(counted.map(i => i.total));
    const retained = sumCents(counted.map(i => i.situation?.retention.amount ?? 0));
    const billedPct = project.totalHT > 0 ? (billedHT / project.totalHT) * 100 : 0;
    const open = project.status !== 'cloture';

    const act = async <T,>(label: string, action: () => Promise<{ success: true; data: T } | { success: false; error: string }>) => {
        setBusy(true);
        const result = await action();
        setBusy(false);
        if (!result.success) {
            toast({ title: 'Action impossible', description: result.error, variant: 'destructive' });
            return false;
        }
        toast({ title: label });
        await load();
        return true;
    };

    const startSituation = () => setProgress(Object.fromEntries(project.lines.map(l => [l.id, previous?.progress[l.id] ?? 0])));
    const sections = [...new Set(project.lines.map(l => l.section ?? ''))];

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2">
                        <Link href="/projects" className="text-muted-foreground hover:text-primary"><ChevronLeft className="h-4 w-4" /></Link>
                        <h1 className="text-2xl font-bold tracking-tight font-mono">{project.code}</h1>
                        <Badge variant={project.status === 'en_cours' ? 'secondary' : 'outline'}>{PROJECT_STATUS_LABELS[project.status]}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                        {project.title} — <Link className="underline" href={`/clients/${project.clientId}`}>{project.clientName}</Link>
                        {project.siteId && <> — <Link className="underline" href={`/sites/${project.siteId}`}>{project.siteName}</Link></>}
                        {' '}— devis <Link className="underline font-mono" href={`/quotes/${project.quoteId}`}>{project.quoteNumber}</Link>
                        {project.purchaseOrderNumber && ` — bon de commande ${project.purchaseOrderNumber}`}
                    </p>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
                <Kpi title="Marché" value={formatEur(project.totalHT)} sub={`${formatEur(project.totalTTC)} TTC`} />
                <Kpi title="Facturé" value={formatEur(billedHT)} sub={`${billedPct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % — ${formatEur(billedTTC)} TTC`} />
                <Kpi title="Reste à facturer" value={formatEur(sumCents([project.totalHT, -billedHT]))} sub="HT" />
                {parSituations
                    ? <Kpi title="Retenue de garantie" value={project.retentionBond ? 'Caution' : formatEur(retained)}
                        sub={project.retentionBond ? 'remplacée par une caution bancaire' : `${project.retentionPct} % — ${project.retentionReleasedAt ? `libérée le ${frDate(project.retentionReleasedAt)}` : 'retenue'}`} />
                    : <Kpi title="Marge prévue" value={project.budget ? formatEur(project.budget.marge) : '—'} sub={project.budget?.tauxMarge != null ? `${(project.budget.tauxMarge * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % du prix de vente` : 'budget des devis'} />}
            </div>
            <ProgressBar value={Math.min(100, billedPct)} />

            <AffaireRentabilite projectId={project.id} sansBudget={!project.budget} />

            <AffaireSynthese project={project} onChange={load} />

            {!parSituations && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Facturation directe</CardTitle>
                        <CardDescription>Cette affaire se facture depuis ses devis (acompte, solde ou totalité) : ouvrez un devis ci-dessus pour émettre une facture.</CardDescription>
                    </CardHeader>
                    {counted.length > 0 && (
                        <CardContent className="text-sm">
                            <table className="w-full">
                                <tbody>{counted.map(i => (
                                    <tr key={i.id} className="border-t"><td className="py-1.5 font-mono text-xs"><Link className="underline" href={`/invoices/${i.id}`}>{i.invoiceNumber}</Link></td>
                                        <td className="py-1.5">{frDate(i.date)}</td><td className="py-1.5 text-right">{formatEur(i.subtotal)} HT</td></tr>
                                ))}</tbody>
                            </table>
                        </CardContent>
                    )}
                </Card>
            )}

            {parSituations && <Card>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                    <div>
                        <CardTitle className="text-base">Situations</CardTitle>
                        <CardDescription>Avancement cumulé ; chaque situation facture la différence avec la précédente.</CardDescription>
                    </div>
                    {open && !progress && <Button onClick={startSituation}><Plus className="mr-2 h-4 w-4" />Nouvelle situation</Button>}
                </CardHeader>
                <CardContent className="text-sm">
                    {situations.filter(s => s.status === 'facturee').length === 0 ? (
                        <p className="text-muted-foreground">Aucune situation facturée.</p>
                    ) : (
                        <table className="w-full">
                            <thead className="text-xs text-muted-foreground"><tr className="border-b">
                                <th className="p-1 text-left">N°</th><th className="p-1 text-left">Mois</th><th className="p-1 text-left">Facture</th>
                                <th className="p-1 text-right">HT</th><th className="p-1 text-right">TTC</th><th className="p-1 text-right">Retenue</th><th className="p-1 text-right">Net à payer</th>
                            </tr></thead>
                            <tbody>
                                {situations.filter(s => s.status === 'facturee').map(s => {
                                    const inv = invoices.find(i => i.id === s.invoiceId);
                                    const cancelled = inv?.status === 'cancelled';
                                    return (
                                        <tr key={s.id} className={`border-b ${cancelled ? 'text-muted-foreground line-through' : ''}`}>
                                            <td className="p-1">{s.number}</td>
                                            <td className="p-1">{frPeriod(s.period)}</td>
                                            <td className="p-1">
                                                <Link className="underline font-mono" href={`/invoices/${s.invoiceId}`}>{s.invoiceNumber}</Link>
                                                {cancelled && <Badge variant="outline" className="ml-2 no-underline">Annulée (avoir)</Badge>}
                                            </td>
                                            <td className="p-1 text-right">{formatEur(inv?.subtotal)}</td>
                                            <td className="p-1 text-right">{formatEur(inv?.total)}</td>
                                            <td className="p-1 text-right">{formatEur(inv?.situation?.retention.amount)}</td>
                                            <td className="p-1 text-right">{formatEur(inv?.situation?.netToPay)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </CardContent>
            </Card>}

            {parSituations && progress && computed && (
                <Card>
                    <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-2">
                        <div>
                            <CardTitle className="text-base">Situation n° {draft?.number ?? (Math.max(0, ...situations.map(s => s.number)) + 1)} {draft ? '(en préparation)' : '(nouvelle)'}</CardTitle>
                            <CardDescription>Saisissez l'avancement cumulé de chaque ligne (en % du marché).</CardDescription>
                        </div>
                        <div className="flex items-end gap-2">
                            <div className="space-y-1"><Label htmlFor="period">Mois des travaux</Label>
                                <Input id="period" type="month" value={period} onChange={e => setPeriod(e.target.value)} /></div>
                            <Button variant="outline" onClick={() => setProgress(Object.fromEntries(project.lines.map(l => [l.id, 100])))}>Tout à 100 %</Button>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4 overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="text-xs text-muted-foreground"><tr className="border-b">
                                <th className="p-1 text-left">Ligne</th><th className="p-1 text-right">Marché HT</th><th className="p-1 text-right">Précédent</th>
                                <th className="p-1 w-28">Cumul %</th><th className="p-1 text-right">Cumul HT</th><th className="p-1 text-right">Cette situation</th>
                            </tr></thead>
                            <tbody>
                                {sections.map(section => (
                                    <SectionRows key={section || '_'} section={section}>
                                        {computed.lines.filter(l => (l.section ?? '') === section).map(l => (
                                            <tr key={l.id} className="border-b">
                                                <td className="p-1">{l.label} <span className="text-xs text-muted-foreground">TVA {l.vatRate} %</span></td>
                                                <td className="p-1 text-right">{formatEur(l.totalHT)}</td>
                                                <td className="p-1 text-right text-muted-foreground">{l.previousPct.toLocaleString('fr-FR')} %</td>
                                                <td className="p-1"><NumberField className="h-8" ariaLabel={`Avancement ${l.label}`} value={progress[l.id] ?? 0}
                                                    onChange={v => setProgress(p => ({ ...(p ?? {}), [l.id]: v ?? 0 }))} /></td>
                                                <td className="p-1 text-right">{formatEur(l.cumul)}</td>
                                                <td className="p-1 text-right font-medium">{formatEur(l.amount)}</td>
                                            </tr>
                                        ))}
                                    </SectionRows>
                                ))}
                            </tbody>
                        </table>

                        <div className="ml-auto w-full max-w-sm space-y-1 text-sm">
                            <Row label="Montant HT de la situation" value={formatEur(computed.subtotal)} strong />
                            {computed.vatBreakdown.map(v => <Row key={v.rate} label={`TVA ${v.rate.toLocaleString('fr-FR')} %`} value={formatEur(v.amount)} />)}
                            <Row label="Total TTC" value={formatEur(computed.total)} strong />
                            {computed.retention.amount !== 0 && <Row label={`Retenue de garantie (${computed.retention.pct} %)`} value={formatEur(-computed.retention.amount)} />}
                            <Row label="Net à payer" value={formatEur(computed.netToPay)} strong />
                            <Row label="Avancement global après cette situation" value={`${computed.progressPct.toLocaleString('fr-FR')} %`} />
                        </div>
                        {issues.length > 0 && <div className="space-y-1">{issues.map(m => <p key={m} className="text-sm text-amber-600">• {m}</p>)}</div>}

                        <div className="flex flex-wrap justify-end gap-2">
                            {draft && <Button variant="ghost" disabled={busy} onClick={() => act('Situation supprimée', () => deleteSituationAction(draft.id))}><Trash2 className="mr-2 h-4 w-4" />Supprimer</Button>}
                            {!draft && <Button variant="ghost" onClick={() => setProgress(null)}>Abandonner</Button>}
                            <Button variant="outline" disabled={busy || !dirty} onClick={() => act('Situation enregistrée', () => saveSituationAction(project.id, { period, progress }))}>
                                <Save className="mr-2 h-4 w-4" />Enregistrer
                            </Button>
                            <Button disabled={busy || dirty || !draft || issues.length > 0}
                                title={dirty ? 'Enregistrez la situation avant de la facturer.' : undefined}
                                onClick={async () => {
                                    if (draft && await confirmer({ title: `Facturer la situation n° ${draft.number} ?`, description: `${formatEur(computed.total)} TTC, net à payer ${formatEur(computed.netToPay)}. La facture reçoit un numéro définitif.`, confirmLabel: 'Facturer' })) {
                                        act('Situation facturée', () => invoiceSituationAction(draft.id));
                                    }
                                }}>
                                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Receipt className="mr-2 h-4 w-4" />}Facturer la situation
                            </Button>
                        </div>
                        {dirty && <p className="text-right text-xs text-muted-foreground">Enregistrez la situation avant de la facturer.</p>}
                    </CardContent>
                </Card>
            )}

            {open && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Jalons</CardTitle>
                        <CardDescription>
                            Réception : {frDate(project.completedAt)} · Retenue libérée : {frDate(project.retentionReleasedAt)}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap items-end gap-2">
                        <div className="space-y-1"><Label htmlFor="ms-date">Date</Label>
                            <Input id="ms-date" type="date" value={milestoneDate} onChange={e => setMilestoneDate(e.target.value)} /></div>
                        {!project.completedAt && <Button variant="outline" disabled={busy} onClick={() => act('Réception enregistrée', () => projectMilestoneAction(project.id, 'completed', milestoneDate))}>Réception des travaux</Button>}
                        {project.completedAt && !project.retentionReleasedAt && !project.retentionBond && (
                            <Button variant="outline" disabled={busy} onClick={() => act('Retenue libérée', () => projectMilestoneAction(project.id, 'retentionReleased', milestoneDate))}>Libérer la retenue</Button>
                        )}
                        <Button variant="ghost" disabled={busy} onClick={async () => {
                            if (await confirmer({ title: `Clôturer l'affaire ${project.code} ?`, description: 'Plus aucune situation ne pourra être facturée.', confirmLabel: 'Clôturer', destructive: true })) {
                                act('Affaire clôturée', () => projectMilestoneAction(project.id, 'closed', milestoneDate));
                            }
                        }}>Clôturer l'affaire</Button>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

function SectionRows({ section, children }: { section: string; children: React.ReactNode }) {
    return (
        <>
            {section && <tr className="bg-muted/40"><td colSpan={6} className="p-1 font-medium">{section}</td></tr>}
            {children}
        </>
    );
}

function Kpi({ title, value, sub }: { title: string; value: string; sub?: string }) {
    return (
        <Card>
            <CardHeader className="pb-2"><CardDescription>{title}</CardDescription><CardTitle className="text-xl">{value}</CardTitle></CardHeader>
            {sub && <CardContent className="text-xs text-muted-foreground">{sub}</CardContent>}
        </Card>
    );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
    return <div className={`flex justify-between gap-4 ${strong ? 'font-semibold' : ''}`}><span>{label}</span><span>{value}</span></div>;
}
