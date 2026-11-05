'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, ExternalLink, Loader2, MessageSquare, MessageSquarePlus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ajouterCommentaireAction, historiqueCommentairesAction } from '@/lib/pilotage/actions';
import { construireTcd, MOTIFS, type CommentaireSuivi, type Focus, type Motif, type ResumeFil, type Totaux } from '@/lib/pilotage/tcd';
import type { EcheanceSuivi } from '@/lib/pilotage/suivi-facturation';
import type { SuiviFacturation } from '@/services/pilotage-admin';

/**
 * Pilotage ADV : synthèse (clients, factures à sortir, retard, blocages) et tableau croisé Client → Contrat →
 * Prestation → Échéances, dépliable niveau par niveau, avec commentaires de suivi historisés.
 */

const fr = (d: string) => d.split('-').reverse().join('/');
const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const dateHeure = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

type Niveau = 0 | 1 | 2 | 3;
const NIVEAUX: { n: Niveau; label: string }[] = [{ n: 0, label: 'Clients' }, { n: 1, label: 'Contrats' }, { n: 2, label: 'Prestations' }, { n: 3, label: 'Échéances' }];

const COULEUR_MOTIF: Record<Motif, string> = {
    en_cours: 'border-blue-400 text-blue-700', attente_client: 'border-amber-500 text-amber-700', attente_donnee: 'border-amber-500 text-amber-700',
    parametrage: 'border-purple-400 text-purple-700', litige: 'border-red-500 text-red-700', resolu: 'border-green-500 text-green-700', note: '',
};

type Cible = { contractId: string; contractNumber: string; itemKey: string | null; libelle: string };

function Montants({ t, focus }: { t: Totaux; focus: Focus }) {
    return (
        <>
            <TableCell className="text-right whitespace-nowrap">{t.retardMax > 0 ? <span className={t.retardMax > 30 ? 'text-red-600 font-semibold' : 'text-red-600'}>{t.retardMax} j</span> : '—'}</TableCell>
            <TableCell className="text-right whitespace-nowrap">
                {t.retard > 0 ? <><span className="font-medium text-red-600">{eur(t.montantRetard)}</span><span className="text-xs text-muted-foreground"> ({t.retard})</span></> : '—'}
            </TableCell>
            <TableCell className="text-right whitespace-nowrap">
                {t.jour > 0 ? <><span className="font-medium text-orange-600">{eur(t.montantJour)}</span><span className="text-xs text-muted-foreground"> ({t.jour})</span></> : '—'}
            </TableCell>
            {focus === 'tout' && (
                <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                    {t.aVenir > 0 ? <>~{eur(t.montantAVenir)}<span className="text-xs"> ({t.aVenir})</span></> : '—'}
                </TableCell>
            )}
            <TableCell className="text-center">
                {t.bloquees > 0 ? <Badge variant="destructive">{t.bloquees}</Badge> : null}
                {t.aLaFacture > 0 && <span className="block text-[10px] text-muted-foreground">{t.aLaFacture} à la facture</span>}
            </TableCell>
        </>
    );
}

function Suivi({ s, onOpen }: { s?: ResumeFil; onOpen: () => void }) {
    return (
        <TableCell className="max-w-[260px]">
            <button type="button" onClick={onOpen} className="flex items-start gap-1.5 text-left w-full group" title="Commentaires de suivi">
                {s ? <MessageSquare className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground group-hover:text-foreground" /> : <MessageSquarePlus className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground/60 group-hover:text-foreground" />}
                {s && (
                    <span className="min-w-0">
                        <Badge variant="outline" className={cn('text-[10px] mr-1', COULEUR_MOTIF[s.dernier.motif])}>{MOTIFS[s.dernier.motif]}</Badge>
                        {s.nombre > 1 && <span className="text-[10px] text-muted-foreground">+{s.nombre - 1}</span>}
                        <span className="block text-xs text-muted-foreground truncate">{s.dernier.texte}</span>
                        <span className="block text-[10px] text-muted-foreground">{s.dernier.auteur} · {dateHeure(s.dernier.createdAt)}</span>
                    </span>
                )}
            </button>
        </TableCell>
    );
}

