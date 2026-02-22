"use client";

import React, { useState, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { batchCreateSites } from "@/services/firestore";
import type { Site, Activity } from "@/lib/types";
import {
    Upload,
    Download,
    FileSpreadsheet,
    CheckCircle,
    AlertCircle,
    Loader2,
    ArrowRight,
    ArrowLeft,
    X,
} from "lucide-react";

// ─── Template columns definition ───────────────────────────────────────────────
const TEMPLATE_COLUMNS = [
    { key: "name", label: "Nom du site", required: true },
    { key: "address", label: "Adresse", required: true },
    { key: "postalCode", label: "Code Postal", required: false },
    { key: "city", label: "Ville", required: false },
    { key: "siteNumber", label: "N° Site", required: false },
    { key: "amountP1", label: "Montant P1", required: false },
    { key: "amountP2", label: "Montant P2", required: false },
    { key: "amountP3", label: "Montant P3", required: false },
    { key: "billingSchedule", label: "Périodicité", required: false },
] as const;

type TemplateKey = (typeof TEMPLATE_COLUMNS)[number]["key"];

const TEMPLATE_HEADERS = TEMPLATE_COLUMNS.map((c) => c.label);

// ─── Types ─────────────────────────────────────────────────────────────────────
type ColumnMapping = Record<TemplateKey, string>; // zenergya field → excel header

type ParsedRow = Record<string, string | number | undefined>;

type ValidatedSite = {
    data: ParsedRow;
    mapped: Partial<Record<TemplateKey, string | number | undefined>>;
    errors: string[];
    valid: boolean;
};

interface SiteImportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    contractId: string;
    clientId: string;
    activities: Activity[];
    onComplete: () => void;
}

