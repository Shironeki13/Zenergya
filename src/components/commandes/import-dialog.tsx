'use client';

import { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useData } from '@/context/data-context';
import { useToast } from '@/hooks/use-toast';
import { importerCommandesAction } from '@/lib/commandes-actions';
import { COLONNES_IMPORT_COMMANDES } from '@/lib/commandes-import';
import { csvToTable } from '@/lib/imports/engine';
import { readXlsxTable } from '@/lib/imports/xlsx';
import type { RapportImportCommandes } from '@/services/commandes-admin';

/**
 * Import de commandes saisies dans un autre outil (Excel ou CSV) : une ligne de fichier par ligne de commande, les
 * lignes de même référence forment une commande. Simulation, puis import ; rien n'est écrit tant qu'une commande est
 * en erreur.
 */

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

function modele() {
    const lignes = [
        COLONNES_IMPORT_COMMANDES.map(c => (c.obligatoire ? `${c.libelle} *` : c.libelle)),
        ['BC-2026-101', '03/11/2026', 'FRN-00001', 'Chaudières gaz', 'technicien@exemple.fr', 'validée', 'Chaudière 300 kW', 'Fournitures', '2', '22400', 'ZEN-AFF2026-0003', '', '', '20/11/2026'],
        ['BC-2026-101', '', '', '', '', '', 'Mise en service', 'Sous-traitance', '1', '1200', 'ZEN-AFF2026-0003', '', '', ''],
        ['BC-2026-102', '04/11/2026', 'FRN-00001', 'Pièces de maintenance', '', 'brouillon', 'Gicleurs', 'Fournitures', '4', '86', '', 'CTN-00001', 'P2', ''],
    ];
    const csv = `﻿${lignes.map(l => l.map(c => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\r\n')}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'modele-commandes.csv';
    a.click();
    URL.revokeObjectURL(a.href);
}

export function ImportCommandesDialog({ open, onOpenChange, onImporte }: { open: boolean; onOpenChange: (o: boolean) => void; onImporte: () => Promise<void> | void }) {
    const { companies } = useData();
    const { toast } = useToast();
    const [companyId, setCompanyId] = useState('');
    const [table, setTable] = useState<unknown[][] | null>(null);
    const [fichier, setFichier] = useState('');
    const [rapport, setRapport] = useState<RapportImportCommandes | null>(null);
    const [erreur, setErreur] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => { if (open && !companyId && companies[0]) setCompanyId(companies[0].id); }, [open, companyId, companies]);

    const fermer = (o: boolean) => { if (!o) { setTable(null); setFichier(''); setRapport(null); setErreur(null); } onOpenChange(o); };
    const simuler = async (t: unknown[][], societe: string) => {
        setBusy(true); setRapport(null); setErreur(null);
        const r = await importerCommandesAction(t, societe, false);
        if (r.success) setRapport(r.data); else setErreur(r.error);
        setBusy(false);
    };
    const lire = async (f: File | undefined) => {
        setRapport(null); setErreur(null); setTable(null);
        if (!f) return;
        setFichier(f.name);
        try {
            const t = /\.xlsx$/i.test(f.name) ? await readXlsxTable(await f.arrayBuffer()) : csvToTable(await f.text());
            setTable(t);
            await simuler(t, companyId);
        } catch (e) { setErreur(e instanceof Error ? e.message : 'Fichier illisible.'); }
    };
    const appliquer = async () => {
        if (!table) return;
        setBusy(true);
        const r = await importerCommandesAction(table, companyId, true);
        setBusy(false);
        if (!r.success) { toast({ title: 'Import refusé', description: r.error, variant: 'destructive' }); return; }
        toast({ title: 'Commandes importées', description: `${r.data.aCreer} commande(s), ${eur(r.data.totalHT)} HT${r.data.doublons ? ` — ${r.data.doublons} déjà importée(s), ignorée(s)` : ''}` });
        await onImporte();
        fermer(false);
    };

    return (
        <Dialog open={open} onOpenChange={fermer}>
            <DialogContent className="max-w-5xl">
                <DialogHeader>
                    <DialogTitle>Importer des commandes</DialogTitle>
                    <DialogDescription>
                        Fichier Excel (.xlsx) ou CSV : une ligne par ligne de commande ; les lignes de même référence forment une commande. État « brouillon » : la commande reste à soumettre
                        (circuit de validation) ; « validée » : déjà validée hors Zenergya, elle entre validée (achats et administrateurs). Une référence déjà importée est ignorée.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <div className="flex flex-wrap items-end gap-2">
                        {companies.length > 1 && (
                            <div className="space-y-1"><Label htmlFor="imp-societe">Société</Label>
                                <Select value={companyId} onValueChange={v => { setCompanyId(v); if (table) simuler(table, v); }}><SelectTrigger id="imp-societe" className="w-[220px]"><SelectValue /></SelectTrigger>
                                    <SelectContent>{companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
                        )}
                        <Input type="file" accept=".xlsx,.csv,text/csv" aria-label="Fichier de commandes" className="max-w-sm" disabled={!companyId} onChange={e => lire(e.target.files?.[0])} />
                        <Button type="button" variant="outline" size="sm" className="h-10" onClick={modele}><Download className="mr-1 h-4 w-4" />Modèle</Button>
                        {busy && <Loader2 className="mb-3 h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>
                    {!rapport && !erreur && (
                        <div className="max-h-[45vh] overflow-auto">
                            <table className="w-full text-xs">
                                <tbody>{COLONNES_IMPORT_COMMANDES.map(c => <tr key={c.cle} className="border-t"><td className="whitespace-nowrap py-1 pr-3 font-medium">{c.libelle}{c.obligatoire && <span className="text-destructive"> *</span>}</td><td className="py-1 text-muted-foreground">{c.aide}</td></tr>)}</tbody>
                            </table>
                        </div>
                    )}
                    {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">{erreur}</p>}
                    {rapport && (
                        <>
                            <p className="text-sm">
                                <span className="font-medium">{fichier}</span> : {rapport.aCreer} commande(s) à créer ({eur(rapport.totalHT)} HT)
                                {rapport.doublons > 0 && `, ${rapport.doublons} déjà importée(s)`}{rapport.erreurs > 0 && <span className="font-medium text-destructive">, {rapport.erreurs} en erreur : corrigez le fichier, rien n&apos;est importé tant qu&apos;il en reste</span>}.
                            </p>
                            <div className="max-h-[45vh] overflow-auto rounded-md border">
                                <table className="w-full text-xs">
                                    <thead className="sticky top-0 bg-muted"><tr className="text-left"><th className="px-2 py-1.5 font-medium">Référence</th><th className="px-2 py-1.5 font-medium">Date</th><th className="px-2 py-1.5 font-medium">Fournisseur</th><th className="px-2 py-1.5 font-medium">Objet</th><th className="px-2 py-1.5 font-medium">Demandeur</th><th className="px-2 py-1.5 text-right font-medium">Lignes</th><th className="px-2 py-1.5 text-right font-medium">Total HT</th><th className="px-2 py-1.5 font-medium">Résultat</th></tr></thead>
                                    <tbody>
                                        {[...rapport.commandes].sort((a, b) => Number(b.etat === 'erreur') - Number(a.etat === 'erreur') || a.ligne - b.ligne).map(c => (
                                            <tr key={c.reference} className="border-t align-top">
                                                <td className="whitespace-nowrap px-2 py-1 font-mono">{c.reference}</td><td className="whitespace-nowrap px-2 py-1">{c.date.split('-').reverse().join('/')}</td>
                                                <td className="px-2 py-1">{c.fournisseur}</td><td className="px-2 py-1">{c.objet}</td><td className="px-2 py-1">{c.demandeur}</td>
                                                <td className="px-2 py-1 text-right">{c.lignes}</td><td className="whitespace-nowrap px-2 py-1 text-right">{eur(c.totalHT)}</td>
                                                <td className="px-2 py-1">{c.etat === 'a_creer' ? <Badge variant="secondary" className="whitespace-nowrap">{c.resultat === 'validee' ? 'À créer, validée' : 'À créer, en brouillon'}</Badge> : c.etat === 'doublon' ? <Badge variant="outline" className="whitespace-nowrap">Déjà importée</Badge> : <span className="text-destructive">{c.messages.join(' ; ')}</span>}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => fermer(false)}>Fermer</Button>
                    <Button disabled={busy || !rapport || rapport.erreurs > 0 || rapport.aCreer === 0} onClick={appliquer}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Importer{rapport?.aCreer ? ` ${rapport.aCreer} commande(s)` : ''}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
