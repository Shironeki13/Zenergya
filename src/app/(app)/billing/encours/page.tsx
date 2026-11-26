'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronDown, ChevronRight, ClipboardCopy, Loader2, Mail, Phone, RefreshCw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useConfirm } from '@/components/confirm-provider';
import { useToast } from '@/hooks/use-toast';
import { LIBELLE_ROLE, releveRelance, type Interlocuteur, type RoleInterlocuteur } from '@/lib/billing/encours';
import { encaisserAction, encoursAction } from '@/lib/billing/encours-actions';
import type { Encours } from '@/services/encours-admin';

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const fr = (d: string) => (d ? d.split('-').reverse().join('/') : '—');
const TON_ROLE: Record<RoleInterlocuteur, string> = {
    payeur: 'border-indigo-300 bg-indigo-50 text-indigo-800',
    representant: 'border-emerald-300 bg-emerald-50 text-emerald-800',
    client: 'border-slate-300 bg-slate-50 text-slate-700',
};

/** Encours et relances : ce qui reste à encaisser, regroupé par celui à qui il faut s'adresser pour être payé. */
export default function EncoursPage() {
    const { toast } = useToast();
    const confirm = useConfirm();
    const [data, setData] = useState<Encours | null>(null);
    const [erreur, setErreur] = useState('');
    const [recherche, setRecherche] = useState('');
    const [echuSeul, setEchuSeul] = useState(false);
    const [ouverts, setOuverts] = useState<Set<string>>(new Set());
    const [coches, setCoches] = useState<Set<string>>(new Set());
    const [envoi, setEnvoi] = useState(false);

    const charger = useCallback(async () => {
        const r = await encoursAction();
        if (r.success) { setData(r.data); setErreur(''); setCoches(new Set()); } else setErreur(r.error);
    }, []);
    useEffect(() => { void charger(); }, [charger]);

    const tous = data?.interlocuteurs ?? [];
    const totaux = useMemo(() => ({
        encours: tous.reduce((s, i) => s + i.encours, 0), echu: tous.reduce((s, i) => s + i.echu, 0),
        factures: tous.reduce((s, i) => s + i.factures.length, 0), enRetard: tous.filter(i => i.echu > 0).length,
    }), [tous]);
    const visibles = useMemo(() => {
        const q = recherche.trim().toLowerCase();
        return tous.filter(i => (!echuSeul || i.echu > 0) && (!q || [i.name, ...i.clients.map(c => c.name), ...i.factures.map(f => f.numero)].some(v => v.toLowerCase().includes(q))));
    }, [tous, recherche, echuSeul]);

    const basculer = (cle: string) => setOuverts(s => { const n = new Set(s); if (n.has(cle)) n.delete(cle); else n.add(cle); return n; });
    const cocher = (ids: string[], v: boolean) => setCoches(s => { const n = new Set(s); ids.forEach(id => (v ? n.add(id) : n.delete(id))); return n; });
    const montantCoche = useMemo(() => tous.flatMap(i => i.factures).filter(f => coches.has(f.id)).reduce((s, f) => s + f.total, 0), [tous, coches]);

    const encaisser = async () => {
        if (!(await confirm({ title: `Marquer ${coches.size} facture(s) comme payée(s) ?`, description: `Encaissement de ${eur(montantCoche)} TTC.` }))) return;
        setEnvoi(true);
        const r = await encaisserAction([...coches]);
        setEnvoi(false);
        if (!r.success) { toast({ variant: 'destructive', title: 'Encaissement impossible', description: r.error }); return; }
        toast({ title: `${r.data} facture(s) marquée(s) payée(s)` });
        await charger();
    };
    const copier = async (i: Interlocuteur) => {
        try { await navigator.clipboard.writeText(releveRelance(i, data?.emetteur ?? '')); toast({ title: 'Relevé copié', description: 'À coller dans votre message de relance.' }); }
        catch { toast({ variant: 'destructive', title: 'Copie impossible', description: 'Le navigateur a refusé l’accès au presse-papiers.' }); }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Encours et relances</h1>
                    <p className="text-sm text-muted-foreground">Les factures à encaisser, regroupées par celui à qui s&apos;adresser : le payeur du client, sinon son syndic, sinon le client.</p>
                </div>
                <Button variant="outline" size="sm" onClick={charger}><RefreshCw className="mr-2 h-4 w-4" />Actualiser</Button>
            </div>

            {erreur && <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{erreur}</p>}
            {!data && !erreur ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : data && (
                <>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">À encaisser TTC</p><p className="text-2xl font-bold">{eur(totaux.encours)}</p><p className="text-xs text-muted-foreground">{totaux.factures} facture(s), {tous.length} interlocuteur(s)</p></div>
                        <button type="button" onClick={() => setEchuSeul(v => !v)} aria-pressed={echuSeul} className={`rounded-lg border bg-card p-4 text-left transition hover:bg-muted/40 ${echuSeul ? 'ring-2 ring-primary' : ''}`}>
                            <p className="text-xs text-muted-foreground">Dont échu</p><p className="text-2xl font-bold text-red-700">{eur(totaux.echu)}</p><p className="text-xs text-muted-foreground">{totaux.enRetard} interlocuteur(s) à relancer{echuSeul ? ' — filtre actif' : ''}</p>
                        </button>
                        <div className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">Sélection à encaisser</p><p className="text-2xl font-bold">{eur(montantCoche)}</p>
                            <Button size="sm" className="mt-1 h-8" disabled={coches.size === 0 || envoi} onClick={encaisser}>{envoi ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Marquer payée(s) ({coches.size})</Button>
                        </div>
                    </div>
                    <div className="relative max-w-sm">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input className="pl-8" placeholder="Rechercher un payeur, un client, un numéro…" value={recherche} onChange={e => setRecherche(e.target.value)} />
                    </div>
                    <Card>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-8" /><TableHead>À qui s&apos;adresser</TableHead><TableHead>Contact</TableHead><TableHead>Pour</TableHead>
                                        <TableHead className="text-right">Factures</TableHead><TableHead className="text-right">Encours TTC</TableHead><TableHead className="text-right">Dont échu</TableHead><TableHead className="w-0" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {visibles.length === 0 && <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">{tous.length === 0 ? 'Aucune facture à encaisser.' : 'Aucun interlocuteur ne correspond.'}</TableCell></TableRow>}
                                    {visibles.map(i => {
                                        const ouvert = ouverts.has(i.cle);
                                        const ids = i.factures.map(f => f.id);
                                        const toutCoche = ids.every(id => coches.has(id));
                                        return (
                                            <Fragment key={i.cle}>
                                                <TableRow data-interlocuteur={i.name} className="cursor-pointer" onClick={() => basculer(i.cle)}>
                                                    <TableCell>{ouvert ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                                                    <TableCell>
                                                        <span className="font-medium">{i.name}</span>
                                                        <Badge variant="outline" className={`ml-2 py-0 text-[10px] ${TON_ROLE[i.role]}`}>{i.role === 'client' ? LIBELLE_ROLE.client : i.quality || LIBELLE_ROLE[i.role]}</Badge>
                                                        {i.adresse && <span className="block text-xs text-muted-foreground">{i.adresse}</span>}
                                                    </TableCell>
                                                    <TableCell className="text-xs" onClick={e => e.stopPropagation()}>
                                                        {i.email && <a href={`mailto:${i.email}`} className="flex items-center gap-1 hover:underline"><Mail className="h-3 w-3" />{i.email}</a>}
                                                        {i.phone && <span className="flex items-center gap-1 text-muted-foreground"><Phone className="h-3 w-3" />{i.phone}</span>}
                                                        {!i.email && !i.phone && <span className="text-amber-700">Aucun contact connu</span>}
                                                    </TableCell>
                                                    <TableCell className="text-xs text-muted-foreground">{i.role === 'client' ? '—' : i.clients.length === 1 ? i.clients[0].name : `${i.clients.length} clients`}</TableCell>
                                                    <TableCell className="text-right">{i.factures.length}</TableCell>
                                                    <TableCell className="text-right font-medium">{eur(i.encours)}</TableCell>
                                                    <TableCell className="text-right">{i.echu > 0 ? <span className="font-medium text-red-700">{eur(i.echu)}<span className="block text-xs font-normal">jusqu&apos;à {i.retardMax} j de retard</span></span> : <span className="text-muted-foreground">—</span>}</TableCell>
                                                    <TableCell className="whitespace-nowrap text-right" onClick={e => e.stopPropagation()}>
                                                        <Button size="sm" variant="outline" className="h-8" onClick={() => copier(i)}><ClipboardCopy className="mr-1.5 h-3.5 w-3.5" />Copier le relevé</Button>
                                                    </TableCell>
                                                </TableRow>
                                                {ouvert && (
                                                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                                                        <TableCell />
                                                        <TableCell colSpan={7} className="py-2">
                                                            <table className="w-full text-sm" data-detail={i.name}>
                                                                <thead><tr className="text-left text-xs text-muted-foreground">
                                                                    <th className="w-8 py-1"><Checkbox aria-label={`Tout cocher pour ${i.name}`} checked={toutCoche} onCheckedChange={v => cocher(ids, v === true)} /></th>
                                                                    <th>Facture</th><th>Client</th><th>Date</th><th>Échéance</th><th className="text-right">TTC</th>
                                                                </tr></thead>
                                                                <tbody>
                                                                    {i.factures.map(f => (
                                                                        <tr key={f.id} className="border-t">
                                                                            <td className="py-1.5"><Checkbox aria-label={`Facture ${f.numero}`} checked={coches.has(f.id)} onCheckedChange={v => cocher([f.id], v === true)} /></td>
                                                                            <td><Link href={`/invoices/${f.id}`} className="font-mono text-xs text-primary hover:underline">{f.numero}</Link></td>
                                                                            <td><Link href={`/clients/${f.clientId}`} className="hover:underline">{f.client}</Link></td>
                                                                            <td>{fr(f.date)}</td>
                                                                            <td>{fr(f.echeance)}{f.joursRetard > 0 && <span className="ml-2 text-xs font-medium text-red-700">échue depuis {f.joursRetard} j</span>}</td>
                                                                            <td className="text-right font-medium">{eur(f.total)}</td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </TableCell>
                                                    </TableRow>
                                                )}
                                            </Fragment>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
}
