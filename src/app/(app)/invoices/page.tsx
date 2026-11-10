'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, MinusCircle, MoreHorizontal } from 'lucide-react';
import { aAnnexeP1 } from '@/lib/billing/p1-annexe';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DataTable, type Colonne } from '@/components/data-table/data-table';
import type { FiltreTable } from '@/components/data-table/logique';
import { STATUTS_FACTURE, StatutFacture, eur0 } from '@/components/fiches/fiche';
import { useConfirm, usePrompt } from '@/components/confirm-provider';
import type { Invoice } from '@/lib/types';
import { useCollections, useData } from '@/context/data-context';
import { useToast } from '@/hooks/use-toast';
import { generateCreditNote } from '@/ai/flows/generate-credit-note-flow';
import { deleteProformaInvoice, updateInvoiceStatus } from '@/services/firestore';
import { convertProforma } from '@/lib/billing/actions';

/**
 * Liste des factures et proformas : recherche, filtres (statut, client, mois), tri, export ; sélection des factures
 * émises pour les annuler par un avoir (motif demandé) ; actions par facture (PDF, payée, proforma).
 */

type Ligne = Invoice & { contrat: string; retard: boolean; mois: string };

/** Jour AAAA-MM-JJ d'une date, vide si absente ou invalide (jamais d'exception). */
const jourIso = (d: unknown) => { const t = new Date(d as string); return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10); };
const moisFr = (m: string) => new Date(`${m}-01T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

export default function InvoicesPage() {
  const confirmer = useConfirm();
  const demander = usePrompt();
  const { invoices, contracts, isLoading: chargementBase, reloadData } = useData();
  // Collections volumineuses, chargées à la demande : l'écran attend qu'elles soient en mémoire.
  const pret = useCollections('invoices');
  const isLoading = chargementBase || !pret;
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);

  const lignes: Ligne[] = useMemo(() => {
    const contrat = new Map(contracts.map(c => [c.id, c.contractNumber ?? '']));
    const maintenant = Date.now();
    return invoices.map(i => ({
      ...i,
      contrat: contrat.get(i.contractId) ?? '',
      // Échue et non payée : en retard (statut « overdue » ou échéance passée).
      retard: i.status === 'overdue' || (i.status === 'due' && !!i.dueDate && new Date(i.dueDate).getTime() < maintenant),
      mois: jourIso(i.date).slice(0, 7),
    }));
  }, [invoices, contracts]);

  const colonnes: Colonne<Ligne>[] = useMemo(() => [
    {
      id: 'numero', label: 'N° de facture', fixe: true, tri: r => r.invoiceNumber ?? '', exporter: r => r.invoiceNumber ?? 'Proforma',
      cell: r => <span className="font-mono text-xs font-medium">{r.invoiceNumber || `Proforma ${r.id.substring(0, 6)}`}</span>,
    },
    { id: 'client', label: 'Client', tri: r => r.clientName, exporter: r => r.clientName, cell: r => <span className="block max-w-[240px] truncate" title={r.clientName}>{r.clientName}</span> },
    { id: 'contrat', label: 'Contrat', tri: r => r.contrat, exporter: r => r.contrat, cell: r => r.contrat ? <Link href={`/contracts/${r.contractId}`} className="font-mono text-xs hover:underline">{r.contrat}</Link> : '—' },
    {
      id: 'statut', label: 'Statut', tri: r => r.status, exporter: r => STATUTS_FACTURE[r.status] ?? r.status,
      cell: r => <span className="inline-flex items-center gap-1.5"><StatutFacture statut={r.status} />{r.retard && r.status === 'due' && <span className="text-xs font-medium text-destructive">échue</span>}</span>,
    },
    { id: 'date', label: 'Date', tri: r => new Date(r.date), exporter: r => jourIso(r.date), cell: r => (jourIso(r.date) ? new Date(r.date).toLocaleDateString('fr-FR') : '—') },
    {
      id: 'echeance', label: 'Échéance', tri: r => (r.dueDate ? new Date(r.dueDate) : null), exporter: r => jourIso(r.dueDate),
      cell: r => r.dueDate ? <span className={r.retard ? 'font-medium text-destructive' : ''}>{new Date(r.dueDate).toLocaleDateString('fr-FR')}</span> : '—',
    },
    { id: 'ht', label: 'HT', align: 'right', masquee: true, tri: r => Number(r.subtotal) || 0, exporter: r => r.subtotal, cell: r => eur0(Number(r.subtotal) || 0) },
    { id: 'ttc', label: 'TTC', align: 'right', tri: r => Number(r.total) || 0, exporter: r => r.total, cell: r => <span className="font-medium">{eur0(Number(r.total) || 0)}</span> },
  ], []);

  const filtres: FiltreTable<Ligne>[] = useMemo(() => [
    { id: 'statut', label: 'Statut', valeur: r => (r.retard && r.status === 'due' ? 'overdue' : r.status), libelle: v => STATUTS_FACTURE[v] ?? v },
    { id: 'client', label: 'Client', valeur: r => r.clientName },
    { id: 'mois', label: 'Mois', valeur: r => r.mois, libelle: moisFr },
  ], []);

  const recherche = useMemo(() => ({
    placeholder: 'N° de facture, client, contrat…',
    valeurs: (r: Ligne) => [r.invoiceNumber, r.clientName, r.contrat, r.id],
  }), []);

  const annulerParAvoir = async (selection: Ligne[], vider: () => void) => {
    const motif = await demander({
      title: `Annuler ${selection.length} facture(s) par un avoir`,
      description: `${selection.map(f => f.invoiceNumber).join(', ')}. Le motif figure sur l'avoir (document légal, numéroté et archivé).`,
      label: "Motif de l'avoir", required: true, multiline: true, placeholder: 'Erreur de période, double facturation…', confirmLabel: "Générer l'avoir",
    });
    if (motif === null) return;
    setIsGenerating(true);
    try {
      const result = await generateCreditNote({ invoiceIds: selection.map(f => f.id), reason: motif, creditNoteDate: new Date().toISOString() });
      if (result.success && result.creditNoteId) {
        toast({ title: "Avoir généré", description: `L'avoir ${result.creditNoteNumber || result.creditNoteId} a été créé.` });
        vider();
        await reloadData(['invoices', 'creditNotes']);
      } else {
        throw new Error(result.error || "Une erreur inconnue est survenue lors de la création de l'avoir.");
      }
    } catch (error) {
      toast({ title: "Erreur de génération", description: error instanceof Error ? error.message : String(error), variant: 'destructive', duration: 10000 });
    } finally {
      setIsGenerating(false);
    }
  };

  const marquerPayee = async (invoice: Ligne) => {
    if (!(await confirmer({ title: `Marquer ${invoice.invoiceNumber} comme payée ?`, description: `${eur0(Number(invoice.total) || 0)} TTC, ${invoice.clientName}.`, confirmLabel: 'Marquer payée' }))) return;
    try {
      await updateInvoiceStatus(invoice.id, 'paid');
      toast({ title: 'Facture payée', description: `${invoice.invoiceNumber} est marquée payée.` });
      await reloadData(['invoices']);
    } catch {
      toast({ title: 'Erreur', description: 'Impossible de mettre à jour le statut.', variant: 'destructive' });
    }
  };

  const handleConvertProforma = async (invoiceId: string) => {
    if (!(await confirmer({ title: 'Convertir ce proforma en facture définitive ?', description: 'Un numéro lui sera attribué et elle ne pourra plus être supprimée.', confirmLabel: 'Convertir' }))) return;
    const result = await convertProforma(invoiceId);
    if (result.success) {
      toast({ title: "Facture émise", description: `Numéro attribué : ${result.invoiceNumber}.` });
      await reloadData(['invoices']);
    } else {
      toast({ title: "Conversion impossible", description: result.error, variant: 'destructive' });
    }
  };

  const handleDeleteProforma = async (invoice: Invoice) => {
    if (!(await confirmer({ title: 'Supprimer ce proforma ?', confirmLabel: 'Supprimer', destructive: true }))) return;
    try {
      await deleteProformaInvoice(invoice);
      toast({ title: "Proforma supprimé" });
      await reloadData(['invoices']);
    } catch (error) {
      toast({ title: "Suppression impossible", description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Factures</h1>
        <p className="text-muted-foreground">
          Factures et proformas. Une facture émise ne se supprime pas : sélectionnez-la pour l&apos;annuler par un avoir.
        </p>
      </div>
      <DataTable
        id="factures"
        rows={lignes}
        rowId={r => r.id}
        colonnes={colonnes}
        chargement={isLoading}
        recherche={recherche}
        filtres={filtres}
        triInitial={{ id: 'date', sens: 'desc' }}
        lien={r => `/invoices/${r.id}`}
        export={{ fichier: 'factures.csv' }}
        vide={{ titre: 'Aucune facture.', description: 'Les factures se génèrent depuis Facturation manuelle ou Facturation groupée.' }}
        selection={{
          possible: r => r.status !== 'proforma' && r.status !== 'cancelled',
          actions: (selection, vider) => (
            <Button size="sm" className="h-8 gap-1" onClick={() => annulerParAvoir(selection as Ligne[], vider)} disabled={isGenerating}>
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <MinusCircle className="h-4 w-4" />}
              Annuler par un avoir
            </Button>
          ),
        }}
        actions={invoice => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Actions pour ${invoice.invoiceNumber ?? 'le proforma'}`}><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem asChild><Link href={`/invoices/${invoice.id}`}>Voir les détails</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><a href={`/api/documents/invoices/${invoice.id}`} target="_blank" rel="noopener noreferrer">Ouvrir le PDF</a></DropdownMenuItem>
              {aAnnexeP1(invoice.lineItems) && <DropdownMenuItem asChild><a href={`/api/documents/invoices/${invoice.id}/annexe`} target="_blank" rel="noopener noreferrer">Annexe P1 (PDF)</a></DropdownMenuItem>}
              {aAnnexeP1(invoice.lineItems) && <DropdownMenuItem asChild><a href={`/api/documents/invoices/${invoice.id}/annexe?format=xlsx`}>Annexe P1 (tableur)</a></DropdownMenuItem>}
              {(invoice.status === 'due' || invoice.status === 'overdue') && <DropdownMenuItem onClick={() => marquerPayee(invoice)}>Marquer comme payée</DropdownMenuItem>}
              {invoice.status === 'proforma' && (<>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleConvertProforma(invoice.id)}>Convertir en facture</DropdownMenuItem>
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDeleteProforma(invoice)}>Supprimer le proforma</DropdownMenuItem>
              </>)}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />
    </div>
  );
}
