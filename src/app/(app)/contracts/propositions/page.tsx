'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, FileText, Loader2, RefreshCw, Sparkles, TriangleAlert, Upload, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { TON_STATUT } from '@/components/propositions/statut';
import { LIBELLE_STATUT, type Proposition, type StatutProposition } from '@/lib/contracts/propositions';
import { listerPropositionsAction } from '@/lib/contracts/propositions-actions';

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const date = (s: string) => new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

/** Propositions de création : documents déposés, lus par l'IA, à revoir avant toute création. */
export default function PropositionsPage() {
    const { toast } = useToast();
    const [liste, setListe] = useState<Proposition[] | null>(null);
    const [onglet, setOnglet] = useState<'a_revoir' | 'acceptee' | 'refusee' | 'echec' | 'toutes'>('a_revoir');
    const [type, setType] = useState<'pdf-prive' | 'pdf-public'>('pdf-prive');
    const [envois, setEnvois] = useState<{ nom: string; etat: 'lecture' | 'ok' | 'echec'; message?: string; id?: string }[]>([]);
    const champ = useRef<HTMLInputElement>(null);

    const charger = useCallback(async () => {
        const r = await listerPropositionsAction();
        if (r.success) setListe(r.data); else toast({ variant: 'destructive', title: 'Propositions illisibles', description: r.error });
    }, [toast]);
    useEffect(() => { void charger(); }, [charger]);

    const deposer = async (fichiers: FileList | null) => {
        const pdf = [...(fichiers ?? [])].filter(f => f.type === 'application/pdf');
        if (!pdf.length) { toast({ variant: 'destructive', title: 'Documents PDF uniquement' }); return; }
        setEnvois(pdf.map(f => ({ nom: f.name, etat: 'lecture' })));
        // Un document à la fois : chaque lecture prend quelques dizaines de secondes.
        for (const [i, f] of pdf.entries()) {
            const form = new FormData(); form.set('fichier', f); form.set('type', type);
            const res = await fetch('/api/propositions', { method: 'POST', credentials: 'same-origin', body: form }).catch(() => null);
            const corps = res ? await res.json().catch(() => ({})) : {};
            setEnvois(e => e.map((x, k) => (k !== i ? x : !res?.ok ? { ...x, etat: 'echec', message: corps.error ?? 'Dépôt impossible.' } : corps.statut === 'echec' ? { ...x, etat: 'echec', message: corps.erreur, id: corps.id } : { ...x, etat: 'ok', id: corps.id })));
            await charger();
        }
        if (champ.current) champ.current.value = '';
    };

    const compte = useMemo(() => Object.fromEntries((['a_revoir', 'acceptee', 'refusee', 'echec'] as const).map(s => [s, (liste ?? []).filter(p => p.statut === s).length])), [liste]);
    const visibles = (liste ?? []).filter(p => onglet === 'toutes' || p.statut === onglet || (onglet === 'a_revoir' && p.statut === 'en_lecture'));

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Sparkles className="h-6 w-6 text-primary" />Propositions de création</h1>
                    <p className="text-sm text-muted-foreground">Déposez un contrat : l&apos;IA le lit et propose le client, le contrat, les sites et les prestations. Rien n&apos;est créé avant qu&apos;une personne de la contrathèque l&apos;ait vérifié et accepté.</p>
                </div>
                <Button variant="outline" size="sm" onClick={charger}><RefreshCw className="mr-2 h-4 w-4" />Actualiser</Button>
            </div>

            <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Déposer des documents</CardTitle><CardDescription>PDF, 20 Mo au plus chacun. Plusieurs documents : une proposition par document.</CardDescription></CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="flex rounded-md border p-0.5 text-sm" role="radiogroup" aria-label="Type de marché">
                            {(['pdf-prive', 'pdf-public'] as const).map(t => <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)} className={`rounded px-3 py-1.5 ${type === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{t === 'pdf-prive' ? 'Marché privé' : 'Marché public'}</button>)}
                        </div>
                        <input ref={champ} type="file" accept="application/pdf" multiple className="hidden" aria-label="Documents à déposer" onChange={e => deposer(e.target.files)} data-depot="fichiers" />
                        <Button onClick={() => champ.current?.click()} disabled={envois.some(e => e.etat === 'lecture')}><Upload className="mr-2 h-4 w-4" />Choisir les documents</Button>
                    </div>
                    {envois.length > 0 && (
                        <ul className="space-y-1 text-sm" data-depot="suivi">
                            {envois.map((e, i) => (
                                <li key={i} className="flex items-center gap-2">
                                    {e.etat === 'lecture' ? <Loader2 className="h-4 w-4 animate-spin text-sky-600" /> : e.etat === 'ok' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-600" />}
                                    <span className="font-medium">{e.nom}</span>
                                    <span className="text-muted-foreground">{e.etat === 'lecture' ? 'lecture en cours…' : e.etat === 'ok' ? 'lu : proposition à revoir' : e.message}</span>
                                    {e.id && <Link href={`/contracts/propositions/${e.id}`} className="text-primary hover:underline">Ouvrir</Link>}
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>

            <Tabs value={onglet} onValueChange={v => setOnglet(v as typeof onglet)}>
                <TabsList>
                    <TabsTrigger value="a_revoir">À revoir ({compte.a_revoir ?? 0})</TabsTrigger>
                    <TabsTrigger value="acceptee">Acceptées ({compte.acceptee ?? 0})</TabsTrigger>
                    <TabsTrigger value="refusee">Refusées ({compte.refusee ?? 0})</TabsTrigger>
                    <TabsTrigger value="echec">Lecture impossible ({compte.echec ?? 0})</TabsTrigger>
                    <TabsTrigger value="toutes">Toutes</TabsTrigger>
                </TabsList>
            </Tabs>
            <Card>
                <CardContent className="p-0">
                    {!liste ? <Loader2 className="m-6 h-5 w-5 animate-spin text-muted-foreground" /> : (
                        <table className="w-full text-sm" data-propositions="liste">
                            <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                                <th className="px-4 py-2 font-medium">Document</th><th className="px-3 font-medium">Client proposé</th><th className="px-3 font-medium">Contrat</th>
                                <th className="px-3 text-right font-medium">Sites</th><th className="px-3 text-right font-medium">Montant annuel</th><th className="px-3 font-medium">À vérifier</th><th className="px-3 font-medium">Déposé</th><th className="px-3 font-medium">Statut</th>
                            </tr></thead>
                            <tbody>
                                {visibles.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">Aucune proposition.</td></tr>}
                                {visibles.map(p => {
                                    const bloquants = (p.alertes ?? []).filter(a => a.gravite === 'bloquant').length, attention = (p.alertes ?? []).filter(a => a.gravite === 'attention').length;
                                    return (
                                        <tr key={p.id} className="border-b hover:bg-muted/30" data-proposition={p.document.name}>
                                            <td className="px-4 py-2"><Link href={`/contracts/propositions/${p.id}`} className="flex items-center gap-1.5 font-medium text-primary hover:underline"><FileText className="h-4 w-4 shrink-0" /><span className="max-w-[220px] truncate">{p.document.name}</span></Link>{p.lecture?.simulee && <Badge variant="outline" className="mt-0.5 py-0 text-[10px]">lecture simulée (démo)</Badge>}</td>
                                            <td className="px-3">{p.resume?.client || '—'}{p.resume && <Badge variant="outline" className={`ml-1.5 py-0 text-[10px] ${p.resume.clientExistant ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-violet-300 bg-violet-50 text-violet-800'}`}>{p.resume.clientExistant ? 'connu' : 'nouveau'}</Badge>}</td>
                                            <td className="max-w-[200px] truncate px-3">{p.resume?.contrat || '—'}</td>
                                            <td className="px-3 text-right tabular-nums">{p.resume?.sites ?? '—'}</td>
                                            <td className="px-3 text-right tabular-nums">{p.resume ? eur(p.resume.montant) : '—'}</td>
                                            <td className="px-3 text-xs">{p.statut === 'echec' ? <span className="text-red-700">{p.erreur}</span> : <>{bloquants > 0 && <span className="mr-2 text-red-700">{bloquants} à compléter</span>}{attention > 0 && <span className="inline-flex items-center gap-1 text-amber-700"><TriangleAlert className="h-3 w-3" />{attention}</span>}{!bloquants && !attention && p.statut === 'a_revoir' && <span className="text-muted-foreground">rien de particulier</span>}</>}</td>
                                            <td className="px-3 text-xs text-muted-foreground">{date(p.deposeLe)}<span className="block">{p.deposePar}</span></td>
                                            <td className="px-3"><Badge variant="outline" className={`whitespace-nowrap ${TON_STATUT[p.statut]}`}>{LIBELLE_STATUT[p.statut]}</Badge>{p.decision?.contractNumber && <Link href={`/contracts/${p.decision.contractId}`} className="ml-1 font-mono text-xs text-primary hover:underline">{p.decision.contractNumber}</Link>}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
