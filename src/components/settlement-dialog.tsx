'use client';

import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Service, SettlementRule, ServiceSettlement, SettlementTargetType, SettlementMethodType, SettlementReason, MeterReading } from '@/lib/types';
import { createSettlement, updateSettlement, getSettlementRules, getMeterReadingsByMeter } from '@/services/firestore';
import { format } from 'date-fns';

interface SettlementDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    service: Service;
    settlement?: ServiceSettlement | null; // If editing
    onSaved: () => void;
}

export function SettlementDialog({ open, onOpenChange, service, settlement, onSaved }: SettlementDialogProps) {
    const { toast } = useToast();
    const [rules, setRules] = useState<SettlementRule[]>([]);

    // Form State
    const [ruleId, setRuleId] = useState<string>('');
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');
    const [reason, setReason] = useState<SettlementReason>('FIN_ANNEE');
    const [comment, setComment] = useState<string>('');

    // P1 Details
    const [startReadingId, setStartReadingId] = useState<string>('');
    const [endReadingId, setEndReadingId] = useState<string>('');
    const [readings, setReadings] = useState<MeterReading[]>([]);
    const [manualStartIndex, setManualStartIndex] = useState<number>(0);
    const [manualEndIndex, setManualEndIndex] = useState<number>(0);

    // Fixed Details (P2/P3)
    const [annualAmountRef, setAnnualAmountRef] = useState<number>(0);
    const [daysInPeriod, setDaysInPeriod] = useState<number>(0);
    const [daysInBase, setDaysInBase] = useState<number>(365);
    const [monthsInPeriod, setMonthsInPeriod] = useState<number>(0);
    const [totalInstallments, setTotalInstallments] = useState<number>(12);
    const [billedInstallments, setBilledInstallments] = useState<number>(0);

    // Manual Amounts (for Fixed or Overrides)
    const [amountHt, setAmountHt] = useState<number>(0);

    const [calculationPreview, setCalculationPreview] = useState<any>(null);

    // Initial Load
    useEffect(() => {
        const loadRules = async () => {
            const r = await getSettlementRules();
            setRules(r);

            if (settlement) {
                // Edit Mode
                setRuleId(settlement.ruleId);
                setStartDate(settlement.startDate);
                setEndDate(settlement.endDate);
                setReason(settlement.reason);
                setComment(settlement.comment || '');
                setAmountHt(settlement.amountHt);

                if (settlement.p1Detail) {
                    setStartReadingId(settlement.p1Detail.startReadingId || 'MANUAL');
                    setEndReadingId(settlement.p1Detail.endReadingId || 'MANUAL');
                    setManualStartIndex(settlement.p1Detail.startIndex);
                    setManualEndIndex(settlement.p1Detail.endIndex);
                }

                if (settlement.fixedDetail) {
                    setAnnualAmountRef(settlement.fixedDetail.annualAmountReference);
                    setDaysInPeriod(settlement.fixedDetail.daysInPeriod || 0);
                    setMonthsInPeriod(settlement.fixedDetail.monthsInPeriod || 0);
                    setTotalInstallments(settlement.fixedDetail.totalInstallments || 12);
                    setBilledInstallments(settlement.fixedDetail.billedInstallments || 0);
                }
            } else {
                // New Mode
                if (service.settlementRuleId) {
                    setRuleId(service.settlementRuleId);
                }
                // Default start date = service start or last settlement end?
                // For now, let's just default to current year.
            }
        };

        loadRules();
    }, [settlement, service]);

    // Load Readings if P1
    useEffect(() => {
        if (service.type === 'P1' && service.meterId) {
            getMeterReadingsByMeter(service.meterId).then(r => {
                setReadings(r.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
            });
        }
    }, [service]);

    // Auto-calculate logic
    useEffect(() => {
        const selectedRule = rules.find(r => r.id === ruleId);
        if (!selectedRule) return;

        let calculatedAmount = 0;
        let details = {};

        if (selectedRule.code === 'CONSO_REELLE') {
            // Consumption logic
            let sIndex = manualStartIndex;
            let eIndex = manualEndIndex;

            if (startReadingId && startReadingId !== 'MANUAL') {
                const r = readings.find(reading => reading.id === startReadingId);
                if (r) sIndex = r.value;
            }
            if (endReadingId && endReadingId !== 'MANUAL') {
                const r = readings.find(reading => reading.id === endReadingId);
                if (r) eIndex = r.value;
            }

            const conso = Math.max(0, eIndex - sIndex);
            // Coefficient? Assuming 1 for now or need to fetch from Dju/Conversion service later?
            // For P1 Gaz, we might need a coefficient. 
            // The model has `conversionCoefficient` in P1 details.
            // Let's assume a default of 1 if not handled yet, or use service unit price if MWh.
            // Wait, P1 price is usually Unit Price * Consumption.
            // If unit is MWh and readings are MWh, coeff is 1. If readings m3, we need coeff.
            // Let's assume readings are in same unit as price for simplicity or use 1.

            calculatedAmount = conso * (service.unitPrice || 0);
            details = { consumption: conso };

            // Only update amount if not manually overridden by user logic (not implemented yet, just auto-set)
            if (!settlement) setAmountHt(calculatedAmount);
        }
        else if (selectedRule.code === 'PRORATA_JOURS') {
            // Prorata Jours
            // Need Start/End dates
            if (startDate && endDate) {
                const start = new Date(startDate);
                const end = new Date(endDate);
                const diffTime = Math.abs(end.getTime() - start.getTime());
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // Inclusive

                // Base amount: Use annualAmountRef or Service P2 Price (usually Annual)
                const base = annualAmountRef || service.price || 0;

                const amount = (base / daysInBase) * diffDays;
                calculatedAmount = amount;
                if (!settlement) {
                    setDaysInPeriod(diffDays);
                    setAmountHt(amount);
                }
            }
        }
        else if (selectedRule.code === 'PRORATA_MOIS') {
            if (startDate && endDate) {
                // Simplified months calc
                const start = new Date(startDate);
                const end = new Date(endDate);
                // Rough estimate or precise?
                const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1; // Inclusive month count?
                // Usually Prorata Mois is 1/12 of annual.

                const base = annualAmountRef || service.price || 0;
                const amount = (base / 12) * months;
                calculatedAmount = amount;
                if (!settlement) {
                    setMonthsInPeriod(months);
                    setAmountHt(amount);
                }
            }
        }
        else if (selectedRule.code === 'ECHEANCIER') {
            // Echeancier: Total Annual - Billed
            // User inputs billed count or amount. 
            // Formula: Annuel - (Annuel/TotalInstallments * BilledInstallments) -> Remaining Balance?
            // Or usually Settlement is "What is owed vs what was paid".
            // Solde = (Montant Du) - (Montant Facturé).
            // Here we are calculating the Settlement Amount (The Bill).
            // If it's a credit, it's negative.

            const base = annualAmountRef || service.price || 0;
            const invoiced = (base / totalInstallments) * billedInstallments;
            const balance = base - invoiced;
            // Wait, this assumes we want to bill the remainder?
            // "Solde Echéancier" typically means "Finalize the year".
            // Let's assume Amount = Remainder.
            calculatedAmount = balance;
            if (!settlement) {
                setAmountHt(balance);
            }
        }

        setCalculationPreview({ amount: calculatedAmount, ...details });

    }, [ruleId, startDate, endDate, manualStartIndex, manualEndIndex, startReadingId, endReadingId, annualAmountRef, daysInBase, totalInstallments, billedInstallments, service, rules, settlement]);

    const handleSave = async () => {
        if (!ruleId || !startDate || !endDate) {
            toast({ title: "Erreur", description: "Veuillez remplir les champs obligatoires.", variant: "destructive" });
            return;
        }

        const selectedRule = rules.find(r => r.id === ruleId);

        const data: any = {
            serviceId: service.id,
            ruleId,
            startDate,
            endDate,
            reason,
            amountHt,
            vatRate: 20, // TODO: Fetch from service or global settings
            amountTtc: amountHt * 1.2, // TODO: proper VAT calc
            calculationDate: new Date().toISOString(),
            comment,
            ruleSnapshot: selectedRule,
        };

        if (selectedRule?.code === 'CONSO_REELLE') {
            data.p1Detail = {
                meterId: service.meterId,
                startReadingId: startReadingId === 'MANUAL' ? undefined : startReadingId,
                endReadingId: endReadingId === 'MANUAL' ? undefined : endReadingId,
                startIndex: manualStartIndex, // Should be updated by effect
                endIndex: manualEndIndex,
                consumption: Math.max(0, manualEndIndex - manualStartIndex), // Re-calc to be safe
                conversionCoefficient: 1, // Default
            };
        } else {
            // Fixed details
            data.fixedDetail = {
                annualAmountReference: annualAmountRef || service.price || 0,
                prorataMode: selectedRule?.code === 'PRORATA_JOURS' ? 'JOURS' : selectedRule?.code === 'PRORATA_MOIS' ? 'MOIS' : 'ECHEANCES',
                daysInPeriod,
                daysInBase,
                monthsInPeriod,
                totalInstallments,
                billedInstallments
            };
        }

        try {
            if (settlement) {
                await updateSettlement(settlement.id, data);
                toast({ title: "Succès", description: "Décompte mis à jour." });
            } else {
                await createSettlement(data);
                toast({ title: "Succès", description: "Décompte créé." });
            }
            onSaved();
            onOpenChange(false);
        } catch (error) {
            console.error(error);
            toast({ title: "Erreur", description: "Impossible d'enregistrer le décompte.", variant: "destructive" });
        }
    };

    const selectedRule = rules.find(r => r.id === ruleId);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{settlement ? "Modifier le décompte" : "Nouveau décompte définitif"}</DialogTitle>
                    <DialogDescription>
                        {service.type} - {service.description || 'Prestation'}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-4">
                    {/* Common Fields */}
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Méthode de Calcul</Label>
                            <Select value={ruleId} onValueChange={setRuleId}>
                                <SelectTrigger><SelectValue placeholder="Choisir une méthode" /></SelectTrigger>
                                <SelectContent>
                                    {rules.filter(r => r.targetType === null || r.targetType === service.type).map(r => (
                                        <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Date de début</Label>
                                <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label>Date de fin</Label>
                                <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Motif</Label>
                            <Select value={reason} onValueChange={(r: SettlementReason) => setReason(r)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="FIN_ANNEE">Fin d'année</SelectItem>
                                    <SelectItem value="RESILIATION">Résiliation</SelectItem>
                                    <SelectItem value="AVENANT">Avenant</SelectItem>
                                    <SelectItem value="CHANGEMENT_SYNDIC">Changement de syndic</SelectItem>
                                    <SelectItem value="AUTRE">Autre</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Dynamic Fields based on Rule */}
                    <div className="space-y-4 p-4 bg-muted/20 rounded-md border">
                        <h3 className="font-semibold text-sm">Paramètres de calcul</h3>

                        {selectedRule?.code === 'CONSO_REELLE' && (
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Index début</Label>
                                    <Select value={startReadingId} onValueChange={(v) => {
                                        setStartReadingId(v);
                                        if (v !== 'MANUAL') {
                                            const r = readings.find(reading => reading.id === v);
                                            if (r) setManualStartIndex(r.value);
                                        }
                                    }}>
                                        <SelectTrigger><SelectValue placeholder="Sélectionner index" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="MANUAL">Saisie Manuelle</SelectItem>
                                            {readings.map(r => (
                                                <SelectItem key={r.id} value={r.id}>{format(new Date(r.date), 'dd/MM/yyyy')} - {r.value} {r.unit}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    {startReadingId === 'MANUAL' && (
                                        <Input type="number" value={manualStartIndex} onChange={e => setManualStartIndex(parseFloat(e.target.value))} placeholder="Valeur Index" />
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <Label>Index fin</Label>
                                    <Select value={endReadingId} onValueChange={(v) => {
                                        setEndReadingId(v);
                                        if (v !== 'MANUAL') {
                                            const r = readings.find(reading => reading.id === v);
                                            if (r) setManualEndIndex(r.value);
                                        }
                                    }}>
                                        <SelectTrigger><SelectValue placeholder="Sélectionner index" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="MANUAL">Saisie Manuelle</SelectItem>
                                            {readings.map(r => (
                                                <SelectItem key={r.id} value={r.id}>{format(new Date(r.date), 'dd/MM/yyyy')} - {r.value} {r.unit}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    {endReadingId === 'MANUAL' && (
                                        <Input type="number" value={manualEndIndex} onChange={e => setManualEndIndex(parseFloat(e.target.value))} placeholder="Valeur Index" />
                                    )}
                                </div>
                                <div className="text-sm">
                                    Consommation: <span className="font-bold">{Math.max(0, manualEndIndex - manualStartIndex)}</span> {service.unit?.replace('€/', '')}
                                </div>
                            </div>
                        )}

                        {(selectedRule?.code === 'PRORATA_JOURS' || selectedRule?.code === 'PRORATA_MOIS') && (
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Montant Annuel de Référence</Label>
                                    <Input type="number" value={annualAmountRef || service.price} onChange={e => setAnnualAmountRef(parseFloat(e.target.value))} />
                                </div>
                                {selectedRule.code === 'PRORATA_JOURS' && (
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label>Nb Jours Période</Label>
                                            <Input type="number" value={daysInPeriod} readOnly className="bg-muted" />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Nb Jours Base</Label>
                                            <Input type="number" value={daysInBase} onChange={e => setDaysInBase(parseFloat(e.target.value))} />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {selectedRule?.code === 'ECHEANCIER' && (
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Montant Total Annuel</Label>
                                    <Input type="number" value={annualAmountRef || service.price} onChange={e => setAnnualAmountRef(parseFloat(e.target.value))} />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Nb Échéances Totales</Label>
                                        <Input type="number" value={totalInstallments} onChange={e => setTotalInstallments(parseFloat(e.target.value))} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Nb Échéances Facturées</Label>
                                        <Input type="number" value={billedInstallments} onChange={e => setBilledInstallments(parseFloat(e.target.value))} />
                                    </div>
                                </div>
                            </div>
                        )}

                    </div>
                </div>

                <div className="space-y-2">
                    <Label>Résultat (HT)</Label>
                    <div className="flex items-center gap-4">
                        <Input type="number" className="text-lg font-bold" value={amountHt} onChange={e => setAmountHt(parseFloat(e.target.value))} />
                        <span className="text-muted-foreground">€ HT</span>
                    </div>
                </div>

                <div className="space-y-2 mt-4">
                    <Label>Commentaire</Label>
                    <Textarea value={comment} onChange={e => setComment(e.target.value)} />
                </div>

                <DialogFooter className="mt-6">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
                    <Button onClick={handleSave}>Enregistrer le décompte</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
