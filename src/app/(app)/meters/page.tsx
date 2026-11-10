'use client';

import Link from 'next/link';
import { DataTable, type Colonne } from '@/components/data-table/data-table';
import type { FiltreTable } from '@/components/data-table/logique';
import { useConfirm } from '@/components/confirm-provider';
import { optionsSites } from '@/lib/select-options';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { PlusCircle, Edit, Trash2, BookOpen, Loader2, Search, Download, Gauge } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { createMeter, updateMeter, deleteMeter } from '@/services/firestore';
import type { Meter } from '@/lib/types';
import { MeterReadingsDialog } from '@/components/meter-readings-dialog';
import { P1CompteurDialog } from '@/components/p1/p1-parametrage-panel';
import { Badge } from '@/components/ui/badge';
import { useCollections, useData } from '@/context/data-context';
import { downloadCSV } from '@/lib/utils';

export default function MetersPage() {
  const { sites, meters, meterTypes, meterReadings, reloadData, isLoading: chargementBase } = useData();
  // Collections volumineuses, chargées à la demande : l'écran attend qu'elles soient en mémoire.
  const pret = useCollections('meters', 'meterReadings');
  const isLoading = chargementBase || !pret;
  const confirmer = useConfirm();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMeter, setEditingMeter] = useState<Meter | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [reference, setReference] = useState('');
  const [siteId, setSiteId] = useState('');
  const [meterTypeId, setMeterTypeId] = useState<string | undefined>(undefined);
  const [location, setLocation] = useState('');
  const [status, setStatus] = useState<'on' | 'off'>('on');

  const resetForm = () => {
    setCode('');
    setName('');
    setReference('');
    setSiteId('');
    setMeterTypeId(undefined);
    setLocation('');
    setStatus('on');
    setEditingMeter(null);
  };

  const handleOpenDialog = (meter: Meter | null = null) => {
    resetForm();
    if (meter) {
      setEditingMeter(meter);
      setCode(meter.code);
      setName(meter.name);
      setReference(meter.reference || '');
      setSiteId(meter.siteId);
      const foundMeterType = meterTypes.find(mt => mt.label === meter.type && mt.unit === meter.unit);
      setMeterTypeId(foundMeterType?.id);
      setLocation(meter.location || '');
      setStatus(meter.status);
    }
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const selectedMeterType = meterTypes.find(mt => mt.id === meterTypeId);

    if (!name.trim() || !siteId || !selectedMeterType) {
      toast({ title: 'Erreur', description: 'Veuillez remplir tous les champs requis.', variant: 'destructive' });
      return;
    }

    setIsSubmitting(true);
    const meterData: Partial<Omit<Meter, 'id' | 'code'>> = {
      name,
      reference,
      siteId,
      type: selectedMeterType.label,
      unit: selectedMeterType.unit,
      location,
      status,
      lastModified: new Date().toISOString(),
      modifiedBy: 'Admin User', // Placeholder
    };

    try {
      if (editingMeter) {
        await updateMeter(editingMeter.id, meterData);
        toast({ title: 'Compteur mis à jour', description: 'Le compteur a été mis à jour avec succès.' });
      } else {
        await createMeter(meterData as Omit<Meter, 'id' | 'code'>);
        toast({ title: 'Compteur créé', description: 'Le nouveau compteur a été ajouté avec succès.' });
      }
      await reloadData(['meters', 'meterReadings']);
      setDialogOpen(false);
      resetForm();
    } catch (error) {
      toast({ title: 'Erreur', description: "L'opération a échoué.", variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (meter: Meter) => {
    if (!(await confirmer({ title: `Supprimer le compteur ${meter.code} ?`, description: 'Action irréversible : ses relevés ne seront plus rattachés à un compteur existant.', confirmLabel: 'Supprimer', destructive: true }))) return;
    try {
      await deleteMeter(meter.id);
      toast({ title: 'Compteur supprimé', description: `${meter.code} a été supprimé.` });
      await reloadData(['meters', 'meterReadings']);
    } catch (error) {
      toast({ title: 'Erreur', description: 'Impossible de supprimer le compteur.', variant: 'destructive' });
    }
  };

  type Ligne = Meter & { site: string; client: string; dernierReleve: string | null };
  const lignes: Ligne[] = useMemo(() => {
    const siteMap = new Map(sites.map(s => [s.id, s]));
    const derniers = new Map<string, string>();
    for (const r of meterReadings) {
      const d = derniers.get(r.meterId);
      if (!d || Date.parse(r.date) > Date.parse(d)) derniers.set(r.meterId, r.date);
    }
    return meters.map(m => ({
      ...m,
      site: siteMap.get(m.siteId)?.name ?? m.siteName ?? '',
      client: siteMap.get(m.siteId)?.clientName ?? m.clientName ?? '',
      dernierReleve: derniers.get(m.id) ?? null,
    }));
  }, [meters, sites, meterReadings]);

  const ancien = (r: Ligne) => r.status !== 'off' && (!r.dernierReleve || Date.parse(r.dernierReleve) < Date.now() - 45 * 86_400_000);
  const colonnes: Colonne<Ligne>[] = useMemo(() => [
    { id: 'code', label: 'Code', fixe: true, tri: r => r.code, exporter: r => r.code, cell: r => <span className="font-mono text-xs font-medium">{r.code}</span> },
    { id: 'nom', label: 'Nom', tri: r => r.name, exporter: r => r.name, cell: r => r.name },
    { id: 'reference', label: 'PDL / PCE', tri: r => r.reference, exporter: r => r.reference, cell: r => r.reference || '—' },
    { id: 'site', label: 'Site', tri: r => r.site, exporter: r => r.site, cell: r => r.siteId ? <Link href={`/sites/${r.siteId}?onglet=compteurs`} className="hover:underline">{r.site || '—'}</Link> : '—' },
    { id: 'client', label: 'Client', tri: r => r.client, exporter: r => r.client, cell: r => r.client || '—' },
    { id: 'type', label: 'Type', tri: r => r.type, exporter: r => r.type, cell: r => r.type || '—' },
    { id: 'unite', label: 'Unité', tri: r => r.unit, exporter: r => r.unit, cell: r => r.unit || '—' },
    {
      id: 'releve', label: 'Dernier relevé', tri: r => (r.dernierReleve ? new Date(r.dernierReleve) : null), exporter: r => r.dernierReleve?.slice(0, 10),
      cell: r => <span className={ancien(r) ? 'font-medium text-amber-700' : ''}>{r.dernierReleve ? new Date(r.dernierReleve).toLocaleDateString('fr-FR') : 'Jamais relevé'}</span>,
    },
    {
      id: 'statut', label: 'Statut', tri: r => r.status, exporter: r => (r.status === 'off' ? 'Hors service' : 'En service'),
      cell: r => <Badge variant={r.status === 'off' ? 'outline' : 'secondary'}>{r.status === 'off' ? 'Hors service' : 'En service'}</Badge>,
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  const filtres: FiltreTable<Ligne>[] = useMemo(() => [
    { id: 'statut', label: 'Statut', valeur: r => r.status ?? 'on', options: [{ value: 'on', label: 'En service' }, { value: 'off', label: 'Hors service' }] },
    { id: 'releve', label: 'Relevé', valeur: r => (r.status === 'off' ? 'hs' : ancien(r) ? 'ancien' : 'recent'),
      options: [{ value: 'recent', label: 'Relevé depuis moins de 45 j' }, { value: 'ancien', label: 'Sans relevé depuis 45 j' }, { value: 'hs', label: 'Hors service' }] },
    { id: 'type', label: 'Type', valeur: r => r.type },
    { id: 'client', label: 'Client', valeur: r => r.client },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  const recherche = useMemo(() => ({
    placeholder: 'Code, nom, PDL/PCE, site, client…', parametreUrl: 'q',
    valeurs: (r: Ligne) => [r.code, r.name, r.reference, r.site, r.client, r.externalRef],
  }), []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Compteurs</h1>
        <p className="text-muted-foreground">Compteurs de tous les sites, leurs relevés et leur paramétrage P1.</p>
      </div>
      <DataTable
        id="compteurs"
        rows={lignes}
        rowId={r => r.id}
        colonnes={colonnes}
        chargement={isLoading}
        recherche={recherche}
        filtres={filtres}
        triInitial={{ id: 'code', sens: 'asc' }}
        export={{ fichier: 'compteurs.csv' }}
        boutons={<Button size="sm" className="h-9 gap-1" onClick={() => handleOpenDialog()}><PlusCircle className="h-4 w-4" />Nouveau compteur</Button>}
        vide={{ titre: 'Aucun compteur.', description: 'Ajoutez un compteur ou importez vos compteurs (Administration › Imports).' }}
        actions={meter => (
          <div className="flex items-center justify-end">
            <MeterReadingsDialog meter={meter} trigger={<Button variant="ghost" size="icon" className="h-8 w-8" title="Relevés" aria-label="Relevés"><BookOpen className="h-4 w-4" /></Button>} />
            <P1CompteurDialog meterId={meter.id} trigger={<Button variant="ghost" size="icon" className="h-8 w-8" title="Paramétrage P1 (usage, énergie, QE…)" aria-label="Paramétrage P1"><Gauge className="h-4 w-4" /></Button>} />
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(meter)} title="Modifier" aria-label="Modifier"><Edit className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(meter)} title="Supprimer" aria-label="Supprimer"><Trash2 className="h-4 w-4" /></Button>
          </div>
        )}
      />

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{editingMeter ? 'Modifier le compteur' : 'Nouveau compteur'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              {editingMeter && (
                <div className="space-y-2">
                  <Label htmlFor="code">Code Compteur</Label>
                  <Input id="code" value={code} required disabled />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="name">Nom</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reference">Référence (PDL/PCE)</Label>
                <Input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ex: 0123456789" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="siteId">Site</Label>
                <SearchableSelect id="siteId" value={siteId} onValueChange={setSiteId} options={optionsSites(sites)} placeholder="Sélectionner un site..." searchPlaceholder="Nom, code SIT, client, ville…" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="meterTypeId">Type de Compteur</Label>
                <Select onValueChange={setMeterTypeId} value={meterTypeId} required>
                  <SelectTrigger><SelectValue placeholder="Sélectionner un type..." /></SelectTrigger>
                  <SelectContent>
                    {meterTypes.map(mt => <SelectItem key={mt.id} value={mt.id}>{mt.label} ({mt.code}) - {mt.unit}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="location">Localisation</Label>
                <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Ex: Local technique RDC" />
              </div>
              <div className="space-y-2">
                <Label>Statut</Label>
                <RadioGroup onValueChange={(v) => setStatus(v as 'on' | 'off')} value={status} className="flex gap-4 pt-2">
                  <div className="flex items-center space-x-2"><RadioGroupItem value="on" id="on" /><Label htmlFor="on" className="font-normal">Allumé</Label></div>
                  <div className="flex items-center space-x-2"><RadioGroupItem value="off" id="off" /><Label htmlFor="off" className="font-normal">Éteint</Label></div>
                </RadioGroup>
              </div>

              <DialogFooter>
                <DialogClose asChild><Button type="button" variant="outline">Annuler</Button></DialogClose>
                <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Enregistrement...' : 'Enregistrer'}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
    </div>
  );
}
