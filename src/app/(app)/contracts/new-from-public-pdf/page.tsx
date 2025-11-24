
'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChevronLeft, FileUp, Loader2, Wand2, X, Paperclip, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { useData } from '@/context/data-context';
import type { Client } from '@/lib/types';
import { ClientSchema, ExtractContractInfoOutputSchema } from '@/lib/types';
import { extractContractInfo } from '@/ai/flows/extract-contract-info-flow';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Textarea } from '@/components/ui/textarea';

const defaultPrompt = `Tu es un expert en analyse de documents contractuels de marchés publics. Analyse le contenu des fichiers TEXTE ci-dessous (Acte d'Engagement, CCAP, CCTP, etc.) et extrais les informations suivantes de manière structurée. Si une information n'est pas trouvée, laisse le champ vide.

Voici les informations à extraire:
- Raison sociale du client (name): Le nom complet du client. Toujours en MAJUSCULES.
- Adresse (address): L'adresse complète du client (numéro, rue, etc.).
- Code Postal (postalCode): Le code postal du client.
- Ville (city): La ville du client. Toujours en MAJUSCULES.
- Type de client (clientType): 'public'.
- Typologie du client (typologyId): Déduis la typologie du client. Ce doit être l'un des IDs de la liste suivante : {{{json typologies}}}.
- Échéancier de facturation (billingSchedule): Trouve la périodicité de facturation. Choisis parmi : {{{json schedules}}}.
- Terme de facturation (term): Trouve le terme. Choisis parmi : {{{json terms}}}.
- Station météo (weatherStation): La station météo de référence.
- activityIds: Trouve les prestations présentes dans le contrat (souvent dans le CCTP ou l'AE). Ce champ doit être un tableau contenant les IDs des prestations détectées. Les prestations à rechercher sont : Fourniture et gestion de l’énergie (P1), Maintenance préventive et petit entretien (P2), Garantie totale / gros entretien (P3). Choisis les IDs parmi cette liste: {{{json activities}}}.
- amounts: Pour chaque prestation identifiée dans 'activityIds', extrais son montant annuel HT (souvent dans l'Acte d'Engagement). Retourne un tableau d'objets, chacun avec 'activityId' et 'amount'. Si aucun montant n'est trouvé pour une prestation, ne l'inclus pas dans ce tableau.
- Date de démarrage (startDate): La date de début du contrat ou de notification, au format YYYY-MM-DD.
- Date de fin (endDate): La date de fin du contrat, au format YYYY-MM-DD.
- Reconduction (renewal): Indique si le contrat est à reconduction (true ou false), souvent dans le CCAP.
- Durée de la reconduction (renewalDuration): Si la reconduction est activée, précise sa durée (ex: '1 an').
- Tacite reconduction (tacitRenewal): Si la reconduction est activée, indique si elle est tacite (true ou false).
- SIRET (siret): Le SIRET de l'entité publique.
- Code service Chorus (chorusServiceCode): Le code service pour la facturation Chorus Pro.
- Numéro d'engagement juridique (chorusLegalCommitmentNumber): Le numéro EJ pour Chorus.

TEXTE DES DOCUMENTS A ANALYSER :
"""
COPIEZ ET COLLEZ LE CONTENU DE TOUS VOS DOCUMENTS ICI (AE, CCAP, CCTP...)
"""
`;


type ClientFormValues = z.infer<typeof ClientSchema> & z.infer<typeof ExtractContractInfoOutputSchema>;

const fileToDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

type DocumentType = 'acteEngagement' | 'ccap' | 'cctp' | 'notification' | 'bpu' | 'dpgf';

const documentFields: { id: DocumentType; label: string; required: boolean }[] = [
    { id: 'acteEngagement', label: "Acte d'Engagement (AE)", required: true },
    { id: 'ccap', label: "CCAP", required: true },
    { id: 'cctp', label: "CCTP", required: true },
    { id: 'notification', label: "Notification", required: false },
    { id: 'bpu', label: "BPU", required: false },
    { id: 'dpgf', label: "DPGF", required: false },
];

