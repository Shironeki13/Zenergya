'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Loader2, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { NumberField } from '@/components/quotes/number-field';
import { formatEur } from '@/components/quotes/format';
import { articleToLine, workToLine } from '@/lib/library/insert';
import { unitPriceOf } from '@/lib/quotes/pricing';
import { QUOTE_LINE_KIND_LABELS, type QuoteLine, type QuotePricing } from '@/lib/quotes/types';
import type { PriceArticle, PriceWork } from '@/lib/library/types';
import { getArticles, getWorks } from '@/services/library';

type Entry = { type: 'article'; item: PriceArticle } | { type: 'work'; item: PriceWork };

/**
 * Ajout d'articles et d'ouvrages de la bibliothèque dans un devis (recopie), avec le prix
 * qu'ils prendront selon les conditions du devis.
 */
export function LibraryPicker({ pricing, onAdd }: { pricing: QuotePricing; onAdd: (line: QuoteLine) => void }) {
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [articles, setArticles] = useState<PriceArticle[] | null>(null);
    const [works, setWorks] = useState<PriceWork[]>([]);
    const [search, setSearch] = useState('');
    const [quantities, setQuantities] = useState<Record<string, number | null>>({});

    useEffect(() => {
        if (!open || articles) return;
        Promise.all([getArticles(), getWorks()])
            .then(([a, w]) => { setArticles(a); setWorks(w); })
            .catch(() => toast({ title: 'Bibliothèque indisponible', variant: 'destructive' }));
    }, [open, articles, toast]);

    const byId = useMemo(() => new Map((articles ?? []).map(a => [a.id, a])), [articles]);
    const entries = useMemo<Entry[]>(() => {
        const s = search.trim().toLowerCase();
        const match = (v: (string | undefined)[]) => !s || v.some(x => (x ?? '').toLowerCase().includes(s));
        return [
            ...works.filter(w => w.active && match([w.code, w.label, w.family])).map(item => ({ type: 'work' as const, item })),
            ...(articles ?? []).filter(a => a.active && match([a.code, a.label, a.family, a.supplierRef])).map(item => ({ type: 'article' as const, item })),
        ].slice(0, 60);
    }, [articles, works, search]);

    const toLine = (e: Entry, quantity: number): QuoteLine => (e.type === 'article'
        ? articleToLine(e.item, { quantity, vatRate: pricing.defaultVatRate })
        : workToLine(e.item, byId, { quantity, vatRate: pricing.defaultVatRate }));

    const add = (e: Entry) => {
        const quantity = quantities[e.item.id] ?? 1;
        if (!(quantity > 0)) return;
        try {
            onAdd(toLine(e, quantity));
            toast({ title: 'Ajouté au devis', description: `${e.item.code} — ${e.item.label} × ${quantity.toLocaleString('fr-FR')}` });
        } catch (err) {
            toast({ title: 'Ajout impossible', description: (err as Error).message, variant: 'destructive' });
        }
    };

    const price = (e: Entry) => {
        try { return unitPriceOf(toLine(e, 1), pricing); } catch { return null; }
    };

    return (
        <>
            <Button size="sm" onClick={() => setOpen(true)}><BookOpen className="mr-1 h-3 w-3" />Bibliothèque</Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Ajouter depuis la bibliothèque</DialogTitle>
                        <DialogDescription>Articles et ouvrages recopiés dans le devis, chiffrés selon ses conditions de prix. Les lignes s'ajoutent en fin de devis.</DialogDescription>
                    </DialogHeader>
                    <Input autoFocus placeholder="Code, libellé, famille…" value={search} onChange={e => setSearch(e.target.value)} />
                    {!articles ? <Loader2 className="mx-auto h-6 w-6 animate-spin" /> : (
                        <ScrollArea className="max-h-[55vh] pr-3">
                            <ul className="divide-y rounded-md border">
                                {entries.length === 0 && <li className="p-3 text-sm text-muted-foreground">Aucun résultat.</li>}
                                {entries.map(e => {
                                    const p = price(e);
                                    return (
                                        <li key={`${e.type}-${e.item.id}`} className="grid grid-cols-[1fr_6rem_auto] items-center gap-2 p-2 text-sm">
                                            <div className="min-w-0">
                                                <p>
                                                    <Badge variant={e.type === 'work' ? 'default' : 'outline'} className="mr-2">
                                                        {e.type === 'work' ? 'Ouvrage' : QUOTE_LINE_KIND_LABELS[(e.item as PriceArticle).kind]}
                                                    </Badge>
                                                    <span className="font-mono text-xs">{e.item.code}</span> {e.item.label}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {p === null ? 'prix non calculable avec les conditions du devis' : `${formatEur(p)} HT / ${e.item.unit}`}
                                                    {e.type === 'work' && ` — ${e.item.components.length} article(s)`}
                                                </p>
                                            </div>
                                            <NumberField ariaLabel="Quantité" className="h-8" value={quantities[e.item.id] ?? 1}
                                                onChange={v => setQuantities(q => ({ ...q, [e.item.id]: v }))} />
                                            <Button size="sm" variant="outline" onClick={() => add(e)}><Plus className="mr-1 h-3 w-3" />Ajouter</Button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </ScrollArea>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
