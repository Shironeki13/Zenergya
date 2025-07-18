'use client';
import React, { useState, useEffect, useOptimistic, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlusCircle, Trash2, Edit } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

import { 
  createCompany, getCompanies, 
  createAgency, getAgencies, 
  createSector, getSectors, 
  createActivity, getActivities 
} from "@/services/firestore";
import type { Company, Agency, Sector, Activity } from "@/lib/types";

// Section simple pour Sociétés et Activités
const SimpleSettingsSection: React.FC<{
  title: string;
  description: string;
  fetchItems: () => Promise<{ id: string; name: string }[]>;
  createItem: (name: string) => Promise<any>;
}> = ({ title, description, fetchItems, createItem }) => {
  const [items, setItems] = useState<{ id: string; name: string }[]>([]);
  const [newItemName, setNewItemName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const loadItems = useCallback(async () => {
    try {
      setIsLoading(true);
      const fetchedItems = await fetchItems();
      setItems(fetchedItems);
    } catch (error) {
      console.error(`Failed to fetch ${title}:`, error);
      toast({ title: "Erreur", description: `Impossible de charger les ${description}.`, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [fetchItems, title, description, toast]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) return;

    try {
      await createItem(newItemName);
      setNewItemName("");
      toast({ title: "Succès", description: `${title.slice(0,-1)} créé avec succès.` });
      await loadItems(); // Re-fetch
    } catch (error) {
      console.error(`Failed to create ${title}:`, error);
      toast({ title: "Erreur", description: `Impossible de créer le ${title.toLowerCase().slice(0,-1)}.`, variant: "destructive" });
    }
  };
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Gérez vos {description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleCreate} className="flex items-center gap-2">
          <Input 
            placeholder={`Nom de la nouvelle ${description.toLowerCase().slice(0, -1)}...`} 
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
          />
          <Button type="submit" size="sm" className="gap-1">
            <PlusCircle className="h-4 w-4" />
            Créer
          </Button>
        </form>
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={2} className="text-center">Chargement...</TableCell></TableRow>
              ) : items.length === 0 ? (
                <TableRow><TableCell colSpan={2} className="text-center">Aucun élément trouvé.</TableCell></TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="text-right">
                       <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Edit className="h-4 w-4" />
                       </Button>
                       <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                       </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};

// Section pour les Agences
const AgenciesSection = () => {
    const [agencies, setAgencies] = useState<Agency[]>([]);
    const [companies, setCompanies] = useState<Company[]>([]);
    const [selectedCompany, setSelectedCompany] = useState<string>('');
    const [newAgencyName, setNewAgencyName] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();

    const loadData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [fetchedAgencies, fetchedCompanies] = await Promise.all([getAgencies(), getCompanies()]);
            setAgencies(fetchedAgencies);
            setCompanies(fetchedCompanies);
        } catch (error) {
            console.error("Failed to fetch data for agencies:", error);
            toast({ title: "Erreur", description: "Impossible de charger les agences et sociétés.", variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newAgencyName.trim() || !selectedCompany) {
            toast({ title: "Erreur", description: "Veuillez sélectionner une société et donner un nom à l'agence.", variant: "destructive" });
            return;
        }
        try {
            await createAgency(newAgencyName, selectedCompany);
            setNewAgencyName('');
            setSelectedCompany('');
            toast({ title: "Succès", description: "Agence créée avec succès." });
            await loadData();
        } catch (error) {
            console.error("Failed to create agency:", error);
            toast({ title: "Erreur", description: "Impossible de créer l'agence.", variant: "destructive" });
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Agences</CardTitle>
                <CardDescription>Gérez vos agences et leur rattachement aux sociétés.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <form onSubmit={handleCreate} className="flex items-end gap-2">
                    <div className='flex-1 space-y-2'>
                        <label className='text-sm font-medium'>Société</label>
                        <Select onValueChange={setSelectedCompany} value={selectedCompany}>
                            <SelectTrigger>
                                <SelectValue placeholder="Sélectionner une société" />
                            </SelectTrigger>
                            <SelectContent>
                                {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className='flex-1 space-y-2'>
                        <label className='text-sm font-medium'>Nom de la nouvelle agence</label>
                        <Input placeholder="Nom de l'agence..." value={newAgencyName} onChange={e => setNewAgencyName(e.target.value)} />
                    </div>
                    <Button type="submit" size="sm" className="gap-1 self-end h-10">
                        <PlusCircle className="h-4 w-4" /> Créer
                    </Button>
                </form>
                <div className="border rounded-md">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Agence</TableHead>
                                <TableHead>Société</TableHead>
                                <TableHead className="w-[100px] text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow><TableCell colSpan={3} className="text-center">Chargement...</TableCell></TableRow>
                            ) : agencies.length === 0 ? (
                                <TableRow><TableCell colSpan={3} className="text-center">Aucune agence trouvée.</TableCell></TableRow>
                            ) : (
                                agencies.map(agency => (
                                    <TableRow key={agency.id}>
                                        <TableCell className="font-medium">{agency.name}</TableCell>
                                        <TableCell>{agency.companyName}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" className="h-8 w-8"><Edit className="h-4 w-4" /></Button>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
};

// Section pour les Secteurs
const SectorsSection = () => {
    const [sectors, setSectors] = useState<Sector[]>([]);
    const [agencies, setAgencies] = useState<Agency[]>([]);
    const [selectedAgency, setSelectedAgency] = useState<string>('');
    const [newSectorName, setNewSectorName] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();

    const loadData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [fetchedSectors, fetchedAgencies] = await Promise.all([getSectors(), getAgencies()]);
            setSectors(fetchedSectors);
            setAgencies(fetchedAgencies);
        } catch (error) {
            console.error("Failed to fetch data for sectors:", error);
            toast({ title: "Erreur", description: "Impossible de charger les secteurs et agences.", variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newSectorName.trim() || !selectedAgency) {
            toast({ title: "Erreur", description: "Veuillez sélectionner une agence et donner un nom au secteur.", variant: "destructive" });
            return;
        }
        try {
            await createSector(newSectorName, selectedAgency);
            setNewSectorName('');
            setSelectedAgency('');
            toast({ title: "Succès", description: "Secteur créé avec succès." });
            await loadData();
        } catch (error) {
            console.error("Failed to create sector:", error);
            toast({ title: "Erreur", description: "Impossible de créer le secteur.", variant: "destructive" });
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Secteurs</CardTitle>
                <CardDescription>Gérez vos secteurs et leur rattachement aux agences.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <form onSubmit={handleCreate} className="flex items-end gap-2">
                    <div className='flex-1 space-y-2'>
                        <label className='text-sm font-medium'>Agence</label>
                        <Select onValueChange={setSelectedAgency} value={selectedAgency}>
                            <SelectTrigger>
                                <SelectValue placeholder="Sélectionner une agence" />
                            </SelectTrigger>
                            <SelectContent>
                                {agencies.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.companyName})</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                     <div className='flex-1 space-y-2'>
                        <label className='text-sm font-medium'>Nom du nouveau secteur</label>
                        <Input placeholder="Nom du secteur..." value={newSectorName} onChange={e => setNewSectorName(e.target.value)} />
                    </div>
                    <Button type="submit" size="sm" className="gap-1 self-end h-10">
                        <PlusCircle className="h-4 w-4" /> Créer
                    </Button>
                </form>
                <div className="border rounded-md">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Secteur</TableHead>
                                <TableHead>Agence</TableHead>
                                <TableHead className="w-[100px] text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow><TableCell colSpan={3} className="text-center">Chargement...</TableCell></TableRow>
                            ) : sectors.length === 0 ? (
                                <TableRow><TableCell colSpan={3} className="text-center">Aucun secteur trouvé.</TableCell></TableRow>
                            ) : (
                                sectors.map(sector => (
                                    <TableRow key={sector.id}>
                                        <TableCell className="font-medium">{sector.name}</TableCell>
                                        <TableCell>{sector.agencyName}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" className="h-8 w-8"><Edit className="h-4 w-4" /></Button>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
};

export default function SettingsPage() {
  return (
    <div className="space-y-6">
       <div>
        <h1 className="text-lg font-medium">Paramétrage</h1>
        <p className="text-sm text-muted-foreground">
          Configurez les entités de votre organisation.
        </p>
      </div>
      <Tabs defaultValue="companies" className="w-full">
        <TabsList>
          <TabsTrigger value="companies">Sociétés</TabsTrigger>
          <TabsTrigger value="agencies">Agences</TabsTrigger>
          <TabsTrigger value="sectors">Secteurs</TabsTrigger>
          <TabsTrigger value="activities">Activités</TabsTrigger>
        </TabsList>
        <TabsContent value="companies">
          <SimpleSettingsSection title="Sociétés" description="sociétés" fetchItems={getCompanies} createItem={createCompany} />
        </TabsContent>
        <TabsContent value="agencies">
          <AgenciesSection />
        </TabsContent>
        <TabsContent value="sectors">
          <SectorsSection />
        </TabsContent>
        <TabsContent value="activities">
          <SimpleSettingsSection title="Activités" description="activités" fetchItems={getActivities} createItem={createActivity} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
