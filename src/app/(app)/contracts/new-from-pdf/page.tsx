
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChevronLeft, FileUp, Loader2, Wand2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function NewContractFromPdfPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const { toast } = useToast();

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
    // Simulate analysis
    setTimeout(() => {
      setIsAnalyzing(false);
      toast({
        title: "Analyse terminée (simulation)",
        description: "L'IA a extrait les informations. Prochaine étape : afficher le formulaire pré-rempli.",
      });
    }, 2000);
  };

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
    </div>
  );
}
