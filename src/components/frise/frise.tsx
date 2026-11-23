'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Frise chronologique (présentation) : un point par étape, à sa date, relié au précédent ; les étapes à venir sont en
 * pointillé. Le survol d'un point donne l'essentiel (infobulle), le clic le sélectionne : l'appelant affiche le détail.
 * Utilisée par la frise du chantier (affaires) et par la vie du contrat.
 */

export type EtatPoint = 'fait' | 'en_cours' | 'alerte' | 'a_venir' | 'annule';
export const TON_POINT: Record<EtatPoint, { point: string; trait: string; texte: string; libelle: string }> = {
    fait: { point: 'border-emerald-600 bg-emerald-600 text-white', trait: 'bg-emerald-500', texte: 'text-emerald-700', libelle: 'Fait' },
    en_cours: { point: 'border-blue-600 bg-white text-blue-700', trait: 'bg-blue-300', texte: 'text-blue-700', libelle: 'En cours' },
    alerte: { point: 'border-red-600 bg-red-600 text-white', trait: 'bg-red-300', texte: 'text-red-700', libelle: 'À traiter' },
    a_venir: { point: 'border-dashed border-slate-400 bg-white text-slate-500', trait: 'bg-slate-200', texte: 'text-slate-500', libelle: 'À venir' },
    annule: { point: 'border-slate-300 bg-slate-100 text-slate-400', trait: 'bg-slate-200', texte: 'text-slate-400 line-through', libelle: 'Annulé' },
};

export type PointFrise = {
    cle: string;
    /** Jour AAAA-MM-JJ ; null : à venir, sans date. */
    date: string | null;
    etat: EtatPoint;
    icone: LucideIcon;
    titre: string;
    /** Lignes sous le titre (montant, avancement, état…). */
    lignes?: ReactNode;
    /** Contenu de l'infobulle, sous le titre. */
    infobulle?: ReactNode;
    /** Repère non cliquable (ex. « aujourd'hui »). */
    repere?: boolean;
};

export const dateFr = (d: string | null) => (d ? d.split('-').reverse().join('/') : 'à venir');

export function Frise({ points, ouvert, onOuvrir, label }: { points: PointFrise[]; ouvert: string | null; onOuvrir: (cle: string | null) => void; label: string }) {
    return (
        <TooltipProvider delayDuration={150}>
            <div className="overflow-x-auto pb-1">
                <ol className="flex min-w-max items-start" aria-label={label}>
                    {points.map((p, i) => {
                        const ton = TON_POINT[p.etat];
                        const actif = ouvert === p.cle;
                        const Icone = p.icone;
                        return (
                            <li key={p.cle} className={cn('relative flex shrink-0 flex-col items-center px-1 text-center', p.repere ? 'w-24' : 'w-36')}>
                                {i > 0 && <span aria-hidden className={cn('absolute right-1/2 top-[2.35rem] w-full', p.etat === 'a_venir' ? 'h-0 border-t-2 border-dashed border-slate-300' : cn('h-0.5', ton.trait))} />}
                                <span className={cn('mb-1 h-4 text-xs tabular-nums', p.repere ? 'font-medium text-foreground' : 'text-muted-foreground')}>{dateFr(p.date)}</span>
                                {p.repere ? (
                                    <span className="relative z-10 flex h-9 w-9 items-center justify-center" aria-hidden><span className="h-9 w-0.5 bg-foreground" /></span>
                                ) : (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button type="button" onClick={() => onOuvrir(actif ? null : p.cle)} aria-pressed={actif} aria-label={`${p.titre}, ${dateFr(p.date)} : afficher le détail`}
                                                className={cn('relative z-10 flex h-9 w-9 items-center justify-center rounded-full border-2 transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', ton.point, actif && 'ring-2 ring-ring ring-offset-2')}>
                                                <Icone className="h-4 w-4" />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs text-left">
                                            <p className="font-medium">{p.titre}</p>
                                            {p.infobulle}
                                            <p className="mt-1 opacity-70">Cliquez pour le détail</p>
                                        </TooltipContent>
                                    </Tooltip>
                                )}
                                <span className={cn('mt-1.5 text-sm font-medium leading-tight', p.etat === 'annule' && 'text-muted-foreground line-through', p.repere && 'text-xs uppercase tracking-wide')}>{p.titre}</span>
                                {p.lignes}
                            </li>
                        );
                    })}
                </ol>
            </div>
        </TooltipProvider>
    );
}
