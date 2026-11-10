'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm, usePrompt } from '@/components/confirm-provider';
import { useData } from '@/context/data-context';
import { useToast } from '@/hooks/use-toast';
import { LIBELLE_ORIGINE, type AnalytiqueEffective, type NiveauAnalytique } from '@/lib/analytique';
import { getAnalytiqueClientAction, getAnalytiqueContratAction, reaffecterAnalytiqueAction, setAnalytiqueExterneAction } from '@/lib/analytique-actions';
import type { AnalytiqueContrat } from '@/services/analytique-admin';

/**
 * Analytique d'un client ou d'un contrat : code effectif de chaque niveau (client, contrat, prestations), son origine
 * (généré par Zenergya, externe, hérité), code externe modifiable, réaffectation (administrateur) quand le
 * référentiel a changé. Les factures émises gardent le code qu'elles portaient.
 */

function Ligne({ libelle, sous, e, onExterne }: { libelle: string; sous?: string; e: AnalytiqueEffective; onExterne: () => void }) {
    return (
        <tr className="border-t align-top">
            <td className="py-2 pr-3">
                <div className="text-sm font-medium">{libelle}</div>
                {sous && <div className="text-xs text-muted-foreground">{sous}</div>}
            </td>
            <td className="py-2 pr-3">
                {e.code ? <span className="break-all font-mono text-xs">{e.code}</span> : <span className="text-sm text-destructive">Non affecté : {e.manque.join(', ')} à renseigner</span>}
                {e.externe && e.genere && <div className="break-all font-mono text-[11px] text-muted-foreground" title="Code généré par Zenergya">{e.genere}</div>}
            </td>
            <td className="py-2 pr-3">
                <Badge variant={e.origine === 'aucun' ? 'destructive' : e.origine === 'genere' ? 'secondary' : 'outline'} className="whitespace-nowrap font-normal">
                    {e.origine === 'genere' ? (e.fige ? 'Généré, figé' : 'Généré') : e.origine === 'externe' ? 'Externe' : e.origine === 'externe-herite' ? 'Externe hérité' : 'Non affecté'}
                </Badge>
            </td>
            <td className="py-2 text-right">
                <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onExterne} title={LIBELLE_ORIGINE[e.origine]}>
                    <Pencil className="h-3.5 w-3.5" />Code externe
                </Button>
            </td>
        </tr>
    );
}

