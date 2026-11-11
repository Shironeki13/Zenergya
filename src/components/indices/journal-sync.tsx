'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { dernieresSyncsAction } from '@/lib/indices/actions';
import type { RapportSync } from '@/services/index-sync';

/**
 * Dernier passage de la synchronisation des indices (planifiée ou lancée à la main) : sources en échec, valeurs
 * rejetées par les contrôles, indices en retard. `version` : à changer pour relire le journal (après un passage).
 */
export function JournalSyncIndices({ version = 0 }: { version?: number }) {
    const [passages, setPassages] = useState<RapportSync[] | null>(null);
    useEffect(() => { dernieresSyncsAction(5).then(r => setPassages(r.success ? r.data : [])); }, [version]);
    if (!passages) return null;
    const r = passages[0];
    if (!r) return (
        <Card><CardContent className="py-3 text-sm text-muted-foreground">Synchronisation automatique : aucun passage enregistré pour l&apos;instant.</CardContent></Card>
    );
    const problemes = r.sources.filter(s => s.statut !== 'ok');
    const quand = new Date(r.le).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    return (
        <Card className={problemes.length ? 'border-amber-300' : undefined}>
            <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                    {problemes.length ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : <CheckCircle2 className="h-4 w-4 text-green-700" />}
                    Synchronisation des indices
                </CardTitle>
                <CardDescription>
                    Dernier passage le {quand} ({r.declencheur === 'planifie' ? 'planifié' : 'lancé à la main'}) : {r.sources.length} sources, {r.nouvelles} nouvelle(s) valeur(s), {r.modifiees} révisée(s)
                    {problemes.length ? `, ${problemes.length} à regarder` : ', tout est à jour'}.
                </CardDescription>
            </CardHeader>
            {problemes.length > 0 && (
                <CardContent className="space-y-1 text-sm">
                    {problemes.map(s => (
                        <div key={s.code} className="flex items-start gap-2">
                            {s.statut === 'erreur' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
                            <p>
                                <span className="font-medium">{s.code}</span>{' : '}
                                {s.statut === 'erreur' && `source en échec (${s.erreur}).`}
                                {s.statut !== 'erreur' && (s.retardMois ?? 0) > 0 && `en retard de ${s.retardMois} mois (dernière valeur : ${s.dernierePeriode ?? 'aucune'}). `}
                                {s.rejetees.length > 0 && `${s.rejetees.length} valeur(s) rejetée(s) : ${s.rejetees.map(x => `${x.period} = ${x.value} (${x.motif})`).join(' ; ')}`}
                            </p>
                        </div>
                    ))}
                </CardContent>
            )}
        </Card>
    );
}