// ─── Component ─────────────────────────────────────────────────────────────────
export function SiteImportDialog({
    open,
    onOpenChange,
    contractId,
    clientId,
    activities,
    onComplete,
}: SiteImportDialogProps) {
    const { toast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Step management
    const [step, setStep] = useState<1 | 2 | 3>(1);

    // Step 1 — file data
    const [fileName, setFileName] = useState("");
    const [headers, setHeaders] = useState<string[]>([]);
    const [rawRows, setRawRows] = useState<ParsedRow[]>([]);
    const [isTemplate, setIsTemplate] = useState(false);

    // Step 2 — mapping
    const [mapping, setMapping] = useState<ColumnMapping>({} as ColumnMapping);

    // Step 3 — validated sites
    const [validatedSites, setValidatedSites] = useState<ValidatedSite[]>([]);
    const [isImporting, setIsImporting] = useState(false);
    const [importProgress, setImportProgress] = useState(0);

    // ─── Reset ───────────────────────────────────────────────────────────────────
    const reset = useCallback(() => {
        setStep(1);
        setFileName("");
        setHeaders([]);
        setRawRows([]);
        setIsTemplate(false);
        setMapping({} as ColumnMapping);
        setValidatedSites([]);
        setIsImporting(false);
        setImportProgress(0);
    }, []);

    // ─── Download template ──────────────────────────────────────────────────────
    const handleDownloadTemplate = () => {
        const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS]);
        // Set column widths
        ws["!cols"] = TEMPLATE_HEADERS.map((h) => ({ wch: Math.max(h.length + 4, 15) }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Sites");
        XLSX.writeFile(wb, "template_import_sites.xlsx");
    };

    // ─── File parsing ───────────────────────────────────────────────────────────
    const handleFileUpload = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setFileName(file.name);

            const reader = new FileReader();
            reader.onload = (evt) => {
                try {
                    const data = new Uint8Array(evt.target?.result as ArrayBuffer);
                    const workbook = XLSX.read(data, { type: "array" });
                    const sheetName = workbook.SheetNames[0];
                    const sheet = workbook.Sheets[sheetName];
                    const json = XLSX.utils.sheet_to_json<ParsedRow>(sheet, {
                        defval: "",
                    });

                    if (json.length === 0) {
                        toast({
                            title: "Fichier vide",
                            description: "Le fichier ne contient aucune donnée.",
                            variant: "destructive",
                        });
                        return;
                    }

                    const fileHeaders = Object.keys(json[0]);
                    setHeaders(fileHeaders);
                    setRawRows(json);

                    // Auto-detect template
                    const isTemplateFmt = TEMPLATE_HEADERS.every((h) =>
                        fileHeaders.includes(h)
                    );
                    setIsTemplate(isTemplateFmt);

                    if (isTemplateFmt) {
                        // Auto-map
                        const autoMapping: ColumnMapping = {} as ColumnMapping;
                        TEMPLATE_COLUMNS.forEach((col) => {
                            autoMapping[col.key] = col.label;
                        });
                        setMapping(autoMapping);
                        // Skip step 2, validate directly
                        validateRows(json, autoMapping);
                        setStep(3);
                    } else {
                        // Try smart-mapping by header similarity
                        const smartMapping: ColumnMapping = {} as ColumnMapping;
                        TEMPLATE_COLUMNS.forEach((col) => {
                            const match = fileHeaders.find(
                                (h) =>
                                    h.toLowerCase().includes(col.label.toLowerCase()) ||
                                    col.label.toLowerCase().includes(h.toLowerCase()) ||
                                    h.toLowerCase().includes(col.key.toLowerCase())
                            );
                            if (match) smartMapping[col.key] = match;
                        });
                        setMapping(smartMapping);
                        setStep(2);
                    }
                } catch {
                    toast({
                        title: "Erreur de lecture",
                        description: "Impossible de lire le fichier Excel.",
                        variant: "destructive",
                    });
                }
            };
            reader.readAsArrayBuffer(file);
            // Reset file input so same file can be re-uploaded
            if (fileInputRef.current) fileInputRef.current.value = "";
        },
        [toast]
    );

    // ─── Validation ─────────────────────────────────────────────────────────────
    const validateRows = useCallback(
        (rows: ParsedRow[], currentMapping: ColumnMapping) => {
            const validated: ValidatedSite[] = rows.map((row) => {
                const mapped: Partial<Record<TemplateKey, string | number | undefined>> = {};
                TEMPLATE_COLUMNS.forEach((col) => {
                    const header = currentMapping[col.key];
                    if (header && row[header] !== undefined) {
                        mapped[col.key] = row[header];
                    }
                });

                const errors: string[] = [];
                if (!mapped.name || String(mapped.name).trim() === "") {
                    errors.push("Nom manquant");
                }
                if (!mapped.address || String(mapped.address).trim() === "") {
                    errors.push("Adresse manquante");
                }

                return { data: row, mapped, errors, valid: errors.length === 0 };
            });
            setValidatedSites(validated);
        },
        []
    );

    // ─── Mapping change handler ─────────────────────────────────────────────────
    const handleMappingChange = (field: TemplateKey, excelHeader: string) => {
        setMapping((prev) => ({ ...prev, [field]: excelHeader }));
    };

    const handleConfirmMapping = () => {
        validateRows(rawRows, mapping);
        setStep(3);
    };

    // ─── Build Site objects + import ─────────────────────────────────────────────
    const handleImport = async () => {
        const validSites = validatedSites.filter((s) => s.valid);
        if (validSites.length === 0) return;

        setIsImporting(true);
        setImportProgress(0);

        try {
            // Find activity IDs for P1, P2, P3
            const p1Activity = activities.find((a) => a.type === "P1");
            const p2Activity = activities.find((a) => a.type === "P2");
            const p3Activity = activities.find((a) => a.type === "P3");

            const sitesData: Omit<Site, "id" | "contractId" | "clientId">[] =
                validSites.map((vs) => {
                    const m = vs.mapped;
                    const amounts: { activityId: string; amount: number }[] = [];
                    const activityIds: string[] = [];

                    if (p1Activity && m.amountP1 && Number(m.amountP1) > 0) {
                        amounts.push({ activityId: p1Activity.id, amount: Number(m.amountP1) });
                        activityIds.push(p1Activity.id);
                    }
                    if (p2Activity && m.amountP2 && Number(m.amountP2) > 0) {
                        amounts.push({ activityId: p2Activity.id, amount: Number(m.amountP2) });
                        activityIds.push(p2Activity.id);
                    }
                    if (p3Activity && m.amountP3 && Number(m.amountP3) > 0) {
                        amounts.push({ activityId: p3Activity.id, amount: Number(m.amountP3) });
                        activityIds.push(p3Activity.id);
                    }

                    return {
                        name: String(m.name || ""),
                        address: String(m.address || ""),
                        postalCode: m.postalCode ? String(m.postalCode) : undefined,
                        city: m.city ? String(m.city) : undefined,
                        siteNumber: m.siteNumber ? String(m.siteNumber) : undefined,
                        billingSchedule: m.billingSchedule ? String(m.billingSchedule) : undefined,
                        activityIds,
                        amounts,
                    };
                });

            const result = await batchCreateSites(contractId, clientId, sitesData);

            toast({
                title: "Import terminé",
                description: `${result.created} site(s) créé(s) avec succès.`,
            });
            onComplete();
            onOpenChange(false);
            reset();
        } catch (error) {
            console.error("Import failed:", error);
            toast({
                title: "Erreur d'import",
                description: "Une erreur est survenue lors de l'import.",
                variant: "destructive",
            });
        } finally {
            setIsImporting(false);
        }
    };

    // ─── Computed ────────────────────────────────────────────────────────────────
    const validCount = validatedSites.filter((s) => s.valid).length;
    const totalCount = validatedSites.length;

    // ─── Render ─────────────────────────────────────────────────────────────────
    return (
        <Dialog
            open={open}
            onOpenChange={(v) => {
                if (!v) reset();
                onOpenChange(v);
            }}
        >
            <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileSpreadsheet className="h-5 w-5" />
                        Import de sites
                    </DialogTitle>
                    <DialogDescription>
                        {step === 1 && "Uploadez un fichier Excel ou téléchargez le template."}
                        {step === 2 && "Associez les colonnes du fichier aux champs Zenergya."}
                        {step === 3 && "Vérifiez les données avant import."}
                    </DialogDescription>
                </DialogHeader>

                {/* ── Stepper indicator ──────────────────────────────────────── */}
                <div className="flex items-center gap-2 px-2 py-3">
                    {[
                        { n: 1, label: "Upload" },
                        { n: 2, label: "Mapping" },
                        { n: 3, label: "Import" },
                    ].map(({ n, label }, i) => (
                        <React.Fragment key={n}>
                            <div
                                className={`flex items-center gap-1.5 text-sm font-medium ${step >= n
                                    ? "text-primary"
                                    : "text-muted-foreground"
                                    }`}
                            >
                                <div
                                    className={`flex items-center justify-center h-6 w-6 rounded-full text-xs ${step > n
                                        ? "bg-primary text-primary-foreground"
                                        : step === n
                                            ? "bg-primary text-primary-foreground"
                                            : "bg-muted text-muted-foreground"
                                        }`}
                                >
                                    {step > n ? (
                                        <CheckCircle className="h-3.5 w-3.5" />
                                    ) : (
                                        n
                                    )}
                                </div>
                                {label}
                            </div>
                            {i < 2 && (
                                <div
                                    className={`flex-1 h-px ${step > n ? "bg-primary" : "bg-border"
                                        }`}
                                />
                            )}
                        </React.Fragment>
                    ))}
                </div>

                {/* ── Step 1: Upload ─────────────────────────────────────────── */}
                {step === 1 && (
                    <div className="flex-1 flex flex-col items-center justify-center gap-6 py-8">
                        {/* Drop zone */}
                        <label
                            htmlFor="site-import-file"
                            className="flex flex-col items-center justify-center w-full max-w-md h-48 border-2 border-dashed rounded-lg cursor-pointer hover:bg-accent/50 transition-colors"
                        >
                            <Upload className="h-10 w-10 text-muted-foreground mb-3" />
                            <p className="text-sm font-medium">
                                Cliquez ou glissez votre fichier ici
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                                Formats acceptés : .xlsx, .xls, .csv
                            </p>
                            {fileName && (
                                <Badge variant="secondary" className="mt-3">
                                    {fileName}
                                </Badge>
                            )}
                            <input
                                ref={fileInputRef}
                                id="site-import-file"
                                type="file"
                                accept=".xlsx,.xls,.csv"
                                className="hidden"
                                onChange={handleFileUpload}
                            />
                        </label>

                        {/* Template download */}
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>ou</span>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleDownloadTemplate}
                                className="gap-1.5"
                            >
                                <Download className="h-3.5 w-3.5" />
                                Télécharger le template
                            </Button>
                        </div>
                    </div>
                )}

                {/* ── Step 2: Column Mapping ─────────────────────────────────── */}
                {step === 2 && (
                    <div className="flex-1 overflow-auto space-y-4">
                        <div className="rounded-lg border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-1/3">Champ Zenergya</TableHead>
                                        <TableHead className="w-1/3">
                                            Colonne Excel
                                        </TableHead>
                                        <TableHead className="w-1/3">Aperçu</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {TEMPLATE_COLUMNS.map((col) => (
                                        <TableRow key={col.key}>
                                            <TableCell className="font-medium">
                                                {col.label}
                                                {col.required && (
                                                    <span className="text-destructive ml-1">*</span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <Select
                                                    value={mapping[col.key] || "__none__"}
                                                    onValueChange={(v) =>
                                                        handleMappingChange(
                                                            col.key,
                                                            v === "__none__" ? "" : v
                                                        )
                                                    }
                                                >
                                                    <SelectTrigger className="h-8">
                                                        <SelectValue placeholder="—" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="__none__">
                                                            — Non mappé —
                                                        </SelectItem>
                                                        {headers.map((h) => (
                                                            <SelectItem key={h} value={h}>
                                                                {h}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]">
                                                {mapping[col.key] &&
                                                    rawRows[0]?.[mapping[col.key]] !==
                                                    undefined &&
                                                    String(rawRows[0][mapping[col.key]])}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            {rawRows.length} ligne(s) détectée(s) dans le fichier.
                        </p>
                    </div>
                )}

                {/* ── Step 3: Preview & Validate ─────────────────────────────── */}
                {step === 3 && (
                    <div className="flex-1 overflow-auto space-y-3">
                        {/* Summary */}
                        <div className="flex items-center gap-3 text-sm">
                            <Badge
                                variant={validCount === totalCount ? "secondary" : "outline"}
                                className="gap-1"
                            >
                                <CheckCircle className="h-3 w-3" />
                                {validCount} valide(s)
                            </Badge>
                            {totalCount - validCount > 0 && (
                                <Badge variant="destructive" className="gap-1">
                                    <AlertCircle className="h-3 w-3" />
                                    {totalCount - validCount} erreur(s)
                                </Badge>
                            )}
                            <span className="text-muted-foreground">
                                sur {totalCount} ligne(s)
                            </span>
                        </div>

                        {/* Preview table */}
                        <div className="rounded-lg border max-h-[40vh] overflow-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-8">#</TableHead>
                                        <TableHead>Nom</TableHead>
                                        <TableHead>Adresse</TableHead>
                                        <TableHead>CP</TableHead>
                                        <TableHead>Ville</TableHead>
                                        <TableHead className="text-right">P1</TableHead>
                                        <TableHead className="text-right">P2</TableHead>
                                        <TableHead className="text-right">P3</TableHead>
                                        <TableHead>Statut</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {validatedSites.map((site, i) => (
                                        <TableRow
                                            key={i}
                                            className={
                                                !site.valid
                                                    ? "bg-destructive/5"
                                                    : undefined
                                            }
                                        >
                                            <TableCell className="text-muted-foreground text-xs">
                                                {i + 1}
                                            </TableCell>
                                            <TableCell className="font-medium max-w-[150px] truncate">
                                                {String(site.mapped.name || "—")}
                                            </TableCell>
                                            <TableCell className="max-w-[150px] truncate">
                                                {String(site.mapped.address || "—")}
                                            </TableCell>
                                            <TableCell>
                                                {String(site.mapped.postalCode || "")}
                                            </TableCell>
                                            <TableCell>
                                                {String(site.mapped.city || "")}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {site.mapped.amountP1
                                                    ? Number(site.mapped.amountP1).toLocaleString(
                                                        "fr-FR"
                                                    )
                                                    : ""}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {site.mapped.amountP2
                                                    ? Number(site.mapped.amountP2).toLocaleString(
                                                        "fr-FR"
                                                    )
                                                    : ""}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {site.mapped.amountP3
                                                    ? Number(site.mapped.amountP3).toLocaleString(
                                                        "fr-FR"
                                                    )
                                                    : ""}
                                            </TableCell>
                                            <TableCell>
                                                {site.valid ? (
                                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                                ) : (
                                                    <div className="flex items-center gap-1">
                                                        <AlertCircle className="h-4 w-4 text-destructive" />
                                                        <span className="text-xs text-destructive">
                                                            {site.errors.join(", ")}
                                                        </span>
                                                    </div>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                )}

                {/* ── Footer ─────────────────────────────────────────────────── */}
                <DialogFooter className="flex items-center justify-between sm:justify-between gap-2">
                    <div>
                        {step > 1 && !isImporting && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setStep((s) => Math.max(1, s - 1) as 1 | 2 | 3)}
                                className="gap-1"
                            >
                                <ArrowLeft className="h-3.5 w-3.5" />
                                Retour
                            </Button>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                reset();
                                onOpenChange(false);
                            }}
                            disabled={isImporting}
                        >
                            <X className="h-3.5 w-3.5 mr-1" />
                            Annuler
                        </Button>

                        {step === 2 && (
                            <Button
                                size="sm"
                                onClick={handleConfirmMapping}
                                disabled={!mapping.name || !mapping.address}
                                className="gap-1"
                            >
                                Valider le mapping
                                <ArrowRight className="h-3.5 w-3.5" />
                            </Button>
                        )}

                        {step === 3 && (
                            <Button
                                size="sm"
                                onClick={handleImport}
                                disabled={validCount === 0 || isImporting}
                                className="gap-1"
                            >
                                {isImporting ? (
                                    <>
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        Import en cours...
                                    </>
                                ) : (
                                    <>
                                        <Upload className="h-3.5 w-3.5" />
                                        Importer {validCount} site(s)
                                    </>
                                )}
                            </Button>
                        )}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
