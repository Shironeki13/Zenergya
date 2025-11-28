'use client';

import { useState, useRef } from 'react';
import { useData } from '@/context/data-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Pencil, Trash2, Search, AlertCircle, FileSpreadsheet, Upload, Download, LineChart as LineChartIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { createIndex, updateIndex, deleteIndex, createIndexValue, updateIndexValue, deleteIndexValue } from '@/services/firestore';
import { Index, IndexValue } from '@/lib/types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

import Papa from 'papaparse';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';

function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default function IndicesPage() {
    const { indices, indexValues, reloadData } = useData();
    const { toast } = useToast();
    const [isIndexDialogOpen, setIsIndexDialogOpen] = useState(false);
    const [isValueDialogOpen, setIsValueDialogOpen] = useState(false);
    const [editingIndex, setEditingIndex] = useState<Index | null>(null);
    const [editingValue, setEditingValue] = useState<IndexValue | null>(null);
    const [selectedIndexId, setSelectedIndexId] = useState<string | null>(null);

    const indicesFileInputRef = useRef<HTMLInputElement>(null);
    const valuesFileInputRef = useRef<HTMLInputElement>(null);

    // Form states for Index
    const [indexCode, setIndexCode] = useState('');
    const [indexLabel, setIndexLabel] = useState('');
    const [indexUnit, setIndexUnit] = useState('');
    const [indexDescription, setIndexDescription] = useState('');
    const [indexType, setIndexType] = useState<'standard' | 'calculated'>('standard');
    const [indexFormula, setIndexFormula] = useState('');
    const [indexDecimals, setIndexDecimals] = useState(4);

    // Search state
    const [searchTerm, setSearchTerm] = useState('');

    // Chart state
    const [chartType, setChartType] = useState<'line' | 'bar'>('line');
    const [dateRangeStart, setDateRangeStart] = useState('');
    const [dateRangeEnd, setDateRangeEnd] = useState('');
    const [showVisualization, setShowVisualization] = useState(false);

    // Form states for Value
    const [valueIndexId, setValueIndexId] = useState('');
    const [valuePeriod, setValuePeriod] = useState('');
    const [valueAmount, setValueAmount] = useState('');
    const [valueSource, setValueSource] = useState('');
    const [valueComment, setValueComment] = useState('');

    const resetIndexForm = () => {
        setIndexCode('');
        setIndexLabel('');
        setIndexUnit('');
        setIndexDescription('');
        setIndexType('standard');
        setIndexFormula('');
        setIndexDecimals(4);
        setEditingIndex(null);
    };

    const resetValueForm = () => {
        setValueIndexId(selectedIndexId || '');
        setValuePeriod('');
        setValueAmount('');
        setValueSource('');
        setValueComment('');
        setEditingValue(null);
    };

    const handleEditIndex = (index: Index) => {
        setEditingIndex(index);
        setIndexCode(index.code);
        setIndexLabel(index.label);
        setIndexUnit(index.unit);
        setIndexDescription(index.description || '');
        setIndexType(index.type || 'standard');
        setIndexFormula(index.formula || '');
        setIndexDecimals(index.decimals ?? 4);
        setIsIndexDialogOpen(true);
    };

    const handleEditValue = (value: IndexValue) => {
        setEditingValue(value);
        setValueIndexId(value.indexId);
        setValuePeriod(value.period);
        setValueAmount(value.value.toString());
        setValueSource(value.source || '');
        setValueComment(value.comment || '');
        setIsValueDialogOpen(true);
    };

    const handleSaveIndex = async () => {
        try {
            const data = {
                code: indexCode,
                label: indexLabel,
                unit: indexUnit,
                active: true,
                description: indexDescription,
                type: indexType,
                formula: indexFormula,
                decimals: indexDecimals,
            };

            if (editingIndex) {
                await updateIndex(editingIndex.id, data);
                toast({ title: "Indice mis à jour", description: "L'indice a été modifié avec succès." });
            } else {
                await createIndex(data);
                toast({ title: "Indice créé", description: "Le nouvel indice a été ajouté." });
            }
            await reloadData();
            setIsIndexDialogOpen(false);
            resetIndexForm();
        } catch (error) {
            console.error(error);
            toast({ title: "Erreur", description: "Une erreur est survenue lors de l'enregistrement.", variant: "destructive" });
        }
    };

    const handleSaveValue = async () => {
        try {
            const data = {
                indexId: valueIndexId,
                period: valuePeriod,
                value: parseFloat(valueAmount),
                source: valueSource,
                comment: valueComment,
            };

            if (editingValue) {
                await updateIndexValue(editingValue.id, data);
                toast({ title: "Valeur mise à jour", description: "La valeur a été modifiée avec succès." });
            } else {
                await createIndexValue(data);
                toast({ title: "Valeur ajoutée", description: "La nouvelle valeur a été enregistrée." });
            }
            await reloadData();
            setIsValueDialogOpen(false);
            resetValueForm();
        } catch (error: any) {
            console.error(error);
            toast({ title: "Erreur", description: error.message || "Une erreur est survenue.", variant: "destructive" });
        }
    };

    // --- Bulk Import/Export Logic ---

    const handleDownloadIndexTemplate = () => {
        const csv = Papa.unparse([
            { code: "PEG", label: "Indice Gaz PEG", unit: "€/MWh", description: "Exemple d'indice" },
            { code: "ATRD", label: "Tarif d'acheminement", unit: "€/MWh", description: "Autre exemple" }
        ], { delimiter: ";" }); // Use semicolon for Excel compatibility
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'modele_indices.csv';
        link.click();
    };

    const handleDownloadValueTemplate = () => {
        const csv = Papa.unparse([
            { index_code: "PEG", period: "2025-01", value: 45.2, source: "EEX", comment: "Estimé" },
            { index_code: "PEG", period: "2025-02", value: 46.5, source: "EEX", comment: "" }
        ], { delimiter: ";" }); // Use semicolon for Excel compatibility
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'modele_valeurs_indices.csv';
        link.click();
    };

    const handleExportIndices = () => {
        const dataToExport = indices.map(i => ({
            code: i.code,
            label: i.label,
            unit: i.unit,
            description: i.description || ''
        }));
        const csv = Papa.unparse(dataToExport, { delimiter: ";" });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `export_indices_${format(new Date(), 'yyyyMMdd')}.csv`;
        link.click();
    };

    const handleExportValues = () => {
        // Export filtered values if an index is selected, otherwise all values
        const valuesToExport = filteredValues.map(v => {
            const index = indices.find(i => i.id === v.indexId);
            return {
                index_code: index?.code || 'UNKNOWN',
                period: v.period,
                value: v.value,
                source: v.source || '',
                comment: v.comment || ''
            };
        });
        const csv = Papa.unparse(valuesToExport, { delimiter: ";" });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `export_valeurs_${format(new Date(), 'yyyyMMdd')}.csv`;
        link.click();
    };

    const handleImportIndices = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (h) => h.trim(), // Clean headers
            complete: async (results) => {
                let successCount = 0;
                let errorCount = 0;

                for (const row of results.data as any[]) {
                    if (!row.code || !row.label || !row.unit) continue; // Skip invalid rows

                    try {
                        const exists = indices.find(i => i.code === row.code);
                        if (!exists) {
                            await createIndex({
                                code: row.code,
                                label: row.label,
                                unit: row.unit,
                                active: true,
                                description: row.description || ''
                            });
                            successCount++;
                        } else {
                            console.log(`Index ${row.code} already exists, skipping.`);
                        }
                    } catch (e) {
                        console.error(e);
                        errorCount++;
                    }
                }

                await reloadData();
                toast({
                    title: "Import terminé",
                    description: `${successCount} indices créés. ${errorCount} erreurs.`,
                    variant: errorCount > 0 ? "destructive" : "default"
                });
                if (indicesFileInputRef.current) indicesFileInputRef.current.value = '';
            }
        });
    };

    const handleImportValues = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (h) => h.trim(),
            complete: async (results) => {
                let successCount = 0;
                let errorCount = 0;

                for (const row of results.data as any[]) {
                    if (!row.index_code || !row.period || !row.value) continue;

                    const index = indices.find(i => i.code === row.index_code);
                    if (!index) {
                        console.warn(`Index code ${row.index_code} not found.`);
                        errorCount++;
                        continue;
                    }

                    // Handle comma decimal separator if present
                    const valueStr = String(row.value).replace(',', '.');
                    const valueNum = parseFloat(valueStr);

                    if (isNaN(valueNum)) {
                        errorCount++;
                        continue;
                    }

                    try {
                        await createIndexValue({
                            indexId: index.id,
                            period: row.period,
                            value: valueNum,
                            source: row.source || '',
                            comment: row.comment || ''
                        });
                        successCount++;
                    } catch (e) {
                        console.error(e);
                        errorCount++;
                    }
                }

                await reloadData();
                toast({
                    title: "Import terminé",
                    description: `${successCount} valeurs ajoutées. ${errorCount} erreurs.`,
                    variant: errorCount > 0 ? "destructive" : "default"
                });
                if (valuesFileInputRef.current) valuesFileInputRef.current.value = '';
            }
        });
    };

    // Filter and Sort Indices
    const filteredIndices = indices
        .filter(index =>
            index.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
            index.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (index.description && index.description.toLowerCase().includes(searchTerm.toLowerCase()))
        )
        .sort((a, b) => a.code.localeCompare(b.code));

    // Calculation Logic
    const calculateValues = (targetIndex: Index): IndexValue[] => {
        if (targetIndex.type !== 'calculated' || !targetIndex.formula) return [];

        const periods = Array.from(new Set(indexValues.map(v => v.period))).sort();
        const results: IndexValue[] = [];

        periods.forEach(period => {
            let formula = targetIndex.formula!;
            let isValid = true;

            // Replace codes with values
            // Sort indices by code length desc to avoid substring replacement issues
            const sortedIndices = [...indices].sort((a, b) => b.code.length - a.code.length);

            for (const idx of sortedIndices) {
                if (idx.id === targetIndex.id) continue;

                // Escape regex characters in code
                const escapedCode = escapeRegExp(idx.code);
                // Regex to match the code as a whole word
                const regex = new RegExp(`\\b${escapedCode}\\b`, 'g');

                if (regex.test(formula)) {
                    const val = indexValues.find(v => v.indexId === idx.id && v.period === period);
                    if (val !== undefined) {
                        formula = formula.replace(regex, val.value.toString());
                    } else {
                        // If a required value is missing, we can't calculate
                        isValid = false;
                        break;
                    }
                }
            }

            if (isValid) {
                try {
                    // Security check: only allow numbers, operators, parens, spaces, and dots
                    if (!/^[0-9.\+\-\*\/\(\)\s]+$/.test(formula)) {
                        return;
                    }
                    // eslint-disable-next-line no-new-func
                    const result = new Function(`return ${formula}`)();
                    if (typeof result === 'number' && !isNaN(result)) {
                        results.push({
                            id: `calc-${targetIndex.id}-${period}`,
                            indexId: targetIndex.id,
                            period: period,
                            value: Number(result.toFixed(targetIndex.decimals ?? 4)),
                            source: 'Calculé',
                            comment: `Formule : ${targetIndex.formula}`
                        });
                    }
                } catch (e) {
                    // Ignore errors
                }
            }
        });

        return results;
    };

    const filteredValues = selectedIndexId
        ? (indices.find(i => i.id === selectedIndexId)?.type === 'calculated'
            ? calculateValues(indices.find(i => i.id === selectedIndexId)!)
            : indexValues.filter(v => v.indexId === selectedIndexId))
        : indexValues;

    // Apply Date Range Filter
    const chartData = filteredValues.filter(v => {
        if (dateRangeStart && v.period < dateRangeStart) return false;
        if (dateRangeEnd && v.period > dateRangeEnd) return false;
        return true;
    }).sort((a, b) => a.period.localeCompare(b.period)); // Sort ascending for chart

    // Sort values by period descending for table
    const tableValues = [...filteredValues].sort((a, b) => b.period.localeCompare(a.period));


    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Gestion des Indices</h1>
                    <p className="text-muted-foreground">
                        Configurez les indices de référence et saisissez leurs valeurs mensuelles.
                    </p>
                </div>
            </div>

            <div className="grid lg:grid-cols-3 gap-6">
                {/* Left Column: Indices List */}
                <Card className="lg:col-span-1 h-fit">
                    <CardHeader className="flex flex-col space-y-4 pb-2">
                        <div className="flex flex-row items-center justify-between space-y-0">
                            <CardTitle className="text-lg font-medium">Référentiel Indices</CardTitle>
                            <div className="flex gap-2">
                                <input
                                    type="file"
                                    accept=".csv"
                                    ref={indicesFileInputRef}
                                    className="hidden"
                                    onChange={handleImportIndices}
                                />
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="outline" size="icon" onClick={handleDownloadIndexTemplate}>
                                            <FileSpreadsheet className="h-4 w-4" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>Télécharger le modèle CSV</p>
                                    </TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="outline" size="icon" onClick={() => indicesFileInputRef.current?.click()}>
                                            <Upload className="h-4 w-4" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>Importer un fichier CSV</p>
                                    </TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="outline" size="icon" onClick={handleExportIndices}>
                                            <Download className="h-4 w-4" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>Exporter les indices (CSV)</p>
                                    </TooltipContent>
                                </Tooltip>

                                <Dialog open={isIndexDialogOpen} onOpenChange={setIsIndexDialogOpen}>
                                    <DialogTrigger asChild>
                                        <Button size="sm" onClick={resetIndexForm}>
                                            <Plus className="h-4 w-4" />
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>{editingIndex ? "Modifier l'indice" : "Créer un nouvel indice"}</DialogTitle>
                                            <DialogDescription>
                                                Définissez les caractéristiques de l'indice.
                                            </DialogDescription>
                                        </DialogHeader>
                                        <div className="grid gap-4 py-4">
                                            <div className="grid grid-cols-4 items-center gap-4">
                                                <Label htmlFor="code" className="text-right">Code</Label>
                                                <Input id="code" value={indexCode} onChange={(e) => setIndexCode(e.target.value)} className="col-span-3" placeholder="Ex: PEG" />
                                            </div>
                                            <div className="grid grid-cols-4 items-center gap-4">
                                                <Label htmlFor="label" className="text-right">Libellé</Label>
                                                <Input id="label" value={indexLabel} onChange={(e) => setIndexLabel(e.target.value)} className="col-span-3" placeholder="Ex: Indice Gaz PEG" />
                                            </div>
                                            <div className="grid grid-cols-4 items-center gap-4">
                                                <Label htmlFor="unit" className="text-right">Unité</Label>
                                                <Input id="unit" value={indexUnit} onChange={(e) => setIndexUnit(e.target.value)} className="col-span-3" placeholder="Ex: €/MWh" />
                                            </div>
                                            <div className="grid grid-cols-4 items-center gap-4">
                                                <Label htmlFor="type" className="text-right">Type</Label>
                                                <Select value={indexType} onValueChange={(v: any) => setIndexType(v)}>
                                                    <SelectTrigger className="col-span-3">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="standard">Standard (Saisie manuelle)</SelectItem>
                                                        <SelectItem value="calculated">Calculé (Formule)</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="grid grid-cols-4 items-center gap-4">
                                                <Label htmlFor="decimals" className="text-right">Décimales</Label>
                                                <Select value={indexDecimals.toString()} onValueChange={(v) => setIndexDecimals(parseInt(v))}>
                                                    <SelectTrigger className="col-span-3">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {[0, 1, 2, 3, 4, 5].map(d => (
                                                            <SelectItem key={d} value={d.toString()}>{d}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            {indexType === 'calculated' && (
                                                <div className="grid grid-cols-4 items-center gap-4">
                                                    <Label htmlFor="formula" className="text-right">Formule</Label>
                                                    <div className="col-span-3 space-y-1">
                                                        <Input
                                                            id="formula"
                                                            value={indexFormula}
                                                            onChange={(e) => setIndexFormula(e.target.value)}
                                                            placeholder="Ex: PEG * 1.2 + 5"
                                                        />
                                                        <p className="text-xs text-muted-foreground">
                                                            Utilisez les codes des autres indices. Opérateurs : + - * / ( )
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            <div className="grid grid-cols-4 items-center gap-4">
                                                <Label htmlFor="desc" className="text-right">Description</Label>
                                                <Input id="desc" value={indexDescription} onChange={(e) => setIndexDescription(e.target.value)} className="col-span-3" />
                                            </div>
                                        </div>
                                        <DialogFooter>
                                            <Button onClick={handleSaveIndex}>Enregistrer</Button>
                                        </DialogFooter>
                                    </DialogContent>
                                </Dialog>
                            </div>
                        </div>
                        <div className="relative">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Rechercher un indice..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-8"
                            />
                        </div>
                    </CardHeader >
                    <CardContent>
                        <div className="space-y-2">
                            {filteredIndices.map(index => (
                                <div
                                    key={index.id}
                                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${selectedIndexId === index.id ? 'bg-primary/10 border-primary' : 'hover:bg-muted'}`}
                                    onClick={() => setSelectedIndexId(index.id === selectedIndexId ? null : index.id)}
                                >
                                    <div>
                                        <div className="font-medium">{index.code}</div>
                                        <div className="text-xs text-muted-foreground">{index.label} ({index.unit})</div>
                                    </div>
                                    <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleEditIndex(index); }}>
                                        <Pencil className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                            {filteredIndices.length === 0 && (
                                <div className="text-center py-4 text-muted-foreground text-sm">
                                    Aucun indice trouvé.
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card >

                {/* Right Column: Values Table & Chart */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Visualization Card */}
                    {
                        selectedIndexId && showVisualization && (
                            <Card>
                                <CardHeader>
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="text-lg font-medium">Visualisation</CardTitle>
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center gap-2 mr-4">
                                                <Label htmlFor="start" className="text-xs">Du</Label>
                                                <Input
                                                    id="start"
                                                    type="month"
                                                    className="h-8 w-32"
                                                    value={dateRangeStart}
                                                    onChange={(e) => setDateRangeStart(e.target.value)}
                                                />
                                                <Label htmlFor="end" className="text-xs">Au</Label>
                                                <Input
                                                    id="end"
                                                    type="month"
                                                    className="h-8 w-32"
                                                    value={dateRangeEnd}
                                                    onChange={(e) => setDateRangeEnd(e.target.value)}
                                                />
                                            </div>
                                            <div className="flex border rounded-md overflow-hidden">
                                                <button
                                                    className={`px-3 py-1 text-sm ${chartType === 'line' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                                                    onClick={() => setChartType('line')}
                                                >
                                                    Ligne
                                                </button>
                                                <button
                                                    className={`px-3 py-1 text-sm ${chartType === 'bar' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                                                    onClick={() => setChartType('bar')}
                                                >
                                                    Barres
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <div className="h-[300px] w-full">
                                        <ResponsiveContainer width="100%" height="100%">
                                            {chartType === 'line' ? (
                                                <LineChart data={chartData}>
                                                    <CartesianGrid strokeDasharray="3 3" />
                                                    <XAxis dataKey="period" />
                                                    <YAxis />
                                                    <RechartsTooltip />
                                                    <Legend />
                                                    <Line type="monotone" dataKey="value" stroke="#8884d8" name="Valeur" />
                                                </LineChart>
                                            ) : (
                                                <BarChart data={chartData}>
                                                    <CartesianGrid strokeDasharray="3 3" />
                                                    <XAxis dataKey="period" />
                                                    <YAxis />
                                                    <RechartsTooltip />
                                                    <Legend />
                                                    <Bar dataKey="value" fill="#8884d8" name="Valeur" />
                                                </BarChart>
                                            )}
                                        </ResponsiveContainer>
                                    </div>
                                </CardContent>
                            </Card>
                        )
                    }

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <div>
                                <CardTitle className="text-lg font-medium">
                                    {selectedIndexId
                                        ? `Historique : ${indices.find(i => i.id === selectedIndexId)?.label}`
                                        : "Toutes les valeurs"}
                                </CardTitle>
                                <CardDescription>
                                    {selectedIndexId
                                        ? "Gérez les valeurs mensuelles pour cet indice."
                                        : "Sélectionnez un indice à gauche pour filtrer."}
                                </CardDescription>
                            </div>
                            <div className="flex gap-2">
                                <input
                                    type="file"
                                    accept=".csv"
                                    ref={valuesFileInputRef}
                                    className="hidden"
                                    onChange={handleImportValues}
                                />
                                {selectedIndexId && (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant={showVisualization ? "default" : "outline"}
                                                size="icon"
                                                onClick={() => setShowVisualization(!showVisualization)}
                                            >
                                                <LineChartIcon className="h-4 w-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>{showVisualization ? "Masquer le graphique" : "Afficher le graphique"}</p>
                                        </TooltipContent>
                                    </Tooltip>
                                )}

                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="outline" size="icon" onClick={handleDownloadValueTemplate}>
                                            <FileSpreadsheet className="h-4 w-4" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>Télécharger le modèle CSV</p>
                                    </TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="outline" size="icon" onClick={() => valuesFileInputRef.current?.click()}>
                                            <Upload className="h-4 w-4" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>Importer un fichier CSV</p>
                                    </TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="outline" size="icon" onClick={handleExportValues}>
                                            <Download className="h-4 w-4" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>Exporter les valeurs (CSV)</p>
                                    </TooltipContent>
                                </Tooltip>

                                <Dialog open={isValueDialogOpen} onOpenChange={setIsValueDialogOpen}>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span tabIndex={0}> {/* Wrap in span to allow tooltip on disabled button */}
                                                <Button size="sm" disabled={!selectedIndexId || indices.find(i => i.id === selectedIndexId)?.type === 'calculated'} onClick={resetValueForm}>
                                                    <Plus className="h-4 w-4 mr-2" />
                                                    Ajouter
                                                </Button>
                                            </span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {indices.find(i => i.id === selectedIndexId)?.type === 'calculated'
                                                ? "Les valeurs sont calculées automatiquement."
                                                : "Ajouter une valeur manuelle."}
                                        </TooltipContent>
                                    </Tooltip>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>Saisir une valeur</DialogTitle>
                                            <DialogDescription>
                                                Ajoutez une valeur mensuelle pour l'indice sélectionné.
                                            </DialogDescription>
                                        </DialogHeader>
                                        <div className="grid gap-4 py-4">
                                            <div className="grid grid-cols-4 items-center gap-4">
                                                <Label htmlFor="idx" className="text-right">Indice</Label>
                                                <Select value={valueIndexId} onValueChange={setValueIndexId} disabled={!!selectedIndexId}>
                                                    <SelectTrigger className="col-span-3">
                                                        <SelectValue placeholder="Choisir un indice" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {indices.map(i => (
                                                            <SelectItem key={i.id} value={i.id}>{i.code} - {i.label}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="grid grid-cols-4 items-center gap-4">
                                                <Label htmlFor="period" className="text-right">Période</Label>
                                                <Input id="period" type="month" value={valuePeriod} onChange={(e) => setValuePeriod(e.target.value)} className="col-span-3" />
                                            </div>
                                            <div className="grid grid-cols-4 items-center gap-4">
                                                <Label htmlFor="val" className="text-right">Valeur</Label>
                                                <Input id="val" type="number" step="0.0001" value={valueAmount} onChange={(e) => setValueAmount(e.target.value)} className="col-span-3" />
                                            </div>
                                            <div className="grid grid-cols-4 items-center gap-4">
                                                <Label htmlFor="source" className="text-right">Source</Label>
                                                <Input id="source" value={valueSource} onChange={(e) => setValueSource(e.target.value)} className="col-span-3" placeholder="Ex: INSEE, EEX..." />
                                            </div>
                                            <div className="grid grid-cols-4 items-center gap-4">
                                                <Label htmlFor="comment" className="text-right">Commentaire</Label>
                                                <Input id="comment" value={valueComment} onChange={(e) => setValueComment(e.target.value)} className="col-span-3" />
                                            </div>
                                        </div>
                                        <DialogFooter>
                                            <Button onClick={handleSaveValue}>Enregistrer</Button>
                                        </DialogFooter>
                                    </DialogContent>
                                </Dialog>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        {!selectedIndexId && <TableHead>Indice</TableHead>}
                                        <TableHead>Période</TableHead>
                                        <TableHead>Valeur</TableHead>
                                        <TableHead>Source</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {tableValues.map(val => {
                                        const idx = indices.find(i => i.id === val.indexId);
                                        return (
                                            <TableRow key={val.id}>
                                                {!selectedIndexId && <TableCell className="font-medium">{idx?.code}</TableCell>}
                                                <TableCell>{val.period}</TableCell>
                                                <TableCell className="font-bold">{val.value.toFixed(idx?.decimals ?? 4)} {idx?.unit}</TableCell>
                                                <TableCell className="text-muted-foreground text-sm">{val.source}</TableCell>
                                                <TableCell className="text-right">
                                                    {(!selectedIndexId || indices.find(i => i.id === selectedIndexId)?.type !== 'calculated') && (
                                                        <Button variant="ghost" size="icon" onClick={() => handleEditValue(val)}>
                                                            <Pencil className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                    {tableValues.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center text-muted-foreground h-24">
                                                Aucune valeur trouvée.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
