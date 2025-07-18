'use client';
import React, { useState, useEffect, useOptimistic } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PlusCircle, Trash2, Edit } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

import { 
  createCompany, getCompanies, 
  createAgency, getAgencies, 
  createSector, getSectors, 
  createActivity, getActivities 
} from "@/services/firestore";

type SettingItem = { id: string; name: string };

interface SettingsSectionProps {
  title: string;
  fetchItems: () => Promise<SettingItem[]>;
  createItem: (name: string) => Promise<any>;
}

const SettingsSection: React.FC<SettingsSectionProps> = ({ title, fetchItems, createItem }) => {
  const [items, setItems] = useState<SettingItem[]>([]);
  const [newItemName, setNewItemName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  const [optimisticItems, setOptimisticItems] = useOptimistic(
    items,
    (state, newItem: SettingItem) => [...state, newItem]
  );

  useEffect(() => {
    const loadItems = async () => {
      try {
        setIsLoading(true);
        const fetchedItems = await fetchItems();
        setItems(fetchedItems);
      } catch (error) {
        console.error(`Failed to fetch ${title}:`, error);
        toast({ title: "Erreur", description: `Impossible de charger les ${title.toLowerCase()}.`, variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    };
    loadItems();
  }, [fetchItems, title, toast]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) return;

    const tempId = Date.now().toString();
    const newItem = { id: tempId, name: newItemName };

    setOptimisticItems(newItem);
    setNewItemName("");

    try {
      await createItem(newItemName);
      // Refetch to get the real ID and confirm the data
      const updatedItems = await fetchItems();
      setItems(updatedItems);
      toast({ title: "Succès", description: `${title} créé avec succès.` });
    } catch (error) {
      console.error(`Failed to create ${title}:`, error);
      toast({ title: "Erreur", description: `Impossible de créer le ${title.toLowerCase()}.`, variant: "destructive" });
      setItems(items); // Revert optimistic update
    }
  };
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Gérez vos {title.toLowerCase()}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleCreate} className="flex items-center gap-2">
          <Input 
            placeholder={`Nom de la nouvelle ${title.toLowerCase().slice(0, -1)}...`} 
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
              ) : optimisticItems.length === 0 ? (
                <TableRow><TableCell colSpan={2} className="text-center">Aucun élément trouvé.</TableCell></TableRow>
              ) : (
                optimisticItems.map((item) => (
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
          <SettingsSection title="Sociétés" fetchItems={getCompanies} createItem={createCompany} />
        </TabsContent>
        <TabsContent value="agencies">
          <SettingsSection title="Agences" fetchItems={getAgencies} createItem={createAgency} />
        </TabsContent>
        <TabsContent value="sectors">
          <SettingsSection title="Secteurs" fetchItems={getSectors} createItem={createSector} />
        </TabsContent>
        <TabsContent value="activities">
          <SettingsSection title="Activités" fetchItems={getActivities} createItem={createActivity} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
