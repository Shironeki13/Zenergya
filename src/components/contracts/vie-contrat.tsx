'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, BellRing, Building2, CalendarClock, CalendarX, ClipboardList, FileCheck2, FilePlus2, FileSignature, Flag, Paperclip, PenLine, RefreshCw, ShieldCheck, Upload, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Frise, TON_POINT, dateFr, type PointFrise } from '@/components/frise/frise';
import { cn } from '@/lib/utils';
import { vieContrat, type DocumentsContrat, type EtapeVie, type TypeVie } from '@/lib/contrats/frise';
import type { Contract } from '@/lib/types';

/**
 * Vie du contrat : frise chronologique de tout ce qui lui est arrivé (dépôt, validation, début, documents et leur
 * validation, modifications) et de ce qui l'attend (date limite de préavis, échéance, reconduction). Survol : l'essentiel ;
 * clic : le détail (qui a déposé, qui a validé, ce que le document change, la pièce).
 */

const ICONE: Record<TypeVie, LucideIcon> = {
    depot: Upload, validation: ShieldCheck, debut: Flag, avenant: FilePlus2, os: ClipboardList, reconduction: RefreshCw, resiliation: CalendarX, syndic: Building2, be: PenLine,
    modification: FileSignature, aujourdhui: Flag, preavis: BellRing, echeance: CalendarClock, fin: CalendarX,
};
const VALIDATION = { en_attente: 'En attente de validation', valide: 'Validé', refuse: 'Refusé' } as const;
const fr = (d?: string | null) => (d ? d.split('-').reverse().join('/') : '—');