function StatutEcheance({ e }: { e: EcheanceSuivi }) {
    if (e.statut === 'aujourdhui') return <Badge variant="outline" className="border-orange-500 text-orange-600">Aujourd&apos;hui</Badge>;
    if (e.statut === 'retard') return <Badge variant={e.jours > 30 ? 'destructive' : 'outline'} className={e.jours > 30 ? '' : 'border-red-400 text-red-600'}>Retard {e.jours} j</Badge>;
    return <Badge variant="secondary">Dans {e.jours} j</Badge>;
}

/** Fil de commentaires d'un contrat ou d'une prestation : historique et ajout. */
function FilCommentaires({ cible, onClose, onAjout }: { cible: Cible | null; onClose: () => void; onAjout: (c: CommentaireSuivi) => void }) {
    const { toast } = useToast();
    const [historique, setHistorique] = useState<CommentaireSuivi[] | null>(null);
    const [motif, setMotif] = useState<Motif>('en_cours');
    const [texte, setTexte] = useState('');
    const [envoi, setEnvoi] = useState(false);

    useEffect(() => {
        if (!cible) return;
        setHistorique(null); setTexte(''); setMotif('en_cours');
        historiqueCommentairesAction(cible.contractId).then(r => {
            if (r.success) setHistorique(r.data);
            else toast({ title: 'Historique indisponible', description: r.error, variant: 'destructive' });
        });
    }, [cible, toast]);

    // Prestation : son fil ; contrat : tout le contrat (commentaires des prestations compris, avec leur cible).
    const fil = (historique ?? []).filter(c => !cible?.itemKey || c.itemKey === cible.itemKey);

    const envoyer = async () => {
        if (!cible || !texte.trim()) return;
        setEnvoi(true);
        const r = await ajouterCommentaireAction({ contractId: cible.contractId, itemKey: cible.itemKey, motif, texte });
        setEnvoi(false);
        if (!r.success) { toast({ title: 'Commentaire refusé', description: r.error, variant: 'destructive' }); return; }
        setHistorique(h => [r.data, ...(h ?? [])]);
        setTexte('');
        onAjout(r.data);
    };

    return (
        <Dialog open={!!cible} onOpenChange={o => { if (!o) onClose(); }}>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Suivi — {cible?.contractNumber}</DialogTitle>
                    <DialogDescription>{cible?.itemKey ? `Prestation : ${cible.libelle}` : 'Contrat entier (les commentaires des prestations sont repris ici).'} Les commentaires sont historisés : ils ne se modifient pas et ne se suppriment pas.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3 rounded-md border p-3 bg-muted/20">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1">
                            <Label>Motif</Label>
                            <Select value={motif} onValueChange={v => setMotif(v as Motif)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>{(Object.keys(MOTIFS) as Motif[]).map(m => <SelectItem key={m} value={m}>{MOTIFS[m]}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                            <Label>Commentaire</Label>
                            <Textarea value={texte} onChange={e => setTexte(e.target.value)} maxLength={2000} rows={3} placeholder="Action menée, interlocuteur, prochaine étape…" />
                        </div>
                    </div>
                    <div className="flex justify-end">
                        <Button size="sm" onClick={envoyer} disabled={envoi || !texte.trim()}>{envoi && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Ajouter</Button>
                    </div>
                </div>
                <div className="space-y-2">
                    {historique === null ? <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Chargement…</p>
                        : fil.length === 0 ? <p className="text-sm text-muted-foreground">Aucun commentaire.</p>
                            : fil.map(c => (
                                <div key={c.id} className="rounded-md border p-3 text-sm">
                                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                        <Badge variant="outline" className={cn('text-[10px]', COULEUR_MOTIF[c.motif])}>{MOTIFS[c.motif]}</Badge>
                                        <span className="font-medium text-foreground">{c.auteur}</span>
                                        <span>{dateHeure(c.createdAt)}</span>
                                        {!cible?.itemKey && <span>· {c.itemKey ? c.cible : 'Contrat'}</span>}
                                    </div>
                                    <p className="mt-1 whitespace-pre-wrap">{c.texte}</p>
                                </div>
                            ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}

export function PilotageAdv({ data, loading, horizon, onHorizon }: { data: SuiviFacturation | null; loading: boolean; horizon: number; onHorizon: (h: number) => void }) {
    const [focus, setFocus] = useState<Focus>('retard');
    const [q, setQ] = useState('');
    const [ouverts, setOuverts] = useState<Set<string>>(new Set());
    const [ajouts, setAjouts] = useState<CommentaireSuivi[]>([]);
    const [cible, setCible] = useState<Cible | null>(null);

    // Les commentaires ajoutés dans la session s'ajoutent à ceux du serveur jusqu'au prochain calcul.
    useEffect(() => { setAjouts([]); }, [data]);
    const commentaires = useMemo(() => {
        const ids = new Set((data?.commentaires ?? []).map(c => c.id));
        return [...(data?.commentaires ?? []), ...ajouts.filter(c => !ids.has(c.id))];
    }, [data, ajouts]);

    const echeances = useMemo(() => {
        const t = q.trim().toLowerCase();
        return (data?.echeances ?? []).filter(e => !t || [e.clientName, e.contractNumber, e.site, e.prestation].some(x => x.toLowerCase().includes(t)));
    }, [data, q]);
    const { clients, synthese } = useMemo(() => construireTcd(echeances, commentaires, focus), [echeances, commentaires, focus]);
    // Synthèse globale (indépendante du focus et de la recherche).
    const global = useMemo(() => construireTcd(data?.echeances ?? [], [], 'tout').synthese, [data]);

    const basculer = (k: string) => setOuverts(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
    const deplier = (niveau: Niveau) => {
        const n = new Set<string>();
        for (const cl of clients) {
            if (niveau >= 1) n.add(cl.key);
            for (const ct of cl.contrats) {
                if (niveau >= 2) n.add(ct.key);
                for (const pr of ct.prestations) if (niveau >= 3) n.add(pr.key);
            }
        }
        setOuverts(n);
    };
    const colonnes = focus === 'tout' ? 8 : 7;

    return (
        <div className="space-y-4">
            {/* Synthèse */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <Kpi titre="Clients à facturer" valeur={`${global.clientsAFacturer}`} sous={`sur ${global.clients} client${global.clients > 1 ? 's' : ''} avec échéances`} />
                <Kpi titre="Factures à sortir" valeur={`${global.facturesASortir}`} sous={global.facturesBloquees ? `dont ${global.facturesBloquees} bloquée${global.facturesBloquees > 1 ? 's' : ''}` : 'aucune bloquée'} alerte={global.facturesBloquees > 0} />
                <Kpi titre="En retard" valeur={eur(global.montantRetard)} sous={`${global.retard} échéance${global.retard > 1 ? 's' : ''}${global.retardMax ? ` · jusqu'à ${global.retardMax} j` : ''}`} alerte={global.retard > 0} />
                <Kpi titre="À facturer aujourd'hui" valeur={eur(global.montantJour)} sous={`${global.jour} échéance${global.jour > 1 ? 's' : ''}${global.aLaFacture ? ` · ${global.aLaFacture} à la facture` : ''}`} />
                <Kpi titre={`À venir (${horizon} j)`} valeur={`~${eur(global.montantAVenir)}`} sous={`${global.aVenir} échéance${global.aVenir > 1 ? 's' : ''}`} />
            </div>

            <Card>
                <CardHeader className="pb-3 flex-row items-start justify-between space-y-0 gap-4">
                    <div>
                        <CardTitle className="text-base">Pilotage par client</CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                            Client → Contrat → Prestation → Échéances, les plus en retard d&apos;abord. Montants exacts pour ce qui est facturable
                            (« ~ » : estimés). Cliquez sur la colonne Suivi pour commenter un contrat ou une prestation.
                        </p>
                    </div>
                    <Link href="/billing/batch"><Button size="sm" variant="outline" className="gap-1 shrink-0">Facturation groupée<ExternalLink className="h-3 w-3" /></Button></Link>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="inline-flex rounded-md border p-0.5">
                            {([['retard', 'En retard et du jour'], ['bloque', 'Bloquées'], ['tout', "Tout l'horizon"]] as [Focus, string][]).map(([f, l]) => (
                                <Button key={f} size="sm" variant={focus === f ? 'default' : 'ghost'} className="h-7" onClick={() => setFocus(f)}>{l}</Button>
                            ))}
                        </div>
                        <div className="inline-flex items-center rounded-md border p-0.5">
                            <span className="px-2 text-xs text-muted-foreground">Détail</span>
                            {NIVEAUX.map(({ n, label }) => <Button key={n} size="sm" variant="ghost" className="h-7" onClick={() => deplier(n)}>{label}</Button>)}
                        </div>
                        <Select value={String(horizon)} onValueChange={v => onHorizon(Number(v))}>
                            <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>{[30, 60, 90].map(h => <SelectItem key={h} value={String(h)}>Horizon {h} j</SelectItem>)}</SelectContent>
                        </Select>
                        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Client, contrat, site, prestation…" className="w-64 h-9" />
                        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>

                    {data && data.contratsEnErreur.length > 0 && (
                        <div className="rounded-md border border-destructive p-3 text-sm">
                            <p className="font-medium text-destructive">Contrats dont l&apos;échéancier ne se calcule pas ({data.contratsEnErreur.length})</p>
                            {data.contratsEnErreur.map(c => (
                                <p key={c.contractId}><Link className="underline" href={`/contracts/${c.contractId}`}>{c.contractNumber}</Link> — {c.clientName} : {c.erreurs.join(' ')}</p>
                            ))}
                        </div>
                    )}

                    <div className="border rounded-md overflow-x-auto">
                        <Table>
                            <TableHeader><TableRow>
                                <TableHead className="min-w-[280px]">Client / Contrat / Prestation</TableHead>
                                <TableHead className="text-right">Retard max</TableHead>
                                <TableHead className="text-right">En retard</TableHead>
                                <TableHead className="text-right">Aujourd&apos;hui</TableHead>
                                {focus === 'tout' && <TableHead className="text-right">À venir</TableHead>}
                                <TableHead className="text-center">Bloquées</TableHead>
                                <TableHead>Suivi</TableHead>
                            </TableRow></TableHeader>
                            <TableBody>
                                {clients.length === 0 ? (
                                    <TableRow><TableCell colSpan={colonnes} className="text-center h-16 text-muted-foreground">
                                        {loading ? 'Calcul en cours…' : focus === 'retard' ? 'Aucune échéance en retard.' : focus === 'bloque' ? 'Aucune échéance bloquée.' : 'Aucune échéance.'}
                                    </TableCell></TableRow>
                                ) : clients.map(cl => (
                                    <Fragment key={cl.key}>
                                        <TableRow className="bg-muted/40 hover:bg-muted/60 cursor-pointer" onClick={() => basculer(cl.key)}>
                                            <TableCell className="font-semibold">
                                                <span className="inline-flex items-center gap-1">{ouverts.has(cl.key) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}{cl.clientName}</span>
                                                <span className="ml-2 text-xs font-normal text-muted-foreground">{cl.contrats.length} contrat{cl.contrats.length > 1 ? 's' : ''}</span>
                                            </TableCell>
                                            <Montants t={cl.totaux} focus={focus} />
                                            <TableCell />
                                        </TableRow>
                                        {ouverts.has(cl.key) && cl.contrats.map(ct => (
                                            <Fragment key={ct.key}>
                                                <TableRow className="hover:bg-muted/30">
                                                    <TableCell className="pl-8 cursor-pointer" onClick={() => basculer(ct.key)}>
                                                        <span className="inline-flex items-center gap-1 font-medium">
                                                            {ouverts.has(ct.key) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                                            <span className="font-mono text-xs">{ct.contractNumber}</span>
                                                        </span>
                                                        <Link href={`/contracts/${ct.contractId}`} onClick={e => e.stopPropagation()} className="ml-2 inline-flex align-middle text-muted-foreground hover:text-foreground" title="Ouvrir le contrat"><ExternalLink className="h-3 w-3" /></Link>
                                                        <span className="ml-2 text-xs text-muted-foreground">{ct.prestations.length} prestation{ct.prestations.length > 1 ? 's' : ''}</span>
                                                    </TableCell>
                                                    <Montants t={ct.totaux} focus={focus} />
                                                    <Suivi s={ct.suivi} onOpen={() => setCible({ contractId: ct.contractId, contractNumber: ct.contractNumber, itemKey: null, libelle: ct.contractNumber })} />
                                                </TableRow>
                                                {ouverts.has(ct.key) && ct.prestations.map(pr => (
                                                    <Fragment key={pr.key}>
                                                        <TableRow className="hover:bg-muted/20">
                                                            <TableCell className="pl-14 cursor-pointer" onClick={() => basculer(pr.key)}>
                                                                <span className="inline-flex items-center gap-1 text-sm">
                                                                    {ouverts.has(pr.key) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                                                    <span className="text-muted-foreground">{pr.site}</span><span>— {pr.prestation}</span>
                                                                </span>
                                                                {pr.blocages.map(b => <span key={b} className="block pl-5 text-xs text-destructive">{b}</span>)}
                                                            </TableCell>
                                                            <Montants t={pr.totaux} focus={focus} />
                                                            <Suivi s={pr.suivi} onOpen={() => setCible({ contractId: ct.contractId, contractNumber: ct.contractNumber, itemKey: pr.itemKey, libelle: `${pr.site} — ${pr.prestation}` })} />
                                                        </TableRow>
                                                        {ouverts.has(pr.key) && pr.echeances.map(e => (
                                                            <TableRow key={`${pr.key}-${e.start}`} className="text-xs">
                                                                <TableCell className="pl-24">
                                                                    <span className="inline-flex items-center gap-2"><StatutEcheance e={e} />{fr(e.start)} → {fr(e.end)}</span>
                                                                    <span className="block text-muted-foreground">Facturable le {fr(e.billableOn)}</span>
                                                                    {e.blocage && <span className="block text-destructive">{e.blocage}</span>}
                                                                </TableCell>
                                                                <TableCell />
                                                                <TableCell colSpan={focus === 'tout' ? 3 : 2} className="text-right whitespace-nowrap">
                                                                    {e.montant === null ? <span className="text-muted-foreground">à la facture</span> : <span className={e.estime ? 'text-muted-foreground' : 'font-medium'}>{e.estime ? '~' : ''}{eur(e.montant)}</span>}
                                                                </TableCell>
                                                                <TableCell colSpan={2} />
                                                            </TableRow>
                                                        ))}
                                                    </Fragment>
                                                ))}
                                            </Fragment>
                                        ))}
                                    </Fragment>
                                ))}
                                {clients.length > 0 && (
                                    <TableRow className="border-t-2 font-semibold">
                                        <TableCell>Total ({synthese.clients} client{synthese.clients > 1 ? 's' : ''}, {synthese.contrats} contrat{synthese.contrats > 1 ? 's' : ''})</TableCell>
                                        <Montants t={synthese} focus={focus} />
                                        <TableCell />
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <FilCommentaires cible={cible} onClose={() => setCible(null)} onAjout={c => setAjouts(a => [...a, c])} />
        </div>
    );
}

function Kpi({ titre, valeur, sous, alerte }: { titre: string; valeur: string; sous: string; alerte?: boolean }) {
    return (
        <Card className={alerte ? 'border-red-200' : ''}>
            <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs font-medium text-muted-foreground">{titre}</CardTitle></CardHeader>
            <CardContent className="px-4 pb-3">
                <p className={cn('text-xl font-bold', alerte && 'text-red-600')}>{valeur}</p>
                <p className="text-xs text-muted-foreground">{sous}</p>
            </CardContent>
        </Card>
    );
}
