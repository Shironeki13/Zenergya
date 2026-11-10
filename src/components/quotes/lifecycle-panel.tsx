'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAffairesClient } from '@/components/quotes/project-panel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Ban, CheckCircle2, CopyPlus, FileDown, Loader2, Send, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { formatEur } from '@/components/quotes/format';
import { availableActions, effectiveStatus } from '@/lib/quotes/lifecycle';
import {
    acceptQuoteAction, cancelQuoteAction, newQuoteVersionAction, refuseQuoteAction, sendQuoteAction, type QuoteActionResult,
} from '@/lib/quotes/actions';
import type { Quote, QuoteVersionRecord } from '@/lib/quotes/types';
import { getQuoteVersions } from '@/services/quotes';

const today = () => new Date().toISOString().slice(0, 10);
const frDate = (d?: string) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
const pdfUrl = (id: string, version?: number) => `/api/quotes/${id}/pdf${version ? `?version=${version}` : ''}`;

type DialogKind = 'send' | 'accept' | 'refuse' | 'cancel' | 'newVersion' | null;

/**
 * Actions du cycle de vie (envoyer, accepter, refuser, nouvelle version, annuler), PDF et historique des versions.
 */
export function QuoteActions({ quote, dirty, issues, onChange }: {
    quote: Quote;
    /** Modifications non enregistrées : l'envoi exige un brouillon enregistré. */
    dirty: boolean;
    issues: string[];
    onChange: (q: Quote) => void;
}) {
    const { toast } = useToast();
    const [dialog, setDialog] = useState<DialogKind>(null);
    const [busy, setBusy] = useState(false);
    const status = effectiveStatus(quote);
    const actions = availableActions(quote);

    const [accept, setAccept] = useState({ acceptedAt: today(), signatoryName: '', signatoryRole: '', purchaseOrderNumber: '', comment: '', createSite: true, confirmExpired: false, attachProjectId: '' });
    const affaires = useAffairesClient(quote.clientId, quote.companyId, dialog === 'accept');
    const [refuse, setRefuse] = useState({ refusedAt: today(), reason: '' });
    const [cancelReason, setCancelReason] = useState('');

    const open = (kind: DialogKind) => {
        if (kind === 'accept') setAccept(a => ({ ...a, acceptedAt: today(), signatoryName: quote.contactName ?? '', confirmExpired: false }));
        setDialog(kind);
    };

    const exec = async (label: string, action: () => Promise<QuoteActionResult>) => {
        setBusy(true);
        try {
            const result = await action();
            if (!result.success) throw new Error(result.error);
            onChange(result.quote);
            setDialog(null);
            toast({ title: label, description: `${result.quote.number}${result.quote.version > 1 ? ` V${result.quote.version}` : ''}` });
        } catch (e) {
            toast({ title: 'Action impossible', description: (e as Error).message, variant: 'destructive' });
        } finally {
            setBusy(false);
        }
    };

    const sendBlocked = dirty ? 'Enregistrez le brouillon avant de l\'envoyer.' : issues.length ? 'Devis incomplet : voir « À corriger avant l\'envoi ».' : null;
    const canCreateSite = !quote.siteId && !!quote.interventionAddress?.address;

    return (
        <>
            <div className="flex flex-wrap gap-2">
                <Button variant="outline" asChild>
                    <a href={pdfUrl(quote.id)} target="_blank" rel="noopener noreferrer">
                        <FileDown className="mr-2 h-4 w-4" />{quote.status === 'brouillon' ? 'Aperçu PDF' : 'PDF'}
                    </a>
                </Button>
                {actions.includes('send') && (
                    <Button onClick={() => open('send')} disabled={!!sendBlocked} title={sendBlocked ?? undefined}><Send className="mr-2 h-4 w-4" />Envoyer</Button>
                )}
                {actions.includes('accept') && <Button onClick={() => open('accept')}><CheckCircle2 className="mr-2 h-4 w-4" />Accepté</Button>}
                {actions.includes('refuse') && <Button variant="outline" onClick={() => open('refuse')}><XCircle className="mr-2 h-4 w-4" />Refusé</Button>}
                {actions.includes('newVersion') && <Button variant="outline" onClick={() => open('newVersion')}><CopyPlus className="mr-2 h-4 w-4" />Nouvelle version</Button>}
                {actions.includes('cancel') && <Button variant="ghost" onClick={() => open('cancel')}><Ban className="mr-2 h-4 w-4" />Annuler le devis</Button>}
            </div>
            {sendBlocked && actions.includes('send') && <p className="text-xs text-muted-foreground">{sendBlocked}</p>}

            <Dialog open={dialog === 'send'} onOpenChange={o => !o && setDialog(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Envoyer le devis {quote.number}{quote.version > 1 ? ` V${quote.version}` : ''}</DialogTitle>
                        <DialogDescription>
                            Le devis prend la date du jour et sera <strong>figé</strong> : son PDF est généré et archivé. Pour le modifier
                            ensuite, il faudra créer une nouvelle version. Total : {formatEur(quote.totals.totalTTC)} TTC.
                        </DialogDescription>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">L'envoi au client (email) se fait avec le PDF téléchargé ; l'envoi depuis l'application viendra plus tard.</p>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialog(null)}>Annuler</Button>
                        <Button disabled={busy} onClick={() => exec('Devis envoyé', () => sendQuoteAction(quote.id))}>
                            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Envoyer et figer
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={dialog === 'accept'} onOpenChange={o => !o && setDialog(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Accord du client</DialogTitle>
                        <DialogDescription>À enregistrer à réception du devis signé (« bon pour accord ») ou de la commande.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1"><Label htmlFor="a-date">Date de l'accord</Label>
                            <Input id="a-date" type="date" value={accept.acceptedAt} onChange={e => setAccept(a => ({ ...a, acceptedAt: e.target.value }))} /></div>
                        <div className="space-y-1"><Label htmlFor="a-po">N° de bon de commande</Label>
                            <Input id="a-po" value={accept.purchaseOrderNumber} onChange={e => setAccept(a => ({ ...a, purchaseOrderNumber: e.target.value }))} /></div>
                        <div className="space-y-1"><Label htmlFor="a-name">Signataire *</Label>
                            <Input id="a-name" value={accept.signatoryName} onChange={e => setAccept(a => ({ ...a, signatoryName: e.target.value }))} /></div>
                        <div className="space-y-1"><Label htmlFor="a-role">Qualité</Label>
                            <Input id="a-role" placeholder="ex. Gérant, Directeur technique" value={accept.signatoryRole} onChange={e => setAccept(a => ({ ...a, signatoryRole: e.target.value }))} /></div>
                        <div className="space-y-1 md:col-span-2"><Label htmlFor="a-comment">Commentaire</Label>
                            <Textarea id="a-comment" rows={2} value={accept.comment} onChange={e => setAccept(a => ({ ...a, comment: e.target.value }))} /></div>
                    </div>
                    {quote.prospect && <p className="text-sm">Le prospect <strong>{quote.clientName}</strong> deviendra client.</p>}
                    <div className="space-y-1">
                        <Label htmlFor="a-affaire">Affaire</Label>
                        <Select value={accept.attachProjectId || 'nouvelle'} onValueChange={v => setAccept(a => ({ ...a, attachProjectId: v === 'nouvelle' ? '' : v }))}>
                            <SelectTrigger id="a-affaire"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="nouvelle">{quote.mode === 'P6' ? 'Nouvelle affaire (créée ensuite, facturée par situations)' : 'Nouvelle affaire (créée à l\'acceptation)'}</SelectItem>
                                {affaires.map(p => <SelectItem key={p.id} value={p.id}>Devis complémentaire de {p.code} — {p.title}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">Une affaire par devis accepté ; un devis complémentaire rejoint l&apos;affaire d&apos;origine (même code analytique, budget cumulé).</p>
                    </div>
                    {canCreateSite && (
                        <label className="flex items-center gap-2 text-sm">
                            <Checkbox checked={accept.createSite} onCheckedChange={v => setAccept(a => ({ ...a, createSite: v === true }))} />
                            Créer le site à partir de l'adresse d'intervention ({[quote.interventionAddress?.address, quote.interventionAddress?.city].filter(Boolean).join(', ')})
                        </label>
                    )}
                    {status === 'expire' && (
                        <label className="flex items-center gap-2 text-sm text-amber-700">
                            <Checkbox checked={accept.confirmExpired} onCheckedChange={v => setAccept(a => ({ ...a, confirmExpired: v === true }))} />
                            Le devis n'est plus valable depuis le {frDate(quote.validUntil)} : l'accepter quand même
                        </label>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialog(null)}>Annuler</Button>
                        <Button disabled={busy || !accept.signatoryName.trim() || (status === 'expire' && !accept.confirmExpired)}
                            onClick={() => exec('Devis accepté', () => acceptQuoteAction(quote.id, { ...accept, createSite: canCreateSite && accept.createSite, ...(accept.attachProjectId ? { attachProjectId: accept.attachProjectId } : { attachProjectId: undefined }) }))}>
                            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Enregistrer l'accord
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={dialog === 'refuse'} onOpenChange={o => !o && setDialog(null)}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Refus du client</DialogTitle></DialogHeader>
                    <div className="grid gap-3">
                        <div className="space-y-1"><Label htmlFor="r-date">Date</Label>
                            <Input id="r-date" type="date" value={refuse.refusedAt} onChange={e => setRefuse(r => ({ ...r, refusedAt: e.target.value }))} /></div>
                        <div className="space-y-1"><Label htmlFor="r-reason">Motif *</Label>
                            <Textarea id="r-reason" rows={2} placeholder="ex. Prix, délai, concurrent retenu…" value={refuse.reason} onChange={e => setRefuse(r => ({ ...r, reason: e.target.value }))} /></div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialog(null)}>Annuler</Button>
                        <Button disabled={busy || !refuse.reason.trim()} onClick={() => exec('Refus enregistré', () => refuseQuoteAction(quote.id, refuse))}>
                            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Enregistrer le refus
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={dialog === 'newVersion'} onOpenChange={o => !o && setDialog(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Créer la version {quote.version + 1}</DialogTitle>
                        <DialogDescription>
                            La version {quote.version} reste archivée telle qu'envoyée (PDF conservé). Le devis redevient un brouillon
                            modifiable, sous le même numéro, à renvoyer au client.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialog(null)}>Annuler</Button>
                        <Button disabled={busy} onClick={() => exec(`Version ${quote.version + 1} créée`, () => newQuoteVersionAction(quote.id))}>
                            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Créer la version {quote.version + 1}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={dialog === 'cancel'} onOpenChange={o => !o && setDialog(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Annuler le devis</DialogTitle>
                        <DialogDescription>Le devis reste consultable, avec son numéro et ses versions ; il ne peut plus évoluer.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1"><Label htmlFor="c-reason">Motif *</Label>
                        <Textarea id="c-reason" rows={2} value={cancelReason} onChange={e => setCancelReason(e.target.value)} /></div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialog(null)}>Retour</Button>
                        <Button variant="destructive" disabled={busy || !cancelReason.trim()} onClick={() => exec('Devis annulé', () => cancelQuoteAction(quote.id, cancelReason))}>
                            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Annuler le devis
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

/** Décision du client, annulation, et versions envoyées avec leur PDF. */
export function QuoteHistory({ quote }: { quote: Quote }) {
    const [versions, setVersions] = useState<QuoteVersionRecord[]>([]);
    const load = useCallback(() => { getQuoteVersions(quote.id).then(setVersions).catch(() => setVersions([])); }, [quote.id]);
    // Recharge à chaque changement de version ou de statut (envoi, nouvelle version…).
    useEffect(() => { load(); }, [load, quote.version, quote.status]);

    const a = quote.acceptance;
    return (
        <Card>
            <CardHeader><CardTitle className="text-base">Suivi du devis</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
                {a && (
                    <div className="rounded-md border border-green-200 bg-green-50/50 p-3 space-y-1">
                        <p className="font-medium">Accepté le {frDate(a.acceptedAt)} par {a.signatoryName}{a.signatoryRole ? ` (${a.signatoryRole})` : ''}</p>
                        {a.purchaseOrderNumber && <p>Bon de commande : {a.purchaseOrderNumber}</p>}
                        {a.acceptedExpired && <p className="text-amber-700">Accepté après la fin de validité.</p>}
                        {a.clientConverted && <p>Le prospect est devenu client.</p>}
                        {a.createdSiteId && <p>Site créé : <a className="underline" href={`/sites/${a.createdSiteId}`}>{quote.siteName}</a></p>}
                        {a.comment && <p className="text-muted-foreground">{a.comment}</p>}
                    </div>
                )}
                {quote.refusal && <p className="text-destructive">Refusé le {frDate(quote.refusal.refusedAt)} : {quote.refusal.reason}</p>}
                {quote.cancellation && <p className="text-muted-foreground">Annulé le {frDate(quote.cancellation.cancelledAt)} : {quote.cancellation.reason}</p>}
                {versions.length === 0 ? (
                    <p className="text-muted-foreground">Aucune version envoyée.</p>
                ) : (
                    <ul className="divide-y rounded-md border">
                        {versions.map(v => (
                            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                                <span>
                                    <strong>V{v.version}</strong> — envoyée le {frDate(v.sentAt)}{v.sentBy ? ` par ${v.sentBy}` : ''} — {formatEur(v.totalTTC)} TTC
                                    {v.supersededAt && <Badge variant="outline" className="ml-2">Remplacée</Badge>}
                                </span>
                                <a className="underline" href={pdfUrl(quote.id, v.version)} target="_blank" rel="noopener noreferrer">PDF</a>
                            </li>
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}
