"use client";

import { useState, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
    Loader2, FileText, Calendar as CalendarIcon, X, Sparkles, ArrowLeft,
    Building, Users, FileSignature, MapPin, Euro,
    ChevronDown, ChevronUp, FileUp
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
    Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
    Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Calendar } from "@/components/ui/calendar";
import {
    Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

import { useData } from "@/context/data-context";
import { extractContractInfo } from "@/ai/flows/extract-contract-info-flow";
import { createClientAndContract } from "@/services/firestore";
import { uploadFile } from "@/services/storage";
import { ClientBaseSchema, ActivityDetailSchema } from "@/lib/types";
import Link from "next/link";
import { cn } from "@/lib/utils";

const defaultPrompt = `
Analyse ce contrat de marché public (CCTP, AE ou CCAP) et extrais les informations suivantes au format JSON.
Si une information est introuvable, laisse le champ vide ou null.

**CLIENT :**
- Nom du client (name): Le nom de l'entité publique (ex: "Mairie de...", "Communauté de communes...").
- Adresse (address): L'adresse postale complète du site d'exécution.
- Code postal (postalCode): Le code postal.
- Ville (city): La ville.
- SIRET (siret): Le numéro SIRET du client.
- Type de client (clientType): Toujours "public".
- Contacts : Identifie le contact technique et le contact facturation si mentionnés.

**CONTRAT :**
- Date de démarrage (startDate): La date de début du contrat ou de notification, au format YYYY-MM-DD.
- Date de fin (endDate): La date de fin du contrat, au format YYYY-MM-DD.
- Reconduction (renewal): Indique si le contrat est à reconduction (true ou false), souvent dans le CCAP.
- Durée de la reconduction (renewalDuration): Si la reconduction est activée, précise sa durée (ex: '1 an').
- Tacite reconduction (tacitRenewal): Si la reconduction est activée, indique si elle est tacite (true ou false).
- Code service Chorus (chorusServiceCode): Le code service pour la facturation Chorus Pro.
- Numéro d'engagement juridique (chorusLegalCommitmentNumber): Le numéro EJ pour Chorus.

**ACTIVITÉS :**
- Activités (activityIds): Liste les IDs des prestations identifiées parmi la liste suivante : {{{json activities}}}.
    - Cherche des mots-clés comme "Fourniture de gaz", "Exploitation CVC", "Maintenance multi-technique", etc.
- Détails des activités (activitiesDetails): Pour chaque prestation identifiée dans 'activityIds', extrais les détails suivants. Retourne un tableau d'objets.
    - activityId: L'ID de l'activité.
    - amount: Le montant annuel HT.
    - termId: Le terme de facturation (ex: échu, à échoir). Retourne l'ID correspondant dans la liste : {{{json terms}}}.
    - scheduleId: La périodicité de facturation (ex: trimestriel, mensuel). Retourne l'ID correspondant dans la liste : {{{json schedules}}}.
    - revisionFormula: La formule de révision de prix.
    - revisionBaseIndices: Les valeurs de base des indices de révision (mois 0). Retourne un tableau d'objets { code: string, value: number, description?: string }. Cherche les valeurs comme "ATRD0", "TICGN0", "Indice_0", "Valeur initiale", etc.
    - SI l'activité est de type P1 (Fourniture d'énergie), extrais aussi :
        - weatherStation: La station météo de référence.
        - contractualTemperature: La température contractuelle moyenne.
        - contractualDJU: Les DJU contractuels.
        - contractualNB: Le NB contractuel.
        - ecsSmallQ: Le petit q ECS.
        - ecsNB: Le NB ECS.

**SITE :**
- Périodicité de facturation (billingSchedule): Périodicité générale (ex: "Mensuel", "Trimestriel").
- Terme de paiement (term): Terme de paiement (ex: "Échu", "Échoir").
`;

// Site sub-schema for the Site tab
const SiteFormSchema = z.object({
    name: z.string().optional(),
    address: z.string().optional(),
    postalCode: z.string().optional(),
    city: z.string().optional(),
    billingSchedule: z.string().optional(),
    term: z.string().optional(),
});

// Extended schema: Client + Contacts + Contract + Site
const MarketPublicFormSchema = ClientBaseSchema.extend({
    invoicingType: z.enum(['multi-site', 'global']).default('multi-site'),
    activityIds: z.array(z.string()).optional(),
    activitiesDetails: z.array(ActivityDetailSchema).optional(),
    startDate: z.date().optional(),
    endDate: z.date().optional(),
    renewal: z.boolean().default(false),
    tacitRenewal: z.boolean().default(false),
    renewalDuration: z.string().optional(),
    noticePeriod: z.string().optional(),
    // Contact fields
    technicalContactName: z.string().optional(),
    technicalContactEmail: z.string().optional(),
    technicalContactPhone: z.string().optional(),
    technicalContactRole: z.string().optional(),
    billingContactName: z.string().optional(),
    billingContactEmail: z.string().optional(),
    billingContactPhone: z.string().optional(),
    billingContactRole: z.string().optional(),
    // Site (nested)
    site: SiteFormSchema.default({}),
});

type ClientFormValues = z.infer<typeof MarketPublicFormSchema>;

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

export default function PublicMarketAIPage() {
    const [files, setFiles] = useState<Record<DocumentType, File | null>>({
        acteEngagement: null, ccap: null, cctp: null, notification: null, bpu: null, dpgf: null
    });
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisResult, setAnalysisResult] = useState<Partial<ClientFormValues> | null>(null);
    const [isSheetOpen, setIsSheetOpen] = useState(false);
    const [prompt, setPrompt] = useState(defaultPrompt);
    const [draggingOver, setDraggingOver] = useState<DocumentType | null>(null);
    const [isPromptExpanded, setIsPromptExpanded] = useState(false);
    const fileInputRefs = useRef<Record<DocumentType, HTMLInputElement | null>>({
        acteEngagement: null, ccap: null, cctp: null, notification: null, bpu: null, dpgf: null
    });

    const { toast } = useToast();
    const router = useRouter();
    const { clients, typologies, activities, terms, schedules, companies, agencies, sectors, currentUser } = useData();

    const form = useForm<ClientFormValues>({
        resolver: zodResolver(MarketPublicFormSchema),
        defaultValues: {
            name: "",
            address: "",
            postalCode: "",
            city: "",
            clientType: "public",
            representedBy: "",
            externalCode: "",
            isBe: false,
            beName: "",
            beEmail: "",
            bePhone: "",
            useChorus: true,
            siret: "",
            chorusServiceCode: "",
            chorusLegalCommitmentNumber: "",
            chorusMarketNumber: "",
            invoicingType: "multi-site",
            renewal: false,
            tacitRenewal: false,
            activityIds: [],
            activitiesDetails: [],
            companyId: "",
            agencyId: "",
            sectorId: "",
            typologyId: "",
            technicalContactName: "",
            technicalContactEmail: "",
            technicalContactPhone: "",
            technicalContactRole: "",
            billingContactName: "",
            billingContactEmail: "",
            billingContactPhone: "",
            billingContactRole: "",

            site: {
                name: "",
                address: "",
                postalCode: "",
                city: "",
                billingSchedule: "Mensuel",
                term: "",
            },
        },
    });

    const watchCompanyId = form.watch("companyId");
    const watchAgencyId = form.watch("agencyId");
    const watchRenewal = form.watch("renewal");
    const watchActivityIds = form.watch("activityIds") || [];

    const filteredAgencies = useMemo(() =>
        agencies.filter(a => a.companyId === watchCompanyId),
        [agencies, watchCompanyId]
    );

    const filteredSectors = useMemo(() =>
        sectors.filter(s => s.agencyId === watchAgencyId),
        [sectors, watchAgencyId]
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
            setFiles(prev => ({ ...prev, [type]: file }));
        }
    };

    const removeFile = (type: DocumentType) => {
        setFiles(prev => ({ ...prev, [type]: null }));
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>, type: DocumentType) => {
        e.preventDefault();
        setDraggingOver(null);
        const droppedFile = e.dataTransfer.files[0];
        if (droppedFile?.type === 'application/pdf') {
            setFiles(prev => ({ ...prev, [type]: droppedFile }));
        } else if (droppedFile) {
            toast({ title: "Fichier invalide", description: "Seuls les fichiers PDF sont acceptés.", variant: "destructive" });
        }
    };

    const handleAnalyze = async () => {
        const fileToAnalyze = files.cctp || files.acteEngagement || files.ccap || Object.values(files).find(f => f !== null);

        if (!fileToAnalyze) {
            toast({
                title: "Aucun document sélectionné",
                description: "Veuillez sélectionner au moins un document PDF (CCTP, AE ou CCAP) à analyser.",
                variant: "destructive",
            });
            return;
        }
        setIsAnalyzing(true);

        try {
            const documentDataUri = await fileToDataUrl(fileToAnalyze);
            const result = await extractContractInfo({
                documentDataUri,
                activities: activities.map(({ id, code, label }) => ({ id, code, label })),
                prompt,
                typologies: typologies.map(({ id, name }) => ({ id, name })),
                schedules: schedules.map(({ id, name }) => ({ id, name })),
                terms: terms.map(({ id, name }) => ({ id, name }))
            });

            const mappedData: Partial<ClientFormValues> = {
                // === TAB 1: Client ===
                name: result.client?.name || "",
                address: result.client?.address || "",
                postalCode: result.client?.postalCode || "",
                city: result.client?.city || "",
                clientType: "public",
                useChorus: true,
                siret: result.client?.siret || "",

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
                renewal: result.contrat?.tacitRenewal || false,
                tacitRenewal: result.contrat?.tacitRenewal || false,
                noticePeriod: result.contrat?.noticePeriod || "",
                activityIds: result.activityIds ?? [],
                activitiesDetails: result.activitiesDetails ?? [],

                // === TAB 4: Site ===
                site: {
                    name: result.client?.name || "",
                    address: result.client?.address || "",
                    postalCode: result.client?.postalCode || "",
                    city: result.client?.city || "",
                    billingSchedule: result.site?.billingSchedule || "Mensuel",
                    term: result.site?.term || "",
                },

                // Preserve hierarchy
                companyId: form.getValues("companyId"),
                agencyId: form.getValues("agencyId"),
                sectorId: form.getValues("sectorId"),
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
        try {
            // Upload all files
            const uploadedDocs: { name: string; type: string; url: string }[] = [];
            const timestamp = Date.now();

            for (const [type, file] of Object.entries(files)) {
                if (file) {
                    const path = `contracts/${timestamp}_${type}_${file.name}`;
                    const url = await uploadFile(file, path);
                    uploadedDocs.push({
                        name: file.name,
                        type: 'application/pdf',
                        url,
                    });
                }
            }

            // Separate site data from the rest
            const { site: siteData, ...restData } = data;

            const finalData = {
                ...restData,
                marketType: 'Marché Public' as const,
                validationStatus: 'pending_validation',
                requesterEmail: currentUser?.email,
                documents: uploadedDocs,
                site: siteData,
            };

            await createClientAndContract(finalData);
            toast({
                title: "Marché Public Créé",
                description: "Le client et le contrat ont été enregistrés avec succès.",
            });
            setIsSheetOpen(false);
            router.push('/contracts');
        } catch (error) {
            console.error("Erreur lors de la création:", error);
            toast({
                title: "Erreur",
                description: "Une erreur est survenue lors de l'enregistrement.",
                variant: "destructive",
            });
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="outline" size="icon" onClick={() => router.back()}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Nouveau Marché Public</h1>
                    <p className="text-muted-foreground">
                        Déposez les documents du marché (AE, CCAP, CCTP...) et lancez l&apos;analyse.
                    </p>
                </div>
            </div>

            <div className="space-y-4">
                {/* Grille 3×2 de cards de dépôt */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {documentFields.map((doc) => {
                        const fileUploaded = files[doc.id];
                        const isDraggingOver = draggingOver === doc.id;
                        return (
                            <div
                                key={doc.id}
                                onDragOver={(e) => { e.preventDefault(); setDraggingOver(doc.id); }}
                                onDragLeave={() => setDraggingOver(null)}
                                onDrop={(e) => handleDrop(e, doc.id)}
                                className={cn(
                                    "border-2 border-dashed rounded-xl p-4 transition-all flex flex-col min-h-[130px]",
                                    isDraggingOver
                                        ? "border-primary bg-primary/5"
                                        : fileUploaded
                                            ? "border-green-500/50 bg-green-50/50 dark:bg-green-950/20"
                                            : "border-muted-foreground/25 hover:border-primary/50"
                                )}
                            >
                                {/* En-tête de la card */}
                                <div className="flex items-start justify-between gap-2 mb-3">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-sm font-semibold leading-tight">{doc.label}</span>
                                        {doc.required
                                            ? <span className="text-xs w-fit bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400 px-1.5 py-0.5 rounded">Requis</span>
                                            : <span className="text-xs w-fit bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Optionnel</span>
                                        }
                                    </div>
                                    {fileUploaded && (
                                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" type="button" onClick={() => removeFile(doc.id)}>
                                            <X className="h-3 w-3" />
                                        </Button>
                                    )}
                                </div>

                                {/* Corps : fichier chargé ou zone de dépôt */}
                                {fileUploaded ? (
                                    <div className="flex-1 flex items-center gap-2 text-sm text-green-700 dark:text-green-400 min-w-0">
                                        <FileText className="h-4 w-4 shrink-0" />
                                        <div className="min-w-0">
                                            <p className="truncate font-medium">{fileUploaded.name}</p>
                                            <p className="text-xs text-muted-foreground">{(fileUploaded.size / 1024 / 1024).toFixed(2)} Mo</p>
                                        </div>
                                    </div>
                                ) : (
                                    <div
                                        className="flex-1 flex flex-col items-center justify-center gap-1.5 cursor-pointer py-2"
                                        onClick={() => fileInputRefs.current[doc.id]?.click()}
                                    >
                                        <FileUp className="h-5 w-5 text-muted-foreground/40" />
                                        <span className="text-xs text-muted-foreground text-center">Glisser ou cliquer</span>
                                    </div>
                                )}

                                <input
                                    ref={(el) => { fileInputRefs.current[doc.id] = el; }}
                                    type="file"
                                    accept="application/pdf"
                                    className="hidden"
                                    onChange={(e) => handleFileChange(e, doc.id)}
                                />
                            </div>
                        );
                    })}
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
                                className="min-h-[300px] font-mono text-xs"
                            />
                        </div>
                    )}
                </div>

                {/* Boutons d'action */}
                <div className="flex justify-end gap-3">
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={() => { setAnalysisResult({}); form.reset(); setIsSheetOpen(true); }}
                    >
                        <FileText className="mr-2 h-4 w-4" />
                        Saisie Manuelle
                    </Button>
                    <Button
                        type="button"
                        size="lg"
                        onClick={handleAnalyze}
                        disabled={isAnalyzing || !Object.values(files).some(f => f !== null)}
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
                <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
                    <SheetHeader>
                        <SheetTitle>Valider les informations extraites</SheetTitle>
                        <SheetDescription>
                            Vérifiez, corrigez et complétez les champs ci-dessous avant de créer la base marché.
                        </SheetDescription>
                    </SheetHeader>
                    <div className="py-4 pr-6">
                        {analysisResult !== null && (
                            <Form {...form}>
                                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                                    {/* Hierarchy (always visible) */}
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-2 pb-2 border-b">
                                            <Building className="h-5 w-5 text-primary" />
                                            <h3 className="font-semibold text-lg">Hiérarchie (Obligatoire)</h3>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            <FormField control={form.control} name="companyId" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Société</FormLabel>
                                                    <Select onValueChange={(val) => { field.onChange(val); form.setValue('agencyId', ''); form.setValue('sectorId', ''); }} value={field.value}>
                                                        <FormControl><SelectTrigger><SelectValue placeholder="Choisir..." /></SelectTrigger></FormControl>
                                                        <SelectContent>
                                                            {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                    <FormMessage />
                                                </FormItem>
                                            )} />
                                            <FormField control={form.control} name="agencyId" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Agence</FormLabel>
                                                    <Select onValueChange={(val) => { field.onChange(val); form.setValue('sectorId', ''); }} value={field.value} disabled={!watchCompanyId}>
                                                        <FormControl><SelectTrigger><SelectValue placeholder="Choisir..." /></SelectTrigger></FormControl>
                                                        <SelectContent>
                                                            {filteredAgencies.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                    <FormMessage />
                                                </FormItem>
                                            )} />
                                            <FormField control={form.control} name="sectorId" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Secteur</FormLabel>
                                                    <Select onValueChange={field.onChange} value={field.value} disabled={!watchAgencyId}>
                                                        <FormControl><SelectTrigger><SelectValue placeholder="Choisir..." /></SelectTrigger></FormControl>
                                                        <SelectContent>
                                                            {filteredSectors.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
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
                                                        <FormControl><Input {...field} /></FormControl>
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

                                            <Separator />

                                            {/* Chorus */}
                                            <FormField control={form.control} name="useChorus" render={({ field }) => (
                                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                                    <div className="space-y-0.5"><FormLabel>Dépôt Chorus</FormLabel></div>
                                                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                                </FormItem>
                                            )} />
                                            {form.watch("useChorus") && (
                                                <div className="space-y-4 p-4 border rounded-lg">
                                                    <FormField control={form.control} name="siret" render={({ field }) => (<FormItem><FormLabel>SIRET</FormLabel><FormControl><Input placeholder="12345678901234" {...field} /></FormControl><FormMessage /></FormItem>)} />
                                                    <FormField control={form.control} name="chorusServiceCode" render={({ field }) => (<FormItem><FormLabel>Code service</FormLabel><FormControl><Input placeholder="Code service Chorus" {...field} /></FormControl><FormMessage /></FormItem>)} />
                                                    <FormField control={form.control} name="chorusLegalCommitmentNumber" render={({ field }) => (<FormItem><FormLabel>Numéro engagement juridique</FormLabel><FormControl><Input placeholder="Numéro EJ" {...field} /></FormControl><FormMessage /></FormItem>)} />
                                                </div>
                                            )}
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
                                                        <FormItem><FormControl><Input placeholder="Rôle / Fonction (ex: Directeur technique)" {...field} /></FormControl></FormItem>
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
                                                        <FormItem><FormControl><Input placeholder="Nom / Service" {...field} /></FormControl></FormItem>
                                                    )} />
                                                    <FormField control={form.control} name="billingContactRole" render={({ field }) => (
                                                        <FormItem><FormControl><Input placeholder="Rôle / Fonction (ex: Service comptable)" {...field} /></FormControl></FormItem>
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
                                                    <FormItem className="flex flex-col"><FormLabel>Date de Démarrage</FormLabel>
                                                        <Popover><PopoverTrigger asChild><FormControl>
                                                            <Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                                                                {field.value ? format(field.value, "PPP", { locale: fr }) : <span>Choisir une date</span>}
                                                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
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
                                                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                            </Button>
                                                        </FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start">
                                                                <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus locale={fr} />
                                                            </PopoverContent></Popover><FormMessage />
                                                    </FormItem>
                                                )} />
                                            </div>

                                            <div className="grid grid-cols-2 gap-4 items-start">
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

                                            <Separator />

                                            {/* Activities */}
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

                                                                                            const currentDetails = form.getValues('activitiesDetails') || [];
                                                                                            if (checked) {
                                                                                                if (!currentDetails.find(d => d.activityId === item.id)) {
                                                                                                    form.setValue('activitiesDetails', [...currentDetails, { activityId: item.id, amount: 0 }]);
                                                                                                }
                                                                                            } else {
                                                                                                form.setValue('activitiesDetails', currentDetails.filter(d => d.activityId !== item.id));
                                                                                            }
                                                                                        }}
                                                                                    />
                                                                                </FormControl>
                                                                                <FormLabel className="font-normal">
                                                                                    {item.label}
                                                                                </FormLabel>
                                                                            </FormItem>
                                                                        )
                                                                    }}
                                                                />
                                                            ))}
                                                        </div>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            {watchActivityIds.length > 0 && (
                                                <div className="space-y-6">
                                                    <h3 className="text-lg font-medium">Détails par Activité</h3>
                                                    {activities.filter(a => watchActivityIds.includes(a.id)).map(activity => {
                                                        const detailIndex = form.getValues('activitiesDetails')?.findIndex(a => a.activityId === activity.id) ?? -1;
                                                        if (detailIndex === -1) return null;
                                                        const isP1 = activity.code === 'P1';

                                                        return (
                                                            <Card key={activity.id}>
                                                                <CardHeader><CardTitle>{activity.label} ({activity.code})</CardTitle></CardHeader>
                                                                <CardContent className="space-y-4">
                                                                    <FormField
                                                                        control={form.control}
                                                                        name={`activitiesDetails.${detailIndex}.amount`}
                                                                        render={({ field }) => (
                                                                            <FormItem>
                                                                                <FormLabel>Montant Annuel HT (€)</FormLabel>
                                                                                <FormControl><Input type="number" {...field} onChange={e => field.onChange(parseFloat(e.target.value) || 0)} /></FormControl>
                                                                                <FormMessage />
                                                                            </FormItem>
                                                                        )}
                                                                    />
                                                                    <div className="grid grid-cols-2 gap-4">
                                                                        <FormField
                                                                            control={form.control}
                                                                            name={`activitiesDetails.${detailIndex}.termId`}
                                                                            render={({ field }) => (
                                                                                <FormItem>
                                                                                    <FormLabel>Terme de facturation</FormLabel>
                                                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                                                        <FormControl><SelectTrigger><SelectValue placeholder="Choisir..." /></SelectTrigger></FormControl>
                                                                                        <SelectContent>
                                                                                            {terms.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                                                                                        </SelectContent>
                                                                                    </Select>
                                                                                    <FormMessage />
                                                                                </FormItem>
                                                                            )}
                                                                        />
                                                                        <FormField
                                                                            control={form.control}
                                                                            name={`activitiesDetails.${detailIndex}.scheduleId`}
                                                                            render={({ field }) => (
                                                                                <FormItem>
                                                                                    <FormLabel>Échéancier</FormLabel>
                                                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                                                        <FormControl><SelectTrigger><SelectValue placeholder="Choisir..." /></SelectTrigger></FormControl>
                                                                                        <SelectContent>
                                                                                            {schedules.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                                                                        </SelectContent>
                                                                                    </Select>
                                                                                    <FormMessage />
                                                                                </FormItem>
                                                                            )}
                                                                        />
                                                                    </div>
                                                                    <FormField
                                                                        control={form.control}
                                                                        name={`activitiesDetails.${detailIndex}.revisionFormula`}
                                                                        render={({ field }) => (
                                                                            <FormItem>
                                                                                <FormLabel>Formule de révision</FormLabel>
                                                                                <FormControl><Input {...field} value={field.value ?? ''} /></FormControl>
                                                                                <FormMessage />
                                                                            </FormItem>
                                                                        )}
                                                                    />

                                                                    <div className="space-y-4 border rounded-md p-4">
                                                                        <div className="flex items-center justify-between">
                                                                            <Label>Indices de Révision (Valeurs de base)</Label>
                                                                            <Button
                                                                                type="button"
                                                                                variant="outline"
                                                                                size="sm"
                                                                                onClick={() => {
                                                                                    const currentIndices = form.getValues(`activitiesDetails.${detailIndex}.revisionBaseIndices`) || [];
                                                                                    form.setValue(`activitiesDetails.${detailIndex}.revisionBaseIndices`, [...currentIndices, { code: '', value: 0 }]);
                                                                                }}
                                                                            >
                                                                                Ajouter un indice
                                                                            </Button>
                                                                        </div>
                                                                        {(form.watch(`activitiesDetails.${detailIndex}.revisionBaseIndices`) || []).map((_, index) => (
                                                                            <div key={index} className="flex gap-2 items-start">
                                                                                <FormField
                                                                                    control={form.control}
                                                                                    name={`activitiesDetails.${detailIndex}.revisionBaseIndices.${index}.code`}
                                                                                    render={({ field }) => (
                                                                                        <FormItem className="flex-1">
                                                                                            <FormControl><Input placeholder="Code (ex: ATRD0)" {...field} /></FormControl>
                                                                                            <FormMessage />
                                                                                        </FormItem>
                                                                                    )}
                                                                                />
                                                                                <FormField
                                                                                    control={form.control}
                                                                                    name={`activitiesDetails.${detailIndex}.revisionBaseIndices.${index}.value`}
                                                                                    render={({ field }) => (
                                                                                        <FormItem className="flex-1">
                                                                                            <FormControl><Input type="number" placeholder="Valeur" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} /></FormControl>
                                                                                            <FormMessage />
                                                                                        </FormItem>
                                                                                    )}
                                                                                />
                                                                                <Button
                                                                                    type="button"
                                                                                    variant="ghost"
                                                                                    size="icon"
                                                                                    onClick={() => {
                                                                                        const currentIndices = form.getValues(`activitiesDetails.${detailIndex}.revisionBaseIndices`) || [];
                                                                                        form.setValue(`activitiesDetails.${detailIndex}.revisionBaseIndices`, currentIndices.filter((_, i) => i !== index));
                                                                                    }}
                                                                                >
                                                                                    <X className="h-4 w-4" />
                                                                                </Button>
                                                                            </div>
                                                                        ))}
                                                                    </div>

                                                                    {isP1 && (
                                                                        <>
                                                                            <Separator className="my-4" />
                                                                            <h4 className="text-sm font-semibold mb-2">Données Techniques P1</h4>
                                                                            <div className="grid grid-cols-2 gap-4">
                                                                                <FormField control={form.control} name={`activitiesDetails.${detailIndex}.weatherStation`} render={({ field }) => (<FormItem><FormLabel>Station Météo</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl></FormItem>)} />
                                                                                <FormField control={form.control} name={`activitiesDetails.${detailIndex}.contractualTemperature`} render={({ field }) => (<FormItem><FormLabel>Temp. Contractuelle (°C)</FormLabel><FormControl><Input type="number" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} /></FormControl></FormItem>)} />
                                                                                <FormField control={form.control} name={`activitiesDetails.${detailIndex}.contractualDJU`} render={({ field }) => (<FormItem><FormLabel>DJU Contractuels</FormLabel><FormControl><Input type="number" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} /></FormControl></FormItem>)} />
                                                                                <FormField control={form.control} name={`activitiesDetails.${detailIndex}.contractualNB`} render={({ field }) => (<FormItem><FormLabel>NB Contractuels</FormLabel><FormControl><Input type="number" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} /></FormControl></FormItem>)} />
                                                                                <FormField control={form.control} name={`activitiesDetails.${detailIndex}.ecsSmallQ`} render={({ field }) => (<FormItem><FormLabel>Petit q ECS</FormLabel><FormControl><Input type="number" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} /></FormControl></FormItem>)} />
                                                                                <FormField control={form.control} name={`activitiesDetails.${detailIndex}.ecsNB`} render={({ field }) => (<FormItem><FormLabel>NB ECS</FormLabel><FormControl><Input type="number" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} /></FormControl></FormItem>)} />
                                                                            </div>
                                                                        </>
                                                                    )}
                                                                </CardContent>
                                                            </Card>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </TabsContent>

                                        {/* ===== TAB 4: SITE ===== */}
                                        <TabsContent value="site" className="space-y-4 pt-4">
                                            <FormField control={form.control} name="site.name" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Nom du Site</FormLabel>
                                                    <FormControl><Input placeholder="Ex: Mairie de..." {...field} /></FormControl>
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
                                        </TabsContent>
                                    </Tabs>

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
