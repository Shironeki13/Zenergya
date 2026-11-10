'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { FileDown, FileSpreadsheet, PlusCircle } from 'lucide-react';
import { aAnnexeP1 } from '@/lib/billing/p1-annexe';
import { Button } from '@/components/ui/button';
import { DataTable, type Colonne } from '@/components/data-table/data-table';
import type { FiltreTable } from '@/components/data-table/logique';
import { eur0 } from '@/components/fiches/fiche';
import { useData } from '@/context/data-context';
import type { CreditNote } from '@/lib/types';

/** Liste des avoirs émis : recherche, filtres (client, mois), tri, export, PDF (tableau commun). */

type Ligne = CreditNote & { factures: string; mois: string };

const jourIso = (d: unknown) => { const t = new Date(d as string); return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10); };
const moisFr = (m: string) => new Date(`${m}-01T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

export default function CreditNotesPage() {
  const { creditNotes, invoices, isLoading } = useData();

  const lignes: Ligne[] = useMemo(() => {
    const numero = new Map(invoices.map(i => [i.id, i.invoiceNumber ?? i.id]));
    return creditNotes.map(cn => ({
      ...cn,
      factures: (cn.originalInvoiceIds ?? []).map(id => numero.get(id) ?? id).join(', '),
      mois: jourIso(cn.date).slice(0, 7),
    }));
  }, [creditNotes, invoices]);

  const colonnes: Colonne<Ligne>[] = useMemo(() => [
    { id: 'numero', label: "N° d'avoir", fixe: true, tri: r => r.creditNoteNumber, exporter: r => r.creditNoteNumber, cell: r => <span className="font-mono text-xs font-medium">{r.creditNoteNumber}</span> },
    { id: 'client', label: 'Client', tri: r => r.clientName, exporter: r => r.clientName, cell: r => r.clientName },
    { id: 'factures', label: 'Factures annulées', tri: r => r.factures, exporter: r => r.factures, cell: r => <span className="font-mono text-xs">{r.factures || '—'}</span> },
    { id: 'motif', label: 'Motif', tri: r => r.reason, exporter: r => r.reason, cell: r => <span className="line-clamp-1 max-w-[320px]" title={r.reason}>{r.reason || '—'}</span> },
    { id: 'date', label: 'Date', tri: r => (jourIso(r.date) ? new Date(r.date) : null), exporter: r => jourIso(r.date), cell: r => (jourIso(r.date) ? new Date(r.date).toLocaleDateString('fr-FR') : '—') },
    { id: 'ttc', label: 'TTC', align: 'right', tri: r => Number(r.total) || 0, exporter: r => r.total, cell: r => <span className="font-medium text-destructive">{eur0(Number(r.total) || 0)}</span> },
  ], []);

  const filtres: FiltreTable<Ligne>[] = useMemo(() => [
    { id: 'client', label: 'Client', valeur: r => r.clientName },
    { id: 'mois', label: 'Mois', valeur: r => r.mois, libelle: moisFr },
  ], []);

  const recherche = useMemo(() => ({
    placeholder: "N° d'avoir, client, facture, motif…",
    valeurs: (r: Ligne) => [r.creditNoteNumber, r.clientName, r.factures, r.reason],
  }), []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Avoirs</h1>
        <p className="text-muted-foreground">Avoirs émis. Pour en créer un : sélectionnez les factures à annuler dans la liste des factures.</p>
      </div>
      <DataTable
        id="avoirs"
        rows={lignes}
        rowId={r => r.id}
        colonnes={colonnes}
        chargement={isLoading}
        recherche={recherche}
        filtres={filtres}
        triInitial={{ id: 'date', sens: 'desc' }}
        export={{ fichier: 'avoirs.csv' }}
        boutons={<Button asChild size="sm" className="h-9 gap-1"><Link href="/invoices"><PlusCircle className="h-4 w-4" />Créer un avoir</Link></Button>}
        vide={{ titre: 'Aucun avoir.', description: 'Un avoir annule une ou plusieurs factures émises (liste des factures, sélection).' }}
        actions={cn => (
          <div className="flex justify-end">
            {!(cn.originalInvoiceIds ?? []).length && aAnnexeP1(cn.lineItems) && (
              <Button variant="ghost" size="icon" className="h-8 w-8" asChild title="Annexe P1 (tableur)">
                <a href={`/api/documents/credit-notes/${cn.id}/annexe?format=xlsx`} aria-label={`Annexe P1 de l'avoir ${cn.creditNoteNumber} (tableur)`}><FileSpreadsheet className="h-4 w-4" /></a>
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" asChild title="Ouvrir le PDF">
              <a href={`/api/documents/credit-notes/${cn.id}`} target="_blank" rel="noopener noreferrer" aria-label={`PDF de l'avoir ${cn.creditNoteNumber}`}><FileDown className="h-4 w-4" /></a>
            </Button>
          </div>
        )}
      />
    </div>
  );
}
