
'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChevronLeft, FileUp, Loader2, Wand2, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useData } from '@/context/data-context';
import type { ClientFormValues, Contract, Client } from '@/lib/types'; // We'll need a dedicated type later
import { ClientSchema } from '@/lib/types';


export default function NewContractFromPdfPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<Partial<ClientFormValues> | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const { toast } = useToast();
  const router = useRouter();
  const { clients, typologies, activities } = useData();

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(ClientSchema),
    defaultValues: {},
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFile = e.target.files[0];
      if (selectedFile.type !== 'application/pdf') {
        toast({
          title: "Fichier invalide",
          description: "Veuillez sélectionner un document au format PDF.",
          variant: "destructive",
        });
        return;
      }
      setFile(selectedFile);
    }
  };

  const handleAnalyze = async () => {
    if (!file) {
      toast({
        title: "Aucun fichier",
        description: "Veuillez sélectionner un fichier à analyser.",
        variant: "destructive",
      });
      return;
    }
    setIsAnalyzing(true);
    
    // TODO: Connect to Genkit flow for analysis
    console.log("Analyse du fichier:", file.name);

    // Simulate AI analysis and get pre-filled data
    setTimeout(() => {
      const simulatedData: Partial<ClientFormValues> = {
        name: 'ACME Corp',
        address: '123 Main Street',
        postalCode: '12345',
        city: 'Anytown',
        clientType: 'private',
        typologyId: typologies.length > 0 ? typologies[0].id : undefined,
        siret: "12345678901234",
        useChorus: true,
        chorusServiceCode: "SERVICE-01",
        chorusLegalCommitmentNumber: "EJ-5678",
        activityIds: activities.length > 0 ? [activities[0].id] : [],
        startDate: new Date(),
        endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
        renewal: true,
        renewalDuration: "1 an",
        tacitRenewal: true,
      };
      
      setAnalysisResult(simulatedData);
      form.reset(simulatedData);
      setIsSheetOpen(true);
      setIsAnalyzing(false);
      toast({
        title: "Analyse terminée",
        description: "Veuillez vérifier et compléter les informations extraites.",
      });
    }, 2000);
  };
  
  async function onSubmit(data: ClientFormValues) {
    // Here we would normally call a function like `createClientAndContract(data)`
    console.log("Formulaire validé avec les données:", data);
    toast({
        title: "Base Marché Créée (Simulation)",
        description: "La nouvelle base marché a été enregistrée avec succès.",
    });
    setIsSheetOpen(false);
    router.push('/contracts');
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/contracts/new-document">
          <Button variant="outline" size="icon" className="h-7 w-7">
            <ChevronLeft className="h-4 w-4" />
            <span className="sr-only">Retour</span>
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Nouvelle Base Marché</h1>
          <p className="text-muted-foreground">
            Importez un document PDF pour que l'IA en extraie les informations.
          </p>
        </div>
      </div>
      
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>1. Importer le document</CardTitle>
          <CardDescription>
            Sélectionnez le contrat ou la base marché au format PDF.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="pdf-upload">Fichier PDF</Label>
                <div className="flex gap-2">
                    <Input id="pdf-upload" type="file" accept="application/pdf" onChange={handleFileChange} />
                </div>
            </div>
            {file && (
                <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-3 text-sm">
                    <FileUp className="h-5 w-5 shrink-0"/>
                    <span className="font-medium truncate flex-1">{file.name}</span>
                    <span className="text-muted-foreground">{Math.round(file.size / 1024)} ko</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setFile(null)}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            )}
        </CardContent>
        <CardFooter>
            <Button onClick={handleAnalyze} disabled={!file || isAnalyzing}>
                {isAnalyzing ? (
                    <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Analyse en cours...
                    </>
                ) : (
                    <>
                        <Wand2 className="mr-2 h-4 w-4" />
                        Lancer l'analyse
                    </>
                )}
            </Button>
        </CardFooter>
      </Card>

      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
            <SheetHeader>
                <SheetTitle>Valider les informations extraites</SheetTitle>
                <SheetDescription>
                    Vérifiez, corrigez et complétez les champs ci-dessous avant de créer la base marché.
                </SheetDescription>
            </SheetHeader>
            <div className="py-4">
                {analysisResult && (
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                             <FormField control={form.control} name="name" render={({ field }) => (
                                <FormItem>
                                <FormLabel>Raison Sociale</FormLabel>
                                <FormControl><Input {...field} /></FormControl>
                                <FormMessage />
                                </FormItem>
                            )} />
                             <FormField control={form.control} name="address" render={({ field }) => (
                                <FormItem>
                                <FormLabel>Adresse</FormLabel>
                                <FormControl><Input {...field} /></FormControl>
                                <FormMessage />
                                </FormItem>
                            )} />
                             <FormField control={form.control} name="typologyId" render={({ field }) => (
                                <FormItem>
                                <FormLabel>Typologie client</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl><SelectTrigger><SelectValue placeholder="Sélectionnez une typologie" /></SelectTrigger></FormControl>
                                    <SelectContent>
                                    {typologies.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                                </FormItem>
                            )} />
                            {/* ... more fields would go here based on ClientSchema ... */}
                            <div className="pt-6 flex justify-end gap-4">
                                <Button type="button" variant="outline" onClick={() => setIsSheetOpen(false)}>Annuler</Button>
                                <Button type="submit">Créer la Base Marché</Button>
                            </div>
                        </form>
                    </Form>
                )}
            </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

