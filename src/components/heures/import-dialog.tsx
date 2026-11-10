'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { COLONNES_IMPORT } from '@/lib/heures';
import { importerHeuresAction } from '@/lib/heures-actions';
import { csvToTable } from '@/lib/imports/engine';
import { readXlsxTable } from '@/lib/imports/xlsx';
import type { RapportImportHeures } from '@/services/heures-admin';

/**
 * Import d'heures saisies dans un autre outil (Excel ou CSV) : lecture du fichier, simulation (chaque ligne : à créer,
 * déjà saisie, en erreur), puis import. Rien n'est écrit tant qu'une ligne est en erreur.
 */

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

function modele() {
    const lignes = [COLONNES_IMPORT.map(c => (c.obligatoire ? `${c.libelle} *` : c.libelle)), ['03/11/2026', 'technicien@exemple.fr', 'ZEN-AFF2026-0003', '', '', '7,5', 'Dépose des chaudières'], ['04/11/2026', 'technicien@exemple.fr', '', 'CTN-00001', 'P2', '2', 'Réglage du brûleur']];
    const csv = `﻿${lignes.map(l => l.map(c => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\r\n')}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'modele-heures.csv';
    a.click();
    URL.revokeObjectURL(a.href);
}

export function ImportHeuresDialog({ open, onOpenChange, onImporte }: { open: boolean; onOpenChange: (o: boolean) => void; onImporte: () => Promise<void> | void }) {
    const { toast } = useToast();
    const [table, setTable] = useState<unknown[][] | null>(null);
    const [fichier, setFichier] = useState('');
    const [rapport, setRapport] = useState<RapportImportHeures | null>(null);
    const [erreur, setErreur] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const fermer = (o: boolean) => { if (!o) { setTable(null); setFichier(''); setRapport(null); setErreur(null); } onOpenChange(o); };
    const lire = async (f: File | undefined) => {
        setRapport(null); setErreur(null); setTable(null);
        if (!f) return;
        setFichier(f.name); setBusy(true);
        try {
            const t = /\.xlsx$/i.test(f.name) ? await readXlsxTable(await f.arrayBuffer()) : csvToTable(await f.text());
            setTable(t);
            const r = await importerHeuresAction(t, false);
            if (r.success) setRapport(r.data); else setErreur(r.error);
        } catch (e) { setErreur(e instanceof Error ? e.message : 'Fichier illisible.'); }
        setBusy(false);
    };
    const appliquer = async () => {
        if (!table) return;
        setBusy(true);
        const r = await importerHeuresAction(table, true);
        setBusy(false);
        if (!r.success) { toast({ title: 'Import refusé', description: r.error, variant: 'destructive' }); return; }
        toast({ title: 'Heures importées', description: `${r.data.aCreer} saisie(s), ${r.data.heures.toLocaleString('fr-FR')} h, ${eur(r.data.cout)}${r.data.doublons ? ` — ${r.data.doublons} déjà saisie(s), ignorée(s)` : ''}` });
        await onImporte();
        fermer(false);
    };

    return (
        <Dialog open={open} onOpenChange={fermer}>
            <DialogContent className="max-w-4xl">
                <DialogHeader>
                    <DialogTitle>Importer des heures</DialogTitle>
                    <DialogDescription>
                        Pour les heures saisies dans un autre outil : fichier Excel (.xlsx) ou CSV, une ligne par technicien, jour et affectation. Vous importez pour votre équipe
                        (un administrateur, pour tous). Une ligne déjà saisie est ignorée : le même fichier se réimporte sans doublon.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <Input type="file" accept=".xlsx,.csv,text/csv" aria-label="Fichier d'heures" className="max-w-sm" onChange={e => lire(e.target.files?.[0])} />
                        <Button type="button" variant="outline" size="sm" onClick={modele}><Download className="mr-1 h-4 w-4" />Modèle</Button>
                        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>
                    {!rapport && !erreur && (
                        <table className="w-full text-xs">
                            <tbody>{COLONNES_IMPORT.map(c => <tr key={c.cle} className="border-t"><td className="py-1 pr-3 font-medium">{c.libelle}{c.obligatoire && <span className="text-destructive"> *</span>}</td><td className="py-1 text-muted-foreground">{c.aide}</td></tr>)}</tbody>
                        </table>
                    )}
                    {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">{erreur}</p>}
                    {rapport && (
                        <>
                            <p className="text-sm">
                                <span className="font-medium">{fichier}</span> : {rapport.aCreer} saisie(s) à créer ({rapport.heures.toLocaleString('fr-FR')} h, {eur(rapport.cout)})
                                {rapport.doublons > 0 && `, ${rapport.doublons} déjà saisie(s)`}{rapport.erreurs > 0 && <span className="font-medium text-destructive">, {rapport.erreurs} en erreur : corrigez le fichier, rien n&apos;est importé tant qu&apos;il en reste</span>}.
                            </p>
                            <div className="max-h-[45vh] overflow-auto rounded-md border">
                                <table className="w-full text-xs">
                                    <thead className="sticky top-0 bg-muted"><tr className="text-left"><th className="px-2 py-1.5 font-medium">Ligne</th><th className="px-2 py-1.5 font-medium">Date</th><th className="px-2 py-1.5 font-medium">Technicien</th><th className="px-2 py-1.5 font-medium">Affectation</th><th className="px-2 py-1.5 text-right font-medium">Heures</th><th className="px-2 py-1.5 text-right font-medium">Coût</th><th className="px-2 py-1.5 font-medium">Résultat</th></tr></thead>
                                    <tbody>
                                        {[...rapport.lignes].sort((a, b) => Number(b.etat === 'erreur') - Number(a.etat === 'erreur') || a.ligne - b.ligne).map(l => (
                                            <tr key={l.ligne} className="border-t align-top">
                                                <td className="px-2 py-1">{l.ligne}</td><td className="px-2 py-1 whitespace-nowrap">{l.date.split('-').reverse().join('/')}</td>
                                                <td className="px-2 py-1">{l.technicien || l.email}</td><td className="px-2 py-1">{l.affectation}</td>
                                                <td className="px-2 py-1 text-right">{Number.isFinite(l.hours) ? l.hours.toLocaleString('fr-FR') : '—'}</td><td className="px-2 py-1 text-right">{l.cout === null ? '—' : eur(l.cout)}</td>
                                                <td className="px-2 py-1">{l.etat === 'a_creer' ? <Badge variant="secondary">À créer</Badge> : l.etat === 'doublon' ? <Badge variant="outline">Déjà saisie</Badge> : <span className="text-destructive">{l.messages.join(' ; ')}</span>}</td>
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
                    <Button disabled={busy || !rapport || rapport.erreurs > 0 || rapport.aCreer === 0} onClick={appliquer}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Importer{rapport?.aCreer ? ` ${rapport.aCreer} saisie(s)` : ''}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
