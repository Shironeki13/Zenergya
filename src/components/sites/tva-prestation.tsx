'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { controlerVentilation, repartir, type QuotePartTva } from '@/lib/billing/ventilation-tva';

/** Ligne saisie : la quote-part reste du texte tant qu'on tape (virgule décimale). */
export type QuotePartSaisie = { vatRateId: string; part: string; libelle: string };

export const versSaisie = (parts?: QuotePartTva[]): QuotePartSaisie[] =>
    (parts ?? []).map(p => ({ vatRateId: p.vatRateId, part: String(p.part).replace('.', ','), libelle: p.libelle ?? '' }));
export const depuisSaisie = (lignes: QuotePartSaisie[]): QuotePartTva[] =>
    lignes.filter(l => l.vatRateId || l.part.trim()).map(l => ({ vatRateId: l.vatRateId, part: Number(l.part.replace(/\s/g, '').replace(',', '.')) || 0, ...(l.libelle.trim() && { libelle: l.libelle.trim() }) }));

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

/**
 * TVA d'une prestation : un taux, ou une ventilation en quote-parts (immeuble mixte au prix global). `ventilable` :
 * faux pour le P1 calculé (acompte, compteur, DJU), qui garde un seul taux.
 */
export function TvaPrestation({ vatRates, vatRateId, onVatRateId, ventilation, onVentilation, ventilable, montantAnnuel }: {
    vatRates: { id: string; code?: string; rate: number }[];
    vatRateId: string; onVatRateId: (v: string) => void;
    ventilation: QuotePartSaisie[]; onVentilation: (v: QuotePartSaisie[]) => void;
    ventilable: boolean; montantAnnuel: number;
}) {
    const ventilee = ventilable && ventilation.length > 0;
    const parts = depuisSaisie(ventilation);
    const anomalies = ventilee ? controlerVentilation(parts, vatRates) : [];
    const total = parts.reduce((s, p) => s + p.part, 0);
    const apercu = ventilee && anomalies.length === 0 && montantAnnuel > 0 ? repartir(montantAnnuel, parts) : null;
    const maj = (i: number, patch: Partial<QuotePartSaisie>) => onVentilation(ventilation.map((l, k) => (k === i ? { ...l, ...patch } : l)));
    const libelleTaux = (id: string) => { const v = vatRates.find(x => x.id === id); return v ? `${v.code ?? ''} · ${v.rate.toLocaleString('fr-FR')} %` : ''; };

    return (
        <div className="space-y-3 rounded-md border p-3" data-bloc="tva-prestation">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>TVA</Label>
                {ventilable && (
                    <label className="flex items-center gap-2 text-sm">
                        <Switch checked={ventilee} aria-label="Ventiler en quote-parts"
                            onCheckedChange={v => onVentilation(v ? [{ vatRateId: vatRateId || '', part: '', libelle: 'habitation' }, { vatRateId: '', part: '', libelle: '' }] : [])} />
                        Ventiler en quote-parts (immeuble mixte)
                    </label>
                )}
            </div>
            {!ventilee ? (
                <Select value={vatRateId} onValueChange={onVatRateId}>
                    <SelectTrigger aria-label="Taux de TVA"><SelectValue placeholder="Taux de l'activité" /></SelectTrigger>
                    <SelectContent>{vatRates.map(v => <SelectItem key={v.id} value={v.id}>{libelleTaux(v.id)}</SelectItem>)}</SelectContent>
                </Select>
            ) : (
                <>
                    <p className="text-xs text-muted-foreground">Le montant annuel est réparti entre les taux ; chaque échéance donne une ligne de facture par quote-part.</p>
                    <div className="space-y-2">
                        {ventilation.map((l, i) => (
                            <div key={i} className="grid grid-cols-[1fr_6rem_1fr_auto] items-center gap-2" data-quote-part={i}>
                                <Select value={l.vatRateId} onValueChange={v => maj(i, { vatRateId: v })}>
                                    <SelectTrigger aria-label={`Taux de la quote-part ${i + 1}`} className="h-9"><SelectValue placeholder="Taux" /></SelectTrigger>
                                    <SelectContent>{vatRates.map(v => <SelectItem key={v.id} value={v.id}>{libelleTaux(v.id)}</SelectItem>)}</SelectContent>
                                </Select>
                                <div className="relative">
                                    <Input aria-label={`Quote-part ${i + 1} (%)`} inputMode="decimal" className="h-9 pr-6 text-right" value={l.part} onChange={e => maj(i, { part: e.target.value })} placeholder="0" />
                                    <span className="pointer-events-none absolute right-2 top-2 text-sm text-muted-foreground">%</span>
                                </div>
                                <Input aria-label={`Libellé de la quote-part ${i + 1}`} className="h-9" value={l.libelle} onChange={e => maj(i, { libelle: e.target.value })} placeholder="habitation, commerces…" />
                                <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={`Retirer la quote-part ${i + 1}`} disabled={ventilation.length <= 2}
                                    onClick={() => onVentilation(ventilation.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></Button>
                            </div>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => onVentilation([...ventilation, { vatRateId: '', part: '', libelle: '' }])}><Plus className="mr-1.5 h-3.5 w-3.5" />Ajouter une quote-part</Button>
                        <span className={Math.abs(total - 100) > 0.005 ? 'font-medium text-amber-700' : 'text-emerald-700'}>Total : {total.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %</span>
                    </div>
                    {anomalies.length > 0 && <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900" data-ventilation="anomalies">{anomalies.join(' ; ')}.</p>}
                    {apercu && (
                        <p className="text-xs text-muted-foreground" data-ventilation="apercu">
                            Sur {eur(montantAnnuel)} HT par an : {parts.map((p, i) => `${eur(apercu[i])} à ${vatRates.find(v => v.id === p.vatRateId)?.rate.toLocaleString('fr-FR')} %${p.libelle ? ` (${p.libelle})` : ''}`).join(', ')}.
                        </p>
                    )}
                </>
            )}
        </div>
    );
}
