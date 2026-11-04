'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Briefcase, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { NumberField } from '@/components/quotes/number-field';
import { createProjectAction } from '@/lib/projects/actions';
import type { Quote } from '@/lib/quotes/types';

/** Devis accepté facturé à l'avancement (P6) : création de l'affaire, ou lien vers elle. */
export function QuoteProject({ quote }: { quote: Quote }) {
    const router = useRouter();
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [retentionPct, setRetentionPct] = useState<number | null>(5);
    const [bond, setBond] = useState(false);
    const [busy, setBusy] = useState(false);

    if (quote.projectId) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Facturation à l'avancement</CardTitle>
                    <CardDescription>
                        Facturé par situations dans l'affaire <Link className="underline font-mono" href={`/projects/${quote.projectId}`}>{quote.projectCode}</Link>.
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    }

    const create = async () => {
        setBusy(true);
        const result = await createProjectAction(quote.id, { retentionPct: retentionPct ?? 0, retentionBond: bond });
        setBusy(false);
        if (!result.success) {
            toast({ title: 'Création impossible', description: result.error, variant: 'destructive' });
            return;
        }
        toast({ title: 'Affaire créée', description: result.data.code });
        router.push(`/projects/${result.data.id}`);
    };

    return (
        <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
                <div>
                    <CardTitle className="text-base">Facturation à l'avancement (P6)</CardTitle>
                    <CardDescription>Le devis devient une affaire, facturée chaque mois selon l'avancement des travaux.</CardDescription>
                </div>
                <Button onClick={() => setOpen(true)}><Briefcase className="mr-2 h-4 w-4" />Créer l'affaire</Button>
            </CardHeader>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Créer l'affaire</DialogTitle>
                        <DialogDescription>
                            Les lignes chiffrées du devis forment le marché (quantités et prix figés). Le devis ne pourra plus être
                            facturé directement (acompte, totalité) : tout passera par les situations.
                        </DialogDescription>
                    </DialogHeader>
                    <CardContent className="space-y-3 p-0">
                        <div className="space-y-1">
                            <Label>Retenue de garantie (% du TTC de chaque situation)</Label>
                            <NumberField value={bond ? 0 : retentionPct} disabled={bond} onChange={setRetentionPct} />
                            <p className="text-xs text-muted-foreground">Généralement 5 % ; libérée à la fin du délai de garantie après la réception.</p>
                        </div>
                        <label className="flex items-center gap-2 text-sm">
                            <Checkbox checked={bond} onCheckedChange={v => setBond(v === true)} />
                            Retenue remplacée par une caution bancaire (aucune retenue sur les situations)
                        </label>
                    </CardContent>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
                        <Button disabled={busy || (!bond && retentionPct === null)} onClick={create}>
                            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Créer l'affaire
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
