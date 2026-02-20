'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { usePricing, CalculatedLine } from '../_hooks/use-pricing';
import {
    Plus,
    Trash2,
    ChevronRight,
    ChevronDown,
    Layers,
    FileText,
    Type,
    GripVertical,
    TrendingUp,
    Percent,
    Calculator,
    Wallet
} from 'lucide-react';
import { cn } from '@/lib/utils';

export function ChiffrageDashboard() {
    const {
        state,
        addLine,
        updateLine,
        removeLine,
        calculatedLines,
        globalCalculations
    } = usePricing();

    console.log('ChiffrageDashboard rendering', {
        linesCount: calculatedLines?.length,
        globalCalculations
    });


    const formatCurrency = (val: number) => {
        if (typeof val !== 'number' || isNaN(val)) return '-';
        return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(val);
    };

    const formatPercent = (val: number) => {
        if (typeof val !== 'number' || isNaN(val)) return '-';
        return new Intl.NumberFormat('fr-FR', { style: 'percent', minimumFractionDigits: 2 }).format(val / 100);
    };


    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pb-10">
            {/* MAIN COLUMN: The Worksheet */}
            <div className="lg:col-span-9 space-y-6">
                <Card className="shadow-lg border-t-4 border-t-blue-800">
                    <CardHeader className="bg-slate-50/50 flex flex-row items-center justify-between py-4">
                        <div className="space-y-1">
                            <CardTitle className="text-xl font-bold text-slate-800 flex items-center gap-2">
                                <Layers className="h-6 w-6 text-blue-800" />
                                Étude de prix détaillée (Worksheet)
                            </CardTitle>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button size="sm" variant="outline" onClick={() => addLine('TITRE')} className="bg-white border-blue-200 text-blue-800 hover:bg-blue-50">
                                <Plus className="h-4 w-4 mr-2" /> Titre
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => addLine('ARTICLE')} className="bg-white border-blue-200 text-blue-800 hover:bg-blue-50">
                                <Plus className="h-4 w-4 mr-2" /> Article
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => addLine('SOUS_TOTAL')} className="bg-white border-blue-200 text-blue-800 hover:bg-blue-50">
                                <Calculator className="h-4 w-4 mr-2" /> Sous-total
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm border-collapse">
                                <thead className="bg-slate-100/80 text-slate-600 uppercase text-[10px] font-bold tracking-wider border-b">
                                    <tr>
                                        <th className="w-10 px-4 py-3"></th>
                                        <th className="text-left px-4 py-3 min-w-[300px]">Libellé / Désignation</th>
                                        <th className="w-20 px-4 py-3 text-center">Unité</th>
                                        <th className="w-24 px-4 py-3 text-right">Qte</th>
                                        <th className="w-28 px-4 py-3 text-right">CU (€)</th>
                                        <th className="w-28 px-4 py-3 text-right">PV HT (€)</th>
                                        <th className="w-32 px-4 py-3 text-right">Total HT</th>
                                        <th className="w-10 px-4 py-3"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {calculatedLines.length === 0 ? (
                                        <tr>
                                            <td colSpan={8} className="py-20 text-center text-slate-400">
                                                <div className="flex flex-col items-center gap-2">
                                                    <FileText className="h-10 w-10 opacity-20" />
                                                    <p>Aucune ligne. Commencez par ajouter un titre ou un article.</p>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        calculatedLines.map((line) => (
                                            <WorksheetRow
                                                key={line.id}
                                                line={line}
                                                onUpdate={(updates) => updateLine(line.id, updates)}
                                                onRemove={() => removeLine(line.id)}
                                            />
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* SIDE COLUMN: Indicators & Totals */}
            <div className="lg:col-span-3 space-y-6">
                <Card className="border-t-4 border-t-green-600 shadow-md">
                    <CardHeader className="bg-slate-50/50 pb-2">
                        <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-600">Récapitulatif Financier</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4 space-y-4">
                        <div className="space-y-1">
                            <Label className="text-[10px] uppercase text-slate-500">Total Déboursé Sec</Label>
                            <div className="text-xl font-bold text-blue-900">{formatCurrency(globalCalculations.totalDirectCosts)}</div>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-[10px] uppercase text-slate-500">Marge Brute HT</Label>
                            <div className="flex justify-between items-baseline">
                                <div className="text-xl font-bold text-green-700">{formatCurrency(globalCalculations.grossMargin)}</div>
                                <div className="text-xs font-semibold text-green-600">{globalCalculations.grossMarginRate.toFixed(2)}%</div>
                            </div>
                        </div>

                        <Separator />

                        <div className="p-4 bg-slate-900 text-white rounded-lg space-y-2 shadow-inner">
                            <div className="text-[10px] uppercase text-slate-400">Total PV HT</div>
                            <div className="text-2xl font-black">{formatCurrency(globalCalculations.totalHT)}</div>
                        </div>

                        <div className="space-y-3 pt-2">
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-slate-500 font-medium">Frais Généraux ({state.generalExpensesRate}%)</span>
                                <span className="font-semibold">{formatCurrency(globalCalculations.generalExpensesAmount)}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-slate-500 font-medium">TVA ({state.globalTva}%)</span>
                                <span className="font-semibold">{formatCurrency(globalCalculations.tvaAmount)}</span>
                            </div>
                        </div>

                        <div className="p-4 bg-blue-100 border border-blue-200 rounded-lg flex justify-between items-center font-black text-blue-900">
                            <span className="text-lg">TTC FINAL</span>
                            <span className="text-xl">{formatCurrency(globalCalculations.totalTTC)}</span>
                        </div>
                    </CardContent>
                </Card>

                <Card className="shadow-lg bg-white overflow-hidden">
                    <CardHeader className="bg-slate-50/50 pb-2 border-b">
                        <CardTitle className="text-xs font-bold uppercase text-slate-500">Performance</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-6 space-y-8">
                        <IndicatorRow
                            label="Marge Nette / PV"
                            value={globalCalculations.netMarginRate}
                            color="bg-green-500"
                            target={15}
                        />
                        <IndicatorRow
                            label="Coefficient de Vente"
                            value={(globalCalculations.totalDirectCosts > 0 ? (globalCalculations.totalHT / globalCalculations.totalDirectCosts) : 1) * 10}
                            max={20}
                            color="bg-blue-500"
                        />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

function WorksheetRow({
    line,
    onUpdate,
    onRemove
}: {
    line: CalculatedLine,
    onUpdate: (u: any) => void,
    onRemove: () => void
}) {
    const isTitre = line.type === 'TITRE';
    const isSousTotal = line.type === 'SOUS_TOTAL';
    const isArticle = line.type === 'ARTICLE';

    return (
        <tr className={cn(
            "group transition-colors",
            isTitre && "bg-slate-50/80 font-bold",
            isSousTotal && "bg-blue-50 font-semibold italic text-blue-800",
            "hover:bg-slate-100"
        )}>
            <td className="px-4 py-2">
                <GripVertical className="h-4 w-4 text-slate-300 opacity-0 group-hover:opacity-100 cursor-grab" />
            </td>
            <td className="px-4 py-2">
                <div className="flex items-center gap-2" style={{ paddingLeft: `${line.niveau * 20}px` }}>
                    {isTitre && <ChevronDown className="h-4 w-4 text-blue-800" />}
                    {isArticle && <Badge variant="outline" className="text-[10px] py-0 px-1 bg-white">ART</Badge>}
                    <Input
                        value={line.libelle}
                        onChange={(e) => onUpdate({ libelle: e.target.value })}
                        className={cn(
                            "h-8 border-transparent focus:border-slate-300 bg-transparent px-1 text-sm",
                            isTitre && "text-blue-900 border-none"
                        )}
                    />
                </div>
            </td>
            <td className="px-4 py-2">
                {isArticle && (
                    <Input
                        value={line.uom || ''}
                        onChange={(e) => onUpdate({ uom: e.target.value })}
                        className="h-8 w-16 text-center border-transparent focus:border-slate-300 bg-transparent px-0 text-xs"
                        placeholder="u"
                    />
                )}
            </td>
            <td className="px-4 py-2 text-right">
                {isArticle && (
                    <Input
                        type="number"
                        value={line.quantite}
                        onChange={(e) => onUpdate({ quantite: parseFloat(e.target.value) || 0 })}
                        className="h-8 w-20 text-right border-transparent focus:border-slate-300 bg-transparent px-1 text-sm"
                    />
                )}
            </td>
            <td className="px-4 py-2 text-right">
                {isArticle && (
                    <Input
                        type="number"
                        value={line.coutUnitaire}
                        onChange={(e) => onUpdate({ coutUnitaire: parseFloat(e.target.value) || 0 })}
                        className="h-8 w-24 text-right border-transparent focus:border-slate-300 bg-transparent px-1 text-sm"
                    />
                )}
            </td>
            <td className="px-4 py-2 text-right">
                {(isArticle || isTitre) && (
                    <Input
                        type="number"
                        value={line.puHT}
                        onChange={(e) => onUpdate({ puHT: parseFloat(e.target.value) || 0 })}
                        className={cn(
                            "h-8 w-24 text-right border-transparent focus:border-slate-300 bg-transparent px-1 text-sm font-semibold",
                            isArticle && "text-blue-600"
                        )}
                    />
                )}
            </td>
            <td className="px-4 py-2 text-right">
                <span className={cn(
                    "text-sm font-bold",
                    isTitre && "text-blue-900",
                    isSousTotal && "text-blue-800"
                )}>
                    {line.totalHT > 0 ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(line.totalHT) : '-'}
                </span>
            </td>
            <td className="px-4 py-2 text-right">
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                    onClick={onRemove}
                >
                    <Trash2 className="h-3 w-3" />
                </Button>
            </td>
        </tr>
    );
}

function IndicatorRow({ label, value, color, max = 100, target }: { label: string, value: number, color: string, max?: number, target?: number }) {
    const progress = Math.min((value / max) * 100, 100);
    return (
        <div className="space-y-2">
            <div className="flex justify-between items-baseline">
                <span className="text-[11px] font-bold text-slate-500 uppercase">{label}</span>
                <span className="text-sm font-black text-slate-800">{value.toFixed(2)}{max === 10 ? 'x' : '%'}</span>
            </div>
            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden relative">
                <div role="progressbar" className={cn("h-full transition-all duration-500", color)} style={{ width: `${progress}%` }} />
                {target && (
                    <div
                        className="absolute top-0 bottom-0 w-0.5 bg-slate-400 opacity-50 z-10"
                        style={{ left: `${(target / max) * 100}%` }}
                        title={`Objectif: ${target}%`}
                    />
                )}
            </div>
            {target && <div className="text-[9px] text-slate-400 text-right italic">Objectif: {target}%</div>}
        </div>
    );
}
