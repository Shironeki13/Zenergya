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
 * Suivi analytique : ventes HT facturées sur une période (factures − avoirs), achats de la même période (commandes
 * engagées, heures au coût interne) et marge, totalisés jusqu'à l'axe choisi (société › agence › secteur › client ›
 * contrat ou affaire › activité › site). Les lignes sans analytique (factures antérieures, non reprises) apparaissent en
 * « non affecté ». Les achats ne sont pas affectés à un site : au niveau « site », ils sont en « non affecté ».
 */

type Ligne = Omit<ReturnType<typeof totauxParAxe>[number], 'montant'> & { ventes: number; achats: number; marge: number };
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

    const lignes = useMemo(() => {
        const par = new Map<string, Ligne>();
        const ajouter = (source: SuiviVentes['lignes'], colonne: 'ventes' | 'achats') => {
            for (const t of totauxParAxe(source.map(l => ({ analytique: l.analytique, montant: l.montant, site: l.site })), axe)) {
                const { montant, ...reste } = t;
                const r = par.get(t.cle) ?? { ...reste, lignes: 0, ventes: 0, achats: 0, marge: 0 };
                r[colonne] = montant;
                if (colonne === 'ventes') r.lignes = t.lignes;
                r.marge = Math.round((r.ventes - r.achats) * 100) / 100;
                par.set(t.cle, r);
            }
        };
        ajouter(data?.lignes ?? [], 'ventes');
        ajouter(data?.achats ?? [], 'achats');
        return [...par.values()];
    }, [data, axe]);
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
        { id: 'lignes', label: 'Lignes de facture', align: 'right', masquee: true, tri: r => r.lignes, exporter: r => r.lignes, cell: r => r.lignes },
        { id: 'montant', label: 'Ventes HT', align: 'right', fixe: true, tri: r => r.ventes, exporter: r => r.ventes, cell: r => <span className="font-medium">{eur(r.ventes)}</span> },
        { id: 'achats', label: 'Achats et heures', align: 'right', tri: r => r.achats, exporter: r => r.achats, cell: r => (r.achats ? eur(r.achats) : '—') },
        { id: 'marge', label: 'Marge', align: 'right', tri: r => r.marge, exporter: r => r.marge, cell: r => <span className={r.marge < 0 ? 'font-medium text-destructive' : 'font-medium'}>{eur(r.marge)}</span> },
        { id: 'taux', label: 'Taux', align: 'right', tri: r => (r.ventes ? r.marge / r.ventes : -Infinity), exporter: r => (r.ventes ? Math.round((r.marge / r.ventes) * 1000) / 10 : ''), cell: r => (r.ventes > 0 ? `${((r.marge / r.ventes) * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` : '—') },
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [axe, data]);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Suivi analytique : ventes, achats, marge</h1>
                    <p className="text-muted-foreground">Ventes HT facturées (factures − avoirs), achats (commandes engagées, heures au coût interne) et marge, par axe analytique. Chaque ligne porte le code en vigueur à sa saisie.</p>
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

            <div className="grid gap-3 sm:grid-cols-4">
                <Indicateur titre="Ventes HT de la période" valeur={data ? eur0(data.total) : '—'} detail={data ? `${data.lignes.length} lignes de facture` : undefined} />
                <Indicateur titre="Achats et heures" valeur={data ? eur0(data.totalAchats) : '—'} detail="commandes engagées, heures au coût interne" />
                <Indicateur titre="Marge" valeur={data ? eur0(data.total - data.totalAchats) : '—'} detail={data && data.total > 0 ? `${(((data.total - data.totalAchats) / data.total) * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % des ventes` : undefined} />
                <Indicateur titre="Ventes non affectées" valeur={data ? eur0(data.nonAffecte) : '—'} detail={data && data.nonAffecte !== 0 ? 'factures sans analytique : à reprendre' : undefined} alerte={!!data && data.nonAffecte !== 0} />
            </div>

            <DataTable
                id={`suivi-analytique-${axe}`}
                rows={lignes}
                rowId={r => r.cle}
                colonnes={colonnes}
                chargement={data === null}
                recherche={{ placeholder: 'Code ou libellé…', valeurs: r => [r.cle, r.code, ...niveaux.map(n => nom(n, r.axes[n]))] }}
                triInitial={{ id: 'montant', sens: 'desc' }}
                export={{ fichier: `suivi-analytique-${debut}-${fin}.csv` }}
                vide={{ titre: 'Aucune vente ni achat sur cette période.' }}
            />
        </div>
    );
}
