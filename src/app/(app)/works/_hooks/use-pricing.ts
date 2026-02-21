'use client';

import { useState, useMemo } from 'react';
import { WorkQuoteLine, WorkLineType } from '@/lib/works/types';

export interface PricingState {
    lines: WorkQuoteLine[];
    globalCoefficient: number;
    globalTva: number;
    globalDiscount: number;
    generalExpensesRate: number;
    ecoContribution: number;
}

export interface CalculatedLine extends WorkQuoteLine {
    totalHT: number;
    totalCout: number; // Déboursé sec total
    margeBrute: number;
}

export function usePricing(initialState?: Partial<PricingState>) {
    const [state, setState] = useState<PricingState>({
        lines: [],
        globalCoefficient: 1.3,
        globalTva: 20,
        globalDiscount: 0,
        generalExpensesRate: 20,
        ecoContribution: 0,
        ...initialState,
    });

    const updateState = (updates: Partial<PricingState>) => {
        setState((prev) => ({ ...prev, ...updates }));
    };

    const addLine = (type: WorkLineType, niveau = 0) => {
        const newLine: WorkQuoteLine = {
            id: Math.random().toString(36).substr(2, 9),
            versionId: 'current',
            type,
            libelle: type === 'ARTICLE' ? 'Nouvel article' : type === 'TITRE' ? 'Nouveau titre' : 'Sous-total',
            quantite: type === 'ARTICLE' ? 1 : 0,
            puHT: 0,
            remisePct: 0,
            tvaPct: state.globalTva,
            coutUnitaire: 0,
            agencyId: '',
            sectorId: '',
            siteId: '',
            activite: '',
            natureCout: '',
            ordreAffichage: state.lines.length,
            niveau,
        };
        setState(prev => ({ ...prev, lines: [...prev.lines, newLine] }));
    };

    const updateLine = (id: string, updates: Partial<WorkQuoteLine>) => {
        setState(prev => ({
            ...prev,
            lines: prev.lines.map(l => l.id === id ? { ...l, ...updates } : l)
        }));
    };

    const removeLine = (id: string) => {
        setState(prev => ({
            ...prev,
            lines: prev.lines.filter(l => l.id !== id)
        }));
    };

    const calculatedLines = useMemo(() => {
        const sortedLines = [...state.lines].sort((a, b) => a.ordreAffichage - b.ordreAffichage);
        const results: CalculatedLine[] = [];

        // Helper to get total for ARTICLE/OUVRAGE
        const getBaseLineTotals = (line: WorkQuoteLine) => {
            const totalHT = line.quantite * line.puHT * (1 - line.remisePct / 100);
            const totalCout = line.quantite * (line.coutUnitaire || 0);
            return { totalHT, totalCout };
        };

        for (let i = 0; i < sortedLines.length; i++) {
            const line = sortedLines[i];

            if (line.type === 'ARTICLE' || line.type === 'OUVRAGE') {
                const { totalHT, totalCout } = getBaseLineTotals(line);
                results.push({
                    ...line,
                    totalHT,
                    totalCout,
                    margeBrute: totalHT - totalCout
                });
            } else if (line.type === 'SOUS_TOTAL') {
                // Sum everything back to the last SOUS_TOTAL or TITRE
                let totalHT = 0;
                let totalCout = 0;
                for (let j = i - 1; j >= 0; j--) {
                    if (sortedLines[j].type === 'SOUS_TOTAL' || sortedLines[j].type === 'TITRE') break;
                    const base = getBaseLineTotals(sortedLines[j]);
                    totalHT += base.totalHT;
                    totalCout += base.totalCout;
                }
                results.push({
                    ...line,
                    totalHT,
                    totalCout,
                    margeBrute: totalHT - totalCout
                });
            } else if (line.type === 'TITRE') {
                // Sum everything "under" this titre (until next titre of same or higher level)
                let totalHT = 0;
                let totalCout = 0;
                for (let j = i + 1; j < sortedLines.length; j++) {
                    const nextLine = sortedLines[j];
                    if (nextLine.type === 'TITRE' && nextLine.niveau <= line.niveau) break;
                    if (nextLine.type === 'ARTICLE' || nextLine.type === 'OUVRAGE') {
                        const base = getBaseLineTotals(nextLine);
                        totalHT += base.totalHT;
                        totalCout += base.totalCout;
                    }
                }
                results.push({
                    ...line,
                    totalHT,
                    totalCout,
                    margeBrute: totalHT - totalCout
                });
            } else {
                // TEXTE etc
                results.push({
                    ...line,
                    totalHT: 0,
                    totalCout: 0,
                    margeBrute: 0
                });
            }
        }
        return results;
    }, [state.lines]);

    const globalCalculations = useMemo(() => {
        // Only sum ARTICLE/OUVRAGE for totals to avoid double counting with TITRE/SOUS_TOTAL
        const totalDirectCosts = calculatedLines.reduce((acc, l) =>
            (l.type === 'ARTICLE' || l.type === 'OUVRAGE') ? acc + l.totalCout : acc, 0);

        const totalHT = calculatedLines.reduce((acc, l) =>
            (l.type === 'ARTICLE' || l.type === 'OUVRAGE') ? acc + l.totalHT : acc, 0);

        const generalExpensesAmount = totalHT * (state.generalExpensesRate / 100);
        const finalCost = totalDirectCosts + generalExpensesAmount; // Approximate

        const grossMargin = totalHT - totalDirectCosts;
        const grossMarginRate = totalHT > 0 ? (grossMargin / totalHT) * 100 : 0;

        const netMargin = totalHT - finalCost;
        const netMarginRate = totalHT > 0 ? (netMargin / totalHT) * 100 : 0;

        const tvaAmount = totalHT * (state.globalTva / 100);
        const totalTTC = totalHT + tvaAmount;
        const finalWithEco = totalTTC + state.ecoContribution;

        return {
            totalDirectCosts,
            totalHT,
            generalExpensesAmount,
            finalCost,
            grossMargin,
            grossMarginRate,
            netMargin,
            netMarginRate,
            tvaAmount,
            totalTTC,
            finalWithEco,
        };
    }, [calculatedLines, state.generalExpensesRate, state.globalTva, state.ecoContribution]);

    return {
        state,
        updateState,
        addLine,
        updateLine,
        removeLine,
        calculatedLines,
        globalCalculations,
    };
}
