'use client';

import { SearchableSelect } from '@/components/ui/searchable-select';
import { useConfirm } from '@/components/confirm-provider';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useData } from '@/context/data-context';
import { emitP1RegularisationAction, previewP1RegularisationAction, type RegulPreviewView } from '@/lib/billing/p1-actions';

/**
 * Régularisation P1 d'un contrat : réel du moteur (import « Réel P1 du moteur ») − acomptes P1 facturés, plus les
 * intéressements de la période. Lignes positives : une facture ; en faveur du client : un avoir de régularisation.
 */

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const thisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }).slice(0, 7);

export default function P1RegularisationPage() {
    const confirmer = useConfirm();
    const { contracts, services, isLoading } = useData();
    const { toast } = useToast();
    const [contractId, setContractId] = useState('');
    const [debut, setDebut] = useState('');
    const [fin, setFin] = useState(thisMonth());
    const [preview, setPreview] = useState<RegulPreviewView | null>(null);
    const [busy, setBusy] = useState(false);

    // Contrats facturant des acomptes P1.
    const candidats = useMemo(() => contracts.filter(c => services.some(s => s.contractId === c.id && s.p1Mode === 'acompte')), [contracts, services]);

    const load = async () => {
        setBusy(true);
        const r = await previewP1RegularisationAction(contractId, debut, fin);
        setBusy(false);
        if (r.success) setPreview(r.data);
        else { setPreview(null); toast({ title: 'Aperçu impossible', description: r.error, variant: 'destructive' }); }
    };
    const emit = async () => {
        if (!(await confirmer({ title: 'Émettre la régularisation ?', description: 'Les factures et avoirs de régularisation seront numérotés et archivés : ils ne pourront plus être supprimés.', confirmLabel: 'Émettre' }))) return;
        setBusy(true);
        const r = await emitP1RegularisationAction(contractId, debut, fin, new Date().toISOString());
        setBusy(false);
        if (!r.success) { toast({ title: 'Émission refusée', description: r.error, variant: 'destructive' }); return; }
        toast({ title: 'Régularisation émise', description: [r.data.invoice && `facture ${r.data.invoice.number}`, r.data.creditNote && `avoir ${r.data.creditNote.number}`].filter(Boolean).join(' et ') });
        setPreview(null);
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Régularisation P1</CardTitle>
                <CardDescription>
                    Réel P1 calculé par le moteur (<Link className="underline" href="/imports">import « Réel P1 du moteur »</Link>) moins les acomptes P1 facturés,
                    plus les intéressements de la période. En faveur du client : avoir de régularisation (les factures d&apos;acompte restent valables).
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1">
                        <Label>Contrat</Label>
                        <SearchableSelect className="w-80" value={contractId} onValueChange={v => { setContractId(v); setPreview(null); }} disabled={isLoading}
                            placeholder={candidats.length ? 'Choisir un contrat' : 'Aucun contrat en acomptes P1'} searchPlaceholder="N° de contrat ou client…"
                            options={candidats.map(c => ({ value: c.id, label: `${c.contractNumber} — ${c.clientName}` }))} />
                    </div>
                    <div className="space-y-1"><Label>Du mois</Label><Input type="month" value={debut} onChange={e => { setDebut(e.target.value); setPreview(null); }} className="w-40" /></div>
                    <div className="space-y-1"><Label>Au mois</Label><Input type="month" value={fin} onChange={e => { setFin(e.target.value); setPreview(null); }} className="w-40" /></div>
                    <Button variant="outline" disabled={busy || !contractId || !debut || !fin} onClick={load}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Aperçu</Button>
                </div>

                {preview && (
                    <div className="space-y-3">
                        {preview.errors.length > 0 && <div className="rounded-md border border-destructive p-3 text-sm text-destructive">{preview.errors.map(e => <p key={e}>{e}</p>)}</div>}
                        <Table>
                            <TableHeader><TableRow><TableHead>Site</TableHead><TableHead>Usage</TableHead><TableHead className="text-right">Réel du moteur</TableHead><TableHead className="text-right">Acomptes facturés</TableHead><TableHead className="text-right">Écart HT</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {preview.detail.map(d => (
                                    <TableRow key={`${d.siteId}-${d.usage}`}>
                                        <TableCell>{d.site}</TableCell><TableCell>{({ total: 'total', chauffage: 'chauffage', ecs: 'ECS' })[d.usage]}</TableCell>
                                        <TableCell className="text-right">{eur(d.reel)}</TableCell>
                                        <TableCell className="text-right">{eur(d.acomptes)}</TableCell>
                                        <TableCell className={`text-right font-medium ${d.ecart < 0 ? 'text-green-700' : ''}`}>{eur(d.ecart)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        {preview.lines.filter(l => l.description.startsWith('Intéressement')).map(l => <p key={l.description} className="text-sm">{l.description} : {eur(l.total)}</p>)}
                        <div className="flex flex-wrap items-center gap-6 text-sm">
                            {preview.facture && <span>Facture : {eur(preview.facture.subtotal)} HT, {eur(preview.facture.total)} TTC</span>}
                            {preview.avoir && <span className="text-green-700">Avoir : {eur(preview.avoir.subtotal)} HT, {eur(preview.avoir.total)} TTC</span>}
                            {!preview.facture && !preview.avoir && !preview.errors.length && <span className="text-muted-foreground">Rien à régulariser sur cette période.</span>}
                            <span className="flex-1" />
                            <Button disabled={busy || preview.errors.length > 0 || (!preview.facture && !preview.avoir)} onClick={emit}>Émettre</Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
