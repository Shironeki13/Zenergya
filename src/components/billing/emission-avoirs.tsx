'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Eye, FileDown, Loader2, MinusCircle, ReceiptText, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { MOTIFS_AVOIR, controleDemande, destinationAvoir, natureAvoir, refusAnnulation, type FactureAAnnuler } from '@/lib/billing/avoirs';
import { emettreAvoirsAction } from '@/lib/billing/avoirs-actions';
import type { ResultatAvoir } from '@/services/avoirs-admin';

export type FactureAvoir = FactureAAnnuler & { clientName: string; total: number; contractId?: string };

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const TON_INTERNE = 'border-amber-300 bg-amber-50 text-amber-800';
const TON_STANDARD = 'border-blue-300 bg-blue-50 text-blue-800';

/**
 * Émission d'avoirs sur une ou plusieurs factures : un avoir par facture, motif commun, nature (interne ou transmis)
 * proposée d'après l'état de transmission de chaque facture ; aperçu PDF pour une facture seule ; compte rendu ligne à
 * ligne et contrats à refacturer.
 */
export function EmissionAvoirs({ factures, open, onOpenChange, onDone }: { factures: FactureAvoir[]; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
    const { toast } = useToast();
    const [motif, setMotif] = useState('');
    const [commentaire, setCommentaire] = useState('');
    const [envoi, setEnvoi] = useState(false);
    const [apercu, setApercu] = useState(false);
    const [resultats, setResultats] = useState<ResultatAvoir[] | null>(null);
    useEffect(() => { if (open) { setMotif(''); setCommentaire(''); setResultats(null); } }, [open]);

    const retenues = useMemo(() => factures.filter(f => !refusAnnulation(f)), [factures]);
    const exclues = useMemo(() => factures.filter(f => refusAnnulation(f)), [factures]);
    const internes = retenues.filter(f => natureAvoir(f) === 'interne').length;
    const total = retenues.reduce((s, f) => s + (Number(f.total) || 0), 0);
    const anomalies = controleDemande(retenues, motif, commentaire);

    const voirApercu = async () => {
        const fenetre = window.open('', '_blank');
        setApercu(true);
        try {
            const r = await fetch('/api/documents/apercu-avoir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceId: retenues[0].id, motif, commentaire }) });
            if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Aperçu impossible.');
            const url = URL.createObjectURL(await r.blob());
            if (fenetre) fenetre.location.href = url; else window.open(url, '_blank');
        } catch (e) {
            fenetre?.close();
            toast({ variant: 'destructive', title: 'Aperçu impossible', description: e instanceof Error ? e.message : String(e) });
        } finally { setApercu(false); }
    };

    const emettre = async () => {
        setEnvoi(true);
        const r = await emettreAvoirsAction(retenues.map(f => f.id), motif, commentaire);
        setEnvoi(false);
        if (!r.success) { toast({ variant: 'destructive', title: 'Émission impossible', description: r.error }); return; }
        setResultats(r.data);
        const ok = r.data.filter(x => x.avoir).length;
        toast({ title: `${ok} avoir(s) émis`, description: ok < r.data.length ? `${r.data.length - ok} refusé(s) : voir le détail.` : undefined, ...(ok < r.data.length && { variant: 'destructive' as const }) });
        onDone();
    };

    const aRefacturer = resultats ? [...new Map(resultats.filter(x => x.avoir && x.contractId).map(x => [x.contractId!, x])).values()] : [];

    return (
        <Dialog open={open} onOpenChange={o => { if (!envoi) onOpenChange(o); }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl" data-dialogue="avoirs">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><ReceiptText className="h-5 w-5" />{resultats ? 'Avoirs émis' : retenues.length > 1 ? `Annuler ${retenues.length} factures par avoir` : 'Annuler la facture par un avoir'}</DialogTitle>
                    <DialogDescription>
                        {resultats ? 'Compte rendu, facture par facture.' : 'Un avoir par facture, qui l\'annule entièrement. Ses échéances redeviennent à facturer : vous pourrez émettre une facture corrigée.'}
                    </DialogDescription>
                </DialogHeader>

                {!resultats ? (
                    <div className="space-y-4">
                        <div className="max-h-64 overflow-y-auto rounded-md border">
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-1.5">Facture</th><th>Client</th><th className="text-right">TTC</th><th className="px-3">Avoir</th></tr></thead>
                                <tbody>
                                    {retenues.map(f => (
                                        <tr key={f.id} className="border-t" data-facture={f.invoiceNumber}>
                                            <td className="px-3 py-1.5 font-mono text-xs">{f.invoiceNumber}</td>
                                            <td className="max-w-[220px] truncate" title={f.clientName}>{f.clientName}</td>
                                            <td className="text-right">{eur(Number(f.total) || 0)}</td>
                                            <td className="px-3"><Badge variant="outline" className={`whitespace-nowrap py-0 text-[10px] ${natureAvoir(f) === 'interne' ? TON_INTERNE : TON_STANDARD}`} title={destinationAvoir(f)}>{natureAvoir(f) === 'interne' ? 'interne' : destinationAvoir(f).replace(/^À transmettre (par|sur) /, '').replace('la plateforme agréée', 'plateforme')}</Badge></td>
                                        </tr>
                                    ))}
                                    {exclues.map(f => (
                                        <tr key={f.id} className="border-t text-muted-foreground"><td className="px-3 py-1.5 font-mono text-xs line-through">{f.invoiceNumber || f.id.slice(0, 6)}</td><td colSpan={3} className="text-xs">Écartée : {refusAnnulation(f)}</td></tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {internes > 0 && (
                            <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900" data-avoirs="internes">
                                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                {internes === 1
                                    ? 'Une facture a été rejetée par la plateforme : le client ne l\'a pas reçue. Son avoir est interne (« AVOIR INTERNE », jamais transmis) ; réémettez ensuite une facture corrigée.'
                                    : `${internes} factures ont été rejetées par la plateforme : le client ne les a pas reçues. Leur avoir est interne (« AVOIR INTERNE », jamais transmis) ; réémettez ensuite des factures corrigées.`}
                            </p>
                        )}
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label htmlFor="motif-avoir">Motif</Label>
                                <Select value={motif} onValueChange={setMotif}>
                                    <SelectTrigger id="motif-avoir" aria-label="Motif de l'avoir"><SelectValue placeholder="Choisir un motif" /></SelectTrigger>
                                    <SelectContent>{MOTIFS_AVOIR.map(m => <SelectItem key={m.code} value={m.code}>{m.libelle}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="commentaire-avoir">Commentaire {motif === 'autre' ? '(obligatoire)' : '(facultatif)'}</Label>
                                <Textarea id="commentaire-avoir" rows={2} value={commentaire} onChange={e => setCommentaire(e.target.value)} placeholder="Imprimé sur l'avoir après le motif" />
                            </div>
                        </div>
                        <p className="text-xs text-muted-foreground">Date de l&apos;avoir : aujourd&apos;hui. Le motif et le commentaire figurent sur chaque avoir (document numéroté et archivé).</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="max-h-72 overflow-y-auto rounded-md border">
                            <table className="w-full text-sm">
                                <tbody>
                                    {resultats.map(x => (
                                        <tr key={x.factureId} className="border-t first:border-t-0" data-resultat={x.facture}>
                                            <td className="px-3 py-1.5">{x.avoir ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <TriangleAlert className="h-4 w-4 text-red-600" />}</td>
                                            <td className="font-mono text-xs">{x.facture}</td>
                                            <td className="max-w-[200px] truncate">{x.client}</td>
                                            <td className="px-3 text-xs">
                                                {x.avoir
                                                    ? <a href={`/api/documents/credit-notes/${x.avoirId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-primary hover:underline"><FileDown className="h-3 w-3" />{x.avoir}{x.nature === 'interne' && ' (interne)'}</a>
                                                    : <span className="text-red-700">Refusée : {x.erreur}</span>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {aRefacturer.length > 0 && (
                            <div className="space-y-1.5 text-sm">
                                <p className="font-medium">Refacturer</p>
                                <p className="text-xs text-muted-foreground">Les échéances annulées sont de nouveau dues sur ces contrats.</p>
                                <div className="flex flex-wrap gap-2">
                                    {aRefacturer.map(x => <Button key={x.contractId} asChild size="sm" variant="outline" className="h-8"><Link href={`/billing?contrat=${x.contractId}`} target="_blank">{x.client}</Link></Button>)}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter className="gap-2">
                    {!resultats ? (
                        <>
                            {retenues.length === 1 && <Button type="button" variant="outline" onClick={voirApercu} disabled={apercu}>{apercu ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}Aperçu de l&apos;avoir</Button>}
                            <Button type="button" variant="destructive" onClick={emettre} disabled={envoi || anomalies.length > 0} title={anomalies.join(' ')}>
                                {envoi ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MinusCircle className="mr-2 h-4 w-4" />}
                                Émettre {retenues.length > 1 ? `${retenues.length} avoirs` : "l'avoir"} — {eur(-total)} TTC
                            </Button>
                        </>
                    ) : <Button type="button" onClick={() => onOpenChange(false)}>Fermer</Button>}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
