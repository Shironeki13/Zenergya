'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PlusCircle, Settings2, Truck, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, type Colonne } from '@/components/data-table/data-table';
import { useOngletUrl } from '@/components/fiches/fiche';
import { FournisseursDialog, SeuilsDialog } from '@/components/commandes/dialogues';
import { ImportCommandesDialog } from '@/components/commandes/import-dialog';
import { useData } from '@/context/data-context';
import { useToast } from '@/hooks/use-toast';
import { LIBELLE_ETAPE, LIBELLE_STATUT, etapeEnCours, factureHT, peutDecider, type Commande, type StatutCommande } from '@/lib/commandes';
import { listCommandesAction } from '@/lib/commandes-actions';

/**
 * Commandes d'achat : liste (toutes, à valider par moi, mes commandes), état et étape de validation en cours, engagé et
 * facturé. Chaque ligne d'une commande porte un code analytique (affaire de travaux ou prestation d'un contrat).
 */

const ONGLETS = ['toutes', 'a-valider', 'miennes'] as const;
type Onglet = typeof ONGLETS[number];
const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
export const VARIANTE: Record<StatutCommande, 'secondary' | 'outline' | 'destructive' | 'default'> = {
    brouillon: 'outline', a_valider: 'default', refusee: 'destructive', validee: 'secondary', passee: 'secondary', recue: 'secondary', soldee: 'outline', annulee: 'outline',
};

