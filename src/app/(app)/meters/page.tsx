
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { PlusCircle, Edit, Trash2, BookOpen, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { createMeter, updateMeter, deleteMeter, getMeterReadingsByMeter, getMeters, getSites } from '@/services/firestore';
import type { Meter, MeterReading, Site } from '@/lib/types';
import { Badge } from '@/components/ui/badge';

export default function MetersPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMeter, setEditingMeter] = useState<Meter | null>(null);
  const [meterToDelete, setMeterToDelete] = useState<Meter | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [siteId, setSiteId] = useState('');
  const [type, setType] = useState('');
  const [unit, setUnit] = useState('');
  const [location, setLocation] = useState('');
  const [status, setStatus] = useState<'on' | 'off'>('on');
  
  // Readings Dialog state
  const [readingsDialogOpen, setReadingsDialogOpen] = useState(false);
  const [selectedMeterForReadings, setSelectedMeterForReadings] = useState<Meter | null>(null);
  const [meterReadings, setMeterReadings] = useState<MeterReading[]>([]);
  const [isLoadingReadings, setIsLoadingReadings] = useState(false);

  const reloadData = async () => {
    try {
        const metersData = await getMeters();
        setMeters(metersData);
    } catch (error) {
        toast({ title: 'Erreur', description: 'Impossible de recharger les compteurs.', variant: 'destructive' });
    }
  };

  useEffect(() => {
    async function fetchData() {
        try {
            const [sitesData, metersData] = await Promise.all([getSites(), getMeters()]);
            setSites(sitesData);
            setMeters(metersData);
        } catch (error) {
            toast({ title: 'Erreur', description: 'Impossible de charger les données de la page.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }
    fetchData();
  }, [toast]);


  const resetForm = () => {
    setCode('');
    setName('');
    setSiteId('');
    setType('');
    setUnit('');
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
      setSiteId(meter.siteId);
      setType(meter.type);
      setUnit(meter.unit);
      setLocation(meter.location || '');
      setStatus(meter.status);
    }
    setDialogOpen(true);
  };
  
  const handleOpenReadingsDialog = async (meter: Meter) => {
    setSelectedMeterForReadings(meter);
    setReadingsDialogOpen(true);
    setIsLoadingReadings(true);
    try {
        const readings = await getMeterReadingsByMeter(meter.id);
        setMeterReadings(readings);
    } catch (error) {
        toast({ title: 'Erreur', description: 'Impossible de charger les relevés.', variant: 'destructive' });
    } finally {
        setIsLoadingReadings(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !siteId || !type.trim() || !unit.trim()) return;

    setIsSubmitting(true);
    const meterData: Partial<Omit<Meter, 'id' | 'code'>> = {
      name,
      siteId,
      type,
      unit,
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
      await reloadData();
      setDialogOpen(false);
      resetForm();
    } catch (error) {
      toast({ title: 'Erreur', description: "L'opération a échoué.", variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!meterToDelete) return;
    try {
      await deleteMeter(meterToDelete.id);
      toast({ title: 'Compteur supprimé', description: 'Le compteur a été supprimé avec succès.' });
      await reloadData();
      setMeterToDelete(null);
    } catch (error) {
      toast({ title: 'Erreur', description: 'Impossible de supprimer le compteur.', variant: 'destructive' });
    }
  };
  
  const metersWithDetails = useMemo(() => {
    const siteMap = new Map(sites.map(s => [s.id, { name: s.name, clientName: s.clientName }]));
    return meters.map(meter => ({
      ...meter,
      siteName: siteMap.get(meter.siteId)?.name || 'N/A',
      clientName: siteMap.get(meter.siteId)?.clientName || 'N/A',
    }));
  }, [meters, sites]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Compteurs</CardTitle>
            <CardDescription>Gérez l'ensemble de vos compteurs et de leurs relevés.</CardDescription>
          </div>
          <Button size="sm" className="gap-1" onClick={() => handleOpenDialog()}>
            <PlusCircle className="h-4 w-4" />
            Nouveau Compteur
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Nom</TableHead>
              <TableHead>Site</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Unité</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="h-24 text-center">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
              </TableCell></TableRow>
            ) : meters.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="h-24 text-center">Aucun compteur trouvé.</TableCell></TableRow>
            ) : (
              metersWithDetails.map((meter) => (
                <TableRow key={meter.id}>
                  <TableCell className="font-medium">{meter.code}</TableCell>
                  <TableCell>{meter.name}</TableCell>
                  <TableCell>{meter.siteName}</TableCell>
                  <TableCell>{meter.clientName}</TableCell>
                  <TableCell>{meter.type}</TableCell>
                  <TableCell>{meter.unit}</TableCell>
                  <TableCell>
                     <Badge variant={meter.status === 'on' ? 'secondary' : 'destructive'}>
                        {meter.status === 'on' ? 'Allumé' : 'Éteint'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenReadingsDialog(meter)} title="Voir les relevés">
                      <BookOpen className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(meter)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Dialog open={!!meterToDelete && meterToDelete.id === meter.id} onOpenChange={(isOpen) => !isOpen && setMeterToDelete(null)}>
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setMeterToDelete(meter)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Supprimer {meterToDelete?.name}?</DialogTitle>
                          <DialogDescription>Cette action est irréversible et supprimera également tous les relevés associés.</DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setMeterToDelete(null)}>Annuler</Button>
                          <Button variant="destructive" onClick={handleDelete}>Confirmer</Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

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
                <Label htmlFor="siteId">Site</Label>
                <Select onValueChange={setSiteId} value={siteId} required>
                    <SelectTrigger><SelectValue placeholder="Sélectionner un site..." /></SelectTrigger>
                    <SelectContent>
                        {sites.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <Label htmlFor="type">Type</Label>
                    <Input id="type" value={type} onChange={(e) => setType(e.target.value)} required placeholder="Ex: Chauffage, ECS..."/>
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="unit">Unité</Label>
                    <Input id="unit" value={unit} onChange={(e) => setUnit(e.target.value)} required placeholder="Ex: kWh, m3..."/>
                </div>
              </div>
              <div className="space-y-2">
                    <Label htmlFor="location">Localisation</Label>
                    <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Ex: Local technique RDC"/>
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
        
        <Dialog open={readingsDialogOpen} onOpenChange={setReadingsDialogOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Relevés pour {selectedMeterForReadings?.name}</DialogTitle>
                    <DialogDescription>Historique des relevés enregistrés pour ce compteur.</DialogDescription>
                </DialogHeader>
                <div className="max-h-96 overflow-y-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead className="text-right">Relevé</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoadingReadings ? (
                                <TableRow><TableCell colSpan={2} className="h-24 text-center">Chargement des relevés...</TableCell></TableRow>
                            ) : meterReadings.length === 0 ? (
                                <TableRow><TableCell colSpan={2} className="h-24 text-center">Aucun relevé pour ce compteur.</TableCell></TableRow>
                            ) : (
                                meterReadings.map(reading => (
                                    <TableRow key={reading.id}>
                                        <TableCell>{new Date(reading.date).toLocaleDateString()}</TableCell>
                                        <TableCell className="text-right">{reading.reading} {reading.unit}</TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
