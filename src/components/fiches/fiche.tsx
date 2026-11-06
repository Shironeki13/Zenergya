'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Modèle des fiches (site, contrat, client) : bandeau, indicateurs cliquables, encart « à faire » avec ses actions,
 * onglets conservés dans l'adresse (?onglet=). Voir docs/ergonomie.md.
 */

/** Onglet courant d'une fiche, lu et écrit dans l'adresse (?onglet=) : lien direct, rechargement, retour arrière. */
export function useOngletUrl<T extends string>(onglets: readonly T[], defaut: T): [T, (o: T) => void] {
    const [onglet, setOnglet] = useState<T>(defaut);
    useEffect(() => {
        const o = new URLSearchParams(window.location.search).get('onglet');
        if (o && (onglets as readonly string[]).includes(o)) setOnglet(o as T);
    }, [onglets]);
    const changer = useCallback((o: T) => {
        setOnglet(o);
        const u = new URL(window.location.href);
        u.searchParams.set('onglet', o);
        window.history.replaceState(window.history.state, '', u);
    }, []);
    return [onglet, changer];
}

// ── Bandeau ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function Indicateur({ titre, valeur, detail, alerte, onClick }: { titre: string; valeur: string; detail?: string; alerte?: boolean; onClick?: () => void }) {
    return (
        <Card className={cn(alerte && 'border-amber-300', onClick && 'cursor-pointer transition-colors hover:bg-muted/40')} onClick={onClick}>
            <CardContent className="px-4 py-3">
                <p className="text-xs font-medium text-muted-foreground">{titre}</p>
                <p className={cn('text-xl font-bold', alerte && 'text-amber-700')}>{valeur}</p>
                {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
            </CardContent>
        </Card>
    );
}

// ── À faire ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type PointAFaire = { id: string; gravite: 'bloquant' | 'attention'; texte: string; action?: { label: string; onClick: () => void } };

/** Nombre de points « à faire » : rouge s'il y a un point bloquant, orange sinon (jamais vert : il reste à faire). */
export function CompteurAFaire({ points, className }: { points: PointAFaire[]; className?: string }) {
    if (!points.length) return null;
    const bloquant = points.some(p => p.gravite === 'bloquant');
    return (
        <Badge variant={bloquant ? 'destructive' : 'outline'} className={cn('h-5 px-1.5 text-[10px]', !bloquant && 'border-amber-400 bg-amber-50 text-amber-800', className)}>
            {points.length}
        </Badge>
    );
}

export function AFaire({ points, chargement, description = 'Ce qui empêche ou fragilise la facturation.' }: { points: PointAFaire[]; chargement?: boolean; description?: string }) {
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                    À faire <CompteurAFaire points={points} />
                    {chargement && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                </CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
                {points.length === 0 ? (
                    <p className="flex items-center gap-2 text-sm text-green-700"><CheckCircle2 className="h-4 w-4" />Rien à signaler.</p>
                ) : (
                    <ul className="space-y-2">
                        {points.map(p => (
                            <li key={p.id} className="flex items-start gap-2 text-sm">
                                <AlertTriangle className={cn('mt-0.5 h-4 w-4 shrink-0', p.gravite === 'bloquant' ? 'text-destructive' : 'text-amber-600')} />
                                <span className="flex-1">{p.texte}</span>
                                {p.action && (
                                    <Button variant="link" size="sm" className="h-auto shrink-0 p-0 text-xs" onClick={p.action.onClick}>
                                        {p.action.label}<ChevronRight className="h-3 w-3" />
                                    </Button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}

// ── Factures ────────────────────────────────────────────────────────────────────────────────────────────────────

export const STATUTS_FACTURE: Record<string, string> = { paid: 'Payée', due: 'À payer', overdue: 'En retard', proforma: 'Proforma', cancelled: 'Annulée' };

export function StatutFacture({ statut }: { statut: string }) {
    return <Badge variant={statut === 'overdue' ? 'destructive' : statut === 'paid' ? 'secondary' : 'outline'}>{STATUTS_FACTURE[statut] ?? statut}</Badge>;
}

export const eur0 = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
export const jourFr = (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
