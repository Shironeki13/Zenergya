'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, CircleDashed, ClipboardCheck, FileText, Flag, Hammer, Lock, Receipt, ShieldCheck, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Frise, TON_POINT, type PointFrise } from '@/components/frise/frise';
import { cn } from '@/lib/utils';
import { formatEur } from '@/components/quotes/format';
import { friseChantier, LIBELLE_ETAT_FACTURE, type EtapeFrise, type LotAvancement } from '@/lib/projects/frise';
import type { Project, ProjectSituation } from '@/lib/projects/types';
import type { Invoice } from '@/lib/types';

/**
 * Frise chronologique du chantier : un point par étape (ouverture, situations et leurs factures, réception, retenue,
 * clôture, puis ce qui reste à venir), avec sa date. Le survol donne l'essentiel, le clic ouvre le détail (facture,
 * règlement, avancement par lot). Trois jauges résument : avancement du chantier, facturé, encaissé.
 */

const fr = (d: string | null) => (d ? d.split('-').reverse().join('/') : 'à venir');
const pct = (x: number) => `${x.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;

const ICONE: Record<EtapeFrise['type'], typeof Flag> = {
    ouverture: Flag, devis: FileText, situation: Hammer, facture: Receipt, preparation: CircleDashed, reception: ClipboardCheck, retenue: ShieldCheck, cloture: Lock, reste: Receipt,
};
const TON = TON_POINT;

function Jauge({ libelle, valeur, montant, couleur }: { libelle: string; valeur: number; montant: string; couleur: string }) {
    return (
        <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{libelle}</span>
                <span className="font-semibold tabular-nums">{pct(valeur)}</span>
            </div>
            <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={libelle} aria-valuenow={valeur} aria-valuemin={0} aria-valuemax={100}>
                <div className={cn('h-full rounded-full transition-all', couleur)} style={{ width: `${Math.min(100, valeur)}%` }} />
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">{montant}</p>
        </div>
    );
}

function Lots({ lots, comparer }: { lots: LotAvancement[]; comparer?: boolean }) {
    if (!lots.length) return null;
    return (
        <div className="space-y-1.5">
            {lots.map(l => (
                <div key={l.cle} className="grid grid-cols-[minmax(0,14rem)_1fr_auto] items-center gap-3 text-sm">
                    <span className="truncate" title={l.label}>{l.label}</span>
                    <div className="relative h-2.5 overflow-hidden rounded-full bg-muted">
                        {comparer && <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-200" style={{ width: `${Math.min(100, l.pct)}%` }} />}
                        <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-600" style={{ width: `${Math.min(100, comparer ? l.avant : l.pct)}%` }} />
                    </div>
                    <span className="w-28 text-right text-xs tabular-nums text-muted-foreground">
                        {comparer && l.pct !== l.avant ? <>{pct(l.avant)} → <span className="font-medium text-foreground">{pct(l.pct)}</span></> : <span className="font-medium text-foreground">{pct(l.pct)}</span>}
                    </span>
                </div>
            ))}
        </div>
    );
}

function Detail({ e, onClose }: { e: EtapeFrise; onClose: () => void }) {
    const ton = TON[e.etat];
    const ligne = (libelle: string, valeur: React.ReactNode) => <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{libelle}</dt><dd className="text-right font-medium">{valeur}</dd></div>;
    return (
        <div className="rounded-lg border bg-muted/20 p-4" role="region" aria-label={`Détail : ${e.titre}`}>
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="font-semibold">{e.titre} <span className={cn('ml-1 text-xs font-normal', ton.texte)}>{ton.libelle}</span></p>
                    <p className="text-sm text-muted-foreground">{fr(e.date)}{e.resume ? ` — ${e.resume}` : ''}</p>
                </div>
                <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Fermer le détail"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-3 grid gap-6 md:grid-cols-2">
                <dl className="space-y-1 text-sm">
                    {e.avancement !== undefined && ligne('Avancement cumulé du chantier', pct(e.avancement))}
                    {e.montantHT !== undefined && ligne(e.type === 'reste' ? 'Reste à facturer HT' : e.type === 'situation' || e.type === 'facture' ? 'Facturé HT' : 'Montant HT', formatEur(e.montantHT))}
                    {e.montantTTC !== undefined && ligne(e.type === 'retenue' ? 'Retenue TTC' : 'TTC', formatEur(e.montantTTC))}
                    {!!e.retenue && ligne('Retenue de garantie', formatEur(e.retenue))}
                    {e.netAPayer !== undefined && ligne('Net à payer', formatEur(e.netAPayer))}
                    {e.devis && ligne('Devis', <Link className="font-mono underline" href={`/quotes/${e.devis.id}`}>{e.devis.numero}</Link>)}
                    {e.facture && ligne('Facture', <Link className="font-mono underline" href={`/invoices/${e.facture.id}`}>{e.facture.numero}</Link>)}
                    {e.facture && ligne('Émise le', fr(e.facture.date))}
                    {e.facture && e.facture.echeance && ligne('Échéance', fr(e.facture.echeance))}
                    {e.facture && ligne('Règlement', <Badge variant="outline" className={cn(e.facture.etat === 'payee' && 'border-emerald-300 text-emerald-700', e.facture.etat === 'en_retard' && 'border-red-300 text-red-700')}>{LIBELLE_ETAT_FACTURE[e.facture.etat]}</Badge>)}
                    {e.type === 'preparation' && <p className="pt-1 text-xs text-muted-foreground">Situation en préparation : elle n&apos;est pas encore facturée (voir plus bas pour la compléter).</p>}
                    {e.etat === 'a_venir' && e.type === 'reception' && <p className="pt-1 text-xs text-muted-foreground">À déclarer à la fin du chantier (« Travaux terminés »).</p>}
                </dl>
                {e.lots && e.lots.length > 0 && (
                    <div>
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Avancement par lot à cette étape</p>
                        <Lots lots={e.lots} comparer />
                    </div>
                )}
            </div>
        </div>
    );
}

export function FriseChantier({ project, situations, invoices }: { project: Project; situations: ProjectSituation[]; invoices: Invoice[] }) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
    const frise = useMemo(() => friseChantier(project, situations, invoices, today), [project, situations, invoices, today]);
    const [ouvert, setOuvert] = useState<string | null>(null);
    const parSituations = (project.billing ?? 'situations') === 'situations';
    const choisie = frise.etapes.find(e => e.id + (e.date ?? '') === ouvert) ?? null;
    const { jauges, montants } = frise;
    const points: PointFrise[] = frise.etapes.map(e => ({
        cle: e.id + (e.date ?? ''), date: e.date, etat: e.etat, icone: e.etat === 'fait' && (e.type === 'situation' || e.type === 'facture') ? Check : ICONE[e.type], titre: e.titre,
        lignes: <>
            {e.avancement !== undefined && <span className="text-xs font-semibold text-emerald-700">{pct(e.avancement)}</span>}
            {e.montantHT !== undefined && <span className="text-xs tabular-nums text-muted-foreground">{formatEur(e.montantHT)}</span>}
            {e.facture && <span className={cn('text-xs', e.facture.etat === 'payee' ? 'text-emerald-700' : e.facture.etat === 'en_retard' ? 'font-medium text-red-700' : 'text-muted-foreground')}>{e.facture.numero} · {LIBELLE_ETAT_FACTURE[e.facture.etat].toLowerCase()}</span>}
            {!e.facture && e.resume && e.type !== 'situation' && <span className="text-xs text-muted-foreground">{e.resume}</span>}
        </>,
        infobulle: <>
            {e.resume && <p>{e.resume}</p>}
            {e.montantHT !== undefined && <p>{formatEur(e.montantHT)} HT</p>}
            {e.facture && <p>Facture {e.facture.numero} — {LIBELLE_ETAT_FACTURE[e.facture.etat].toLowerCase()}</p>}
        </>,
    }));

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-base">Avancement du chantier</CardTitle>
                <CardDescription>Chaque point est une étape, à sa date. Survolez-le pour l&apos;essentiel, cliquez pour le détail (facture, règlement, avancement par lot).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
                <div className="flex flex-col gap-4 md:flex-row md:gap-8">
                    {parSituations && <Jauge libelle="Avancement du chantier" valeur={jauges.avancement} montant={`${formatEur(montants.marche)} HT de marché`} couleur="bg-emerald-600" />}
                    <Jauge libelle="Facturé" valeur={jauges.facture} montant={`${formatEur(montants.facture)} HT — reste ${formatEur(montants.resteAFacturer)}`} couleur="bg-blue-600" />
                    <Jauge libelle="Encaissé" valeur={jauges.encaisse} montant={`${formatEur(montants.encaisse)} HT — à encaisser ${formatEur(montants.aEncaisser)}`} couleur="bg-violet-600" />
                </div>
                {parSituations && jauges.avancement - jauges.facture > 0.05 && (
                    <p className="flex items-center gap-2 text-sm text-amber-700"><AlertTriangle className="h-4 w-4 shrink-0" />{pct(Math.round((jauges.avancement - jauges.facture) * 10) / 10)} du chantier sont réalisés mais pas encore facturés.</p>
                )}

                <Frise points={points} ouvert={ouvert} onOuvrir={setOuvert} label="Frise chronologique du chantier" />

                {choisie && <Detail e={choisie} onClose={() => setOuvert(null)} />}

                {!choisie && frise.lots.length > 0 && (
                    <div>
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Avancement par lot aujourd&apos;hui</p>
                        <Lots lots={frise.lots} />
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
