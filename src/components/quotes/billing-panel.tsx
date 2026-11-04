'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Receipt } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { NumberField } from '@/components/quotes/number-field';
import { formatEur } from '@/components/quotes/format';
import { allowedBillingKinds, billingSummary, buildQuoteInvoice, type QuoteBillingRequest } from '@/lib/quotes/billing';
import { invoiceQuoteAction } from '@/lib/quotes/actions';
import type { Quote } from '@/lib/quotes/types';
import type { Invoice } from '@/lib/types';
import { getQuoteInvoices } from '@/services/quotes';

const KIND_LABELS = { acompte: 'Acompte', solde: 'Solde', totale: 'Totalité' } as const;
const STATUS_LABELS: Record<string, string> = { due: 'À payer', overdue: 'En retard', paid: 'Payée', cancelled: 'Annulée (avoir)', proforma: 'Proforma' };

/**
 * Facturation d'un devis accepté : factures émises, reste à facturer, et émission
 * d'une facture de totalité, d'acompte ou de solde (numéro légal attribué par le serveur).
 */
export function QuoteBilling({ quote }: { quote: Quote }) {
    const { toast } = useToast();
    const [invoices, setInvoices] = useState<Invoice[] | null>(null);
    const [dialog, setDialog] = useState<QuoteBillingRequest['kind'] | null>(null);
    const [percent, setPercent] = useState<number | null>(30);
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
        getQuoteInvoices(quote.id).then(setInvoices).catch(() => setInvoices([]));
    }, [quote.id]);
    useEffect(() => { load(); }, [load]);

    const summary = useMemo(() => (invoices ? billingSummary(quote, invoices) : null), [quote, invoices]);
    const allowed = summary ? allowedBillingKinds(summary) : [];

    // Aperçu de la facture demandée, calculé comme le fera le serveur.
    const preview = useMemo(() => {
        if (!dialog || !invoices) return null;
        try {
            const request: QuoteBillingRequest = dialog === 'acompte' ? { kind: 'acompte', percent: percent ?? 0 } : { kind: dialog };
            return { draft: buildQuoteInvoice(quote, request, invoices), error: null };
        } catch (e) {
            return { draft: null, error: (e as Error).message };
        }
    }, [dialog, percent, quote, invoices]);

    const issue = async () => {
        if (!dialog) return;
        setBusy(true);
        const request: QuoteBillingRequest = dialog === 'acompte' ? { kind: 'acompte', percent: percent ?? 0 } : { kind: dialog };
        const result = await invoiceQuoteAction(quote.id, request);
        setBusy(false);
        if (!result.success) {
            toast({ title: 'Facturation impossible', description: result.error, variant: 'destructive' });
            return;
        }
        setDialog(null);
        load();
        toast({ title: 'Facture émise', description: `${result.invoiceNumber} — ${KIND_LABELS[request.kind]}` });
    };

    if (!invoices || !summary) return <Card><CardContent className="p-6"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></CardContent></Card>;

    const billedPct = quote.totals.totalTTC > 0 ? Math.min(100, (summary.invoicedTTC / quote.totals.totalTTC) * 100) : 0;

    return (
        <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
                <div>
                    <CardTitle className="text-base">Facturation</CardTitle>
                    <CardDescription>
                        Facturé {formatEur(summary.invoicedTTC)} sur {formatEur(quote.totals.totalTTC)} TTC
                        {summary.complete ? ' — entièrement facturé' : ` — reste ${formatEur(summary.remainingTTC)}`}
                    </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                    {allowed.includes('totale') && <Button onClick={() => setDialog('totale')}><Receipt className="mr-2 h-4 w-4" />Facturer la totalité</Button>}
                    {allowed.includes('acompte') && <Button variant="outline" onClick={() => setDialog('acompte')}>Facturer un acompte</Button>}
                    {allowed.includes('solde') && <Button onClick={() => setDialog('solde')}><Receipt className="mr-2 h-4 w-4" />Facturer le solde</Button>}
                </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
                <Progress value={billedPct} />
                {invoices.length === 0 ? (
                    <p className="text-muted-foreground">Aucune facture émise.</p>
                ) : (
                    <ul className="divide-y rounded-md border">
                        {invoices.map(inv => (
                            <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                                <span>
                                    <Link className="underline font-mono" href={`/invoices/${inv.id}`}>{inv.invoiceNumber}</Link>
                                    {' — '}{inv.quote ? KIND_LABELS[inv.quote.billingKind] : 'Facture'}
                                    {inv.quote?.percent ? ` ${inv.quote.percent.toLocaleString('fr-FR')} %` : ''}
                                    {' — '}{new Date(inv.date).toLocaleDateString('fr-FR')}
                                </span>
                                <span className="flex items-center gap-2">
                                    {formatEur(inv.total)} TTC
                                    <Badge variant={inv.status === 'cancelled' ? 'outline' : inv.status === 'paid' ? 'default' : 'secondary'}>{STATUS_LABELS[inv.status] ?? inv.status}</Badge>
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
                {summary.hasDeposits && !summary.complete && (
                    <p className="text-muted-foreground">Acomptes facturés : {summary.depositPercent.toLocaleString('fr-FR')} % du devis.</p>
                )}
            </CardContent>

            <Dialog open={!!dialog} onOpenChange={o => !o && setDialog(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{dialog === 'acompte' ? "Facture d'acompte" : dialog === 'solde' ? 'Facture de solde' : 'Facture de la totalité'}</DialogTitle>
                        <DialogDescription>
                            Facture émise immédiatement avec un numéro définitif, puis archivée. Une erreur se corrige par un avoir.
                        </DialogDescription>
                    </DialogHeader>
                    {dialog === 'acompte' && (
                        <div className="space-y-1">
                            <Label>Acompte (% du devis)</Label>
                            <NumberField value={percent} onChange={setPercent} />
                            {summary.depositPercent > 0 && <p className="text-xs text-muted-foreground">Déjà facturé en acomptes : {summary.depositPercent.toLocaleString('fr-FR')} %.</p>}
                        </div>
                    )}
                    {preview?.error && <p className="text-sm text-destructive">{preview.error}</p>}
                    {preview?.draft && (
                        <div className="rounded-md border p-3 text-sm space-y-1">
                            {dialog === 'solde' && preview.draft.deposits.map(d => (
                                <p key={d.invoiceId} className="text-muted-foreground">Déduction de l'acompte {d.invoiceNumber} : −{formatEur(d.subtotal)} HT</p>
                            ))}
                            <div className="flex justify-between"><span>Total HT</span><span>{formatEur(preview.draft.subtotal)}</span></div>
                            {preview.draft.vatBreakdown.map(v => (
                                <div key={v.rate} className="flex justify-between text-muted-foreground"><span>TVA {v.rate.toLocaleString('fr-FR')} %</span><span>{formatEur(v.amount)}</span></div>
                            ))}
                            <div className="flex justify-between font-semibold"><span>Total TTC</span><span>{formatEur(preview.draft.total)}</span></div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialog(null)}>Annuler</Button>
                        <Button disabled={busy || !preview?.draft} onClick={issue}>
                            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Émettre la facture
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
