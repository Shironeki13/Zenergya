'use client';

import { useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { updateClient } from '@/services/firestore';
import { fetchEntreprises } from '@/components/clients/company-lookup';
import { sireneCheckIssues, toSireneCheck, type SireneCheck } from '@/lib/entreprises';
import type { Client } from '@/lib/types';

/**
 * Contrôle du SIRET de la fiche dans le répertoire des entreprises : établissement actif ou fermé,
 * entreprise cessée, entité publique ou privée. Le résultat est enregistré sur la fiche (`sireneCheck`).
 */
export function SireneCheckPanel({ client, onChecked }: { client: Client; onChecked: (check: SireneCheck) => void }) {
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const check = client.sireneCheck;
    const stale = check && check.siret !== (client.siret ?? '').replace(/\s/g, '');
    const issues = stale ? [] : sireneCheckIssues(check, client.clientType);

    const verify = async () => {
        if (!client.siret) return;
        setLoading(true);
        try {
            const result = toSireneCheck(client.siret, await fetchEntreprises({ q: client.siret, inclureCessees: true }));
            await updateClient(client.id, { sireneCheck: result });
            onChecked(result);
            const found = sireneCheckIssues(result, client.clientType);
            toast({
                title: found.length ? 'SIRET vérifié : à examiner' : 'SIRET vérifié',
                description: found.length ? found.join(' ') : `${result.nom} — établissement actif.`,
                variant: found.length ? 'destructive' : 'default',
            });
        } catch (e) {
            toast({ title: 'Vérification impossible', description: (e as Error).message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    };

    if (!client.siret) return null;

    return (
        <div className="rounded-md border p-3 space-y-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted-foreground">
                    {!check ? 'SIRET jamais vérifié dans le répertoire des entreprises.'
                        : stale ? 'Le SIRET a changé depuis la dernière vérification.'
                            : `Vérifié le ${new Date(check.checkedAt).toLocaleDateString('fr-FR')}${check.nom ? ` — ${check.nom}` : ''}.`}
                </span>
                <Button type="button" size="sm" variant="outline" onClick={verify} disabled={loading}>
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                    Vérifier le SIRET
                </Button>
            </div>
            {check && !stale && (issues.length
                ? issues.map(m => <p key={m} className="text-destructive">• {m}</p>)
                : <p className="text-green-600">Établissement actif.</p>)}
        </div>
    );
}
