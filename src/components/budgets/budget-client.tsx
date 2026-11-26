'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TuilesBudget } from '@/components/budgets/budget-contrat';
import { TableauGroupesBudget } from '@/components/budgets/groupes-budget';
import { cumuler, parAxe } from '@/lib/budgets/budget';
import { budgetClientAction } from '@/lib/budgets/actions';
import type { BudgetDeContrat } from '@/services/budgets-admin';

/** Budget d'un client : somme des budgets de ses contrats, par contrat ou par activité. */
export function BudgetClient({ clientId }: { clientId: string }) {
    const [annee, setAnnee] = useState(new Date().getFullYear());
    const [contrats, setContrats] = useState<BudgetDeContrat[] | null>(null);
    const [erreur, setErreur] = useState('');
    const [axe, setAxe] = useState<'contrat' | 'activite'>('contrat');
    const charger = useCallback(async () => {
        setContrats(null);
        const r = await budgetClientAction(clientId, annee);
        if (r.success) { setContrats(r.data.contrats); setErreur(''); } else setErreur(r.error);
    }, [clientId, annee]);
    useEffect(() => { void charger(); }, [charger]);
    const budgetes = useMemo(() => (contrats ?? []).filter(c => c.aBudget), [contrats]);
    const total = useMemo(() => cumuler((contrats ?? []).map(c => c.total), 'Total'), [contrats]);
    return (
        <Card data-carte="budget-client">
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
                <div>
                    <CardTitle className="text-base">Budget {annee}</CardTitle>
                    <CardDescription>Somme des budgets des contrats du client{contrats ? ` (${budgetes.length} contrat(s) budgété(s) sur ${contrats.length})` : ''} ; le réalisé compte aussi pour les contrats sans budget.</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                    <Tabs value={axe} onValueChange={v => setAxe(v as 'contrat' | 'activite')}><TabsList><TabsTrigger value="contrat">Par contrat</TabsTrigger><TabsTrigger value="activite">Par activité</TabsTrigger></TabsList></Tabs>
                    <div className="flex items-center rounded-md border">
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Année précédente" onClick={() => setAnnee(a => a - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                        <span className="px-2 text-sm font-medium tabular-nums">{annee}</span>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Année suivante" onClick={() => setAnnee(a => a + 1)}><ChevronRight className="h-4 w-4" /></Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {erreur && <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{erreur}</p>}
                {!contrats && !erreur ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : contrats && (
                    <>
                        <TuilesBudget total={total} aBudget={budgetes.length > 0} />
                        <TableauGroupesBudget groupes={parAxe(contrats, axe)} axe={axe} />
                    </>
                )}
            </CardContent>
        </Card>
    );
}