export default function NewContractFromPublicPdfPage() {
  const [files, setFiles] = useState<Record<DocumentType, File | null>>({
    acteEngagement: null, ccap: null, cctp: null, notification: null, bpu: null, dpgf: null
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<Partial<ClientFormValues> | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [prompt, setPrompt] = useState(defaultPrompt);

  const { toast } = useToast();
  const router = useRouter();
  const { clients, typologies, activities, schedules, terms } = useData();

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(ClientSchema),
    defaultValues: {
      clientType: "public",
      useChorus: true,
      renewal: false,
      tacitRenewal: false,
      activityIds: [],
      amounts: [],
    },
  });
  
  const watchTypologyId = form.watch("typologyId");
  const watchRenewal = form.watch("renewal");
  const watchActivityIds = form.watch("activityIds") || [];


  const selectedTypology = useMemo(() => 
    typologies.find(t => t.id === watchTypologyId),
    [typologies, watchTypologyId]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: DocumentType) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
       if (file.type !== 'application/pdf') {
         toast({
          title: "Fichier invalide",
          description: "Veuillez ne sélectionner que des documents au format PDF.",
          variant: "destructive",
        });
        return;
      }
      setFiles(prev => ({...prev, [type]: file }));
    }
  };
  
  const removeFile = (type: DocumentType) => {
    setFiles(prev => ({...prev, [type]: null }));
  }

  const handleAnalyze = async () => {
    if (prompt.includes('COPIEZ ET COLLEZ LE CONTENU DE VOS DOCUMENTS ICI')) {
        toast({
            title: "Prompt non modifié",
            description: "Veuillez copier et coller le contenu de vos documents dans le prompt.",
            variant: "destructive",
        });
        return;
    }
    const mainFile = files.acteEngagement || files.ccap || files.cctp;
    if (!mainFile) {
      toast({
        title: "Aucun fichier principal",
        description: "Veuillez déposer au moins l'AE, le CCAP ou le CCTP.",
        variant: "destructive",
      });
      return;
    }
    setIsAnalyzing(true);
    
    try {
        const documentDataUri = await fileToDataUrl(mainFile);
        const result = await extractContractInfo({ documentDataUri, activities, prompt, typologies, schedules, terms });

        const mappedData: Partial<ClientFormValues> = {
            ...result,
            clientType: "public",
            useChorus: true,
            startDate: result.startDate ? new Date(result.startDate) : undefined,
            endDate: result.endDate ? new Date(result.endDate) : undefined,
            activityIds: result.amounts?.map(a => a.activityId) ?? [],
        };

        setAnalysisResult(mappedData);
        form.reset(mappedData);
        setIsSheetOpen(true);
        toast({
            title: "Analyse terminée",
            description: "Veuillez vérifier et compléter les informations extraites.",
        });

    } catch (error) {
        console.error("Échec de l'analyse du contrat:", error);
        toast({
            title: "Erreur d'analyse",
            description: error instanceof Error ? error.message : "Impossible d'extraire les informations.",
            variant: "destructive",
            duration: 10000,
        });
    } finally {
        setIsAnalyzing(false);
    }
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
          <h1 className="text-2xl font-bold tracking-tight">Nouvelle Base Marché Public</h1>
          <p className="text-muted-foreground">
            Déposez les documents du marché public, ajustez le prompt, puis lancez l'analyse.
          </p>
        </div>
      </div>
      
      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="flex-1">
          <CardHeader>
              <CardTitle>1. Importer les documents</CardTitle>
              <CardDescription>
                  Déposez chaque document du marché dans son champ respectif.
              </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {documentFields.map(docField => (
                <div key={docField.id}>
                    <Label htmlFor={docField.id} className="mb-2 flex items-center gap-2">
                        {docField.label}
                        {docField.required && <span className="text-destructive text-xs">*</span>}
                    </Label>
                    {files[docField.id] ? (
                         <div className="flex items-center justify-between text-sm text-muted-foreground bg-muted/50 p-2 rounded-md">
                            <span className="truncate flex items-center gap-2"><Paperclip className="h-4 w-4"/>{files[docField.id]!.name}</span>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeFile(docField.id)}><X className="h-4 w-4" /></Button>
                        </div>
                    ) : (
                         <div className="relative">
                            <FileText className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input id={docField.id} type="file" accept="application/pdf" onChange={(e) => handleFileChange(e, docField.id)} className="pl-9" />
                        </div>
                    )}
                </div>
            ))}
          </CardContent>
        </Card>

        <Card className="flex-1">
            <CardHeader>
                <CardTitle>2. Personnaliser le Prompt</CardTitle>
                <CardDescription>
                    Copiez et collez le contenu textuel des documents dans le champ ci-dessous pour que l'IA puisse les analyser.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Textarea 
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="min-h-[300px] font-mono text-xs"
                />
            </CardContent>
        </Card>
      </div>
      
       <div className="flex justify-center">
            <Button onClick={handleAnalyze} disabled={isAnalyzing || !files.acteEngagement && !files.ccap && !files.cctp} size="lg">
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
        </div>


      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
            <SheetHeader>
                <SheetTitle>Valider les informations extraites</SheetTitle>
                <SheetDescription>
                    Vérifiez, corrigez et complétez les champs ci-dessous avant de créer la base marché.
                </SheetDescription>
            </SheetHeader>
            <div className="py-4 pr-6">
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
                            <div className="grid grid-cols-2 gap-4">
                              <FormField control={form.control} name="postalCode" render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Code postal</FormLabel>
                                  <FormControl><Input placeholder="75000" {...field} /></FormControl>
                                  <FormMessage />
                                </FormItem>
                              )} />
                              <FormField control={form.control} name="city" render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Ville</FormLabel>
                                  <FormControl><Input placeholder="Gotham" {...field} /></FormControl>
                                  <FormMessage />
                                </FormItem>
                              )} />
                            </div>
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
                            
                            <FormField
                                control={form.control} name="activityIds" render={() => (
                                <FormItem>
                                    <div className="mb-4"><FormLabel className="text-base">Type de prestation</FormLabel></div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {activities.map((item) => (
                                        <FormField
                                            key={item.id} control={form.control} name="activityIds"
                                            render={({ field }) => {
                                            return (
                                                <FormItem key={item.id} className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                                                <FormControl>
                                                    <Checkbox
                                                    checked={field.value?.includes(item.id)}
                                                    onCheckedChange={(checked) => {
                                                        const newActivities = checked
                                                            ? [...(field.value || []), item.id]
                                                            : field.value?.filter((value) => value !== item.id);
                                                        field.onChange(newActivities);
                                                    }}
                                                    />
                                                </FormControl>
                                                <FormLabel className="font-normal">{item.code}</FormLabel>
                                                </FormItem>
                                            )}}
                                        />
                                        ))}
                                    </div><FormMessage />
                                </FormItem>
                            )} />
                            
                            {watchActivityIds.length > 0 && (
                                <Card>
                                    <CardHeader><CardTitle>Montants Annuels HT</CardTitle></CardHeader>
                                    <CardContent className="space-y-4">
                                        {activities.filter(a => watchActivityIds.includes(a.id)).map(activity => {
                                            const amountIndex = form.getValues('amounts')?.findIndex(a => a.activityId === activity.id) ?? -1;
                                            return (
                                                <FormField
                                                    key={activity.id}
                                                    control={form.control}
                                                    name={`amounts.${amountIndex}.amount`}
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel>Montant {activity.code} (€)</FormLabel>
                                                            <FormControl>
                                                                <Input 
                                                                    type="number"
                                                                    {...field}
                                                                    onChange={e => field.onChange(parseFloat(e.target.value) || 0)}
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            );
                                        })}
                                    </CardContent>
                                </Card>
                            )}


                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <FormField control={form.control} name="startDate" render={({ field }) => (
                                    <FormItem className="flex flex-col"><FormLabel>Date de Démarrage</FormLabel>
                                    <Popover><PopoverTrigger asChild><FormControl>
                                        <Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                                        {field.value ? format(field.value, "PPP", { locale: fr }) : <span>Choisir une date</span>}
                                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                        </Button>
                                    </FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start">
                                        <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus locale={fr}/>
                                    </PopoverContent></Popover><FormMessage />
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="endDate" render={({ field }) => (
                                    <FormItem className="flex flex-col"><FormLabel>Date de Fin</FormLabel>
                                    <Popover><PopoverTrigger asChild><FormControl>
                                        <Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                                        {field.value ? format(field.value, "PPP", { locale: fr }) : <span>Choisir une date</span>}
                                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                        </Button>
                                    </FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start">
                                        <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus locale={fr}/>
                                    </PopoverContent></Popover><FormMessage />
                                    </FormItem>
                                )} />
                            </div>
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                                <FormField control={form.control} name="renewal" render={({ field }) => (
                                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                        <div className="space-y-0.5"><FormLabel>Reconduction</FormLabel></div>
                                        <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                    </FormItem>
                                )} />
                                {watchRenewal && (
                                    <div className="space-y-4">
                                        <FormField control={form.control} name="renewalDuration" render={({ field }) => (<FormItem><FormLabel>Durée de reconduction</FormLabel><FormControl><Input placeholder="Ex: 1 an" {...field} /></FormControl><FormMessage /></FormItem>)} />
                                        <FormField control={form.control} name="tacitRenewal" render={({ field }) => (
                                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                                <div className="space-y-0.5"><FormLabel>Tacite reconduction</FormLabel></div>
                                                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                            </FormItem>
                                        )} />
                                    </div>
                                )}
                            </div>
                             <div className="space-y-4 p-4 border rounded-lg">
                                <FormField control={form.control} name="siret" render={({ field }) => (<FormItem><FormLabel>SIRET</FormLabel><FormControl><Input placeholder="12345678901234" {...field} /></FormControl><FormMessage /></FormItem>)} />
                                <FormField control={form.control} name="chorusServiceCode" render={({ field }) => (<FormItem><FormLabel>Code service</FormLabel><FormControl><Input placeholder="Code service Chorus" {...field} /></FormControl><FormMessage /></FormItem>)} />
                                <FormField control={form.control} name="chorusLegalCommitmentNumber" render={({ field }) => (<FormItem><FormLabel>Numéro engagement juridique</FormLabel><FormControl><Input placeholder="Numéro EJ" {...field} /></FormControl><FormMessage /></FormItem>)} />
                            </div>

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
