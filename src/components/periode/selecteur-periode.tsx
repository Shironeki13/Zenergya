'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PERIODE_TOUT, periodeParDefaut, type Periode } from '@/hooks/use-lecture-periode';

/**
 * Période des listes de factures et d'avoirs : par défaut l'exercice en cours et le précédent. `note` : ce qui reste
 * affiché quelle que soit la période (ex. les factures impayées).
 */
export function SelecteurPeriode({ periode, onChange, note }: { periode: Periode; onChange: (p: Periode) => void; note?: string }) {
    const annee = new Date().getFullYear();
    const defaut = periodeParDefaut();
    const raccourcis: [string, Periode][] = [
        [`${annee - 1} et ${annee}`, defaut], [String(annee), { du: `${annee}-01-01`, au: `${annee}-12-31` }], ['Tout l\'historique', PERIODE_TOUT],
    ];
    const actif = (p: Periode) => p.du === periode.du && p.au === periode.au;
    return (
        <div className="flex flex-wrap items-end gap-2 text-sm">
            <div className="space-y-1"><Label htmlFor="periode-du">Du</Label><Input id="periode-du" type="date" className="h-9 w-[150px]" value={periode.du} max={periode.au} onChange={e => e.target.value && onChange({ ...periode, du: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="periode-au">Au</Label><Input id="periode-au" type="date" className="h-9 w-[150px]" value={periode.au} min={periode.du} onChange={e => e.target.value && onChange({ ...periode, au: e.target.value })} /></div>
            {raccourcis.map(([libelle, p]) => <Button key={libelle} type="button" size="sm" variant={actif(p) ? 'secondary' : 'ghost'} className="h-9" onClick={() => onChange(p)}>{libelle}</Button>)}
            {note && <p className="basis-full text-xs text-muted-foreground">{note}</p>}
        </div>
    );
}
