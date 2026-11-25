'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { enregistrerFactureEnergieAction, facturesEnergieAction, supprimerFactureEnergieAction } from '@/lib/billing/factures-energie-actions';
import type { FactureEnergieSuivie } from '@/services/factures-energie-admin';

/**
 * Factures du fournisseur d'énergie d'un site, refacturées à l'euro l'euro (prestation P1 « €€ ») : saisie, suivi de
 * ce qui est refacturé, lien vers la facturation du contrat.
 */

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const fr = (d?: string | null) => (d ? d.split('-').reverse().join('/') : '');
const VIDE = { fournisseur: '', numero: '', date: '', debut: '', fin: '', montantHT: '', commentaire: '' };

export function FacturesEnergie({ siteId, contractId }: { siteId: string; contractId?: string }) {
    const { toast } = useToast();
    const [factures, setFactures] = useState<FactureEnergieSuivie[] | null>(null);
    const [ouvert, setOuvert] = useState<{ id: string | null } | null>(null);
    const [saisie, setSaisie] = useState(VIDE);
    const [envoi, setEnvoi] = useState(false);

    const charger = useCallback(async () => {
        const r = await facturesEnergieAction(siteId);
        if (r.success) setFactures(r.data); else { setFactures([]); toast({ title: 'Factures du fournisseur indisponibles', description: r.error, variant: 'destructive' }); }
    }, [siteId, toast]);
    useEffect(() => { void charger(); }, [charger]);

    const ouvrir = (f?: FactureEnergieSuivie) => {
        setSaisie(f ? { fournisseur: f.fournisseur, numero: f.numero, date: f.date, debut: f.debut ?? '', fin: f.fin ?? '', montantHT: String(f.montantHT).replace('.', ','), commentaire: f.commentaire ?? '' }
            : { ...VIDE, fournisseur: factures?.[0]?.fournisseur ?? '' });
        setOuvert({ id: f?.id ?? null });
    };
    const enregistrer = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!ouvert) return;
        setEnvoi(true);
        const r = await enregistrerFactureEnergieAction(siteId, ouvert.id, { ...saisie, montantHT: Number(saisie.montantHT.replace(/\s/g, '').replace(',', '.')) });
        setEnvoi(false);
        if (!r.success) { toast({ title: 'Enregistrement refusé', description: r.error, variant: 'destructive' }); return; }
        toast({ title: ouvert.id ? 'Facture du fournisseur modifiée' : 'Facture du fournisseur ajoutée', description: 'Elle sera proposée à la prochaine facturation du contrat.' });
        setOuvert(null);
        await charger();
    };
    const supprimer = async (f: FactureEnergieSuivie) => {
        if (!window.confirm(`Supprimer la facture ${f.numero} de ${f.fournisseur} ?`)) return;
        const r = await supprimerFactureEnergieAction(siteId, f.id);
        if (!r.success) { toast({ title: 'Suppression refusée', description: r.error, variant: 'destructive' }); return; }
        await charger();
    };

    const attente = (factures ?? []).filter(f => !f.refacturee);
    const champ = (cle: keyof typeof VIDE, libelle: string, type = 'text', requis = false) => (
        <div className="space-y-1">
            <Label htmlFor={`fe-${cle}`}>{libelle}</Label>
            <Input id={`fe-${cle}`} type={type} required={requis} value={saisie[cle]} onChange={e => setSaisie(s => ({ ...s, [cle]: e.target.value }))} />
        </div>
    );

    return (
        <Card data-bloc="factures-energie">
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-3">
                <div>
                    <CardTitle className="text-base">Factures du fournisseur à refacturer (€€)</CardTitle>
                    <CardDescription data-resume>
                        Chaque facture saisie ici est refacturée au client une seule fois, à l'euro l'euro, par la prestation de refacturation du site.
                        {factures && attente.length > 0 ? ` ${attente.length} en attente, pour ${eur(attente.reduce((a, f) => a + f.montantHT, 0))} HT.` : ''}
                    </CardDescription>
                </div>
                <div className="flex gap-2">
                    {contractId && attente.length > 0 && <Button asChild variant="outline" size="sm"><Link href={`/billing?contrat=${contractId}`}>Facturer le contrat</Link></Button>}
                    <Button size="sm" onClick={() => ouvrir()}><Plus className="mr-1 h-4 w-4" />Ajouter une facture</Button>
                </div>
            </CardHeader>
            <CardContent>
                {factures === null ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    : factures.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">Aucune facture du fournisseur saisie sur ce site.</p> : (
                        <Table>
                            <TableHeader><TableRow>
                                <TableHead>Fournisseur</TableHead><TableHead>N° de facture</TableHead><TableHead>Date</TableHead><TableHead>Consommation</TableHead>
                                <TableHead className="text-right">Montant HT</TableHead><TableHead>Refacturation</TableHead><TableHead className="w-24" />
                            </TableRow></TableHeader>
                            <TableBody>
                                {factures.map(f => (
                                    <TableRow key={f.id}>
                                        <TableCell className="font-medium">{f.fournisseur}</TableCell>
                                        <TableCell className="font-mono text-xs">{f.numero}</TableCell>
                                        <TableCell>{fr(f.date)}</TableCell>
                                        <TableCell className="text-sm text-muted-foreground">{f.debut && f.fin ? `du ${fr(f.debut)} au ${fr(f.fin)}` : '—'}</TableCell>
                                        <TableCell className="text-right tabular-nums">{eur(f.montantHT)}</TableCell>
                                        <TableCell>
                                            {f.refacturee
                                                ? <Link href={`/invoices/${f.refacturee.invoiceId}`}><Badge variant="secondary">{f.refacturee.proforma ? 'Sur un proforma' : `Refacturée : ${f.refacturee.numero}`}</Badge></Link>
                                                : <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-800">À refacturer</Badge>}
                                        </TableCell>
                                        <TableCell>
                                            {!f.refacturee && (
                                                <div className="flex justify-end">
                                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => ouvrir(f)} aria-label={`Modifier la facture ${f.numero}`}><Pencil className="h-4 w-4" /></Button>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => supprimer(f)} aria-label={`Supprimer la facture ${f.numero}`}><Trash2 className="h-4 w-4" /></Button>
                                                </div>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
            </CardContent>

            <Dialog open={!!ouvert} onOpenChange={o => { if (!o) setOuvert(null); }}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>{ouvert?.id ? 'Modifier la facture du fournisseur' : 'Facture du fournisseur à refacturer'}</DialogTitle>
                        <DialogDescription>Recopiez la facture du fournisseur d'énergie : son montant HT sera refacturé tel quel au client.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={enregistrer} className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">{champ('fournisseur', 'Fournisseur', 'text', true)}{champ('numero', 'N° de la facture', 'text', true)}</div>
                        <div className="grid grid-cols-2 gap-3">
                            {champ('date', 'Date de la facture', 'date', true)}
                            <div className="space-y-1">
                                <Label htmlFor="fe-montantHT">Montant HT (€)</Label>
                                <Input id="fe-montantHT" inputMode="decimal" required placeholder="ex. 1 254,30" value={saisie.montantHT} onChange={e => setSaisie(s => ({ ...s, montantHT: e.target.value }))} />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">{champ('debut', 'Consommation du (facultatif)', 'date')}{champ('fin', 'au', 'date')}</div>
                        {champ('commentaire', 'Commentaire (facultatif)')}
                        <p className="text-xs text-muted-foreground">Un avoir du fournisseur se saisit avec un montant négatif.</p>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setOuvert(null)}>Annuler</Button>
                            <Button type="submit" disabled={envoi}>{envoi ? 'Enregistrement…' : 'Enregistrer'}</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
