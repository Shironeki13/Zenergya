'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Loader2, Pencil, Plus, Search, Trash2, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TON_POSITIF } from '@/components/ui/pastilles';
import { DialogueTiers } from '@/components/clients/adressage-fields';
import { useConfirm } from '@/components/confirm-provider';
import { useToast } from '@/hooks/use-toast';
import type { Tiers } from '@/lib/billing/adressage';
import { annuaireTiersAction, supprimerTiersAction } from '@/lib/tiers/actions';
import type { LigneAnnuaire } from '@/services/tiers-admin';

/** Annuaire des syndics et payeurs : leur adresse est celle qui s'imprime sur les factures des clients qui les citent. */
export default function TiersPage() {
    const { toast } = useToast();
    const confirm = useConfirm();
    const [lignes, setLignes] = useState<LigneAnnuaire[] | null>(null);
    const [erreur, setErreur] = useState('');
    const [recherche, setRecherche] = useState('');
    const [aCompleter, setACompleter] = useState(false);
    const [edition, setEdition] = useState<Partial<Tiers> | null>(null);

    const charger = useCallback(async () => {
        const r = await annuaireTiersAction();
        if (r.success) { setLignes(r.data); setErreur(''); } else setErreur(r.error);
    }, []);
    useEffect(() => { void charger(); }, [charger]);

    const incomplets = useMemo(() => (lignes ?? []).filter(l => !l.complet && l.representes + l.payes > 0), [lignes]);
    const facturesConcernees = incomplets.reduce((n, l) => n + l.representes + l.payes, 0);
    const visibles = useMemo(() => {
        const q = recherche.trim().toLowerCase();
        return (lignes ?? []).filter(l => (!aCompleter || (!l.complet && l.representes + l.payes > 0))
            && (!q || [l.name, l.tiers?.city, l.tiers?.quality, ...l.clients.map(c => c.name)].some(v => v?.toLowerCase().includes(q))));
    }, [lignes, recherche, aCompleter]);

    const supprimer = async (t: Tiers) => {
        if (!(await confirm({ title: `Supprimer « ${t.name} » ?`, description: "Le tiers est retiré de l'annuaire.", destructive: true }))) return;
        const r = await supprimerTiersAction(t.id);
        if (!r.success) { toast({ variant: 'destructive', title: 'Suppression impossible', description: r.error }); return; }
        toast({ title: 'Tiers supprimé' }); await charger();
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Syndics et payeurs</h1>
                    <p className="text-sm text-muted-foreground">Les tiers cités par les clients comme représentant ou payeur. Leur adresse est celle qui s&apos;imprime sur les factures.</p>
                </div>
                <Button size="sm" onClick={() => setEdition({ quality: 'syndic' })}><Plus className="mr-2 h-4 w-4" />Nouveau tiers</Button>
            </div>

            {erreur && <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{erreur}</p>}
            {lignes === null && !erreur ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : lignes && (
                <>
                    {incomplets.length > 0 ? (
                        <div data-bloc="a-completer" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                            <TriangleAlert className="h-4 w-4 shrink-0" />
                            <span><strong>{incomplets.length} tiers sans adresse</strong>, cités par {facturesConcernees} client(s) : leurs factures partent à l&apos;adresse du client.</span>
                            <Button size="sm" variant="outline" className="ml-auto h-8 bg-white" onClick={() => setACompleter(v => !v)}>{aCompleter ? 'Voir tout' : 'Voir seulement ceux-là'}</Button>
                        </div>
                    ) : lignes.length > 0 && (
                        <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900"><CheckCircle2 className="h-4 w-4" />Tous les tiers cités ont une adresse.</div>
                    )}
                    <div className="relative max-w-sm">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input className="pl-8" placeholder="Rechercher un tiers, une ville, un client…" value={recherche} onChange={e => setRecherche(e.target.value)} />
                    </div>
                    <Card>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Tiers</TableHead><TableHead>Adresse imprimée sur les factures</TableHead><TableHead>Clients qui le citent</TableHead><TableHead className="w-0" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {visibles.length === 0 && <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">{lignes.length === 0 ? "Aucun tiers : renseignez « Représenté par » ou « Payeur » sur une fiche client, ou créez un tiers." : 'Aucun tiers ne correspond.'}</TableCell></TableRow>}
                                    {visibles.map(l => (
                                        <TableRow key={l.tiers?.id ?? `nom:${l.name}`} data-tiers={l.name}>
                                            <TableCell className="align-top">
                                                <span className="font-medium">{l.name}</span>
                                                {l.tiers?.quality && <Badge variant="outline" className="ml-2 py-0 text-[10px]">{l.tiers.quality}</Badge>}
                                                {(l.tiers?.email || l.tiers?.phone) && <span className="block text-xs text-muted-foreground">{[l.tiers.email, l.tiers.phone].filter(Boolean).join(' · ')}</span>}
                                            </TableCell>
                                            <TableCell className="align-top">
                                                {l.complet
                                                    ? <span>{l.tiers!.address}<span className="block text-xs text-muted-foreground">{`${l.tiers!.postalCode ?? ''} ${l.tiers!.city}`.trim()}</span></span>
                                                    : <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">{l.tiers ? 'Adresse à renseigner' : 'Sans fiche'}</Badge>}
                                            </TableCell>
                                            <TableCell className="align-top text-sm">
                                                {l.representes + l.payes === 0 ? <span className="text-muted-foreground">Aucun</span> : (
                                                    <>
                                                        <span className="flex flex-wrap gap-1">
                                                            {l.representes > 0 && <Badge variant="outline" className={TON_POSITIF}>représente {l.representes}</Badge>}
                                                            {l.payes > 0 && <Badge variant="outline" className="border-indigo-300 bg-indigo-50 text-indigo-800">paie pour {l.payes}</Badge>}
                                                        </span>
                                                        <span className="mt-1 block text-xs text-muted-foreground">
                                                            {l.clients.map((c, i) => <span key={c.id}>{i > 0 && ', '}<Link href={`/clients/${c.id}`} className="hover:underline">{c.name}</Link></span>)}
                                                            {l.representes + l.payes > l.clients.length && '…'}
                                                        </span>
                                                    </>
                                                )}
                                            </TableCell>
                                            <TableCell className="whitespace-nowrap text-right align-top">
                                                <Button size="sm" variant={l.complet ? 'ghost' : 'outline'} className="h-8" onClick={() => setEdition(l.tiers ?? { name: l.name, quality: l.payes > l.representes ? '' : 'syndic' })}>
                                                    <Pencil className="mr-1.5 h-3.5 w-3.5" />{l.complet ? 'Modifier' : "Renseigner l'adresse"}
                                                </Button>
                                                {l.tiers && l.representes + l.payes === 0 && <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-red-700" aria-label={`Supprimer ${l.name}`} onClick={() => supprimer(l.tiers!)}><Trash2 className="h-4 w-4" /></Button>}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </>
            )}
            <DialogueTiers edition={edition} onClose={() => setEdition(null)} onSaved={async () => { setEdition(null); await charger(); }} />
        </div>
    );
}
