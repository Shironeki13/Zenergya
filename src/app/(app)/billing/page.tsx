
'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { getClients, getContractsByClient } from '@/services/firestore';
import { generateInvoice } from '@/ai/flows/generate-invoice-flow';
import type { Client, Contract } from '@/lib/types';

export default function BillingPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    async function fetchClients() {
      try {
        const clientsData = await getClients();
        setClients(clientsData);
      } catch (error) {
        toast({ title: 'Erreur', description: 'Impossible de charger les clients.', variant: 'destructive' });
      }
    }
    fetchClients();
  }, [toast]);

  useEffect(() => {
    if (selectedClientId) {
      async function fetchContracts() {
        try {
          const contractsData = await getContractsByClient(selectedClientId!);
          setContracts(contractsData);
          setSelectedContractId(null);
        } catch (error) {
          toast({ title: 'Erreur', description: 'Impossible de charger les contrats.', variant: 'destructive' });
        }
      }
      fetchContracts();
    } else {
      setContracts([]);
      setSelectedContractId(null);
    }
  }, [selectedClientId, toast]);

  const handleGenerateInvoice = async () => {
    if (!selectedContractId) {
      toast({ title: 'Erreur', description: 'Veuillez sélectionner un contrat.', variant: 'destructive' });
      return;
    }
    setIsGenerating(true);
    try {
      const result = await generateInvoice({ contractId: selectedContractId });
      if (result.success) {
        toast({
          title: 'Facture Générée',
          description: `La facture ${result.invoiceId} a été créée avec succès.`,
        });
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Une erreur inconnue est survenue.';
      toast({
        title: 'Échec de la génération',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
       <div>
        <h1 className="text-lg font-medium">Facturation Manuelle</h1>
        <p className="text-sm text-muted-foreground">
          Générez une facture pour un contrat spécifique.
        </p>
      </div>
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Sélection du Contrat</CardTitle>
          <CardDescription>
            Choisissez un client puis un contrat pour générer la facture correspondante.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="client-select">Client</Label>
            <Select onValueChange={(value) => setSelectedClientId(value)}>
              <SelectTrigger id="client-select">
                <SelectValue placeholder="Sélectionner un client..." />
              </SelectTrigger>
              <SelectContent>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedClientId && (
            <div className="space-y-2">
              <Label htmlFor="contract-select">Contrat</Label>
              <Select onValueChange={(value) => setSelectedContractId(value)} value={selectedContractId || ''}>
                <SelectTrigger id="contract-select">
                  <SelectValue placeholder="Sélectionner un contrat..." />
                </SelectTrigger>
                <SelectContent>
                  {contracts.length > 0 ? (
                    contracts.map((contract) => (
                      <SelectItem key={contract.id} value={contract.id}>
                        Contrat du {new Date(contract.startDate).toLocaleDateString()} au {new Date(contract.endDate).toLocaleDateString()}
                      </SelectItem>
                    ))
                  ) : (
                    <div className="p-4 text-sm text-muted-foreground">Aucun contrat pour ce client.</div>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button onClick={handleGenerateInvoice} disabled={!selectedContractId || isGenerating}>
            {isGenerating ? 'Génération en cours...' : 'Générer la Facture'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
