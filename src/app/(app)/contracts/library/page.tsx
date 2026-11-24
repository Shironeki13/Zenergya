'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, BellRing, CalendarClock, CalendarX, CircleAlert, FileClock, FilePlus2, FileX2, Files, Info, Loader2, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useData } from '@/context/data-context';
import { BoutonValidation, type CibleValidation } from '@/components/contracts/validation/bouton-validation';
import type { TypeValidation } from '@/lib/validations';
import { lireServeur } from '@/services/lecture';
import { cn } from '@/lib/utils';
import { LIBELLE_NATURE, LIBELLE_SUIVI, NATURES_DOCUMENT, suiviContratheque, type DocumentSuivi, type Gravite, type LigneSuivi, type TypeSuivi } from '@/lib/contrats/suivi';

/**
 * Tableau de bord de la contrathèque : ce qu'il faut traiter sur l'ensemble des contrats (documents à valider,
 * préavis, échéances, refus), classé par urgence, et le calendrier des douze prochains mois. Chaque ligne ouvre la vie
 * du contrat concerné.
 */

const fr = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—');
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const moisFr = (m: string) => `${MOIS[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`;

const GRAVITE: Record<Gravite, { icone: LucideIcon; classe: string; libelle: string }> = {
    critique: { icone: CircleAlert, classe: 'text-red-600', libelle: 'Urgent' },
    attention: { icone: AlertTriangle, classe: 'text-amber-600', libelle: 'À surveiller' },
    info: { icone: Info, classe: 'text-slate-500', libelle: 'Pour information' },
};
const ICONE: Record<TypeSuivi, LucideIcon> = {
    echeance_depassee: CalendarX, preavis: BellRing, echeance: CalendarClock, contrat_attente: FileClock, contrat_refuse: FileX2, document_attente: FileClock, document_refuse: FileX2, resiliation_a_venir: CalendarX,
};
type Filtre = 'tout' | 'valider' | 'preavis' | 'echeances' | 'refuses';
const FILTRES: Record<Filtre, { libelle: string; types: TypeSuivi[] | null }> = {
    tout: { libelle: 'Tout', types: null },
    valider: { libelle: 'À valider', types: ['document_attente', 'contrat_attente'] },
    preavis: { libelle: 'Préavis', types: ['preavis'] },
    echeances: { libelle: 'Échéances', types: ['echeance', 'echeance_depassee', 'resiliation_a_venir'] },
    refuses: { libelle: 'Refusés', types: ['document_refuse', 'contrat_refuse'] },
};

function Tuile({ titre, valeur, sous, icone: Icone, ton, actif, onClick }: { titre: string; valeur: number; sous: string; icone: LucideIcon; ton: string; actif?: boolean; onClick?: () => void }) {
    return (
        <button type="button" onClick={onClick} disabled={!onClick} aria-pressed={actif}
            className={cn('rounded-xl border bg-card p-4 text-left transition-shadow', onClick && 'hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring', actif && 'ring-2 ring-ring')}>
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">{titre}</span>
                <span className={cn('flex h-8 w-8 items-center justify-center rounded-md', ton)}><Icone className="h-4 w-4" /></span>
            </div>
            <p className="mt-1 text-2xl font-bold tabular-nums">{valeur}</p>
            <p className="text-xs text-muted-foreground">{sous}</p>
        </button>
    );
}

