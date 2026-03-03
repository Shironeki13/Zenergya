"use client";

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, FileText, ArrowLeft, Sparkles, Building, FileSignature, Euro, MapPin, Users, ChevronDown, ChevronUp, FileUp, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { extractContractInfo } from '@/ai/flows/extract-contract-info-flow';
import { createClientAndContract } from '@/services/firestore';
import { uploadFile } from '@/services/storage';
import { useData } from '@/context/data-context';
import { ClientBaseSchema } from "@/lib/types";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
6.  **Contacts** : Identifie et extrais les contacts mentionnés dans le contrat :
    - **Contact Technique** (\`contactTechnique\`) : La personne à contacter pour les aspects techniques (gardien, gestionnaire technique, responsable technique, syndic opérationnel...). Extrais son nom, email, téléphone, et son rôle/fonction (ex: "Gardien", "Gestionnaire", "Responsable Technique").
    - **Contact Facturation** (\`contactFacturation\`) : La personne ou service à contacter pour la facturation (comptable, service comptabilité, ordonnateur, trésorier...). Extrais son nom, email, téléphone, et son rôle/fonction (ex: "Comptable", "Service Facturation", "Gestionnaire").
    - Si un seul contact est mentionné, utilise-le pour les deux.
    - Si aucun contact explicite n'est mentionné mais qu'un représentant (Syndic) est identifié, utilise-le comme contact technique avec le rôle "Syndic".

**Instructions Logiques pour le CONTRAT :**
1.  **Nom & Libellé** :
    - \`name\` : "Contrat Maintenance - [Nom Client]" (ex: "Contrat Maintenance - Le Bastion").
    - \`label\` : Type de prestations (ex: "Chauffage & ECS (Type P1 MTI - P2)").
2.  **Dates & Durée** :
    - \`startDate\` : Date d'effet du contrat.
    - \`endDate\` : Date de fin (souvent calculée : date effet + durée).
    - \`durationStr\` : Durée telle qu'écrite dans le contrat (ex: "2 ans", "5 ans").
3.  **Montants (HT/an)** :
    - \`baseAmountP1\` : Montant P1 (Total P1 ou Forfait P1).
    - \`baseAmountP2\` : Montant P2 (Total P2 ou Forfait P2).
    - \`baseAmountP3\` : Montant P3 (Garantie totale).
    - \`baseAmountP3R\` : Montant P3R (Renouvellement).
4.  **Reconduction** :
    - \`tacitRenewal\` : \`true\` si reconduction tacite.
    - \`noticePeriod\` : Préavis de résiliation (ex: "3 mois", "6 mois").

**Instructions Logiques pour le SITE :**
1.  **Facturation** :
    - \`billingSchedule\` : Périodicité de facturation (ex: "Mensuel", "Trimestriel", "Annuel").
    - \`term\` : Terme de paiement (ex: "Échu", "Échoir").
2.  **Révisions de Prix** :
    - \`revisionP1\` : Formule complète de révision P1.
    - \`revisionP2\` : Formule ou indice de révision P2.
    - \`revisionP3\` : Formule de révision P3.
3.  **Données Techniques P1** :
    - \`heatingReferenceDju\` : DJU de référence (ex: 1200, 2050).
    - \`heatingWeatherStation\` : Station météo de référence (ex: "Nice", "Le Bourget").
    - \`contractualNB\` : Valeur du NB contractuel.
    - \`smallQ\` : Valeur du petit q.
4.  **Options P1** :
    - \`hasHeating\` : \`true\` si prestation de chauffage (P1 Chauffage).
    - \`hasECS\` : \`true\` si prestation d'Eau Chaude Sanitaire (P1 ECS).
    - \`hasInterest\` : \`true\` si mention d'intéressement ou de partage d'économies.

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
    "contactTechnique": { "name": "...", "email": "...", "phone": "...", "role": "..." },
    "contactFacturation": { "name": "...", "email": "...", "phone": "...", "role": "..." }
  },
  "contrat": {
     "name": "Nom du contrat",
     "label": "Libellé",
     "objet": "Objet du contrat",
     "startDate": "YYYY-MM-DD",
     "durationStr": "Durée (ex: 2 ans)",
     "endDate": "YYYY-MM-DD",
     "tacitRenewal": boolean,
     "noticePeriod": "Préavis",
     "baseAmountP1": number,
     "baseAmountP2": number,
     "baseAmountP3": number,
     "baseAmountP3R": number
  },
  "site": {
     "billingSchedule": "Périodicité (ex: Mensuel, Trimestriel)",
     "term": "Terme (ex: Échu, Échoir)",
     "revisionP1": "Formule...",
     "revisionP2": "Formule...",
     "revisionP3": "Formule...",
     "heatingReferenceDju": number,
     "heatingWeatherStation": "Station...",
     "hasInterest": boolean,
     "hasHeating": boolean,
     "hasECS": boolean,
     "contractualNB": number,
     "smallQ": number
  }
}`;

// Site sub-schema for the Site tab
const SiteFormSchema = z.object({
    name: z.string().optional(),
    address: z.string().optional(),
    postalCode: z.string().optional(),
    city: z.string().optional(),
    billingSchedule: z.string().optional(),
    term: z.string().optional(),
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

// Extended schema: Client + Contacts + Contract + Site
const ExtendedClientSchema = ClientBaseSchema.extend({
    // Contact fields (saved as separate Contact entities)
    technicalContactName: z.string().optional(),
    technicalContactEmail: z.string().optional(),
    technicalContactPhone: z.string().optional(),
    technicalContactRole: z.string().optional(),
    billingContactName: z.string().optional(),
    billingContactEmail: z.string().optional(),
    billingContactPhone: z.string().optional(),
    billingContactRole: z.string().optional(),
    // Contract fields
    startDate: z.date().optional(),
    endDate: z.date().optional(),
    contractName: z.string().optional(),
    label: z.string().optional(),
    baseAmountP1: z.number().optional(),
    baseAmountP2: z.number().optional(),
    baseAmountP3: z.number().optional(),
    baseAmountP3R: z.number().optional(),
    renewal: z.boolean().default(false),
    tacitRenewal: z.boolean().default(false),
    renewalDuration: z.string().optional(),
    noticePeriod: z.string().optional(),
    // Site (nested)
    site: SiteFormSchema.default({}),
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
    const [isDragging, setIsDragging] = useState(false);
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [isPromptExpanded, setIsPromptExpanded] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

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
            technicalContactRole: "",
            billingContactName: "",
            billingContactEmail: "",
            billingContactPhone: "",
            billingContactRole: "",
            baseAmountP1: undefined,
            baseAmountP2: undefined,
            typologyId: "",

            site: {
                name: "",
                address: "",
                postalCode: "",
                city: "",
                billingSchedule: "Mensuel",
                term: "",
                revisionP1: "",
                revisionP2: "",
                revisionP3: "",
                hasInterest: false,
                hasHeating: false,
                hasECS: false,
            },
        },
    });

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const newFile = e.target.files[0];
            setFile(newFile);
            if (pdfUrl) URL.revokeObjectURL(pdfUrl);
            setPdfUrl(URL.createObjectURL(newFile));
        }
    };

    const removeFile = () => {
        setFile(null);
        if (pdfUrl) {
            URL.revokeObjectURL(pdfUrl);
            setPdfUrl(null);
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
        const droppedFile = e.dataTransfer.files[0];
        if (droppedFile?.type === 'application/pdf') {
            setFile(droppedFile);
            if (pdfUrl) URL.revokeObjectURL(pdfUrl);
            setPdfUrl(URL.createObjectURL(droppedFile));
        }
    };

    useEffect(() => {
        return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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

                    // Map AI result to form values — respecting new tabbed structure
                    const mappedData: Partial<ClientFormValues> = {
                        // === TAB 1: Client ===
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

                        // === TAB 2: Contacts ===
                        technicalContactName: result.client?.contactTechnique?.name || "",
                        technicalContactEmail: result.client?.contactTechnique?.email || "",
                        technicalContactPhone: result.client?.contactTechnique?.phone || "",
                        technicalContactRole: result.client?.contactTechnique?.role || "",
                        billingContactName: result.client?.contactFacturation?.name || "",
                        billingContactEmail: result.client?.contactFacturation?.email || "",
                        billingContactPhone: result.client?.contactFacturation?.phone || "",
                        billingContactRole: result.client?.contactFacturation?.role || "",

                        // === TAB 3: Contrat ===
                        startDate: result.contrat?.startDate ? new Date(result.contrat.startDate) : undefined,
                        endDate: result.contrat?.endDate ? new Date(result.contrat.endDate) : undefined,
                        renewalDuration: result.contrat?.durationStr || "",
                        tacitRenewal: result.contrat?.tacitRenewal || false,
                        noticePeriod: result.contrat?.noticePeriod || "",
                        renewal: !!result.contrat?.tacitRenewal,
                        baseAmountP1: result.contrat?.baseAmountP1,
                        baseAmountP2: result.contrat?.baseAmountP2,
                        baseAmountP3: result.contrat?.baseAmountP3,
                        baseAmountP3R: result.contrat?.baseAmountP3R,
                        contractName: result.contrat?.name || "",
                        label: result.contrat?.label || "",

                        // === TAB 4: Site ===
                        site: {
                            name: result.client?.name || "", // Default site name to client name
                            address: result.client?.address || "",
                            postalCode: result.client?.postalCode || "",
                            city: result.client?.city || "",
                            billingSchedule: result.site?.billingSchedule || "Mensuel",
                            term: result.site?.term || "",
                            revisionP1: result.site?.revisionP1 || "",
                            revisionP2: result.site?.revisionP2 || "",
                            revisionP3: result.site?.revisionP3 || "",
                            heatingReferenceDju: result.site?.heatingReferenceDju,
                            heatingWeatherStation: result.site?.heatingWeatherStation || "",
                            hasInterest: result.site?.hasInterest || false,
                            hasHeating: result.site?.hasHeating || false,
                            hasECS: result.site?.hasECS || false,
                            contractualNB: result.site?.contractualNB,
                            smallQ: result.site?.smallQ,
                        },

                        // Preserve hierarchy
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

            // Separate site data from the rest
            const { site: siteData, ...restData } = data;

            const contractData = {
                ...restData,
                clientType: 'private',
                validationStatus: 'pending_validation',
                requesterEmail: currentUser?.email,
                documents: downloadUrl ? [{
                    name: file?.name || 'Contrat.pdf',
                    type: 'application/pdf',
                    url: downloadUrl
                }] : [],
                // Pass site data for createClientAndContract to handle
                site: siteData,
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

            <div className="space-y-4">
                {/* Zone de dépôt / Prévisualisation PDF */}
                <div
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    className={cn(
                        "border-2 border-dashed rounded-xl transition-all",
                        isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
                    )}
                >
                    {!file ? (
                        <div
                            className="flex flex-col items-center gap-4 py-20 px-8 text-center cursor-pointer"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <div className="rounded-full bg-muted p-5">
                                <FileUp className="h-10 w-10 text-muted-foreground" />
                            </div>
                            <div>
                                <p className="text-base font-medium">Glissez votre contrat PDF ici</p>
                                <p className="text-sm text-muted-foreground mt-1">ou cliquez pour parcourir vos fichiers</p>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                type="button"
                                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                            >
                                Parcourir...
                            </Button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".pdf"
                                className="hidden"
                                onChange={handleFileChange}
                            />
                        </div>
                    ) : (
                        <div className="p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-sm">
                                    <FileText className="h-4 w-4 text-primary" />
                                    <span className="font-medium">{file.name}</span>
                                    <span className="text-muted-foreground">({(file.size / 1024 / 1024).toFixed(2)} Mo)</span>
                                </div>
                                <Button variant="ghost" size="icon" type="button" onClick={removeFile}>
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                            {pdfUrl && (
                                <iframe
                                    src={pdfUrl}
                                    className="w-full rounded-lg border bg-white"
                                    style={{ height: '620px' }}
                                    title="Prévisualisation du contrat"
                                />
                            )}
                        </div>
                    )}
                </div>

                {/* Configuration IA (accordéon) */}
                <div className="border rounded-lg overflow-hidden">
                    <button
                        type="button"
                        className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors text-left"
                        onClick={() => setIsPromptExpanded(!isPromptExpanded)}
                    >
                        <div className="flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-primary" />
                            <span className="text-sm font-medium">Configuration de l&apos;IA</span>
                            <span className="text-xs text-muted-foreground">(paramètres avancés)</span>
                        </div>
                        {isPromptExpanded
                            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        }
                    </button>
                    {isPromptExpanded && (
                        <div className="p-4 border-t">
                            <Textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                className="min-h-[200px] font-mono text-xs"
                            />
                        </div>
                    )}
                </div>

                {/* Boutons d'action */}
                <div className="flex justify-end gap-3">
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={() => { form.reset(); setIsSheetOpen(true); }}
                    >
                        <FileText className="mr-2 h-4 w-4" />
                        Saisie Manuelle
                    </Button>
                    <Button
                        type="button"
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
                                Lancer l&apos;analyse
                            </>
                        )}
                    </Button>
                </div>
            </div>

            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
                    <SheetHeader>
                        <SheetTitle>Validation de l&apos;analyse</SheetTitle>
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
                            })} className="space-y-6">

                                {/* Section Hiérarchie (always visible above tabs) */}
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

                                {/* ===== TABBED FORM ===== */}
                                <Tabs defaultValue="client" className="w-full">
                                    <TabsList className="grid w-full grid-cols-4">
                                        <TabsTrigger value="client" className="gap-1.5">
                                            <Building className="h-3.5 w-3.5" />
                                            Client
                                        </TabsTrigger>
                                        <TabsTrigger value="contacts" className="gap-1.5">
                                            <Users className="h-3.5 w-3.5" />
                                            Contacts
                                        </TabsTrigger>
                                        <TabsTrigger value="contrat" className="gap-1.5">
                                            <FileSignature className="h-3.5 w-3.5" />
                                            Contrat
                                        </TabsTrigger>
                                        <TabsTrigger value="site" className="gap-1.5">
                                            <MapPin className="h-3.5 w-3.5" />
                                            Site
                                        </TabsTrigger>
                                    </TabsList>

                                    {/* ===== TAB 1: CLIENT ===== */}
                                    <TabsContent value="client" className="space-y-4 pt-4">
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
                                    </TabsContent>

                                    {/* ===== TAB 2: CONTACTS ===== */}
                                    <TabsContent value="contacts" className="space-y-6 pt-4">
                                        <div className="space-y-3">
                                            <Label className="text-sm font-semibold">Contact Technique</Label>
                                            <div className="grid grid-cols-2 gap-3">
                                                <FormField control={form.control} name="technicalContactName" render={({ field }) => (
                                                    <FormItem><FormControl><Input placeholder="Nom" {...field} /></FormControl></FormItem>
                                                )} />
                                                <FormField control={form.control} name="technicalContactRole" render={({ field }) => (
                                                    <FormItem><FormControl><Input placeholder="Rôle / Fonction (ex: Gardien)" {...field} /></FormControl></FormItem>
                                                )} />
                                                <FormField control={form.control} name="technicalContactEmail" render={({ field }) => (
                                                    <FormItem><FormControl><Input placeholder="Email" {...field} /></FormControl></FormItem>
                                                )} />
                                                <FormField control={form.control} name="technicalContactPhone" render={({ field }) => (
                                                    <FormItem><FormControl><Input placeholder="Téléphone" {...field} /></FormControl></FormItem>
                                                )} />
                                            </div>
                                        </div>

                                        <Separator />

                                        <div className="space-y-3">
                                            <Label className="text-sm font-semibold">Contact Facturation</Label>
                                            <div className="grid grid-cols-2 gap-3">
                                                <FormField control={form.control} name="billingContactName" render={({ field }) => (
                                                    <FormItem><FormControl><Input placeholder="Nom" {...field} /></FormControl></FormItem>
                                                )} />
                                                <FormField control={form.control} name="billingContactRole" render={({ field }) => (
                                                    <FormItem><FormControl><Input placeholder="Rôle / Fonction (ex: Comptable)" {...field} /></FormControl></FormItem>
                                                )} />
                                                <FormField control={form.control} name="billingContactEmail" render={({ field }) => (
                                                    <FormItem><FormControl><Input placeholder="Email" {...field} /></FormControl></FormItem>
                                                )} />
                                                <FormField control={form.control} name="billingContactPhone" render={({ field }) => (
                                                    <FormItem><FormControl><Input placeholder="Téléphone" {...field} /></FormControl></FormItem>
                                                )} />
                                            </div>
                                        </div>
                                    </TabsContent>

                                    {/* ===== TAB 3: CONTRAT ===== */}
                                    <TabsContent value="contrat" className="space-y-4 pt-4">
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
                                    </TabsContent>

                                    {/* ===== TAB 4: SITE ===== */}
                                    <TabsContent value="site" className="space-y-4 pt-4">
                                        <FormField control={form.control} name="site.name" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Nom du Site</FormLabel>
                                                <FormControl><Input placeholder="Ex: Résidence Le Bastion" {...field} /></FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />

                                        <FormField control={form.control} name="site.address" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Adresse du Site</FormLabel>
                                                <FormControl><Input {...field} /></FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )} />

                                        <div className="grid grid-cols-2 gap-4">
                                            <FormField control={form.control} name="site.postalCode" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Code Postal</FormLabel>
                                                    <FormControl><Input {...field} /></FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )} />
                                            <FormField control={form.control} name="site.city" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Ville</FormLabel>
                                                    <FormControl><Input {...field} /></FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )} />
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <FormField control={form.control} name="site.billingSchedule" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Périodicité de Facturation</FormLabel>
                                                    <FormControl><Input placeholder="Ex: Mensuel" {...field} /></FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )} />
                                            <FormField control={form.control} name="site.term" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Terme / Échéance</FormLabel>
                                                    <FormControl><Input placeholder="Ex: Échu" {...field} /></FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )} />
                                        </div>

                                        <Separator />

                                        <div className="space-y-2">
                                            <Label className="text-sm font-semibold">Formules de Révision</Label>
                                            <FormField control={form.control} name="site.revisionP1" render={({ field }) => (
                                                <FormItem><FormControl><Input placeholder="Formule P1" {...field} /></FormControl></FormItem>
                                            )} />
                                            <FormField control={form.control} name="site.revisionP2" render={({ field }) => (
                                                <FormItem><FormControl><Input placeholder="Formule P2" {...field} /></FormControl></FormItem>
                                            )} />
                                            <FormField control={form.control} name="site.revisionP3" render={({ field }) => (
                                                <FormItem><FormControl><Input placeholder="Formule P3" {...field} /></FormControl></FormItem>
                                            )} />
                                        </div>

                                        <Separator />

                                        <div className="grid grid-cols-2 gap-4">
                                            <FormField control={form.control} name="site.heatingReferenceDju" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>DJU Référence</FormLabel>
                                                    <FormControl><Input type="number" {...field} onChange={e => field.onChange(e.target.value === '' ? undefined : e.target.valueAsNumber)} /></FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )} />
                                            <FormField control={form.control} name="site.heatingWeatherStation" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Station Météo</FormLabel>
                                                    <FormControl><Input {...field} /></FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )} />
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <FormField control={form.control} name="site.contractualNB" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>NB (Nombre de Base)</FormLabel>
                                                    <FormControl><Input type="number" {...field} onChange={e => field.onChange(e.target.value === '' ? undefined : e.target.valueAsNumber)} /></FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )} />
                                            <FormField control={form.control} name="site.smallQ" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Petit q</FormLabel>
                                                    <FormControl><Input type="number" {...field} onChange={e => field.onChange(e.target.value === '' ? undefined : e.target.valueAsNumber)} /></FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )} />
                                        </div>

                                        <div className="flex flex-wrap gap-4">
                                            <FormField control={form.control} name="site.hasInterest" render={({ field }) => (
                                                <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                                                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                                    <FormLabel>Intéressement</FormLabel>
                                                </FormItem>
                                            )} />
                                            <FormField control={form.control} name="site.hasHeating" render={({ field }) => (
                                                <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                                                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                                    <FormLabel>Chauffage</FormLabel>
                                                </FormItem>
                                            )} />
                                            <FormField control={form.control} name="site.hasECS" render={({ field }) => (
                                                <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                                                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                                    <FormLabel>ECS</FormLabel>
                                                </FormItem>
                                            )} />
                                        </div>
                                    </TabsContent>
                                </Tabs>

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
