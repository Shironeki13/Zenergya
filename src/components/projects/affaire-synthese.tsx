'use client';

import Link from 'next/link';
import { Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePrompt } from '@/components/confirm-provider';
import { formatEur } from '@/components/quotes/format';
import { useToast } from '@/hooks/use-toast';
import { setProjectAnalyticExternalAction } from '@/lib/projects/actions';
import { LIBELLE_FACTURATION, LIBELLE_NATURE, NATURES } from '@/lib/projects/affaire';
import type { Project } from '@/lib/projects/types';

/**
 * Synthèse d'une affaire de travaux : budget prévu par nature (somme de ses devis), devis rattachés, analytique (code
 * généré figé, code externe). L'engagé et le réel viendront des commandes et des heures portant le code de l'affaire.
 */
export function AffaireSynthese({ project, factureHT, onChange }: { project: Project; factureHT: number; onChange: () => Promise<void> | void }) {
    const { toast } = useToast();
    const demander = usePrompt();
    const b = project.budget;
    const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${(x * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`);
    const code = project.analyticExternal || project.analyticCode;

    const externe = async () => {
        const v = await demander({
            title: `Code analytique externe — affaire ${project.code}`,
            description: 'Code de votre outil comptable : il remplace le code généré sur les prochaines factures (et commandes) de l\'affaire. Vide : retour au code généré. Les factures déjà émises gardent leur code.',
            label: 'Code externe', defaultValue: project.analyticExternal ?? '', placeholder: 'ex. 68W2/T260007', confirmLabel: 'Enregistrer',
        });
        if (v === null || v.trim() === (project.analyticExternal ?? '')) return;
        const r = await setProjectAnalyticExternalAction(project.id, v);
        if (!r.success) { toast({ title: 'Code externe refusé', description: r.error, variant: 'destructive' }); return; }
        toast({ title: v.trim() ? 'Code externe enregistré' : 'Code externe retiré' });
        await onChange();
    };

    return (
        <div className="grid gap-4 lg:grid-cols-2">
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Budget prévu</CardTitle>
                    <CardDescription>Somme des devis de l&apos;affaire : prix de vente et déboursé par nature. L&apos;engagé (commandes) et le réel (factures fournisseurs, heures) s&apos;y compareront.</CardDescription>
                </CardHeader>
                <CardContent>
                    {!b ? <p className="text-sm text-muted-foreground">Affaire antérieure : budget non enregistré (il sera calculé à la reprise).</p> : (
                        <table className="w-full text-sm">
                            <tbody>
                                {NATURES.map(n => (
                                    <tr key={n} className="border-b">
                                        <td className="py-1.5">{LIBELLE_NATURE[n]}{n === 'MAIN_OEUVRE' && b.heures ? <span className="text-xs text-muted-foreground"> — {b.heures.toLocaleString('fr-FR')} h</span> : null}</td>
                                        <td className="py-1.5 text-right">{formatEur(b.parNature[n])}</td>
                                    </tr>
                                ))}
                                <tr className="border-b font-medium"><td className="py-1.5">Déboursé prévu</td><td className="py-1.5 text-right">{formatEur(b.cout)}</td></tr>
                                <tr className="border-b font-medium"><td className="py-1.5">Prix de vente HT</td><td className="py-1.5 text-right">{formatEur(b.vente)}</td></tr>
                                <tr className="font-semibold"><td className="py-1.5">Marge prévue</td><td className="py-1.5 text-right">{formatEur(b.marge)} <span className="font-normal text-muted-foreground">({pct(b.tauxMarge)})</span></td></tr>
                                <tr className="text-muted-foreground"><td className="pt-2 text-xs">Facturé à ce jour</td><td className="pt-2 text-right text-xs">{formatEur(factureHT)} HT ({b.vente > 0 ? pct(factureHT / b.vente) : '—'})</td></tr>
                            </tbody>
                        </table>
                    )}
                </CardContent>
            </Card>

            <div className="space-y-4">
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-2">
                            <div>
                                <CardTitle className="text-base">Analytique</CardTitle>
                                <CardDescription>Société - agence - secteur - client - affaire. Figée sur chaque ligne de facture de l&apos;affaire.</CardDescription>
                            </div>
                            <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2 text-xs" onClick={externe}><Pencil className="h-3.5 w-3.5" />Code externe</Button>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-1 text-sm">
                        {code ? <p className="break-all font-mono text-xs">{code}</p> : <p className="text-destructive">Non affecté : code de l&apos;agence ou du secteur du client à renseigner (Paramétrage).</p>}
                        {project.analyticExternal && project.analyticCode && <p className="break-all font-mono text-[11px] text-muted-foreground" title="Code généré par Zenergya">{project.analyticCode}</p>}
                        <div className="flex flex-wrap gap-1 pt-1">
                            <Badge variant="outline" className="font-normal">{project.analyticExternal ? 'Externe' : project.analyticCode ? 'Généré, figé' : 'Non affecté'}</Badge>
                            <Badge variant="secondary" className="font-normal">{project.mode ?? 'P6'}</Badge>
                            <Badge variant="secondary" className="font-normal">Facturation {LIBELLE_FACTURATION[project.billing ?? 'situations'].toLowerCase()}</Badge>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-3"><CardTitle className="text-base">Devis de l&apos;affaire</CardTitle></CardHeader>
                    <CardContent>
                        <table className="w-full text-sm">
                            <thead><tr className="text-left text-xs text-muted-foreground"><th className="pb-1 font-normal">Devis</th><th className="pb-1 font-normal">Objet</th><th className="pb-1 text-right font-normal">Vente HT</th><th className="pb-1 text-right font-normal">Marge</th></tr></thead>
                            <tbody>
                                {(project.quotes ?? [{ quoteId: project.quoteId, number: project.quoteNumber, title: project.title, vente: project.totalHT, marge: null as number | null }]).map(d => (
                                    <tr key={d.quoteId} className="border-t">
                                        <td className="py-1.5 font-mono text-xs"><Link className="underline" href={`/quotes/${d.quoteId}`}>{d.number}</Link></td>
                                        <td className="py-1.5">{d.title}</td>
                                        <td className="py-1.5 text-right">{formatEur(d.vente)}</td>
                                        <td className="py-1.5 text-right">{d.marge === null ? '—' : formatEur(d.marge)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
