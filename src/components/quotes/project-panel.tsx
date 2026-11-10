'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Briefcase, Link2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { NumberField } from '@/components/quotes/number-field';
import { attachQuoteAction, createDirectProjectAction, createProjectAction } from '@/lib/projects/actions';
import { LIBELLE_FACTURATION } from '@/lib/projects/affaire';
import type { Project } from '@/lib/projects/types';
import type { Quote } from '@/lib/quotes/types';
import { getProjects } from '@/services/projects';

/** Affaires ouvertes du client d'un devis (rattachement d'un devis complémentaire). */
export function useAffairesClient(clientId: string, companyId: string, actif: boolean): Project[] {
    const [affaires, setAffaires] = useState<Project[]>([]);
    useEffect(() => {
        if (!actif) return;
        getProjects().then(l => setAffaires(l.filter(p => p.clientId === clientId && p.companyId === companyId && p.status !== 'cloture').sort((a, b) => b.code.localeCompare(a.code)))).catch(() => setAffaires([]));
    }, [clientId, companyId, actif]);
    return affaires;
}

/**
 * Affaire d'un devis accepté : lien vers elle ; sinon création (P5 : facturation directe ; P6 : par situations, avec
 * retenue de garantie) ou rattachement à une affaire existante du client (devis complémentaire).
 */
export function QuoteProject({ quote }: { quote: Quote }) {
    const router = useRouter();
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [retentionPct, setRetentionPct] = useState<number | null>(5);
    const [bond, setBond] = useState(false);
    const [busy, setBusy] = useState(false);
    const [cible, setCible] = useState('');
    const affaires = useAffairesClient(quote.clientId, quote.companyId, !quote.projectId);

    if (quote.projectId) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Affaire</CardTitle>
                    <CardDescription>
                        Ce devis fait partie de l&apos;affaire <Link className="underline font-mono" href={`/projects/${quote.projectId}`}>{quote.projectCode}</Link>
                        {' '}— facturation {LIBELLE_FACTURATION[quote.projectBilling ?? 'situations'].toLowerCase()}. Le budget, l&apos;analytique et la rentabilité se suivent sur l&apos;affaire.
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    }

    const fin = (titre: string, result: Awaited<ReturnType<typeof createProjectAction>>) => {
        setBusy(false);
        if (!result.success) { toast({ title: 'Opération impossible', description: result.error, variant: 'destructive' }); return; }
        toast({ title: titre, description: result.data.code });
        router.push(`/projects/${result.data.id}`);
    };
    const create = async () => { setBusy(true); fin('Affaire créée', await createProjectAction(quote.id, { retentionPct: retentionPct ?? 0, retentionBond: bond })); };
    const direct = async () => { setBusy(true); fin('Affaire créée', await createDirectProjectAction(quote.id)); };
    const rattacher = async () => { if (!cible) return; setBusy(true); fin('Devis rattaché à l\'affaire', await attachQuoteAction(quote.id, cible)); };

    return (
        <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
                <div>
                    <CardTitle className="text-base">Affaire</CardTitle>
                    <CardDescription>
                        {quote.mode === 'P6'
                            ? 'Le devis devient une affaire, facturée chaque mois selon l\'avancement des travaux (situations).'
                            : 'Le devis devient une affaire (budget, analytique, rentabilité) ; il se facture directement : acompte, solde ou totalité.'}
                    </CardDescription>
                </div>
                {quote.mode === 'P6'
                    ? <Button onClick={() => setOpen(true)}><Briefcase className="mr-2 h-4 w-4" />Créer l&apos;affaire</Button>
                    : <Button disabled={busy} onClick={direct}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Briefcase className="mr-2 h-4 w-4" />}Créer l&apos;affaire</Button>}
            </CardHeader>
            {affaires.length > 0 && (
                <CardContent className="flex flex-wrap items-end gap-2 border-t pt-4">
                    <div className="space-y-1">
                        <Label htmlFor="affaire-cible">Devis complémentaire : le rattacher à une affaire existante du client</Label>
                        <Select value={cible} onValueChange={setCible}>
                            <SelectTrigger id="affaire-cible" className="w-[420px] max-w-full"><SelectValue placeholder="Choisir une affaire…" /></SelectTrigger>
                            <SelectContent>{affaires.map(p => <SelectItem key={p.id} value={p.id}>{p.code} — {p.title}</SelectItem>)}</SelectContent>
                        </Select>
                    </div>
                    <Button variant="outline" disabled={!cible || busy} onClick={rattacher}><Link2 className="mr-2 h-4 w-4" />Rattacher</Button>
                </CardContent>
            )}
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Créer l&apos;affaire</DialogTitle>
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
                            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Créer l&apos;affaire
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
