'use client';

import { useConfirm } from '@/components/confirm-provider';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, ChevronLeft, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useData } from '@/context/data-context';
import { NumberField } from '@/components/quotes/number-field';
import { formatEur, formatPct, StatusBadge } from '@/components/quotes/format';
import { computeLines, computeQuoteTotals, isPriced, newLineId, quoteIssues, addDays, unitCostOf } from '@/lib/quotes/pricing';
import { QUOTE_LINE_KIND_LABELS, type Quote, type QuoteLine, type QuoteLineKind, type QuotePricing } from '@/lib/quotes/types';
import { deleteQuoteDraft, getQuote, updateQuoteDraft, type QuoteDraftPatch } from '@/services/quotes';
import { QuoteActions, QuoteHistory } from '@/components/quotes/lifecycle-panel';
import { QuoteBilling } from '@/components/quotes/billing-panel';
import { QuoteProject } from '@/components/quotes/project-panel';
import { LibraryPicker } from '@/components/quotes/library-picker';
import { effectiveStatus } from '@/lib/quotes/lifecycle';

type Draft = Required<Pick<Quote, 'title' | 'date' | 'validityDays' | 'pricing' | 'lines'>> &
    Pick<Quote, 'paymentTerms' | 'estimatedStart' | 'estimatedDuration' | 'notes' | 'internalNotes'
        | 'authorId' | 'authorName' | 'authorEmail' | 'agencyId' | 'sectorId'
        | 'contactId' | 'contactName' | 'contactEmail' | 'contactPhone' | 'clientReference' | 'requestDate'>;

const toDraft = (q: Quote): Draft => ({
    title: q.title, date: q.date, validityDays: q.validityDays, pricing: q.pricing, lines: q.lines,
    paymentTerms: q.paymentTerms ?? '', estimatedStart: q.estimatedStart ?? '', estimatedDuration: q.estimatedDuration ?? '',
    notes: q.notes ?? '', internalNotes: q.internalNotes ?? '',
    authorId: q.authorId ?? '', authorName: q.authorName ?? '', authorEmail: q.authorEmail ?? '',
    agencyId: q.agencyId ?? '', sectorId: q.sectorId ?? '',
    contactId: q.contactId ?? '', contactName: q.contactName ?? '', contactEmail: q.contactEmail ?? '', contactPhone: q.contactPhone ?? '',
    clientReference: q.clientReference ?? '', requestDate: q.requestDate ?? '',
});

const NONE = '__none__';
/** Champs texte vides → absents (Firestore et lisibilité). */
const orUndefined = (v?: string) => (v && v.trim() ? v.trim() : undefined);

const ADDABLE: QuoteLineKind[] = ['TITRE', 'FOURNITURE', 'MAIN_OEUVRE', 'SOUS_TRAITANCE', 'DIVERS', 'TEXTE', 'SOUS_TOTAL'];
const SOURCE = { client: 'fiche client', company: 'société' } as const;

