'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, ExternalLink, Info, Loader2, Quote, RefreshCw, Sparkles, TriangleAlert, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PastilleActivite } from '@/components/ui/pastilles';
import { TON_STATUT } from '@/components/propositions/statut';
import { usePrompt } from '@/components/confirm-provider';
import { useData } from '@/context/data-context';
import { useToast } from '@/hooks/use-toast';
import { LIBELLE_STATUT, preuvesDe, type Preuve, type Proposition } from '@/lib/contracts/propositions';
import { propositionAction, refuserPropositionAction, relirePropositionAction } from '@/lib/contracts/propositions-actions';

const TON_CONFIANCE: Record<Preuve['confiance'], string> = { haute: 'border-emerald-300 bg-emerald-50 text-emerald-800', moyenne: 'border-amber-300 bg-amber-50 text-amber-800', basse: 'border-red-300 bg-red-50 text-red-800' };
const fr = (d?: string) => (d ? d.split('-').reverse().join('/') : '');
const eur = (s: string) => { const n = Number(String(s).replace(/\s/g, '').replace(',', '.')); return n ? n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) : '—'; };

/** Revue d'une proposition : le document à gauche ; à droite ce qui a été lu, d'où ça vient, et ce qu'il faut vérifier. */
export default function PropositionPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const { toast } = useToast();
    const demander = usePrompt();
    const { isAdmin, isContratheque, clients, activities, schedules, terms, sites } = useData();
    const [p, setP] = useState<Proposition | null>(null);
    const [erreur, setErreur] = useState('');
    const [relecture, setRelecture] = useState(false);
    const decide = isAdmin || isContratheque;

    const charger = useCallback(async () => {
        const r = await propositionAction(id);
        if (r.success) { setP(r.data); setErreur(''); } else setErreur(r.error);
    }, [id]);
    useEffect(() => { void charger(); }, [charger]);

    const refuser = async () => {
        const motif = await demander({ title: 'Refuser la proposition', description: 'Rien ne sera créé. Le motif reste dans l\'historique.', label: 'Motif', required: true, multiline: true, confirmLabel: 'Refuser' });
        if (motif === null) return;
        const r = await refuserPropositionAction(id, motif);
        if (!r.success) { toast({ variant: 'destructive', title: 'Refus impossible', description: r.error }); return; }
        toast({ title: 'Proposition refusée' }); await charger();
    };
    const relire = async () => {
        setRelecture(true);
        const r = await relirePropositionAction(id);
        setRelecture(false);
        if (r.success) setP(r.data); else toast({ variant: 'destructive', title: 'Relecture impossible', description: r.error });
    };

    if (erreur) return <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{erreur}</p>;
    if (!p) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
    const b = p.brouillon;
    const lu = (champ: string) => !!b?.lusDansPdf.includes(champ);
    const client = b?.client.mode === 'existant' ? clients.find(c => c.id === b.client.clientId) : null;
    const nomRef = (l: { id: string; name: string }[], v: string) => l.find(x => x.id === v)?.name ?? '—';

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                    <Link href="/contracts/propositions" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ArrowLeft className="h-3.5 w-3.5" />Propositions</Link>
                    <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight">
                        <Sparkles className="h-5 w-5 text-primary" />{p.document.name}
                        <Badge variant="outline" className={TON_STATUT[p.statut]}>{LIBELLE_STATUT[p.statut]}</Badge>
                        {p.lecture?.simulee && <Badge variant="outline">lecture simulée (démo)</Badge>}
                    </h1>
                    <p className="text-sm text-muted-foreground">Déposé par {p.deposePar} le {new Date(p.deposeLe).toLocaleString('fr-FR')}{p.lecture && ` · lu par ${p.lecture.modele} en ${Math.round((p.lecture.dureeMs ?? 0) / 1000)} s`}{p.type === 'pdf-public' ? ' · marché public' : ' · marché privé'}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {(p.statut === 'echec' || p.statut === 'a_revoir') && <Button variant="outline" size="sm" onClick={relire} disabled={relecture}>{relecture ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Relire</Button>}
                    {p.statut === 'a_revoir' && decide && <Button variant="outline" size="sm" onClick={refuser}><XCircle className="mr-2 h-4 w-4" />Refuser</Button>}
                    {p.statut === 'a_revoir' && decide && <Button size="sm" onClick={() => router.push(`/contracts/nouveau?proposition=${p.id}`)}><CheckCircle2 className="mr-2 h-4 w-4" />Vérifier et créer</Button>}
                    {p.decision?.contractId && <Button asChild size="sm"><Link href={`/contracts/${p.decision.contractId}`}>Contrat {p.decision.contractNumber}</Link></Button>}
                </div>
            </div>
            {p.statut === 'a_revoir' && !decide && <p className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">La contrathèque vérifiera cette proposition avant toute création.</p>}
            {p.statut === 'echec' && <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">Lecture impossible : {p.erreur}</p>}
            {p.decision?.motif && <p className="rounded-md border p-3 text-sm">Refusée par {p.decision.par} le {new Date(p.decision.le).toLocaleDateString('fr-FR')} : {p.decision.motif}</p>}

            <div className="grid gap-4 xl:grid-cols-2">
                <Card className="overflow-hidden">
                    <CardHeader className="flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-base">Document</CardTitle><Button asChild size="sm" variant="ghost"><a href={p.document.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Ouvrir</a></Button></CardHeader>
                    <CardContent className="p-0"><iframe title="Document déposé" src={p.document.url} className="h-[78vh] w-full border-t" /></CardContent>
                </Card>

                {b && (
                    <div className="space-y-4" data-proposition="lecture">
                        {(p.alertes ?? []).length > 0 && (
                            <Card><CardContent className="space-y-1.5 p-4 text-sm" data-proposition="alertes">
                                {p.alertes!.map((a, i) => (
                                    <p key={i} className={`flex items-start gap-2 ${a.gravite === 'bloquant' ? 'text-red-800' : a.gravite === 'attention' ? 'text-amber-800' : 'text-slate-700'}`}>
                                        {a.gravite === 'info' ? <Info className="mt-0.5 h-4 w-4 shrink-0" /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
                                        <span>{a.texte}{a.lien && <> <Link href={a.lien} className="underline">voir</Link></>}{a.gravite === 'bloquant' && <span className="text-xs text-muted-foreground"> — à compléter à la création</span>}</span>
                                    </p>
                                ))}
                            </CardContent></Card>
                        )}
                        <Bloc titre="Client">
                            {client ? <Champ libelle="Client existant" valeur={<Link href={`/clients/${client.id}`} className="text-primary hover:underline">{client.name}</Link>} preuves={preuvesDe(p.preuves, 'client.name')} lu />
                                : <Champ libelle="Nouveau client" valeur={b.client.nouveau.name} preuves={preuvesDe(p.preuves, 'client.name')} lu={lu('client.name')} />}
                            <Champ libelle="Adresse" valeur={[b.client.nouveau.address, `${b.client.nouveau.postalCode} ${b.client.nouveau.city}`.trim()].filter(Boolean).join(', ')} preuves={preuvesDe(p.preuves, 'client.address')} lu={lu('client.address')} />
                            <Champ libelle="SIRET" valeur={b.client.nouveau.siret} preuves={preuvesDe(p.preuves, 'client.siret')} lu={lu('client.siret')} />
                            <Champ libelle="Représenté par" valeur={b.client.nouveau.representedBy} preuves={preuvesDe(p.preuves, 'client.representativeName')} lu={lu('client.representedBy')} />
                            <Champ libelle="Contact de facturation" valeur={[b.client.nouveau.contactFacturation.name, b.client.nouveau.contactFacturation.email, b.client.nouveau.contactFacturation.phone].filter(Boolean).join(' · ')} preuves={preuvesDe(p.preuves, 'client.contactFacturation')} lu={lu('client.contactFacturation.name')} />
                        </Bloc>
                        <Bloc titre="Contrat">
                            <Champ libelle="Libellé" valeur={b.contrat.label} preuves={preuvesDe(p.preuves, 'contrat.label')} lu={lu('contrat.label')} />
                            <Champ libelle="Période" valeur={b.contrat.startDate || b.contrat.endDate ? `du ${fr(b.contrat.startDate) || '?'} au ${fr(b.contrat.endDate) || '?'}` : ''} preuves={[...preuvesDe(p.preuves, 'contrat.startDate'), ...preuvesDe(p.preuves, 'contrat.endDate')]} lu={lu('contrat.startDate')} />
                            <Champ libelle="Reconduction" valeur={b.contrat.tacitRenewal ? 'tacite' : 'non tacite'} preuves={preuvesDe(p.preuves, 'contrat.tacitRenewal')} lu={lu('contrat.tacitRenewal')} />
                            <Champ libelle="Préavis" valeur={b.contrat.noticePeriod} preuves={preuvesDe(p.preuves, 'contrat.noticePeriod')} lu={lu('contrat.noticePeriod')} />
                            <Champ libelle="Facturation" valeur={`${b.contrat.invoicingType === 'global' ? 'globale' : 'par site'} · ${nomRef(schedules, b.contrat.scheduleId)} · ${nomRef(terms, b.contrat.termId)}`} lu={lu('contrat.invoicingType')} />
                        </Bloc>
                        <Bloc titre={`Sites (${b.sites.existants.length + b.sites.nouveaux.length})`}>
                            {b.sites.existants.map(sid => <Champ key={sid} libelle="Site existant" valeur={<Link href={`/sites/${sid}`} className="text-primary hover:underline">{sites.find(s => s.id === sid)?.name ?? sid}</Link>} lu />)}
                            {b.sites.nouveaux.map((s, i) => <Champ key={s.cle} libelle="Nouveau site" valeur={`${s.name}${s.address ? ` — ${s.address}, ${s.postalCode} ${s.city}` : ''}`} preuves={preuvesDe(p.preuves, `sites[${i}]`)} lu />)}
                        </Bloc>
                        <Bloc titre="Prestations">
                            {b.prestations.lignes.length === 0 ? <p className="text-sm text-muted-foreground">Aucune prestation lue : à saisir à la création.</p> : (
                                <table className="w-full text-sm" data-proposition="prestations">
                                    <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 font-medium">Activité</th><th className="font-medium">Site</th><th className="text-right font-medium">Annuel HT</th><th className="pl-3 font-medium">Rythme</th><th className="pl-3 font-medium">Source</th></tr></thead>
                                    <tbody>{b.prestations.lignes.map((l, i) => {
                                        const a = activities.find(x => x.id === l.activityId);
                                        const site = b.sites.nouveaux.find(s => s.cle === l.site)?.name ?? sites.find(s => s.id === l.site)?.name ?? l.site;
                                        const pr = preuvesDe(p.preuves, `activitiesDetails[${l.activityId}]`);
                                        return (
                                            <tr key={i} className="border-t align-top">
                                                <td className="py-1.5"><PastilleActivite code={a?.code} type={a?.type} /></td>
                                                <td className="text-xs">{site}</td>
                                                <td className="text-right tabular-nums">{eur(l.montant)}</td>
                                                <td className="pl-3 text-xs">{nomRef(schedules, l.scheduleId)} · {nomRef(terms, l.termId)}</td>
                                                <td className="pl-3">{l.montant && pr[0] ? <Extrait p={pr[0]} /> : <span className="text-xs text-muted-foreground">—</span>}</td>
                                            </tr>
                                        );
                                    })}</tbody>
                                </table>
                            )}
                        </Bloc>
                        <p className="text-xs text-muted-foreground">Les valeurs marquées « lu » viennent du document ; les extraits disent d&apos;où. « Vérifier et créer » ouvre l&apos;assistant de création pré-rempli : tout reste modifiable, et le contrat créé part en validation comme les autres.</p>
                    </div>
                )}
            </div>
        </div>
    );
}

function Bloc({ titre, children }: { titre: string; children: React.ReactNode }) {
    return <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{titre}</CardTitle></CardHeader><CardContent className="space-y-2.5 text-sm">{children}</CardContent></Card>;
}

function Champ({ libelle, valeur, preuves = [], lu }: { libelle: string; valeur: React.ReactNode; preuves?: Preuve[]; lu?: boolean }) {
    const vide = valeur === '' || valeur === null || valeur === undefined;
    return (
        <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-3" data-champ={libelle}>
            <span className="text-muted-foreground">{libelle}</span>
            <div className="min-w-0">
                <span className={vide ? 'text-muted-foreground' : 'font-medium'}>{vide ? 'non lu — à saisir' : valeur}</span>
                {lu && !vide && <Badge variant="outline" className="ml-2 border-violet-300 bg-violet-50 py-0 text-[10px] text-violet-800">lu</Badge>}
                {preuves.slice(0, 2).map((pr, i) => <div key={i} className="mt-1"><Extrait p={pr} /></div>)}
            </div>
        </div>
    );
}

function Extrait({ p }: { p: Preuve }) {
    return (
        <span className="flex items-start gap-1 text-xs text-muted-foreground" title={`Page ${p.page ?? '?'} — confiance ${p.confiance}`}>
            <Quote className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="italic">« {p.extrait} »{p.page ? ` (p. ${p.page})` : ''}</span>
            <Badge variant="outline" className={`ml-1 shrink-0 py-0 text-[10px] not-italic ${TON_CONFIANCE[p.confiance]}`}>{p.confiance}</Badge>
        </span>
    );
}
