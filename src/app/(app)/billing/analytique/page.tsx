'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable, type Colonne } from '@/components/data-table/data-table';
import { Indicateur, eur0 } from '@/components/fiches/fiche';
import { useToast } from '@/hooks/use-toast';
import { AXES_SUIVI, LIBELLE_AXE, NON_AFFECTE, totauxParAxe, type AxeSuivi } from '@/lib/analytique';
import { suiviVentesAction } from '@/lib/analytique-actions';
import type { SuiviVentes } from '@/services/analytique-admin';

/**
 * Suivi des ventes par analytique : ventes HT facturées sur une période (factures − avoirs), totalisées jusqu'à l'axe
 * choisi (société › agence › secteur › client › contrat › activité › site). Les lignes sans analytique (factures
 * antérieures, non reprises) apparaissent en « non affecté ».
 */

type Ligne = ReturnType<typeof totauxParAxe>[number];
const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

export default function SuiviAnalytiquePage() {
    const { toast } = useToast();
    const annee = new Date().getFullYear();
    const [debut, setDebut] = useState(`${annee}-01-01`);
    const [fin, setFin] = useState(`${annee}-12-31`);
    const [axe, setAxe] = useState<AxeSuivi>('contrat');
    const [data, setData] = useState<SuiviVentes | null>(null);
    const [chargement, setChargement] = useState(false);

    const charger = useCallback(async () => {
        if (!debut || !fin) return;
        setChargement(true);
        const r = await suiviVentesAction(debut, fin);
        setChargement(false);
        if (r.success) setData(r.data);
        else toast({ title: 'Suivi indisponible', description: r.error, variant: 'destructive' });
    }, [debut, fin, toast]);
    useEffect(() => { charger(); }, [charger]);

    const lignes = useMemo(() => totauxParAxe((data?.lignes ?? []).map(l => ({ analytique: l.analytique, montant: l.montant, site: l.site })), axe), [data, axe]);
    const niveaux = AXES_SUIVI.slice(0, AXES_SUIVI.indexOf(axe) + 1);
    const nom = (n: AxeSuivi, code?: string) => (n === 'site' || !code || code === NON_AFFECTE ? '' : data?.libelles[n]?.[code] ?? '');

    const colonnes: Colonne<Ligne>[] = useMemo(() => [
        ...niveaux.map(n => ({
            id: n, label: LIBELLE_AXE[n], tri: (r: Ligne) => r.axes[n] ?? '',
            exporter: (r: Ligne) => `${r.axes[n] ?? ''}${nom(n, r.axes[n]) ? ` — ${nom(n, r.axes[n])}` : ''}`,
            cell: (r: Ligne) => (
                <span className={r.axes[n] === NON_AFFECTE ? 'text-destructive' : ''}>
                    <span className="font-mono text-xs">{r.axes[n]}</span>
                    {nom(n, r.axes[n]) && <span className="block max-w-[220px] truncate text-xs text-muted-foreground" title={nom(n, r.axes[n])}>{nom(n, r.axes[n])}</span>}
                </span>
            ),
        })),
        { id: 'code', label: 'Code analytique', masquee: true, tri: r => r.code, exporter: r => r.code, cell: r => <span className="break-all font-mono text-xs">{r.code}</span> },
        { id: 'lignes', label: 'Lignes', align: 'right', tri: r => r.lignes, exporter: r => r.lignes, cell: r => r.lignes },
        { id: 'montant', label: 'Ventes HT', align: 'right', fixe: true, tri: r => r.montant, exporter: r => r.montant, cell: r => <span className="font-medium">{eur(r.montant)}</span> },
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [axe, data]);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Suivi analytique des ventes</h1>
                    <p className="text-muted-foreground">Ventes HT facturées (factures − avoirs), par axe analytique. Chaque ligne de facture porte le code en vigueur à son émission.</p>
                </div>
                <Button variant="outline" size="sm" onClick={charger} disabled={chargement}>{chargement ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}Actualiser</Button>
            </div>

            <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1"><Label htmlFor="suivi-debut">Du</Label><Input id="suivi-debut" type="date" value={debut} onChange={e => setDebut(e.target.value)} className="w-40" /></div>
                <div className="space-y-1"><Label htmlFor="suivi-fin">Au</Label><Input id="suivi-fin" type="date" value={fin} onChange={e => setFin(e.target.value)} className="w-40" /></div>
                <div className="space-y-1">
                    <Label htmlFor="suivi-axe">Détail jusqu&apos;à</Label>
                    <Select value={axe} onValueChange={v => setAxe(v as AxeSuivi)}>
                        <SelectTrigger id="suivi-axe" className="w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>{AXES_SUIVI.map(a => <SelectItem key={a} value={a}>{LIBELLE_AXE[a]}</SelectItem>)}</SelectContent>
                    </Select>
                </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
                <Indicateur titre="Ventes HT de la période" valeur={data ? eur0(data.total) : '—'} />
                <Indicateur titre="Dont non affecté" valeur={data ? eur0(data.nonAffecte) : '—'} detail={data && data.nonAffecte !== 0 ? 'factures sans analytique : à reprendre' : undefined} />
                <Indicateur titre="Lignes de facture" valeur={data ? String(data.lignes.length) : '—'} />
            </div>

            <DataTable
                id={`suivi-analytique-${axe}`}
                rows={lignes}
                rowId={r => r.cle}
                colonnes={colonnes}
                chargement={data === null}
                recherche={{ placeholder: 'Code ou libellé…', valeurs: r => [r.cle, r.code, ...niveaux.map(n => nom(n, r.axes[n]))] }}
                triInitial={{ id: 'montant', sens: 'desc' }}
                export={{ fichier: `ventes-analytique-${debut}-${fin}.csv` }}
                vide={{ titre: 'Aucune vente facturée sur cette période.' }}
            />
        </div>
    );
}