export default function QuoteEditorPage() {
    const confirmer = useConfirm();
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const { toast } = useToast();
    const { currentUser, users, contacts, agencies, sectors } = useData();
    const [quote, setQuote] = useState<Quote | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());   // ouvrages dont le détail est affiché

    const load = useCallback(async () => {
        const q = await getQuote(id);
        setQuote(q);
        setDraft(q ? toDraft(q) : null);
        setLoading(false);
    }, [id]);
    useEffect(() => { load().catch(() => setLoading(false)); }, [load]);

    const computed = useMemo(() => (draft ? computeLines(draft.lines, draft.pricing) : []), [draft]);
    const totals = useMemo(() => (draft ? computeQuoteTotals(draft.lines, draft.pricing) : null), [draft]);
    const issues = useMemo(() => (draft ? quoteIssues(draft.lines, draft.pricing) : []), [draft]);
    const dirty = !!quote && !!draft && JSON.stringify(toDraft(quote)) !== JSON.stringify(draft);

    // Quitter avec des modifications non enregistrées : confirmation du navigateur.
    useEffect(() => {
        if (!dirty) return;
        const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);

    if (loading) return <Loader2 className="mx-auto mt-24 h-8 w-8 animate-spin" />;
    if (!quote || !draft || !totals) return <p className="text-muted-foreground">Devis introuvable. <Link className="underline" href="/quotes">Retour aux devis</Link></p>;

    const readOnly = quote.status !== 'brouillon';
    const set = (patch: Partial<Draft>) => setDraft(d => (d ? { ...d, ...patch } : d));
    const setPricing = (patch: Partial<QuotePricing>) => set({ pricing: { ...draft.pricing, ...patch, sources: { ...draft.pricing.sources, ...Object.fromEntries(Object.keys(patch).map(k => [k, undefined])) } } });
    const setLine = (i: number, patch: Partial<QuoteLine>) => set({ lines: draft.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
    const move = (i: number, delta: number) => {
        const j = i + delta;
        if (j < 0 || j >= draft.lines.length) return;
        const lines = [...draft.lines];
        [lines[i], lines[j]] = [lines[j], lines[i]];
        set({ lines });
    };
    const addLine = (kind: QuoteLineKind) => set({
        lines: [...draft.lines, {
            id: newLineId(), kind, quantity: isPriced({ kind }) ? 1 : 0, vatRate: draft.pricing.defaultVatRate,
            label: kind === 'SOUS_TOTAL' ? 'Sous-total' : kind === 'MAIN_OEUVRE' ? "Main-d'œuvre" : '',
            ...(kind === 'MAIN_OEUVRE' && { unit: 'h' }),
            ...(kind === 'TITRE' && { level: 0 }),
        }],
    });

    const save = async () => {
        setSaving(true);
        try {
            const patch: QuoteDraftPatch = {
                ...draft,
                paymentTerms: draft.paymentTerms?.trim() || undefined,
                estimatedStart: draft.estimatedStart || undefined,
                estimatedDuration: draft.estimatedDuration?.trim() || undefined,
                notes: draft.notes?.trim() || undefined,
                internalNotes: draft.internalNotes?.trim() || undefined,
                authorId: orUndefined(draft.authorId), authorName: orUndefined(draft.authorName), authorEmail: orUndefined(draft.authorEmail),
                agencyId: orUndefined(draft.agencyId), sectorId: orUndefined(draft.sectorId),
                contactId: orUndefined(draft.contactId), contactName: orUndefined(draft.contactName),
                contactEmail: orUndefined(draft.contactEmail), contactPhone: orUndefined(draft.contactPhone),
                clientReference: orUndefined(draft.clientReference), requestDate: orUndefined(draft.requestDate),
            };
            const updated = await updateQuoteDraft(quote.id, patch, currentUser?.email);
            setQuote(updated);
            setDraft(toDraft(updated));
            toast({ title: 'Devis enregistré', description: `${updated.number} — ${formatEur(updated.totals.totalHT)} HT` });
        } catch (e) {
            toast({ title: 'Enregistrement impossible', description: (e as Error).message, variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        if (!(await confirmer({ title: `Supprimer le brouillon ${quote.number} ?`, confirmLabel: 'Supprimer', destructive: true }))) return;
        try {
            await deleteQuoteDraft(quote.id);
            router.push('/quotes');
        } catch (e) {
            toast({ title: 'Suppression impossible', description: (e as Error).message, variant: 'destructive' });
        }
    };

    const lieu = quote.siteName
        ? <Link className="underline" href={`/sites/${quote.siteId}`}>{quote.siteName}</Link>
        : [quote.interventionAddress?.address, [quote.interventionAddress?.postalCode, quote.interventionAddress?.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2">
                        <Link href="/quotes" className="text-muted-foreground hover:text-primary"><ChevronLeft className="h-4 w-4" /></Link>
                        <h1 className="text-2xl font-bold tracking-tight font-mono">{quote.number}{quote.version > 1 && ` V${quote.version}`}</h1>
                        <StatusBadge status={effectiveStatus(quote)} />
                        <Badge variant="outline">{quote.mode}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                        <Link className="underline" href={`/clients/${quote.clientId}`}>{quote.clientName}</Link>
                        {quote.prospect && <Badge variant="outline" className="ml-2">Prospect</Badge>} — {lieu || '—'}
                    </p>
                </div>
                {!readOnly && (
                    <div className="flex gap-2">
                        {quote.version === 1 && <Button variant="outline" onClick={remove}><Trash2 className="mr-2 h-4 w-4" />Supprimer</Button>}
                        <Button onClick={save} disabled={!dirty || saving || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)}>
                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Enregistrer
                        </Button>
                    </div>
                )}
            </div>
            <QuoteActions quote={quote} dirty={dirty} issues={issues} onChange={q => { setQuote(q); setDraft(toDraft(q)); }} />
            {readOnly && (
                <p className="text-sm text-muted-foreground">
                    Ce devis n'est plus un brouillon : il est figé{quote.sentAt ? ` depuis son envoi le ${new Date(quote.sentAt).toLocaleDateString('fr-FR')}` : ''}.
                    {effectiveStatus(quote) === 'expire' && ` Sa validité a pris fin le ${new Date(quote.validUntil).toLocaleDateString('fr-FR')}.`}
                </p>
            )}
            {/* P6 (ou affaire déjà créée) : facturation par situations ; sinon facturation directe. */}
            {quote.status === 'accepte' && (quote.mode === 'P6' || quote.projectId ? <QuoteProject quote={quote} /> : <QuoteBilling quote={quote} />)}
            {(quote.version > 1 || quote.sentAt || quote.cancellation) && <QuoteHistory quote={quote} />}

            <Card>
                <CardHeader><CardTitle className="text-base">Suivi</CardTitle></CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-3">
                    <div className="space-y-1">
                        <Label>Rédacteur du devis</Label>
                        <Select value={draft.authorId || NONE} disabled={readOnly} onValueChange={v => {
                            const u = users.find(x => x.id === v);
                            set(u ? { authorId: u.id, authorName: [u.firstName, u.name].filter(Boolean).join(' ') || u.email, authorEmail: u.email }
                                : { authorId: '', authorName: '', authorEmail: '' });
                        }}>
                            <SelectTrigger><SelectValue placeholder="Choisir" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NONE}>Non attribué</SelectItem>
                                {/* Rédacteur d'origine absent de la liste (utilisateur supprimé) : reste affiché. */}
                                {draft.authorId && !users.some(u => u.id === draft.authorId) && <SelectItem value={draft.authorId}>{draft.authorName}</SelectItem>}
                                {[...users].sort((a, b) => a.name.localeCompare(b.name)).map(u => (
                                    <SelectItem key={u.id} value={u.id}>{[u.firstName, u.name].filter(Boolean).join(' ') || u.email}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label>Agence</Label>
                        <Select value={draft.agencyId || NONE} disabled={readOnly} onValueChange={v => set({ agencyId: v === NONE ? '' : v, sectorId: '' })}>
                            <SelectTrigger><SelectValue placeholder="Choisir" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NONE}>—</SelectItem>
                                {agencies.filter(a => a.companyId === quote.companyId).map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label>Secteur</Label>
                        <Select value={draft.sectorId || NONE} disabled={readOnly || !draft.agencyId} onValueChange={v => set({ sectorId: v === NONE ? '' : v })}>
                            <SelectTrigger><SelectValue placeholder="Choisir" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NONE}>—</SelectItem>
                                {sectors.filter(s => s.agencyId === draft.agencyId).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label>Interlocuteur chez le client</Label>
                        <Select value={draft.contactId || NONE} disabled={readOnly} onValueChange={v => {
                            const c = contacts.find(x => x.id === v);
                            set(c ? { contactId: c.id, contactName: c.name, contactEmail: c.email ?? '', contactPhone: c.phone ?? '' }
                                : { contactId: '', contactName: '', contactEmail: '', contactPhone: '' });
                        }}>
                            <SelectTrigger><SelectValue placeholder="Choisir" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NONE}>Aucun</SelectItem>
                                {contacts.filter(c => c.clientId === quote.clientId).map(c => (
                                    <SelectItem key={c.id} value={c.id}>{c.name}{c.role ? ` — ${c.role}` : ''}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {draft.contactId && <p className="text-xs text-muted-foreground">{[draft.contactEmail, draft.contactPhone].filter(Boolean).join(' · ') || 'Sans email ni téléphone'}</p>}
                        {contacts.every(c => c.clientId !== quote.clientId) && (
                            <p className="text-xs text-muted-foreground">Aucun contact : à ajouter sur la <Link className="underline" href={`/clients/${quote.clientId}`}>fiche client</Link>.</p>
                        )}
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="q-ref">Référence du client</Label>
                        <Input id="q-ref" placeholder="N° de consultation, de demande…" value={draft.clientReference ?? ''} disabled={readOnly}
                            onChange={e => set({ clientReference: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="q-request">Date de la demande</Label>
                        <Input id="q-request" type="date" value={draft.requestDate ?? ''} disabled={readOnly}
                            onChange={e => set({ requestDate: e.target.value })} />
                    </div>
                </CardContent>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader><CardTitle className="text-base">Informations</CardTitle></CardHeader>
                    <CardContent className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1 md:col-span-2"><Label htmlFor="q-title">Objet</Label>
                            <Input id="q-title" value={draft.title} disabled={readOnly} onChange={e => set({ title: e.target.value })} /></div>
                        <div className="space-y-1"><Label htmlFor="q-date">Date</Label>
                            <Input id="q-date" type="date" value={draft.date} disabled={readOnly} onChange={e => set({ date: e.target.value })} /></div>
                        <div className="space-y-1"><Label>Validité (jours)</Label>
                            <NumberField value={draft.validityDays} disabled={readOnly} onChange={v => set({ validityDays: Math.max(1, Math.round(v ?? 30)) })} />
                            <p className="text-xs text-muted-foreground">
                                {/^\d{4}-\d{2}-\d{2}$/.test(draft.date)
                                    ? `Valable jusqu'au ${new Date(addDays(draft.date, draft.validityDays)).toLocaleDateString('fr-FR')}`
                                    : 'Date du devis à renseigner'}
                            </p></div>
                        <div className="space-y-1"><Label htmlFor="q-start">Début estimé des travaux</Label>
                            <Input id="q-start" type="date" value={draft.estimatedStart ?? ''} disabled={readOnly} onChange={e => set({ estimatedStart: e.target.value })} /></div>
                        <div className="space-y-1"><Label htmlFor="q-duration">Durée estimée</Label>
                            <Input id="q-duration" placeholder="ex. 3 jours" value={draft.estimatedDuration ?? ''} disabled={readOnly} onChange={e => set({ estimatedDuration: e.target.value })} /></div>
                        <div className="space-y-1 md:col-span-2"><Label htmlFor="q-pay">Conditions de paiement</Label>
                            <Input id="q-pay" placeholder="ex. 30 % à la commande, solde à réception" value={draft.paymentTerms ?? ''} disabled={readOnly} onChange={e => set({ paymentTerms: e.target.value })} /></div>
                        <div className="space-y-1 md:col-span-2"><Label htmlFor="q-notes">Conditions particulières (sur le devis)</Label>
                            <Textarea id="q-notes" rows={2} value={draft.notes ?? ''} disabled={readOnly} onChange={e => set({ notes: e.target.value })} /></div>
                        <div className="space-y-1 md:col-span-2"><Label htmlFor="q-internal">Notes internes (jamais affichées au client)</Label>
                            <Textarea id="q-internal" rows={2} value={draft.internalNotes ?? ''} disabled={readOnly} onChange={e => set({ internalNotes: e.target.value })} /></div>
                    </CardContent>
                </Card>

                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Conditions de prix</CardTitle>
                            <CardDescription>Recopiées à la création ; modifiables pour ce devis seulement.</CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-3 grid-cols-2">
                            {([
                                ['coefficient', 'Coefficient de vente'],
                                ['laborRate', 'Taux horaire MO facturé (€ HT/h)'],
                                ['laborCost', 'Coût horaire MO interne (€/h)'],
                                ['defaultVatRate', 'TVA des nouvelles lignes (%)'],
                            ] as const).map(([key, label]) => {
                                const source = key !== 'defaultVatRate' ? draft.pricing.sources?.[key] : undefined;
                                return (
                                    <div key={key} className="space-y-1">
                                        <Label className="text-xs">{label}</Label>
                                        <NumberField value={draft.pricing[key]} disabled={readOnly}
                                            onChange={v => setPricing(key === 'defaultVatRate' ? { defaultVatRate: v ?? 20 } : { [key]: v })} />
                                        {source && <p className="text-xs text-muted-foreground">Repris de la {SOURCE[source]}</p>}
                                        {key !== 'defaultVatRate' && draft.pricing[key] === null && <p className="text-xs text-amber-600">Non renseigné</p>}
                                    </div>
                                );
                            })}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader><CardTitle className="text-base">Totaux</CardTitle></CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="space-y-1">
                                <Row label="Total HT" value={formatEur(totals.totalHT)} strong />
                                {totals.vat.map(v => <Row key={v.rate} label={`TVA ${v.rate.toLocaleString('fr-FR')} % (sur ${formatEur(v.base)})`} value={formatEur(v.amount)} />)}
                                <Row label="Total TTC" value={formatEur(totals.totalTTC)} strong />
                                {totals.optionsHT > 0 && <Row label="Options (non comptées)" value={`${formatEur(totals.optionsHT)} HT`} muted />}
                            </div>
                            <div className="space-y-1 rounded-md bg-muted/50 p-3">
                                <p className="text-xs font-medium text-muted-foreground">Interne</p>
                                <Row label="Déboursé" value={formatEur(totals.totalCost)} />
                                <Row label="Marge" value={`${formatEur(totals.margin)} (${formatPct(totals.marginRate)})`} strong />
                                <Row label="Coefficient effectif" value={totals.effectiveCoefficient?.toLocaleString('fr-FR') ?? '—'} />
                                <Row label="Heures de main-d'œuvre" value={`${totals.laborHours.toLocaleString('fr-FR')} h`} />
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            <Card>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">Lignes</CardTitle>
                    {!readOnly && (
                        <div className="flex flex-wrap gap-1">
                            <LibraryPicker pricing={draft.pricing} onAdd={line => setDraft(d => (d ? { ...d, lines: [...d.lines, line] } : d))} />
                            {ADDABLE.map(k => (
                                <Button key={k} size="sm" variant="outline" onClick={() => addLine(k)}><Plus className="mr-1 h-3 w-3" />{QUOTE_LINE_KIND_LABELS[k]}</Button>
                            ))}
                        </div>
                    )}
                </CardHeader>
                <CardContent className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="text-xs text-muted-foreground">
                            <tr className="border-b">
                                <th className="p-1 text-left w-24">Nature</th>
                                <th className="p-1 text-left min-w-56">Désignation</th>
                                <th className="p-1 w-16">Unité</th>
                                <th className="p-1 w-20">Qté</th>
                                <th className="p-1 w-24">Déboursé u.</th>
                                <th className="p-1 w-20">Coef.</th>
                                <th className="p-1 w-28">PU HT</th>
                                <th className="p-1 w-16">Remise %</th>
                                <th className="p-1 w-16">TVA %</th>
                                <th className="p-1 w-28 text-right">Total HT</th>
                                <th className="p-1 w-10" title="Option : affichée, non comptée">Opt.</th>
                                <th className="p-1 w-24" />
                            </tr>
                        </thead>
                        <tbody>
                            {computed.length === 0 && (
                                <tr><td colSpan={12} className="p-6 text-center text-muted-foreground">Aucune ligne : ajoutez un titre, des fournitures, de la main-d'œuvre…</td></tr>
                            )}
                            {computed.map((l, i) => {
                                const priced = isPriced(l);
                                const actions = !readOnly && (
                                    <td className="p-1 whitespace-nowrap text-right">
                                        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Monter" onClick={() => move(i, -1)}><ArrowUp className="h-3 w-3" /></Button>
                                        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Descendre" onClick={() => move(i, 1)}><ArrowDown className="h-3 w-3" /></Button>
                                        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Supprimer la ligne"
                                            onClick={() => set({ lines: draft.lines.filter((_, j) => j !== i) })}><Trash2 className="h-3 w-3" /></Button>
                                    </td>
                                );
                                if (!priced) {
                                    return (
                                        <tr key={l.id} className={`border-b ${l.kind === 'TITRE' ? 'bg-muted/40 font-medium' : ''}`}>
                                            <td className="p-1 text-xs text-muted-foreground">{QUOTE_LINE_KIND_LABELS[l.kind]}</td>
                                            <td className="p-1" colSpan={l.kind === 'TEXTE' ? 9 : 8}>
                                                <div className="flex items-center gap-2" style={{ paddingLeft: `${(l.level ?? 0) * 16}px` }}>
                                                    {l.kind === 'TITRE' && !readOnly && (
                                                        <Select value={String(l.level ?? 0)} onValueChange={v => setLine(i, { level: Number(v) })}>
                                                            <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
                                                            <SelectContent><SelectItem value="0">Niv. 1</SelectItem><SelectItem value="1">Niv. 2</SelectItem><SelectItem value="2">Niv. 3</SelectItem></SelectContent>
                                                        </Select>
                                                    )}
                                                    {l.kind === 'TEXTE'
                                                        ? <Textarea rows={1} value={l.label} disabled={readOnly} onChange={e => setLine(i, { label: e.target.value })} />
                                                        : <Input className="h-8" value={l.label} disabled={readOnly} onChange={e => setLine(i, { label: e.target.value })} />}
                                                </div>
                                            </td>
                                            {l.kind !== 'TEXTE' && <td className="p-1 text-right font-medium">{formatEur(l.groupHT ?? 0)}</td>}
                                            <td />
                                            {actions || <td />}
                                        </tr>
                                    );
                                }
                                const mo = l.kind === 'MAIN_OEUVRE';
                                const work = l.kind === 'OUVRAGE';
                                const open = work && expanded.has(l.id);
                                const setComponent = (j: number, patch: { quantity?: number; unitCost?: number | null }) =>
                                    setLine(i, { components: (l.components ?? []).map((c, k) => (k === j ? { ...c, ...patch } : c)) });
                                return (
                                    <Fragment key={l.id}>
                                    <tr className={`border-b ${l.optional ? 'text-muted-foreground italic' : ''}`}>
                                        <td className="p-1 text-xs">
                                            {work ? (
                                                <button type="button" className="underline" aria-expanded={open}
                                                    onClick={() => setExpanded(s => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })}>
                                                    {open ? '▾' : '▸'} Ouvrage
                                                </button>
                                            ) : QUOTE_LINE_KIND_LABELS[l.kind]}
                                            {l.source?.code && <span className="block font-mono text-[10px] text-muted-foreground">{l.source.code}</span>}
                                        </td>
                                        <td className="p-1"><Input className="h-8" value={l.label} disabled={readOnly} onChange={e => setLine(i, { label: e.target.value })} /></td>
                                        <td className="p-1"><Input className="h-8" value={l.unit ?? ''} disabled={readOnly} onChange={e => setLine(i, { unit: e.target.value })} /></td>
                                        <td className="p-1"><NumberField className="h-8" ariaLabel="Quantité" value={l.quantity} disabled={readOnly} onChange={v => setLine(i, { quantity: v ?? 0 })} /></td>
                                        <td className="p-1">{work
                                            ? <span className="text-xs" title="Somme des composants">{(() => { const c = unitCostOf(l, draft.pricing); return c === null ? '?' : formatEur(c); })()}</span>
                                            : <NumberField className="h-8" ariaLabel="Déboursé unitaire" value={l.unitCost} disabled={readOnly}
                                                placeholder={mo ? String(draft.pricing.laborCost ?? '') : ''} onChange={v => setLine(i, { unitCost: v })} />}</td>
                                        <td className="p-1">{mo ? <span className="text-xs text-muted-foreground">—</span>
                                            : <NumberField className="h-8" ariaLabel="Coefficient" value={l.coefficient} disabled={readOnly}
                                                placeholder={String(draft.pricing.coefficient ?? '').replace('.', ',')} onChange={v => setLine(i, { coefficient: v })} />}</td>
                                        <td className="p-1"><NumberField className="h-8" ariaLabel="Prix unitaire HT" value={l.unitPriceOverride} disabled={readOnly}
                                            placeholder={l.unitPrice === null ? '?' : l.unitPrice.toLocaleString('fr-FR')} onChange={v => setLine(i, { unitPriceOverride: v })} /></td>
                                        <td className="p-1"><NumberField className="h-8" ariaLabel="Remise" value={l.discountPct} disabled={readOnly} onChange={v => setLine(i, { discountPct: v ?? 0 })} /></td>
                                        <td className="p-1"><NumberField className="h-8" ariaLabel="TVA" value={l.vatRate} disabled={readOnly} onChange={v => setLine(i, { vatRate: v ?? 0 })} /></td>
                                        <td className="p-1 text-right">{l.unitPrice === null ? <span className="text-amber-600">non calculable</span> : formatEur(l.totalHT)}</td>
                                        <td className="p-1 text-center"><Checkbox checked={!!l.optional} disabled={readOnly} onCheckedChange={v => setLine(i, { optional: v === true })} /></td>
                                        {actions || <td />}
                                    </tr>
                                    {open && (l.components ?? []).map((c, j) => (
                                        <tr key={`${l.id}-c${j}`} className="border-b bg-muted/30 text-xs">
                                            <td className="p-1 pl-4 text-muted-foreground">{QUOTE_LINE_KIND_LABELS[c.kind]}</td>
                                            <td className="p-1 pl-4">{c.code && <span className="font-mono">{c.code} </span>}{c.label}</td>
                                            <td className="p-1">{c.unit}</td>
                                            <td className="p-1"><NumberField className="h-7" ariaLabel={`Quantité de ${c.label} par unité`} value={c.quantity} disabled={readOnly}
                                                onChange={v => setComponent(j, { quantity: v ?? 0 })} /></td>
                                            <td className="p-1"><NumberField className="h-7" ariaLabel={`Déboursé de ${c.label}`} value={c.unitCost} disabled={readOnly}
                                                placeholder={c.kind === 'MAIN_OEUVRE' ? String(draft.pricing.laborCost ?? '') : ''} onChange={v => setComponent(j, { unitCost: v })} /></td>
                                            <td className="p-1 text-muted-foreground" colSpan={7}>par unité d'ouvrage</td>
                                        </tr>
                                    ))}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                    <p className="mt-2 text-xs text-muted-foreground">
                        PU HT vide = calculé (déboursé × coefficient ; main-d'œuvre : taux horaire ; ouvrage : somme de ses composants). Saisir un PU HT l'impose.
                        Le détail d'un ouvrage (▸) reste interne : le client ne voit que sa ligne.
                    </p>
                </CardContent>
            </Card>

            {issues.length > 0 && (
                <Card>
                    <CardHeader><CardTitle className="text-base">À corriger avant l'envoi</CardTitle></CardHeader>
                    <CardContent className="text-sm space-y-1">{issues.map(m => <p key={m} className="text-amber-600">• {m}</p>)}</CardContent>
                </Card>
            )}
        </div>
    );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
    return (
        <div className={`flex justify-between gap-4 ${strong ? 'font-semibold' : ''} ${muted ? 'text-muted-foreground' : ''}`}>
            <span>{label}</span><span>{value}</span>
        </div>
    );
}