export function AnalytiqueCard({ contractId, clientId, sites }: { contractId?: string; clientId?: string; sites?: Record<string, string> }) {
    const { toast } = useToast();
    const { isAdmin } = useData();
    const demander = usePrompt();
    const confirmer = useConfirm();
    const [contrat, setContrat] = useState<AnalytiqueContrat | null>(null);
    const [client, setClient] = useState<AnalytiqueEffective | null>(null);
    const [erreur, setErreur] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const charger = useCallback(async () => {
        if (contractId) {
            const r = await getAnalytiqueContratAction(contractId);
            if (r.success) { setContrat(r.data); setClient(r.data.client); setErreur(null); } else setErreur(r.error);
        } else if (clientId) {
            const r = await getAnalytiqueClientAction(clientId);
            if (r.success) { setClient(r.data.analytique); setErreur(null); } else setErreur(r.error);
        }
    }, [contractId, clientId]);
    useEffect(() => { charger(); }, [charger]);

    const externe = async (niveau: NiveauAnalytique, id: string, libelle: string, e: AnalytiqueEffective) => {
        const actuel = e.origine === 'externe' ? e.externe ?? '' : '';
        const v = await demander({
            title: `Code analytique externe — ${libelle}`,
            description: 'Code de votre outil comptable : il remplace le code généré pour ce niveau, et les niveaux en dessous en héritent (avec leur segment) sauf s\'ils ont le leur. Vide : retour au code généré ou hérité. Les factures déjà émises gardent leur code.',
            label: 'Code externe', defaultValue: actuel, placeholder: 'ex. 68W2/V080912-1-001', confirmLabel: 'Enregistrer',
        });
        if (v === null || v.trim() === actuel) return;
        setBusy(true);
        const r = await setAnalytiqueExterneAction(niveau, id, v);
        setBusy(false);
        if (!r.success) { toast({ title: 'Code externe refusé', description: r.error, variant: 'destructive' }); return; }
        toast({ title: v.trim() ? 'Code externe enregistré' : 'Code externe retiré' });
        await charger();
    };

    const reaffecter = async () => {
        if (!contractId) return;
        const motif = await demander({
            title: 'Réaffecter l\'analytique du contrat',
            description: 'Régénère le code du contrat et de ses prestations à partir du référentiel actuel (société, agence, secteur du client). L\'ancien code reste dans l\'historique ; les factures déjà émises gardent le leur.',
            label: 'Motif', placeholder: 'ex. client passé au secteur Lyon Sud le 01/01/2027', required: true, multiline: true, confirmLabel: 'Continuer',
        });
        if (!motif) return;
        const aussiClient = await confirmer({ title: 'Régénérer aussi le code du client ?', description: 'Oui : le code du client suit le référentiel actuel (ses autres contrats gardent leur code tant qu\'ils ne sont pas réaffectés). Non : seul ce contrat change.', confirmLabel: 'Oui, client aussi', cancelLabel: 'Non, ce contrat seulement' });
        setBusy(true);
        const r = await reaffecterAnalytiqueAction(contractId, motif, aussiClient);
        setBusy(false);
        if (!r.success) { toast({ title: 'Réaffectation impossible', description: r.error, variant: 'destructive' }); return; }
        toast({ title: 'Analytique réaffectée' });
        await charger();
    };

    return (
        <Card>
            <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <CardTitle className="text-base">Analytique</CardTitle>
                        <CardDescription>
                            Société - agence - secteur - client - contrat - activité. Chaque ligne de facture garde le code en vigueur à son émission : les ventes
                            (et, à terme, les commandes) se suivent par code.
                        </CardDescription>
                    </div>
                    {contractId && isAdmin && <Button variant="outline" size="sm" className="shrink-0 gap-1" disabled={busy} onClick={reaffecter}><RefreshCw className="h-3.5 w-3.5" />Réaffecter</Button>}
                </div>
            </CardHeader>
            <CardContent>
                {erreur ? <p className="text-sm text-destructive">{erreur}</p> : !client ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
                    <table className="w-full">
                        <thead><tr className="text-left text-xs text-muted-foreground"><th className="pb-1 font-normal">Niveau</th><th className="pb-1 font-normal">Code effectif</th><th className="pb-1 font-normal">Origine</th><th /></tr></thead>
                        <tbody>
                            <Ligne libelle="Client" e={client} onExterne={() => externe('client', contrat?.clientId ?? clientId!, 'client', client)} />
                            {contrat && <Ligne libelle="Contrat" e={contrat.contrat} onExterne={() => externe('contrat', contrat.contractId, 'contrat', contrat.contrat)} />}
                            {contrat?.prestations.map(p => (
                                <Ligne key={p.serviceId} libelle={`Prestation ${p.activityCode}`} sous={`${p.activityLabel}${sites?.[p.siteId] ? ` — ${sites[p.siteId]}` : ''}`} e={p.analytique}
                                    onExterne={() => externe('prestation', p.serviceId, `prestation ${p.activityCode}`, p.analytique)} />
                            ))}
                        </tbody>
                    </table>
                )}
                {contrat && contrat.historique.length > 0 && (
                    <div className="mt-3 border-t pt-2 text-xs text-muted-foreground">
                        <p className="font-medium">Anciens codes du contrat</p>
                        {contrat.historique.map((h, i) => <p key={i}><span className="font-mono">{h.code}</span> jusqu&apos;au {new Date(h.jusquAu).toLocaleDateString('fr-FR')} — {h.motif} ({h.par})</p>)}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
