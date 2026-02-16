"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Upload, FileText, CheckCircle, AlertCircle, ArrowLeft, Trash2, Sparkles, Building, FileSignature, User, Euro } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { extractContractInfo } from '@/ai/flows/extract-contract-info-flow';
import { createClientAndContract } from '@/services/firestore';
import { uploadFile } from '@/services/storage';
import { useData } from '@/context/data-context';
import { ClientSchema, ClientBaseSchema } from "@/lib/types";
import {
    Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
    Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import Link from 'next/link';
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Default prompt for AI extraction
const defaultPrompt = `Agis comme un expert en saisie de données juridiques. Analyse ce contrat et extrais les données pour remplir la base de données.

**Instructions Logiques pour le CLIENT :**
1.  **Identification du Client (\`name\`)** : C'est l'entité bénéficiaire du service (ex: "Copropriété Le Bastion", "Mairie de...", "Société X"). Ce N'EST PAS le représentant (Syndic) sauf si le contrat est directement au nom du Syndic pour ses propres bureaux.
2.  **Représentant** : Si le client est une Copropriété, identifie le Syndic (mention "Représenté par").
3.  **Typologie (\`typologyName\`)** : Déduis-la du contexte :
    - "Copropriété" (si mention de syndic, résidence, SDC).
    - "Tertiaire" (Bureaux, Commerces, SA, SAS).
    - "Collectivité" (Mairie, Ecole, Public).
    - "Industrie" (Usine, Site de production).
4.  **Chorus (\`useChorus\`)** : Mets \`true\` UNIQUEMENT si le client est une entité publique (Mairie, Collectivité, État). Sinon \`false\`.
5.  **Adresses** : L'\`address\` principale doit être le lieu d'exécution du contrat (l'adresse de l'immeuble chauffé).

**Instructions Logiques pour le CONTRAT :**
1.  **Nom & Libellé** :
    - \`name\` : "Contrat Maintenance - [Nom Client]" (ex: "Contrat Maintenance - Le Bastion").
    - \`label\` : Type de prestations (ex: "Chauffage & ECS (Type P1 MTI - P2)").
2.  **Dates & Durée** :
    - \`startDate\` : Date d'effet du contrat.
    - \`endDate\` : Date de fin (souvent calculée : date effet + durée).
    - \`term\` : Périodicité de facturation (ex: "Trimestriel", "Mensuel", "Semestriel").
3.  **Montants (HT/an)** :
    - \`baseAmountP1\` : Montant P1 (Total P1 ou Forfait P1).
    - \`baseAmountP2\` : Montant P2 (Total P2 ou Forfait P2).
    - \`baseAmountP3\` : Montant P3 (Garantie totale).
    - \`baseAmountP3R\` : Montant P3R (Renouvellement).
4.  **Révisions de Prix** :
    - \`revisionP1\` : Formule complète de révision P1.
    - \`revisionP2\` : Formule ou indice de révision P2.
    - \`revisionP3\` : Formule de révision P3.
5.  **Données Techniques** :
    - \`heatingReferenceDju\` : DJU de référence (ex: 1200, 2050).
    - \`heatingWeatherStation\` : Station météo de référence (ex: "Nice", "Le Bourget").
    - \`hasInterest\` : \`true\` si mention d'intéressement ou de partage d'économies.
    - \`hasHeating\` : \`true\` si prestation de chauffage (P1 Chauffage).
    - \`hasECS\` : \`true\` si prestation d'Eau Chaude Sanitaire (P1 ECS).

**Format de sortie :** Uniquement un JSON valide respectant strictement ce schéma :

{
  "client": {
    "name": "Nom du client final",
    "representativeName": "Nom du représentant/Syndic",
    "address": "Adresse du site",
    "postalCode": "Code postal",
    "city": "Ville",
    "clientType": "private" ou "public",
    "typologyName": "Copropriété, Tertiaire, Industrie ou Collectivité",
    "siret": "SIRET",
    "isBe": false,
    "useChorus": boolean,
    "contactTechnique": { "name": "...", "email": "...", "phone": "..." },
    "contactFacturation": { "name": "...", "email": "...", "phone": "..." }
  },
  "contrat": {
     "name": "Nom du contrat",
     "label": "Libellé",
     "objet": "Objet du contrat",
     "startDate": "YYYY-MM-DD",
     "durationStr": "Durée (ex: 2 ans)",
     "endDate": "YYYY-MM-DD",
     "term": "Périodicité (ex: Trimestriel)",
     "tacitRenewal": boolean,
     "noticePeriod": "Préavis",
     "baseAmountP1": number,
     "baseAmountP2": number,
     "baseAmountP3": number,
     "baseAmountP3R": number,
     "revisionP1": "Formule...",
     "revisionP2": "Formule...",
     "revisionP3": "Formule...",
     "heatingReferenceDju": number,
     "heatingWeatherStation": "Station...",
     "hasInterest": boolean,
     "hasInterest": boolean,
     "hasHeating": boolean,
     "hasECS": boolean,
     "contractualNB": number,
     "smallQ": number
  }
}`;

// Extended schema to include contract amounts for the form
const ExtendedClientSchema = ClientBaseSchema.extend({
    // Contract specific fields
    startDate: z.date().optional(),
    endDate: z.date().optional(),
    contractName: z.string().optional(),
    label: z.string().optional(),
    term: z.string().optional(),
    baseAmountP1: z.number().optional(),
    baseAmountP2: z.number().optional(),
    baseAmountP3: z.number().optional(),
    baseAmountP3R: z.number().optional(),
    revisionP1: z.string().optional(),
    revisionP2: z.string().optional(),
    revisionP3: z.string().optional(),
    heatingReferenceDju: z.number().optional(),
    heatingWeatherStation: z.string().optional(),
    hasInterest: z.boolean().default(false),
    hasHeating: z.boolean().default(false),
    hasECS: z.boolean().default(false),
    contractualNB: z.number().optional(),
    smallQ: z.number().optional(),
});

type ClientFormValues = z.infer<typeof ExtendedClientSchema>;

export default function MarketPrivatePage() {
    const router = useRouter();
    const { toast } = useToast();
    const { reloadData, typologies, companies, agencies, sectors, currentUser } = useData();
    const [file, setFile] = useState<File | null>(null);
    const [prompt, setPrompt] = useState(defaultPrompt);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isSheetOpen, setIsSheetOpen] = useState(false);

    const form = useForm<ClientFormValues>({
        resolver: zodResolver(ExtendedClientSchema),
        defaultValues: {
            name: "",
            address: "",
            postalCode: "",
            city: "",
            clientType: "private",
            representedBy: "",
            externalCode: "",
            isBe: false,
            beName: "",
            beEmail: "",
            bePhone: "",
            useChorus: false,
            siret: "",

            renewal: false,
            tacitRenewal: false,
            renewalDuration: "",
            noticePeriod: "",

            companyId: "",
            agencyId: "",
            sectorId: "",
            technicalContactName: "",
            technicalContactEmail: "",
            technicalContactPhone: "",
            billingContactName: "",
            billingContactEmail: "",
            billingContactPhone: "",
            baseAmountP1: undefined,
            baseAmountP2: undefined,
            contractualNB: undefined,
            smallQ: undefined,
            typologyId: "",
        },
    });

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
        }
    };

    const removeFile = () => {
        setFile(null);
    };

    const findTypologyId = (name: string | undefined | null) => {
        if (!name) return "";
        const match = typologies.find(t => t.name.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(t.name.toLowerCase()));
        return match ? match.id : "";
    };

    const handleAnalyze = async () => {
        if (!file) return;

        setIsAnalyzing(true);

        try {
            const reader = new FileReader();
            reader.readAsDataURL(file);

            reader.onload = async () => {
                const base64File = reader.result as string;

                try {
                    const result = await extractContractInfo({
                        documentDataUri: base64File,
                        activities: [],
                        prompt: prompt,
                        typologies: [],
                        schedules: [],
                        terms: []
                    });

                    // Map nested result to flat form values
                    const mappedData: Partial<ClientFormValues> = {
                        name: result.client?.name || "",
                        address: result.client?.address || "",
                        postalCode: result.client?.postalCode || "",
                        city: result.client?.city || "",
                        siret: result.client?.siret || "",
                        clientType: result.client?.clientType || "private",
                        representedBy: result.client?.representativeName || "",
                        typologyId: findTypologyId(result.client?.typologyName),
                        useChorus: result.client?.useChorus || false,
                        isBe: result.client?.isBe || false,

                        technicalContactName: result.client?.contactTechnique?.name || "",
                        technicalContactEmail: result.client?.contactTechnique?.email || "",
                        technicalContactPhone: result.client?.contactTechnique?.phone || "",

                        billingContactName: result.client?.contactFacturation?.name || "",
                        billingContactEmail: result.client?.contactFacturation?.email || "",
                        billingContactPhone: result.client?.contactFacturation?.phone || "",

                        startDate: result.contrat?.startDate ? new Date(result.contrat.startDate) : undefined,
                        endDate: result.contrat?.endDate ? new Date(result.contrat.endDate) : undefined,
                        renewalDuration: result.contrat?.durationStr || "",
                        tacitRenewal: result.contrat?.tacitRenewal || false,
                        noticePeriod: result.contrat?.noticePeriod || "",
                        renewal: !!result.contrat?.tacitRenewal, // Infer renewal from tacitRenewal

                        baseAmountP1: result.contrat?.baseAmountP1,
                        baseAmountP2: result.contrat?.baseAmountP2,
                        baseAmountP3: result.contrat?.baseAmountP3,
                        baseAmountP3R: result.contrat?.baseAmountP3R,

                        contractName: result.contrat?.name || "",
                        label: result.contrat?.label || "",
                        term: result.contrat?.term || "",

                        revisionP1: result.contrat?.revisionP1 || "",
                        revisionP2: result.contrat?.revisionP2 || "",
                        revisionP3: result.contrat?.revisionP3 || "",

                        heatingReferenceDju: result.contrat?.heatingReferenceDju,
                        heatingWeatherStation: result.contrat?.heatingWeatherStation || "",

                        hasInterest: result.contrat?.hasInterest || false,
                        hasHeating: result.contrat?.hasHeating || false,
                        hasECS: result.contrat?.hasECS || false,
                        contractualNB: result.contrat?.contractualNB,
                        smallQ: result.contrat?.smallQ,

                        // Preserve or default hierarchy fields to avoid validation errors
                        companyId: form.getValues("companyId") || companies[0]?.id || "",
                        agencyId: form.getValues("agencyId") || agencies[0]?.id || "",
                        sectorId: form.getValues("sectorId") || sectors[0]?.id || "",
                    };

                    form.reset(mappedData);
                    setIsSheetOpen(true);
                    toast({
                        title: "Analyse terminée",
                        description: "Veuillez vérifier les informations extraites.",
                    });

                } catch (error) {
                    console.error("Error analyzing contract:", error);
                    toast({
                        title: "Erreur",
                        description: "Une erreur est survenue lors de l'analyse.",
                        variant: "destructive",
                    });
                } finally {
                    setIsAnalyzing(false);
                }
            };

        } catch (error) {
            console.error("Error reading file:", error);
            setIsAnalyzing(false);
            toast({
                title: "Erreur",
                description: "Impossible de lire le fichier.",
                variant: "destructive",
            });
        }
    };

    const onSubmit = async (data: ClientFormValues) => {
        try {
            let downloadUrl = "";
            if (file) {
                const path = `BASE_MARCHE/${Date.now()}_${file.name}`;
                downloadUrl = await uploadFile(file, path);
            }

            // Separate contract specific fields that are not in ClientSchema
            const { baseAmountP1, baseAmountP2, ...clientData } = data;

            const contractData = {
                ...clientData,
                clientType: 'private',
                validationStatus: 'pending_validation',
                requesterEmail: currentUser?.email,

                documents: downloadUrl ? [{
                    name: file?.name || 'Contrat.pdf',
                    type: 'application/pdf',
                    url: downloadUrl
                }] : [],
                baseAmountP1,
                baseAmountP2,
                baseAmountP3: data.baseAmountP3,
                baseAmountP3R: data.baseAmountP3R,
                contractName: data.contractName,
                label: data.label,
                term: data.term,
                revisionP1: data.revisionP1,
                revisionP2: data.revisionP2,
                revisionP3: data.revisionP3,
                heatingReferenceDju: data.heatingReferenceDju,
                heatingWeatherStation: data.heatingWeatherStation,
                hasInterest: data.hasInterest,
                hasHeating: data.hasHeating,
                hasECS: data.hasECS,
                contractualNB: data.contractualNB,
                smallQ: data.smallQ,
            };

            await createClientAndContract(contractData);

            toast({
                title: "Succès",
                description: "Le contrat a été créé avec succès.",
            });

            reloadData();
            setIsSheetOpen(false);
            router.push('/contracts');

        } catch (error) {
            console.error("Error creating contract:", error);
            toast({
                title: "Erreur",
                description: "Une erreur est survenue lors de la création.",
                variant: "destructive",
            });
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="outline" size="icon" asChild>
                    <Link href="/contracts/new">
                        <ArrowLeft className="h-4 w-4" />
                    </Link>
                </Button>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Nouveau Marché Privé</h1>
                    <p className="text-muted-foreground">
                        Importez un contrat PDF pour une analyse automatique et une création rapide.
                    </p>
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Document</CardTitle>
                        <CardDescription>
                            Sélectionnez le contrat (PDF) à analyser.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid w-full max-w-sm items-center gap-1.5">
                            <Label htmlFor="contract">Contrat PDF</Label>
                            <div className="flex items-center gap-2">
                                <Input id="contract" type="file" accept=".pdf" onChange={handleFileChange} className="flex-1" />
                                {file && (
                                    <Button variant="ghost" size="icon" onClick={removeFile}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        </div>
                        {file && (
                            <div className="mt-4 flex items-center gap-2 text-sm text-green-600">
                                <CheckCircle className="h-4 w-4" />
                                <span>{file.name} prêt à être analysé</span>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Configuration de l'IA</CardTitle>
                        <CardDescription>
                            Vous pouvez ajuster le prompt utilisé pour l'analyse.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            className="min-h-[200px] font-mono text-xs"
                        />
                    </CardContent>
                </Card>
            </div>

            <div className="flex justify-end">
                <Button
                    size="lg"
                    onClick={handleAnalyze}
                    disabled={!file || isAnalyzing}
                    className="min-w-[200px]"
                >
                    {isAnalyzing ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Analyse en cours...
                        </>
                    ) : (
                        <>
                            <Sparkles className="mr-2 h-4 w-4" />
                            Lancer l'analyse
                        </>
                    )}
                </Button>

                <Button
                    size="lg"
                    variant="secondary"
                    onClick={() => {
                        form.reset();
                        setIsSheetOpen(true);
                    }}
                    className="min-w-[200px]"
                >
                    <FileText className="mr-2 h-4 w-4" />
                    Saisie Manuelle
                </Button>
            </div>

            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
                    <SheetHeader>
                        <SheetTitle>Validation de l'analyse</SheetTitle>
                        <SheetDescription>
                            Vérifiez les données extraites avant de valider.
                        </SheetDescription>
                    </SheetHeader>
                    <div className="py-6">
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(onSubmit, (errors) => {
                                console.error("Form Validation Errors:", errors);
                                const errorMessages = Object.entries(errors)
                                    .map(([key, error]) => `${key}: ${(error as any).message}`)
                                    .join(', ');
                                toast({
                                    title: "Erreur de validation",
                                    description: `Champs invalides: ${errorMessages}`,
                                    variant: "destructive",
                                });
                            })} className="space-y-8">

                                {/* Section Hiérarchie */}
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2 pb-2 border-b">
                                        <Building className="h-5 w-5 text-primary" />
                                        <h3 className="font-semibold text-lg">Hiérarchie (Obligatoire)</h3>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <FormField control={form.control} name="companyId" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Société</FormLabel>
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Sélectionner" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {companies.map((c) => (
                                                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name="agencyId" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Agence</FormLabel>
                                                <Select onValueChange={field.onChange} defaultValue={field.value} disabled={!form.watch('companyId')}>
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Sélectionner" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {agencies.filter(a => a.companyId === form.watch('companyId')).map((a) => (
                                                            <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name="sectorId" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Secteur</FormLabel>
                                                <Select onValueChange={field.onChange} defaultValue={field.value} disabled={!form.watch('agencyId')}>
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Sélectionner" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {sectors.filter(s => s.agencyId === form.watch('agencyId')).map((s) => (
                                                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                    </div>
                                </div>

                                {/* Section Client */}
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2 pb-2 border-b">
                                        <Building className="h-5 w-5 text-primary" />
                                        <h3 className="font-semibold text-lg">Client</h3>
                                    </div>

                                    <FormField control={form.control} name="name" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Raison Sociale</FormLabel>
                                            <FormControl><Input {...field} /></FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )} />

                                    <div className="grid grid-cols-2 gap-4">
                                        <FormField control={form.control} name="typologyId" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Typologie</FormLabel>
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Sélectionner" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {typologies.map((t) => (
                                                            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name="clientType" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Type</FormLabel>
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Sélectionner" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        <SelectItem value="private">Privé</SelectItem>
                                                        <SelectItem value="public">Public</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                    </div>

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
                                                <FormLabel>Code Postal</FormLabel>
                                                <FormControl><Input {...field} /></FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name="city" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Ville</FormLabel>
                                                <FormControl><Input {...field} /></FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <FormField control={form.control} name="siret" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>SIRET</FormLabel>
                                                <FormControl><Input {...field} /></FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                        {typologies.find(t => t.id === form.watch("typologyId"))?.name === "Copropriété" && (
                                            <FormField control={form.control} name="representedBy" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Représenté par</FormLabel>
                                                    <FormControl><Input {...field} /></FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )} />
                                        )}
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="text-sm font-medium text-muted-foreground">Contact Technique</Label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <FormField control={form.control} name="technicalContactName" render={({ field }) => (
                                                <FormItem><FormControl><Input placeholder="Nom" {...field} /></FormControl></FormItem>
                                            )} />
                                            <FormField control={form.control} name="technicalContactEmail" render={({ field }) => (
                                                <FormItem><FormControl><Input placeholder="Email" {...field} /></FormControl></FormItem>
                                            )} />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="text-sm font-medium text-muted-foreground">Contact Facturation</Label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <FormField control={form.control} name="billingContactName" render={({ field }) => (
                                                <FormItem><FormControl><Input placeholder="Nom" {...field} /></FormControl></FormItem>
                                            )} />
                                            <FormField control={form.control} name="billingContactEmail" render={({ field }) => (
                                                <FormItem><FormControl><Input placeholder="Email" {...field} /></FormControl></FormItem>
                                            )} />
                                        </div>
                                    </div>
                                </div>

                                {/* Section Contrat */}
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2 pb-2 border-b">
                                        <FileSignature className="h-5 w-5 text-primary" />
                                        <h3 className="font-semibold text-lg">Contrat</h3>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <FormField control={form.control} name="startDate" render={({ field }) => (
                                            <FormItem className="flex flex-col"><FormLabel>Date de Début</FormLabel>
                                                <Popover><PopoverTrigger asChild><FormControl>
                                                    <Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                                                        {field.value ? format(field.value, "PPP", { locale: fr }) : <span>Choisir une date</span>}
                                                    </Button>
                                                </FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start">
                                                        <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus locale={fr} />
                                                    </PopoverContent></Popover><FormMessage />
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name="endDate" render={({ field }) => (
                                            <FormItem className="flex flex-col"><FormLabel>Date de Fin</FormLabel>
                                                <Popover><PopoverTrigger asChild><FormControl>
                                                    <Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                                                        {field.value ? format(field.value, "PPP", { locale: fr }) : <span>Choisir une date</span>}
                                                    </Button>
                                                </FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start">
                                                        <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus locale={fr} />
                                                    </PopoverContent></Popover><FormMessage />
                                            </FormItem>
                                        )} />
                                    </div>

                                    <FormField control={form.control} name="renewal" render={({ field }) => (
                                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                            <div className="space-y-0.5"><FormLabel>Reconduction</FormLabel></div>
                                            <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                        </FormItem>
                                    )} />

                                    {form.watch("renewal") && (
                                        <div className="space-y-4 pt-2">
                                            <FormField control={form.control} name="tacitRenewal" render={({ field }) => (
                                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                                    <div className="space-y-0.5"><FormLabel>Tacite Reconduction</FormLabel></div>
                                                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                                </FormItem>
                                            )} />
                                            <FormField control={form.control} name="renewalDuration" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Durée de reconduction</FormLabel>
                                                    <FormControl><Input placeholder="Ex: 12 mois" {...field} /></FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )} />
                                        </div>
                                    )}

                                    <FormField control={form.control} name="noticePeriod" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Préavis de résiliation</FormLabel>
                                            <FormControl><Input placeholder="Ex: 2 mois" {...field} /></FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )} />

                                    <Separator />

                                    <div className="grid grid-cols-2 gap-4">
                                        <FormField control={form.control} name="baseAmountP1" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Montant P1 (HT/an)</FormLabel>
                                                <FormControl>
                                                    <div className="relative">
                                                        <Euro className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                                        <Input type="number" className="pl-8" {...field} onChange={e => field.onChange(e.target.value === '' ? undefined : e.target.valueAsNumber)} />
                                                    </div>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name="baseAmountP2" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Montant P2 (HT/an)</FormLabel>
                                                <FormControl>
                                                    <div className="relative">
                                                        <Euro className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                                        <Input type="number" className="pl-8" {...field} onChange={e => field.onChange(e.target.value === '' ? undefined : e.target.valueAsNumber)} />
                                                    </div>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <FormField control={form.control} name="baseAmountP3" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Montant P3 (HT/an)</FormLabel>
                                                <FormControl>
                                                    <div className="relative">
                                                        <Euro className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                                        <Input type="number" className="pl-8" {...field} onChange={e => field.onChange(e.target.value === '' ? undefined : e.target.valueAsNumber)} />
                                                    </div>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name="baseAmountP3R" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Montant P3R (HT/an)</FormLabel>
                                                <FormControl>
                                                    <div className="relative">
                                                        <Euro className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                                        <Input type="number" className="pl-8" {...field} onChange={e => field.onChange(e.target.value === '' ? undefined : e.target.valueAsNumber)} />
                                                    </div>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <FormField control={form.control} name="contractName" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Nom du Contrat</FormLabel>
                                                <FormControl><Input {...field} /></FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name="label" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Libellé</FormLabel>
                                                <FormControl><Input {...field} /></FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                    </div>

                                    <FormField control={form.control} name="term" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Périodicité</FormLabel>
                                            <FormControl><Input placeholder="Ex: Trimestriel" {...field} /></FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )} />

                                    <div className="space-y-2">
                                        <Label className="text-sm font-medium text-muted-foreground">Révisions</Label>
                                        <FormField control={form.control} name="revisionP1" render={({ field }) => (
                                            <FormItem><FormControl><Input placeholder="Formule P1" {...field} /></FormControl></FormItem>
                                        )} />
                                        <FormField control={form.control} name="revisionP2" render={({ field }) => (
                                            <FormItem><FormControl><Input placeholder="Formule P2" {...field} /></FormControl></FormItem>
                                        )} />
                                        <FormField control={form.control} name="revisionP3" render={({ field }) => (
                                            <FormItem><FormControl><Input placeholder="Formule P3" {...field} /></FormControl></FormItem>
                                        )} />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <FormField control={form.control} name="heatingReferenceDju" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>DJU Référence</FormLabel>
                                                <FormControl><Input type="number" {...field} onChange={e => field.onChange(e.target.value === '' ? undefined : e.target.valueAsNumber)} /></FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name="heatingWeatherStation" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Station Météo</FormLabel>
                                                <FormControl><Input {...field} /></FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <FormField control={form.control} name="contractualNB" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>NB (Nombre de Base)</FormLabel>
                                                <FormControl><Input type="number" {...field} onChange={e => field.onChange(e.target.value === '' ? undefined : e.target.valueAsNumber)} /></FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name="smallQ" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Petit q</FormLabel>
                                                <FormControl><Input type="number" {...field} onChange={e => field.onChange(e.target.value === '' ? undefined : e.target.valueAsNumber)} /></FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />
                                    </div>

                                    <div className="flex flex-wrap gap-4">
                                        <FormField control={form.control} name="hasInterest" render={({ field }) => (
                                            <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                                                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                                <FormLabel>Intéressement</FormLabel>
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name="hasHeating" render={({ field }) => (
                                            <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                                                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                                <FormLabel>Chauffage</FormLabel>
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name="hasECS" render={({ field }) => (
                                            <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                                                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                                <FormLabel>ECS</FormLabel>
                                            </FormItem>
                                        )} />
                                    </div>
                                </div>

                                <div className="flex justify-end gap-4 pt-4">
                                    <Button type="button" variant="outline" onClick={() => setIsSheetOpen(false)}>Annuler</Button>
                                    <Button type="submit">Valider</Button>
                                </div>
                            </form>
                        </Form>
                    </div>
                </SheetContent>
            </Sheet>
        </div >
    );
}