export default function ContrathequePage() {
    const { contracts, isLoading, isContratheque, reloadData } = useData();
    const [documents, setDocuments] = useState<DocumentSuivi[] | null>(null);
    const [filtre, setFiltreBrut] = useState<Filtre>('tout');
    // Sous-filtre par nature (contrat, avenant, reconduction…) pour ce qui est à valider ou refusé.
    const [nature, setNature] = useState<LigneSuivi['document'] | null>(null);
    const setFiltre = (f: Filtre | ((x: Filtre) => Filtre)) => { setFiltreBrut(f); setNature(null); };
    const chargerDocuments = useCallback(() => lireServeur<DocumentSuivi[]>('documentsASuivre', {}, []).then(setDocuments).catch(() => setDocuments([])), []);
    useEffect(() => { void chargerDocuments(); }, [chargerDocuments]);
    // Après une validation ou un refus : documents et contrats relus.
    const recharger = useCallback(async () => { await Promise.all([chargerDocuments(), reloadData(['contracts', 'clients', 'sites', 'services'])]); }, [chargerDocuments, reloadData]);
    /** Document à contrôler d'une ligne en attente (contrat ou document du contrat). */
    const cibleDe = (l: LigneSuivi): CibleValidation | null => {
        if (l.type === 'contrat_attente') return { type: 'contrat', id: l.contractId };
        if (l.type !== 'document_attente') return null;
        const [, type, id] = l.cle.split(':');
        return type && id ? { type: type as TypeValidation, id } : null;
    };

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
    const suivi = useMemo(() => suiviContratheque(contracts, documents ?? [], today), [contracts, documents, today]);
    const duFiltre = useMemo(() => { const t = FILTRES[filtre].types; return t ? suivi.lignes.filter(l => t.includes(l.type)) : suivi.lignes; }, [suivi, filtre]);
    const parNature = filtre === 'valider' || filtre === 'refuses';
    const lignes = useMemo(() => (parNature && nature ? duFiltre.filter(l => l.document === nature) : duFiltre), [duFiltre, parNature, nature]);
    const { chiffres } = suivi;
    const bascule = (f: Filtre) => () => setFiltre(x => (x === f ? 'tout' : f));
    const maxMois = Math.max(1, ...suivi.calendrier.map(m => m.preavis.length + m.echeances.length));

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Contrathèque</h1>
                    <p className="text-muted-foreground">Ce qu&apos;il faut traiter sur vos contrats, et ce qui arrive dans les douze prochains mois.</p>
                    {!isContratheque && <p className="text-sm text-muted-foreground">Les documents déposés sont validés ou refusés par la contrathèque ou un administrateur ; vous êtes prévenu par mail de la décision.</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                    {isContratheque && <Button asChild variant="outline"><Link href="/admin/validations"><ShieldCheck className="mr-2 h-4 w-4" />Valider les documents</Link></Button>}
                    <Button asChild variant="outline"><Link href="/contracts"><Files className="mr-2 h-4 w-4" />Liste des contrats</Link></Button>
                    <Button asChild><Link href="/contracts/new"><FilePlus2 className="mr-2 h-4 w-4" />Ajouter un document</Link></Button>
                </div>
            </div>

            {isLoading || documents === null ? <Loader2 className="mx-auto mt-16 h-8 w-8 animate-spin" /> : (
                <>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                        <Tuile titre="Contrats actifs" valeur={chiffres.actifs} sous={chiffres.sansPreavis ? `${chiffres.sansPreavis} sans préavis lisible` : 'préavis renseigné partout'} icone={Files} ton="bg-blue-100 text-blue-700" />
                        <Tuile titre="À valider" valeur={chiffres.aValider} sous="documents et contrats en attente" icone={FileClock} ton="bg-amber-100 text-amber-700" actif={filtre === 'valider'} onClick={bascule('valider')} />
                        <Tuile titre="Préavis sous 90 jours" valeur={chiffres.preavis90} sous="dates limites de dénonciation" icone={BellRing} ton="bg-red-100 text-red-700" actif={filtre === 'preavis'} onClick={bascule('preavis')} />
                        <Tuile titre="Échéances sous 6 mois" valeur={chiffres.echeances180 + chiffres.depassees} sous={chiffres.depassees ? `dont ${chiffres.depassees} dépassée(s)` : 'aucune dépassée'} icone={CalendarClock} ton="bg-violet-100 text-violet-700" actif={filtre === 'echeances'} onClick={bascule('echeances')} />
                        <Tuile titre="Refusés" valeur={chiffres.refuses} sous="à corriger et redéposer" icone={FileX2} ton="bg-slate-200 text-slate-700" actif={filtre === 'refuses'} onClick={bascule('refuses')} />
                    </div>

                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Les douze prochains mois</CardTitle>
                            <CardDescription>Dates limites de préavis (rouge) et échéances (violet) des contrats actifs. Survolez une pastille pour le contrat, cliquez pour ouvrir sa vie.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <TooltipProvider delayDuration={100}>
                                <div className="grid grid-cols-6 gap-2 lg:grid-cols-12">
                                    {suivi.calendrier.map(m => (
                                        <div key={m.mois} className="flex min-h-28 flex-col rounded-lg border bg-muted/20 p-2">
                                            <p className="text-center text-xs font-medium capitalize text-muted-foreground">{moisFr(m.mois)}</p>
                                            <div className="mt-2 flex flex-1 flex-wrap content-start justify-center gap-1">
                                                {m.preavis.map(x => (
                                                    <Tooltip key={`p${x.contractId}`}><TooltipTrigger asChild>
                                                        <Link href={`/contracts/${x.contractId}?onglet=historique`} aria-label={`Préavis ${x.contrat} le ${fr(x.date)}`} className="flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white hover:ring-2 hover:ring-red-300"><BellRing className="h-3 w-3" /></Link>
                                                    </TooltipTrigger><TooltipContent><p className="font-medium">Préavis avant le {fr(x.date)}</p><p>{x.contrat} — {x.client}</p></TooltipContent></Tooltip>
                                                ))}
                                                {m.echeances.map(x => (
                                                    <Tooltip key={`e${x.contractId}`}><TooltipTrigger asChild>
                                                        <Link href={`/contracts/${x.contractId}?onglet=historique`} aria-label={`Échéance ${x.contrat} le ${fr(x.date)}`} className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-600 text-white hover:ring-2 hover:ring-violet-300"><CalendarClock className="h-3 w-3" /></Link>
                                                    </TooltipTrigger><TooltipContent><p className="font-medium">Échéance le {fr(x.date)}</p><p>{x.contrat} — {x.client}</p><p>{x.tacite ? 'Reconduction tacite' : 'Sans reconduction tacite'}</p></TooltipContent></Tooltip>
                                                ))}
                                            </div>
                                            <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden><div className="h-full rounded-full bg-slate-400" style={{ width: `${((m.preavis.length + m.echeances.length) / maxMois) * 100}%` }} /></div>
                                        </div>
                                    ))}
                                </div>
                            </TooltipProvider>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
                            <div>
                                <CardTitle className="text-base">À traiter ({lignes.length})</CardTitle>
                                <CardDescription>Du plus urgent au moins urgent. Un clic ouvre la vie du contrat{isContratheque ? ' ; « Contrôler » ouvre le document pour le valider ou le refuser' : ''}.</CardDescription>
                            </div>
                            <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrer">
                                {(Object.keys(FILTRES) as Filtre[]).map(f => <Button key={f} size="sm" variant={filtre === f ? 'default' : 'outline'} onClick={() => setFiltre(f)} aria-pressed={filtre === f}>{FILTRES[f].libelle}</Button>)}
                            </div>
                        </CardHeader>
                        <CardContent>
                            {parNature && duFiltre.length > 0 && (
                                <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrer par type de document">
                                    <span className="mr-1 text-xs text-muted-foreground">Type :</span>
                                    <Button size="sm" variant={nature === null ? 'secondary' : 'ghost'} className="h-7 px-2.5 text-xs" aria-pressed={nature === null} onClick={() => setNature(null)}>Tous ({duFiltre.length})</Button>
                                    {NATURES_DOCUMENT.map(n => {
                                        const nb = duFiltre.filter(l => l.document === n).length;
                                        return <Button key={n} size="sm" variant={nature === n ? 'secondary' : 'ghost'} className="h-7 px-2.5 text-xs" disabled={nb === 0} aria-pressed={nature === n} onClick={() => setNature(nature === n ? null : n)}>{LIBELLE_NATURE[n]} ({nb})</Button>;
                                    })}
                                </div>
                            )}
                            {lignes.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Rien à traiter{filtre !== 'tout' ? ' dans cette catégorie' : ''}.</p> : (
                                <ul className="divide-y">
                                    {lignes.map((l: LigneSuivi) => {
                                        const g = GRAVITE[l.gravite];
                                        const Icone = ICONE[l.type];
                                        return (
                                            <li key={l.cle} className="flex items-center gap-2">
                                                <Link href={`/contracts/${l.contractId}?onglet=historique`} className="flex min-w-0 flex-1 items-start gap-3 rounded-md px-2 py-2.5 hover:bg-muted/50">
                                                    <g.icone className={cn('mt-0.5 h-4 w-4 shrink-0', g.classe)} aria-label={g.libelle} />
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-sm"><span className="font-mono text-xs">{l.contrat}</span> <span className="font-medium">{l.client}</span></p>
                                                        <p className="text-sm text-muted-foreground">{l.texte}</p>
                                                    </div>
                                                    <Badge variant="outline" className="shrink-0 gap-1"><Icone className="h-3 w-3" />{LIBELLE_SUIVI[l.type]}</Badge>
                                                    <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{fr(l.date)}</span>
                                                </Link>
                                                {cibleDe(l) && <BoutonValidation cible={cibleDe(l)!} onTraite={recharger} />}
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
}