function Detail({ e, onClose, onVoirDocuments }: { e: EtapeVie; onClose: () => void; onVoirDocuments?: (onglet: NonNullable<EtapeVie['onglet']>) => void }) {
    const ton = TON_POINT[e.etat];
    const ligne = (libelle: string, valeur: React.ReactNode) => <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{libelle}</dt><dd className="text-right font-medium">{valeur}</dd></div>;
    const v = e.validation;
    return (
        <div className="rounded-lg border bg-muted/20 p-4" role="region" aria-label={`Détail : ${e.titre}`}>
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="font-semibold">{e.titre} <span className={cn('ml-1 text-xs font-normal', ton.texte)}>{v ? VALIDATION[v.etat] : ton.libelle}</span></p>
                    <p className="text-sm text-muted-foreground">{fr(e.date)}{e.resume ? ` — ${e.resume}` : ''}</p>
                </div>
                <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Fermer le détail"><X className="h-4 w-4" /></button>
            </div>
            {e.note && <p className={cn('mt-2 flex items-start gap-2 text-sm', e.etat === 'alerte' ? 'text-red-700' : 'text-muted-foreground')}>{e.etat === 'alerte' && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}{e.note}</p>}
            <div className="mt-3 grid gap-6 md:grid-cols-2">
                {v && (
                    <div>
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Circuit du document</p>
                        <dl className="space-y-1 text-sm">
                            {ligne('Déposé', `${fr(v.deposeLe)}${v.deposePar ? ` par ${v.deposePar}` : ''}`)}
                            {v.etat === 'valide' && ligne('Validé', v.valideLe ? `${fr(v.valideLe)}${v.validePar ? ` par ${v.validePar}` : ''}` : 'document antérieur à la validation')}
                            {v.etat === 'en_attente' && ligne('Validation', <Badge variant="outline" className="border-blue-300 text-blue-700">en attente de la contrathèque</Badge>)}
                            {v.etat === 'refuse' && ligne('Refusé', `${fr(v.valideLe)}${v.validePar ? ` par ${v.validePar}` : ''}`)}
                            {v.motifRefus && ligne('Motif du refus', v.motifRefus)}
                        </dl>
                        {v.corrections && v.corrections.length > 0 && (
                            <div className="mt-2 text-sm">
                                <p className="text-xs text-muted-foreground">Valeurs corrigées à la validation :</p>
                                {v.corrections.map((c, i) => <p key={i}>{c.libelle} : {c.avant || '—'} → <span className="font-medium">{c.apres || '—'}</span></p>)}
                            </div>
                        )}
                    </div>
                )}
                {(e.effets?.length || e.piece || e.onglet) && (
                    <div>
                        {!!e.effets?.length && <>
                            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{e.type === 'modification' ? 'Ce qui a été modifié' : 'Ce que cela change'}</p>
                            <dl className="space-y-1 text-sm">{e.effets.map((x, i) => <div key={i} className="flex justify-between gap-4"><dt className="text-muted-foreground">{x.libelle}</dt><dd className="text-right font-medium">{x.valeur}</dd></div>)}</dl>
                        </>}
                        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                            {e.piece && <a className="inline-flex items-center gap-1 underline" href={e.piece.url} target="_blank" rel="noopener noreferrer"><Paperclip className="h-3.5 w-3.5" />{e.piece.nom ?? 'Ouvrir la pièce'}</a>}
                            {e.onglet && onVoirDocuments && <button type="button" className="underline" onClick={() => onVoirDocuments(e.onglet!)}>Voir dans la liste des documents</button>}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export function VieContrat({ contract, documents, onVoirDocuments }: { contract: Contract; documents: DocumentsContrat; onVoirDocuments?: (onglet: NonNullable<EtapeVie['onglet']>) => void }) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
    const vie = useMemo(() => vieContrat(contract, documents, today), [contract, documents, today]);
    const [ouvert, setOuvert] = useState<string | null>(null);
    const choisie = vie.etapes.find(e => e.id === ouvert) ?? null;

    const points: PointFrise[] = vie.etapes.map(e => ({
        cle: e.id, date: e.date, etat: e.etat, icone: e.type === 'validation' && e.etat === 'fait' ? FileCheck2 : ICONE[e.type], titre: e.titre, repere: e.type === 'aujourdhui',
        lignes: e.type === 'aujourdhui' ? null : <>
            {e.resume && <span className="line-clamp-2 text-xs text-muted-foreground" title={e.resume}>{e.resume}</span>}
            {e.validation && e.validation.etat !== 'valide' && <span className={cn('text-xs font-medium', e.validation.etat === 'refuse' ? 'text-red-700' : 'text-blue-700')}>{VALIDATION[e.validation.etat].toLowerCase()}</span>}
        </>,
        infobulle: <>
            {e.resume && <p>{e.resume}</p>}
            {e.validation && <p>{VALIDATION[e.validation.etat]}{e.validation.validePar ? ` par ${e.validation.validePar}` : ''}</p>}
            {e.effets?.slice(0, 2).map((x, i) => <p key={i}>{x.libelle} : {x.valeur}</p>)}
        </>,
    }));

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-base">Vie du contrat</CardTitle>
                <CardDescription>Tout ce qui est arrivé au contrat, et ce qui l&apos;attend. Survolez un point pour l&apos;essentiel, cliquez pour le détail (qui a déposé, qui a validé, ce que le document change).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:gap-8">
                    {vie.ecoule !== null && (
                        <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2 text-sm">
                                <span className="text-muted-foreground">Durée écoulée, du {dateFr(String(contract.startDate).slice(0, 10))} au {dateFr(String(contract.endDate).slice(0, 10))}</span>
                                <span className="font-semibold tabular-nums">{vie.ecoule.toLocaleString('fr-FR')} %</span>
                            </div>
                            <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Durée écoulée du contrat" aria-valuenow={vie.ecoule} aria-valuemin={0} aria-valuemax={100}>
                                <div className="h-full rounded-full bg-blue-600" style={{ width: `${vie.ecoule}%` }} />
                            </div>
                        </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                        {vie.enAttente > 0 && <Badge variant="outline" className="border-blue-300 text-blue-700">{vie.enAttente} en attente de validation</Badge>}
                        {vie.refuses > 0 && <Badge variant="outline" className="border-red-300 text-red-700">{vie.refuses} refusé(s)</Badge>}
                        {vie.prochaine && <span className={cn(vie.prochaine.etat === 'alerte' ? 'font-medium text-red-700' : 'text-muted-foreground')}>Prochaine étape : {vie.prochaine.titre.toLowerCase()} le {dateFr(vie.prochaine.date)}</span>}
                    </div>
                </div>
                <Frise points={points} ouvert={ouvert} onOuvrir={setOuvert} label="Frise chronologique de la vie du contrat" />
                {choisie && <Detail e={choisie} onClose={() => setOuvert(null)} onVoirDocuments={onVoirDocuments} />}
            </CardContent>
        </Card>
    );
}