export default function CommandesPage() {
    const { currentUser, authUser, isAdmin, isAcheteur } = useData();
    const { toast } = useToast();
    const [onglet, changerOnglet] = useOngletUrl<Onglet>(ONGLETS, 'toutes');
    const [commandes, setCommandes] = useState<Commande[] | null>(null);
    const [fournisseurs, setFournisseurs] = useState(false);
    const [seuils, setSeuils] = useState(false);
    const [importer, setImporter] = useState(false);
    const moi = (authUser ?? currentUser)?.id ?? '';

    const charger = useCallback(async () => {
        const r = await listCommandesAction();
        if (r.success) setCommandes(r.data);
        else { setCommandes([]); toast({ title: 'Commandes indisponibles', description: r.error, variant: 'destructive' }); }
    }, [toast]);
    useEffect(() => { charger(); }, [charger]);

    const aValider = useMemo(() => (commandes ?? []).filter(c => peutDecider(c, { id: moi, isAdmin, isAcheteur }).ok), [commandes, moi, isAdmin, isAcheteur]);
    const lignes = useMemo(() => (onglet === 'a-valider' ? aValider : onglet === 'miennes' ? (commandes ?? []).filter(c => c.requesterId === moi) : commandes ?? []), [onglet, commandes, aValider, moi]);

    const colonnes: Colonne<Commande>[] = useMemo(() => [
        { id: 'numero', label: 'Commande', fixe: true, tri: r => r.number ?? '', exporter: r => r.number ?? '', cell: r => <span className="whitespace-nowrap font-mono text-xs">{r.number ?? <span className="font-sans text-muted-foreground">brouillon</span>}{r.externalRef && <span className="block font-sans text-muted-foreground" title="Référence d'origine (commande importée)">{r.externalRef}</span>}</span> },
        { id: 'date', label: 'Date', tri: r => r.date, exporter: r => r.date, cell: r => r.date.split('-').reverse().join('/') },
        { id: 'fournisseur', label: 'Fournisseur', tri: r => r.supplierName, exporter: r => r.supplierName, cell: r => <span className="block max-w-[180px] truncate" title={r.supplierName}>{r.supplierName}</span> },
        { id: 'objet', label: 'Objet', exporter: r => r.title, cell: r => <span className="block max-w-[260px] truncate" title={r.title}>{r.title}</span> },
        { id: 'analytique', label: 'Analytique', exporter: r => [...new Set(r.lines.map(l => l.analytique?.code ?? l.cible.libelle ?? ''))].join(' ; '), cell: r => {
            const codes = [...new Set(r.lines.map(l => l.cible.libelle ?? l.analytique?.code ?? '—'))];
            return <span className="block max-w-[240px] truncate text-xs" title={codes.join('\n')}>{codes[0]}{codes.length > 1 ? ` +${codes.length - 1}` : ''}</span>;
        } },
        { id: 'demandeur', label: 'Demandeur', tri: r => r.requesterName, exporter: r => r.requesterName, cell: r => r.requesterName },
        { id: 'statut', label: 'État', tri: r => r.status, exporter: r => LIBELLE_STATUT[r.status], cell: r => {
            const e = etapeEnCours(r);
            return <span className="inline-flex flex-col gap-0.5"><Badge variant={VARIANTE[r.status]} className="w-fit whitespace-nowrap">{LIBELLE_STATUT[r.status]}</Badge>
                {e && <span className="text-xs text-muted-foreground">{LIBELLE_ETAPE[e.role]}{e.approverName ? ` : ${e.approverName}` : ''}</span>}</span>;
        } },
        { id: 'total', label: 'Total HT', align: 'right', tri: r => r.totalHT, exporter: r => r.totalHT, cell: r => <span className="font-medium">{eur(r.totalHT)}</span> },
        { id: 'facture', label: 'Facturé fournisseur', align: 'right', masquee: true, tri: r => factureHT(r), exporter: r => factureHT(r), cell: r => (factureHT(r) ? eur(factureHT(r)) : '—') },
    ], []);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Commandes d&apos;achat</h1>
                    <p className="text-muted-foreground">Chaque ligne est affectée à un code analytique (affaire ou contrat). Validation selon le montant : autovalidation, responsable N+1, N+2, achats.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {isAdmin && <Button variant="outline" size="sm" onClick={() => setSeuils(true)}><Settings2 className="mr-1 h-4 w-4" />Seuils de validation</Button>}
                    <Button variant="outline" size="sm" onClick={() => setImporter(true)}><Upload className="mr-1 h-4 w-4" />Importer</Button>
                    <Button variant="outline" size="sm" onClick={() => setFournisseurs(true)}><Truck className="mr-1 h-4 w-4" />Fournisseurs</Button>
                </div>
            </div>

            <Tabs value={onglet} onValueChange={v => changerOnglet(v as Onglet)}>
                <TabsList>
                    <TabsTrigger value="toutes">Toutes</TabsTrigger>
                    <TabsTrigger value="a-valider" className="gap-1.5">À valider par moi {aValider.length > 0 && <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">{aValider.length}</Badge>}</TabsTrigger>
                    <TabsTrigger value="miennes">Mes commandes</TabsTrigger>
                </TabsList>
            </Tabs>

            <DataTable
                id={`commandes-${onglet}`}
                rows={lignes}
                rowId={r => r.id}
                colonnes={colonnes}
                chargement={commandes === null}
                lien={r => `/purchases/${r.id}`}
                recherche={{ placeholder: 'Numéro, fournisseur, objet, code analytique…', valeurs: r => [r.number, r.externalRef, r.supplierName, r.title, r.requesterName, ...r.lines.flatMap(l => [l.analytique?.code, l.cible.libelle])] }}
                filtres={[{ id: 'statut', label: 'État', valeur: r => r.status, libelle: v => LIBELLE_STATUT[v as StatutCommande] ?? v }]}
                triInitial={{ id: 'date', sens: 'desc' }}
                export={{ fichier: 'commandes.csv' }}
                boutons={<Button asChild size="sm" className="h-9 gap-1"><Link href="/purchases/nouvelle"><PlusCircle className="h-4 w-4" />Nouvelle commande</Link></Button>}
                vide={{ titre: onglet === 'a-valider' ? 'Aucune commande à valider.' : 'Aucune commande.', description: onglet === 'toutes' ? 'Créez une commande : elle est affectée à une affaire de travaux ou à un contrat.' : undefined }}
            />
            <FournisseursDialog open={fournisseurs} onOpenChange={setFournisseurs} />
            <SeuilsDialog open={seuils} onOpenChange={setSeuils} />
            <ImportCommandesDialog open={importer} onOpenChange={setImporter} onImporte={charger} />
        </div>
    );
}
