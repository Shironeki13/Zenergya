'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { margeSiteAction } from '@/lib/energie/actions';
import type { MargeSite } from '@/services/energie-marge-admin';

/**
 * Marge P1 d'un site sur douze mois : P1 facturé au client face aux factures du fournisseur d'énergie. Réservée aux
 * administrateurs et au module Achats (prix d'achat) : pour les autres, la carte ne s'affiche pas.
 */

const eur0 = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const moisFr = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });

export function TableauMarge({ m }: { m: MargeSite['marge'] }) {
    return (
        <table className="w-full text-sm tabular-nums" data-tableau="marge">
            <thead><tr className="border-b text-xs text-muted-foreground"><th className="py-2 text-left font-medium">Mois</th><th className="px-2 text-right font-medium">P1 facturé</th><th className="px-2 text-right font-medium">Achats d'énergie</th><th className="px-2 text-right font-medium">Marge</th><th className="pl-2 text-right font-medium">Taux</th></tr></thead>
            <tbody>{m.mois.map(l => (
                <tr key={l.mois} className={`border-b last:border-0 ${l.complet ? '' : 'text-muted-foreground'}`}>
                    <td className="py-1.5 capitalize">{moisFr(l.mois)}</td>
                    <td className="px-2 text-right">{l.ventes ? eur0(l.ventes) : '—'}</td>
                    <td className="px-2 text-right">{l.achats ? eur0(l.achats) : <span className="text-xs">{l.ventes ? 'non saisi' : '—'}</span>}</td>
                    <td className={`px-2 text-right ${l.marge !== null && l.marge < 0 ? 'text-red-700' : ''}`}>{l.marge !== null ? eur0(l.marge) : '—'}</td>
                    <td className="pl-2 text-right">{l.marge !== null && l.ventes > 0 ? `${((l.marge / l.ventes) * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` : '—'}</td>
                </tr>
            ))}</tbody>
            <tfoot><tr className="border-t font-semibold">
                <td className="py-2">{m.moisComplets} mois complet{m.moisComplets > 1 ? 's' : ''}</td><td className="px-2 text-right">{eur0(m.ventes)}</td><td className="px-2 text-right">{eur0(m.achats)}</td>
                <td className={`px-2 text-right ${m.marge < 0 ? 'text-red-700' : ''}`}>{eur0(m.marge)}</td><td className="pl-2 text-right">{m.taux !== null ? `${m.taux.toLocaleString('fr-FR')} %` : '—'}</td>
            </tr></tfoot>
        </table>
    );
}

export function MargeP1Site({ siteId }: { siteId: string }) {
    const [m, setM] = useState<MargeSite | null>(null);
    useEffect(() => { let actif = true; void margeSiteAction(siteId).then(r => { if (actif && r.success) setM(r.data); }); return () => { actif = false; }; }, [siteId]);
    if (!m || m.marge.mois.length === 0) return null;
    return (
        <Card data-bloc="marge-p1">
            <CardHeader className="pb-3">
                <CardTitle className="text-base">Marge P1 sur douze mois</CardTitle>
                <CardDescription>
                    P1 facturé au client face aux factures du fournisseur d'énergie de ce site. La marge n'est calculée que sur les mois où les deux sont connus
                    {m.marge.ventesSansAchat > 0 ? ` : ${eur0(m.marge.ventesSansAchat)} facturés au client sur des mois sans achat saisi restent hors calcul` : ''}.
                </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto"><TableauMarge m={m.marge} /></CardContent>
        </Card>
    );
}
