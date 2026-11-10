'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatEur } from '@/components/quotes/format';
import { LIBELLE_STATUT } from '@/lib/commandes';
import { rentabiliteAffaireAction } from '@/lib/projects/actions';
import { LIBELLE_NATURE } from '@/lib/projects/affaire';
import type { RentabiliteAffaire } from '@/services/rentabilite-admin';

/**
 * Rentabilité d'une affaire : par nature, prévu (devis) / engagé (commandes validées, heures) / réel (factures des
 * fournisseurs, heures) ; marge prévue et marge à terminaison ; commandes et heures de l'affaire.
 */

const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`);
const h = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} h`;
const jour = (d: string) => d.split('-').reverse().join('/');

export function AffaireRentabilite({ projectId, sansBudget }: { projectId: string; sansBudget?: boolean }) {
    const [data, setData] = useState<RentabiliteAffaire | null>(null);
    const [erreur, setErreur] = useState<string | null>(null);
    useEffect(() => { rentabiliteAffaireAction(projectId).then(r => (r.success ? setData(r.data) : setErreur(r.error))); }, [projectId]);

    if (erreur) return <Card><CardContent className="py-4 text-sm text-destructive">Rentabilité indisponible : {erreur}</CardContent></Card>;
    if (!data) return <Card><CardContent className="py-6"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;
    const r = data.rentabilite;
    const ecart = (n: number) => <span className={n < 0 ? 'font-medium text-destructive' : ''}>{formatEur(n)}</span>;

    return (
        <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Rentabilité</CardTitle>
                    <CardDescription>
                        Prévu : déboursé des devis. Engagé : commandes validées et heures saisies. Réel : factures des fournisseurs et heures.
                        {sansBudget && ' Affaire antérieure : budget des devis non enregistré, pas de prévu.'}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {r.alertes.length > 0 && (
                        <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                            {r.alertes.map((a, i) => <p key={i} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{a}</p>)}
                        </div>
                    )}
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[560px] text-sm">
                            <thead><tr className="text-right text-xs text-muted-foreground">
                                <th className="pb-1 text-left font-normal">Nature</th><th className="pb-1 font-normal">Prévu</th><th className="pb-1 font-normal">Engagé</th>
                                <th className="pb-1 font-normal">Réel</th><th className="pb-1 font-normal">Reste à engager</th>
                            </tr></thead>
                            <tbody>
                                {r.lignes.map(l => (
                                    <tr key={l.nature} className="border-t text-right">
                                        <td className="py-1.5 text-left">
                                            {LIBELLE_NATURE[l.nature]}
                                            {l.nature === 'MAIN_OEUVRE' && <span className="text-xs text-muted-foreground"> — {h(r.heuresReelles)} sur {h(r.heuresPrevues)}</span>}
                                            {l.enValidation > 0 && <span className="block text-xs text-muted-foreground">+ {formatEur(l.enValidation)} en cours de validation</span>}
                                        </td>
                                        <td className="py-1.5">{formatEur(l.prevu)}</td><td className="py-1.5">{formatEur(l.engage)}</td><td className="py-1.5">{formatEur(l.reel)}</td>
                                        <td className="py-1.5">{ecart(l.reste)}</td>
                                    </tr>
                                ))}
                                <tr className="border-t text-right font-semibold">
                                    <td className="py-1.5 text-left">Total des coûts{r.total.enValidation > 0 && <span className="block text-xs font-normal text-muted-foreground">+ {formatEur(r.total.enValidation)} en cours de validation</span>}</td>
                                    <td className="py-1.5">{formatEur(r.total.prevu)}</td><td className="py-1.5">{formatEur(r.total.engage)}</td><td className="py-1.5">{formatEur(r.total.reel)}</td><td className="py-1.5">{ecart(r.total.reste)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Marge</CardTitle>
                    <CardDescription>À terminaison : chaque nature au plus grand de son prévu et de son engagé.</CardDescription>
                </CardHeader>
                <CardContent>
                    <table className="w-full text-sm">
                        <tbody>
                            <tr className="border-b"><td className="py-1.5">Prix de vente HT</td><td className="py-1.5 text-right">{formatEur(r.vente)}</td></tr>
                            <tr className="border-b"><td className="py-1.5">Marge prévue</td><td className="py-1.5 text-right">{formatEur(r.margePrevue)} <span className="block text-xs text-muted-foreground">{pct(r.tauxMargePrevue)} du prix de vente</span></td></tr>
                            <tr className="border-b"><td className="py-1.5">Coût à terminaison</td><td className="py-1.5 text-right">{formatEur(r.coutATerminaison)}</td></tr>
                            <tr className="border-b font-semibold"><td className="py-1.5">Marge à terminaison</td><td className="py-1.5 text-right">{ecart(r.margeATerminaison)} <span className="block text-xs font-normal text-muted-foreground">{pct(r.tauxMargeATerminaison)} du prix de vente</span></td></tr>
                            <tr className="border-b"><td className="py-1.5">Écart sur la marge prévue</td><td className="py-1.5 text-right">{r.ecartMarge === 0 ? '—' : ecart(r.ecartMarge)}</td></tr>
                            <tr className="border-b text-muted-foreground"><td className="pt-2 text-xs">Facturé à ce jour</td><td className="whitespace-nowrap pt-2 text-right text-xs">{formatEur(r.facture)} HT ({r.vente > 0 ? pct(r.facture / r.vente) : '—'})</td></tr>
                            <tr className="text-muted-foreground"><td className="py-1 text-xs">Facturé − réel</td><td className="py-1 text-right text-xs">{formatEur(r.resultatADate)}</td></tr>
                        </tbody>
                    </table>
                </CardContent>
            </Card>

            <Card className="lg:col-span-2">
                <CardHeader className="pb-3"><CardTitle className="text-base">Commandes de l&apos;affaire</CardTitle></CardHeader>
                <CardContent>
                    {data.commandes.length === 0 ? <p className="text-sm text-muted-foreground">Aucune commande affectée à cette affaire. <Link className="underline" href="/purchases/nouvelle">Créer une commande</Link></p> : (
                        <table className="w-full text-sm">
                            <thead><tr className="text-left text-xs text-muted-foreground"><th className="pb-1 font-normal">Commande</th><th className="pb-1 font-normal">Fournisseur</th><th className="pb-1 font-normal">Objet</th><th className="pb-1 font-normal">État</th><th className="pb-1 text-right font-normal">Montant HT</th><th className="pb-1 text-right font-normal">Facturé fournisseur</th></tr></thead>
                            <tbody>
                                {data.commandes.map(c => (
                                    <tr key={c.id} className="border-t">
                                        <td className="whitespace-nowrap py-1.5 font-mono text-xs"><Link className="underline" href={`/purchases/${c.id}`}>{c.number ?? 'brouillon'}</Link><span className="block font-sans text-muted-foreground">{jour(c.date)}</span></td>
                                        <td className="py-1.5">{c.supplierName}</td><td className="py-1.5">{c.title}</td>
                                        <td className="py-1.5"><Badge variant={c.engagee ? 'secondary' : c.status === 'refusee' ? 'destructive' : 'outline'} className="whitespace-nowrap font-normal">{LIBELLE_STATUT[c.status]}</Badge></td>
                                        <td className={`py-1.5 text-right ${c.engagee ? '' : 'text-muted-foreground'}`}>{formatEur(c.montant)}</td>
                                        <td className="py-1.5 text-right">{c.reel ? formatEur(c.reel) : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Heures de l&apos;affaire</CardTitle></CardHeader>
                <CardContent>
                    {data.heures.length === 0 ? <p className="text-sm text-muted-foreground">Aucune heure saisie sur cette affaire. <Link className="underline" href="/timesheets">Saisir des heures</Link></p> : (
                        <table className="w-full text-sm">
                            <tbody>
                                {data.heures.map(t => (
                                    <tr key={t.userName} className="border-b">
                                        <td className="py-1.5">{t.userName}<span className="block text-xs text-muted-foreground">du {jour(t.du)} au {jour(t.au)}</span></td>
                                        <td className="py-1.5 text-right">{h(t.heures)}<span className="block text-xs text-muted-foreground">{formatEur(t.cout)}</span></td>
                                    </tr>
                                ))}
                                <tr className="font-medium"><td className="py-1.5">Total</td><td className="py-1.5 text-right">{h(r.heuresReelles)} sur {h(r.heuresPrevues)} prévues</td></tr>
                            </tbody>
                        </table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
