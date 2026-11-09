'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ClipboardCheck, ExternalLink, FileText, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, type Colonne } from '@/components/data-table/data-table';
import { ControleDocument } from '@/components/contracts/validation/controle-document';
import { useOngletUrl } from '@/components/fiches/fiche';
import { useData } from '@/context/data-context';
import { useToast } from '@/hooks/use-toast';
import {
    LIBELLES_VALIDATION, LIBELLE_UNITAIRE, TYPES_VALIDATION, aucunUnitaire, type ElementAValider, type TypeValidation,
} from '@/lib/validations';
import { fileValidationAction } from '@/lib/validations-actions';

/**
 * Validation des documents de contrat (contrathèque, garante des documents) : file d'attente fractionnée par type —
 * base marché, avenants, ordres de service, reconductions, résiliations, changements de syndic et de BE. Chaque document
 * s'ouvre dans l'écran de contrôle : pièce et valeurs saisies côte à côte, chaque valeur cochée ou corrigée avant de
 * valider (effets appliqués au serveur), ou refus motivé.
 */

const ONGLETS = ['tout', ...TYPES_VALIDATION] as const;
type Onglet = typeof ONGLETS[number];
const jour = (d: string | null) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');

export default function ValidationsPage() {
    const { isContratheque, reloadData } = useData();
    const { toast } = useToast();
    const [onglet, changerOnglet] = useOngletUrl<Onglet>(ONGLETS, 'tout');
    const [file, setFile] = useState<ElementAValider[] | null>(null);
    const [ouvert, setOuvert] = useState<ElementAValider | null>(null);

    const charger = useCallback(async () => {
        const r = await fileValidationAction();
        if (r.success) setFile(r.data);
        else { setFile([]); toast({ title: 'File de validation indisponible', description: r.error, variant: 'destructive' }); }
    }, [toast]);
    useEffect(() => { if (isContratheque) charger(); }, [isContratheque, charger]);

    const compte = useMemo(() => Object.fromEntries(TYPES_VALIDATION.map(t => [t, (file ?? []).filter(e => e.type === t).length])) as Record<TypeValidation, number>, [file]);
    const lignes = useMemo(() => (file ?? []).filter(e => onglet === 'tout' || e.type === onglet), [file, onglet]);

    const colonnes: Colonne<ElementAValider>[] = useMemo(() => [
        ...(onglet === 'tout' ? [{ id: 'type', label: 'Type', tri: (r: ElementAValider) => LIBELLE_UNITAIRE[r.type], cell: (r: ElementAValider) => <Badge variant="outline">{LIBELLE_UNITAIRE[r.type]}</Badge> }] : []),
        { id: 'contrat', label: 'Contrat', fixe: true, tri: r => r.contractNumber, cell: r => <Link href={`/contracts/${r.contractId}`} className="font-mono text-xs underline">{r.contractNumber}</Link> },
        { id: 'client', label: 'Client', tri: r => r.clientName, cell: r => <span className="block max-w-[200px] truncate" title={r.clientName}>{r.clientName}</span> },
        { id: 'details', label: 'Objet', cell: r => <span className="line-clamp-2 max-w-[320px] text-sm" title={r.details}>{r.details || '—'}</span> },
        { id: 'effet', label: 'Effet', tri: r => (r.effet ? new Date(r.effet) : null), cell: r => jour(r.effet) },
        { id: 'demande', label: 'Demandé', tri: r => (r.demandeLe ? new Date(r.demandeLe) : null), cell: r => <span className="text-sm">{jour(r.demandeLe)}<span className="block text-xs text-muted-foreground">{r.demandePar}</span></span> },
        {
            id: 'document', label: 'Document', cell: r => r.documentUrl
                ? <a href={r.documentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-[180px] items-center gap-1 text-sm text-primary underline"><FileText className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{r.documentName ?? 'Ouvrir'}</span><ExternalLink className="h-3 w-3 shrink-0" /></a>
                : <Badge variant="destructive">Aucun document</Badge>,
        },
    ], [onglet]);

    if (!isContratheque) return <p className="text-muted-foreground">La validation des documents de contrat est réservée à la contrathèque (droit donné par un administrateur dans Utilisateurs › Rôles).</p>;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Validation des documents</h1>
                    <p className="text-muted-foreground">
                        {file === null ? 'Chargement…' : `${file.length} document(s) en attente.`} Ouvrez chaque document pour contrôler les valeurs saisies contre la pièce, puis validez ou refusez avec un motif.
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={charger}><RefreshCw className="mr-1 h-4 w-4" />Actualiser</Button>
            </div>

            <Tabs value={onglet} onValueChange={v => changerOnglet(v as Onglet)}>
                <TabsList className="h-auto flex-wrap justify-start">
                    <TabsTrigger value="tout" className="gap-1.5">Tout <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{file?.length ?? 0}</Badge></TabsTrigger>
                    {TYPES_VALIDATION.map(t => (
                        <TabsTrigger key={t} value={t} className="gap-1.5">
                            {LIBELLES_VALIDATION[t]}
                            {compte[t] > 0 && <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">{compte[t]}</Badge>}
                        </TabsTrigger>
                    ))}
                </TabsList>
            </Tabs>

            <DataTable
                id={`validations-${onglet}`}
                rows={lignes}
                rowId={r => `${r.type}-${r.id}`}
                colonnes={colonnes}
                chargement={file === null}
                recherche={{ placeholder: 'Contrat, client, objet, demandeur…', valeurs: r => [r.contractNumber, r.clientName, r.details, r.demandePar] }}
                triInitial={{ id: 'demande', sens: 'asc' }}
                vide={{ titre: onglet === 'tout' ? 'Aucun document en attente de validation.' : `${aucunUnitaire(onglet as TypeValidation)} en attente.` }}
                actions={r => (
                    <div className="flex justify-end">
                        <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setOuvert(r)}><ClipboardCheck className="h-4 w-4" />Contrôler</Button>
                    </div>
                )}
            />
            <ControleDocument element={ouvert} onClose={() => setOuvert(null)} onTraite={async () => { await Promise.all([charger(), reloadData()]); }} />
        </div>
    );
}
