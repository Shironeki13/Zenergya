'use client';

import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PastilleActivite } from '@/components/ui/pastilles';
import { NATURES_DEPENSE, NON_AFFECTE, type AxeBudget, type GroupeBudget, type Montants } from '@/lib/budgets/budget';

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const dep = (m: Montants) => NATURES_DEPENSE.reduce((s, n) => s + m[n], 0);
const pct = (marge: number, ca: number) => (ca > 0 ? `${Math.round((marge / ca) * 100)} %` : '—');
const signe = (n: number) => <span className={n < 0 ? 'font-medium text-red-700' : n > 0 ? 'font-medium text-emerald-700' : 'text-muted-foreground'}>{n > 0 ? '+' : ''}{eur(n)}</span>;

/** Tableau des budgets regroupés (contrat, client, agence ou activité) : CA, dépenses, marge, écarts. */
export function TableauGroupesBudget({ groupes, axe }: { groupes: GroupeBudget[]; axe: AxeBudget }) {
    const total = groupes.reduce((t, g) => ({ caB: t.caB + g.total.budget.ca, caA: t.caA + g.total.atterrissage.ca, dB: t.dB + dep(g.total.budget), dA: t.dA + dep(g.total.atterrissage), mB: t.mB + g.total.marge.budget, mA: t.mA + g.total.marge.atterrissage }), { caB: 0, caA: 0, dB: 0, dA: 0, mB: 0, mA: 0 });
    const th = 'px-3 py-1.5 text-right font-medium';
    return (
        <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm" data-budget="groupes">
                <thead>
                    <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
                        <th rowSpan={2} className="px-3 py-2 text-left font-medium">{{ contrat: 'Contrat', client: 'Client', agence: 'Agence', activite: 'Activité' }[axe]}</th>
                        <th colSpan={3} className="border-l px-3 py-1.5 text-center font-medium">Chiffre d&apos;affaires</th>
                        <th colSpan={2} className="border-l px-3 py-1.5 text-center font-medium">Dépenses</th>
                        <th colSpan={3} className="border-l px-3 py-1.5 text-center font-medium">Marge</th>
                        <th rowSpan={2} className="px-3 py-2" />
                    </tr>
                    <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                        <th className={`${th} border-l`}>Budget</th><th className={th}>Atterrissage</th><th className={th}>Écart</th>
                        <th className={`${th} border-l`}>Budget</th><th className={th}>Atterrissage</th>
                        <th className={`${th} border-l`}>Budget</th><th className={th}>Atterrissage</th><th className={th}>Écart</th>
                    </tr>
                </thead>
                <tbody>
                    {groupes.length === 0 && <tr><td colSpan={10} className="py-8 text-center text-muted-foreground">Aucun budget à afficher.</td></tr>}
                    {groupes.map(g => (
                        <tr key={g.cle} className="border-b hover:bg-muted/30" data-groupe={g.libelle}>
                            <td className="px-3 py-2">
                                {axe === 'activite' ? (g.cle === NON_AFFECTE ? <span className="text-xs text-muted-foreground">Non affecté</span> : <PastilleActivite code={g.cle} />)
                                    : g.lien ? <Link href={g.lien} className="font-medium text-primary hover:underline">{g.libelle}</Link> : <span className="font-medium">{g.libelle}</span>}
                                {g.detail && <span className="block max-w-[280px] truncate text-xs text-muted-foreground" title={g.detail}>{g.detail}</span>}
                            </td>
                            <td className="border-l px-3 py-2 text-right tabular-nums">{eur(g.total.budget.ca)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{eur(g.total.atterrissage.ca)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{signe(g.total.atterrissage.ca - g.total.budget.ca)}</td>
                            <td className="border-l px-3 py-2 text-right tabular-nums">{eur(dep(g.total.budget))}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{eur(dep(g.total.atterrissage))}</td>
                            <td className="border-l px-3 py-2 text-right tabular-nums">{eur(g.total.marge.budget)}<span className="block text-[10px] text-muted-foreground">{pct(g.total.marge.budget, g.total.budget.ca)}</span></td>
                            <td className="px-3 py-2 text-right font-medium tabular-nums">{eur(g.total.marge.atterrissage)}<span className="block text-[10px] font-normal text-muted-foreground">{pct(g.total.marge.atterrissage, g.total.atterrissage.ca)}</span></td>
                            <td className="px-3 py-2 text-right tabular-nums">{signe(g.total.ecartMarge)}</td>
                            <td className="px-3 py-2 text-right">
                                {g.alertes > 0 && <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 py-0 text-[10px] text-amber-800" title={g.total.alertes.slice(0, 8).join('\n')}><TriangleAlert className="h-3 w-3" />{g.alertes}</Badge>}
                            </td>
                        </tr>
                    ))}
                    {groupes.length > 1 && (
                        <tr className="bg-muted/40 font-semibold">
                            <td className="px-3 py-2">Total</td>
                            <td className="border-l px-3 py-2 text-right tabular-nums">{eur(total.caB)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{eur(total.caA)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{signe(total.caA - total.caB)}</td>
                            <td className="border-l px-3 py-2 text-right tabular-nums">{eur(total.dB)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{eur(total.dA)}</td>
                            <td className="border-l px-3 py-2 text-right tabular-nums">{eur(total.mB)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{eur(total.mA)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{signe(total.mA - total.mB)}</td>
                            <td />
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}

/** Export CSV (séparateur « ; », montants à la virgule). */
export function csvGroupes(groupes: GroupeBudget[], axe: AxeBudget, annee: number): string {
    const n = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',');
    const entete = [axe, 'Détail', 'CA budget', 'CA réalisé', 'CA atterrissage', 'Dépenses budget', 'Dépenses réalisées', 'Dépenses atterrissage', 'Marge budget', 'Marge atterrissage', 'Écart marge', 'Alertes'];
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    return [`Budgets ${annee}`, entete.join(';'), ...groupes.map(g => [q(g.libelle), q(g.detail), n(g.total.budget.ca), n(g.total.realise.ca), n(g.total.atterrissage.ca), n(dep(g.total.budget)), n(dep(g.total.realise)), n(dep(g.total.atterrissage)), n(g.total.marge.budget), n(g.total.marge.atterrissage), n(g.total.ecartMarge), String(g.alertes)].join(';'))].join('\n');
}
