'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Info, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { enregistrerFactureEnergieAction, facturesEnergieAction, supprimerFactureEnergieAction } from '@/lib/billing/factures-energie-actions';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { FactureEnergieSuivie, PointDuSite } from '@/services/factures-energie-admin';

/**
 * Factures du fournisseur d'énergie d'un site, refacturées à l'euro l'euro (prestation P1 « €€ ») : saisie, suivi de
 * ce qui est refacturé, lien vers la facturation du contrat.
 */

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const fr = (d?: string | null) => (d ? d.split('-').reverse().join('/') : '');
const VIDE = { fournisseur: '', numero: '', date: '', debut: '', fin: '', montantHT: '', commentaire: '', pointId: '', quantite: '' };
const AUCUN = '__aucun__';

/** `refacturation` : le site a une prestation €€ (les factures saisies sont refacturées au client) ; sinon elles servent au suivi des achats. */
export function FacturesEnergie({ siteId, contractId, refacturation }: { siteId: string; contractId?: string; refacturation: boolean }) {
    const { toast } = useToast();
    const [factures, setFactures] = useState<FactureEnergieSuivie[] | null>(null);
    const [points, setPoints] = useState<PointDuSite[]>([]);
    const [flux, setFlux] = useState<{ actif: boolean; avertissement?: string }>({ actif: false });
    const [ouvert, setOuvert] = useState<{ id: string | null } | null>(null);
    const [saisie, setSaisie] = useState(VIDE);
    const [envoi, setEnvoi] = useState(false);

    const charger = useCallback(async () => {
        const r = await facturesEnergieAction(siteId);
        if (r.success) { setFactures(r.data.factures); setPoints(r.data.points); setFlux({ actif: r.data.flux, avertissement: r.data.avertissement }); } else { setFactures([]); toast({ title: 'Factures du fournisseur indisponibles', description: r.error, variant: 'destructive' }); }
    }, [siteId, toast]);
    useEffect(() => { void charger(); }, [charger]);

    const ouvrir = (f?: FactureEnergieSuivie) => {
        // Nouvelle facture : le point de livraison du site s'il est seul, et le fournisseur de son contrat.
        const seul = points.length === 1 ? points[0] : null;
        setSaisie(f ? { fournisseur: f.fournisseur, numero: f.numero, date: f.date, debut: f.debut ?? '', fin: f.fin ?? '', montantHT: String(f.montantHT).replace('.', ','), commentaire: f.commentaire ?? '', pointId: f.pointId ?? '', quantite: f.quantite != null ? String(f.quantite).replace('.', ',') : '' }
            : { ...VIDE, pointId: seul?.id ?? '', fournisseur: seul?.fournisseur || factures?.[0]?.fournisseur || '' });
        setOuvert({ id: f?.id ?? null });
    };
    const enregistrer = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!ouvert) return;
        setEnvoi(true);
        const r = await enregistrerFactureEnergieAction(siteId, ouvert.id, { ...saisie, montantHT: Number(saisie.montantHT.replace(/\s/g, '').replace(',', '.')), quantite: saisie.quantite.trim() ? Number(saisie.quantite.replace(/\s/g, '').replace(',', '.')) : null });
        setEnvoi(false);
        if (!r.success) { toast({ title: 'Enregistrement refusé', description: r.error, variant: 'destructive' }); return; }
        toast({ title: ouvert.id ? 'Facture du fournisseur modifiée' : 'Facture du fournisseur ajoutée', description: refacturation ? 'Elle sera proposée à la prochaine facturation du contrat.' : undefined });
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
                    <CardTitle className="text-base">{refacturation ? 'Factures du fournisseur à refacturer (€€)' : "Factures du fournisseur d'énergie"}</CardTitle>
                    <CardDescription data-resume>
                        {refacturation ? "Chaque facture saisie ici est refacturée au client une seule fois, à l'euro l'euro, par la prestation de refacturation du site."
                            : "Les achats d'énergie de ce site, pour les rapprocher de son contrat fournisseur et de ce qui est facturé au client. Elles ne sont pas refacturées (pas de prestation €€ sur ce site)."}
                        {refacturation && factures && attente.length > 0 ? ` ${attente.length} en attente, pour ${eur(attente.reduce((a, f) => a + f.montantHT, 0))} HT.` : ''}
                        {flux.actif && points.length > 0 ? ' Les factures reçues par le flux des fournisseurs (Esker) apparaissent ici d\'elles-mêmes ; la saisie reste possible pour les autres.' : ''}
                        {points.length > 0 ? ` ${points.length} point${points.length > 1 ? 's' : ''} de livraison suivi${points.length > 1 ? 's' : ''} sur ce site.` : ''}
                    </CardDescription>
                </div>
                <div className="flex gap-2">
                    {refacturation && contractId && attente.length > 0 && <Button asChild variant="outline" size="sm"><Link href={`/billing?contrat=${contractId}`}>Facturer le contrat</Link></Button>}
                    <Button size="sm" onClick={() => ouvrir()}><Plus className="mr-1 h-4 w-4" />Ajouter une facture</Button>
                </div>
            </CardHeader>
            <CardContent>
                {flux.avertissement && <p className="mb-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{flux.avertissement} Seules les factures saisies dans le logiciel sont affichées.</p>}
                {factures === null ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    : factures.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">Aucune facture du fournisseur saisie sur ce site.</p> : (
                        <Table>
                            <TableHeader><TableRow>
                                <TableHead>Fournisseur</TableHead><TableHead>N° de facture</TableHead><TableHead>Date</TableHead><TableHead>Consommation</TableHead>
                                <TableHead className="text-right">Montant HT</TableHead>{refacturation && <TableHead>Refacturation</TableHead>}<TableHead className="w-24" />
                            </TableRow></TableHeader>
                            <TableBody>
                                {factures.map(f => (
                                    <TableRow key={f.id}>
                                        <TableCell className="font-medium">{f.fournisseur}
                                            {f.origine === 'bigquery' && <Badge variant="outline" className="ml-2 px-1.5 py-0 text-[10px] font-normal">{f.source || 'Flux'}</Badge>}
                                            {f.pdl && <span className="block font-mono text-xs font-normal text-muted-foreground">PDL {f.pdl}{f.controle?.periode?.numeroContrat ? ` · ${f.controle.periode.numeroContrat}` : ''}</span>}
                                            {(f.controle?.alertes ?? []).map((a, i) => (
                                                <span key={i} className={`mt-0.5 flex items-start gap-1 text-xs font-normal ${a.gravite === 'attention' ? 'text-amber-700' : 'text-muted-foreground'}`}>
                                                    {a.gravite === 'attention' ? <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> : <Info className="mt-0.5 h-3 w-3 shrink-0" />}{a.texte}
                                                </span>
                                            ))}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">{f.pdf ? <a href={f.pdf} target="_blank" rel="noopener noreferrer" className="text-primary underline" title="Ouvrir la facture du fournisseur">{f.numero}</a> : f.numero}</TableCell>
                                        <TableCell>{fr(f.date)}</TableCell>
                                        <TableCell className="text-sm text-muted-foreground">{f.debut && f.fin ? `du ${fr(f.debut)} au ${fr(f.fin)}` : '—'}</TableCell>
                                        <TableCell className="text-right tabular-nums">{eur(f.montantHT)}{f.quantite ? <span className="block text-xs text-muted-foreground">{f.quantite.toLocaleString('fr-FR')} MWh</span> : null}
                                            {f.origine === 'bigquery' && (f.consommation != null || f.acheminement || f.taxes) && (
                                                <span className="block text-[11px] text-muted-foreground" title="Molécule · acheminement · taxes · abonnement (HT)">
                                                    {[f.consommation != null ? `mol. ${eur(f.consommation)}` : '', f.acheminement ? `ach. ${eur(f.acheminement)}` : '', f.taxes ? `taxes ${eur(f.taxes)}` : '', f.abonnement ? `abo. ${eur(f.abonnement)}` : ''].filter(Boolean).join(' · ')}
                                                </span>
                                            )}</TableCell>
                                        {refacturation && <TableCell>
                                            {f.refacturee
                                                ? <Link href={`/invoices/${f.refacturee.invoiceId}`}><Badge variant="secondary">{f.refacturee.proforma ? 'Sur un proforma' : `Refacturée : ${f.refacturee.numero}`}</Badge></Link>
                                                : <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-800">À refacturer</Badge>}
                                        </TableCell>}
                                        <TableCell>
                                            {!f.refacturee && f.origine !== 'bigquery' && (
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
                        <DialogTitle>{ouvert?.id ? 'Modifier la facture du fournisseur' : refacturation ? 'Facture du fournisseur à refacturer' : 'Facture du fournisseur'}</DialogTitle>
                        <DialogDescription>Recopiez la facture du fournisseur d'énergie{refacturation ? ' : son montant HT sera refacturé tel quel au client.' : '.'}</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={enregistrer} className="space-y-3">
                        {points.length > 0 && (
                            <div className="space-y-1">
                                <Label htmlFor="fe-point">Point de livraison</Label>
                                <Select value={saisie.pointId || AUCUN} onValueChange={v => setSaisie(s => ({ ...s, pointId: v === AUCUN ? '' : v, fournisseur: s.fournisseur || points.find(p => p.id === v)?.fournisseur || '' }))}>
                                    <SelectTrigger id="fe-point"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={AUCUN}>Non précisé</SelectItem>
                                        {points.map(p => <SelectItem key={p.id} value={p.id}>{p.energie} · {p.pdl}{p.fournisseur ? ` — ${p.fournisseur}` : ''}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-3">{champ('fournisseur', 'Fournisseur', 'text', true)}{champ('numero', 'N° de la facture', 'text', true)}</div>
                        <div className="grid grid-cols-2 gap-3">
                            {champ('date', 'Date de la facture', 'date', true)}
                            <div className="space-y-1">
                                <Label htmlFor="fe-montantHT">Montant HT (€)</Label>
                                <Input id="fe-montantHT" inputMode="decimal" required placeholder="ex. 1 254,30" value={saisie.montantHT} onChange={e => setSaisie(s => ({ ...s, montantHT: e.target.value }))} />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">{champ('debut', 'Consommation du (facultatif)', 'date')}{champ('fin', 'au', 'date')}</div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label htmlFor="fe-quantite">Quantité (MWh, facultatif)</Label>
                                <Input id="fe-quantite" inputMode="decimal" placeholder="ex. 42,5" value={saisie.quantite} onChange={e => setSaisie(s => ({ ...s, quantite: e.target.value }))} />
                            </div>
                            {champ('commentaire', 'Commentaire (facultatif)')}
                        </div>
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
