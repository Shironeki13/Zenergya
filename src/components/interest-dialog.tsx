'use client';

import { SearchableSelect } from '@/components/ui/searchable-select';
import { useState, useEffect } from 'react';
import { Interest, Service, MeterReading, Dju } from '@/lib/types';
import { createInterest, updateInterest, getMeterReadingsByMeter, getDjuTotal, getWeatherStations } from '@/services/firestore';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { Calculator } from 'lucide-react';
import { getP1SiteAction } from '@/lib/p1/actions';
import { baremeAu, valeurAu } from '@/lib/p1/stockage';
import type { TermeNc, TrancheBareme, TypeMarche } from '@/lib/p1/parametrage';
import { formatBareme, partage, quantiteRegularisation } from '@/lib/p1/bareme';

interface InterestDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    service: Service;
    existingInterest: Interest | null;
    onSaved: () => void;
}

export function InterestDialog({ open, onOpenChange, service, existingInterest, onSaved }: InterestDialogProps) {
    // Form State
    const [seasonLabel, setSeasonLabel] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    // Readings
    const [startReadingId, setStartReadingId] = useState('');
    const [endReadingId, setEndReadingId] = useState('');
    const [startIndex, setStartIndex] = useState(0);
    const [endIndex, setEndIndex] = useState(0);

    // Reference (Snapshot from Service)
    const [referenceNb, setReferenceNb] = useState(service.referenceNb || 0);
    const [referenceDju, setReferenceDju] = useState(service.referenceDju || 0);
    const [sharingPercentage, setSharingPercentage] = useState(service.sharingPercentage || 0);
    const [interestUnitPrice, setInterestUnitPrice] = useState(service.interestUnitPrice || 0);

    // Calculated
    const [measuredDju, setMeasuredDju] = useState(0);
    // Coefficient de conversion (QE) : jamais 1 par défaut ; vide tant qu'il n'est pas connu (paramétrage P1 du compteur).
    const [conversionCoefficient, setConversionCoefficient] = useState<number | null>(null);
    /** Origine des références : paramétrage P1 daté, ou ancienne saisie de la prestation. */
    const [referenceSource, setReferenceSource] = useState<'p1' | 'prestation' | null>(null);
    /** Barème de partage en vigueur (paramétrage P1) et type de marché : partage par tranches comme le moteur P1. */
    const [p1Bareme, setP1Bareme] = useState<{ typeMarche: TypeMarche; tranches: TrancheBareme[]; source: 'site' | 'contrat' } | null>(null);

    // Results
    const [ncMwh, setNcMwh] = useState(0);
    const [correctedNb, setCorrectedNb] = useState(0);
    const [deviationPercentage, setDeviationPercentage] = useState(0);
    const [sharingQuantity, setSharingQuantity] = useState(0);
    const [interestAmount, setInterestAmount] = useState(0);
    const [gainLoss, setGainLoss] = useState(0);

    const [comment, setComment] = useState('');

    // Data Loading
    const [readings, setReadings] = useState<MeterReading[]>([]);
    const [stations, setStations] = useState<{ code: string, name: string }[]>([]);
    const [selectedStation, setSelectedStation] = useState(service.heatingWeatherStation || '');

    const [isLoadingReadings, setIsLoadingReadings] = useState(false);
    const [isCalculating, setIsCalculating] = useState(false);

    useEffect(() => {
        const loadStations = async () => {
            try {
                const s = await getWeatherStations();
                setStations(s);
            } catch (e) {
                console.error(e);
            }
        };
        loadStations();
    }, []);

    useEffect(() => {
        if (open && service.meterId) {
            const loadReadings = async () => {
                setIsLoadingReadings(true);
                try {
                    const data = await getMeterReadingsByMeter(service.meterId!);
                    // Sort by date desc
                    setReadings(data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
                } catch (e) {
                    console.error(e);
                } finally {
                    setIsLoadingReadings(false);
                }
            };
            loadReadings();
        }
    }, [open, service.meterId]);

    useEffect(() => {
        if (existingInterest) {
            setSeasonLabel(existingInterest.seasonLabel);
            setStartDate(existingInterest.startDate);
            setEndDate(existingInterest.endDate);
            setStartReadingId(existingInterest.startReadingId || '');
            setEndReadingId(existingInterest.endReadingId || '');
            setStartIndex(existingInterest.startIndex);
            setEndIndex(existingInterest.endIndex);

            setReferenceNb(existingInterest.referenceNb);
            setReferenceDju(existingInterest.referenceDju);
            setSharingPercentage(existingInterest.sharingPercentage || 0); // Handle legacy/missing
            setInterestUnitPrice(existingInterest.unitPrice); // interestUnitPrice stored as unitPrice in Interest type? No, unitPrice is separate. 
            // Wait, Interest type has unitPrice. Service has interestUnitPrice. Let's assume they map.

            setMeasuredDju(existingInterest.measuredDju);
            setConversionCoefficient(existingInterest.conversionCoefficient ?? null);
            setReferenceSource(null);

            // Results should be recalculated or loaded? Loaded is safer for history, but recalculating ensures consistency if logic changes.
            // Let's load them for display.
            setNcMwh(existingInterest.ncMwh);
            setCorrectedNb(existingInterest.correctedNb);
            setDeviationPercentage(existingInterest.deviationPercentage);
            setSharingQuantity(existingInterest.sharingQuantity);
            setInterestAmount(existingInterest.interestAmount);
            setGainLoss(existingInterest.gainLoss);

            setComment(existingInterest.comment || '');
        } else {
            // Nouvel intéressement : références du paramétrage P1 en vigueur (voir l'effet suivant).
            setSeasonLabel(`${new Date().getFullYear() - 1}-${new Date().getFullYear()}`);
            setSharingPercentage(service.sharingPercentage || 0);
            setInterestUnitPrice(service.interestUnitPrice || 0);
        }
    }, [existingInterest, service]);

    // Références d'un nouvel intéressement : paramétrage P1 en vigueur au début de la saison (source unique) ;
    // à défaut, l'ancienne saisie de la prestation, signalée.
    useEffect(() => {
        if (!open || existingInterest) return;
        let cancelled = false;
        const day = startDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
        getP1SiteAction(service.siteId, day).then(r => {
            if (cancelled) return;
            const view = r.success ? r.data : null;
            const meter = view?.meters.find(m => m.id === service.meterId);
            const postes = Object.values(view?.siteDoc?.postes ?? {}).filter(p => !p.retireLe);
            const poste = postes.find(p => (valeurAu<TermeNc[]>(p.params, 'formuleNc', day) ?? []).some(t => t.codeCompteur === meter?.code)) ?? (postes.length === 1 ? postes[0] : undefined);
            const nb = poste ? valeurAu<number>(poste.params, 'cibleNb', day) : null;
            const dju = poste ? valeurAu<number>(poste.params, 'djuReference', day) : null;
            if (nb && dju) {
                setReferenceNb(nb); setReferenceDju(dju); setReferenceSource('p1');
            } else if (service.referenceNb && service.referenceDju) {
                setReferenceNb(service.referenceNb); setReferenceDju(service.referenceDju); setReferenceSource('prestation');
            } else {
                setReferenceNb(0); setReferenceDju(0); setReferenceSource(null);
            }
            const qe = meter ? valeurAu<number>(meter.doc?.params, 'qe', day) : null;
            setConversionCoefficient(qe ?? ((meter?.unit ?? '').toLowerCase() === 'mwh' ? 1 : null));
            const station = view ? valeurAu<string>(view.siteDoc?.params, 'stationMeteo', day) : null;
            if (station) setSelectedStation(station);
            const typeMarche = view ? valeurAu<TypeMarche>(view.siteDoc?.params, 'typeMarche', day) : null;
            const bareme = view && typeMarche ? baremeAu(view.siteDoc, view.contractDoc, typeMarche, day) : null;
            setP1Bareme(typeMarche && bareme ? { typeMarche, ...bareme } : null);
        });
        return () => { cancelled = true; };
    }, [open, existingInterest, startDate, service]);

    // Auto-select reading values when IDs change
    useEffect(() => {
        if (startReadingId && startReadingId !== 'MANUAL') {
            const r = readings.find(reading => reading.id === startReadingId);
            if (r) setStartIndex(r.value);
        }
    }, [startReadingId, readings]);

    useEffect(() => {
        if (endReadingId && endReadingId !== 'MANUAL') {
            const r = readings.find(reading => reading.id === endReadingId);
            if (r) setEndIndex(r.value);
        }
    }, [endReadingId, readings]);


    const handleCalculate = async () => {
        setIsCalculating(true);
        try {
            // 1. Calculate NC (MWh)
            // NC = (Index Fin - Index Début) * Coeff
            const rawConsumption = endIndex - startIndex;
            if (rawConsumption < 0) {
                toast({ title: "Attention", description: "L'index de fin est inférieur à l'index de début.", variant: "destructive" });
                setIsCalculating(false);
                return;
            }
            if (conversionCoefficient === null || !(conversionCoefficient > 0)) {
                toast({ title: "Coefficient QE non renseigné", description: "Renseignez le coefficient de conversion du compteur (paramétrage P1) : il n'est jamais supposé égal à 1.", variant: "destructive" });
                setIsCalculating(false);
                return;
            }
            if (!(referenceNb > 0) || !(referenceDju > 0)) {
                toast({ title: "Références non renseignées", description: "Cible NB et DJU de référence du poste de consommation (paramétrage P1).", variant: "destructive" });
                setIsCalculating(false);
                return;
            }
            const calculatedNc = rawConsumption * conversionCoefficient;
            setNcMwh(calculatedNc);

            // 2. Fetch/Calculate DJU Mesuré
            // Needs weather station from service
            let djuVal = measuredDju;
            if (selectedStation && selectedStation !== 'MANUAL' && startDate && endDate) {
                djuVal = await getDjuTotal(selectedStation, startDate, endDate);
                setMeasuredDju(djuVal);
            } else {
                // If manual or no station, rely on user input for Measured DJU (which is handled by state)
                // If it was 0, maybe warn?
            }

            // 3. Calculate NB Corrigé
            // NB_cor = NB_ref * (DJU_mes / DJU_ref)
            let calcCorrectedNb = 0;
            if (referenceDju > 0) {
                calcCorrectedNb = referenceNb * (djuVal / referenceDju);
            }
            setCorrectedNb(calcCorrectedNb);

            // 4. Calculate Deviation %
            // % Ecart = (NC - NB_cor) / NB_cor
            let calcDeviation = 0;
            if (calcCorrectedNb > 0) {
                calcDeviation = (calculatedNc - calcCorrectedNb) / calcCorrectedNb;
            }
            setDeviationPercentage(calcDeviation);

            // 5. Calculate Sharing Quantity & Interest
            // Logic depends on contract type (MCI, MTI, MF) - for now implementing generic logic based on sharing %
            // Generic Logic:
            // Gain/Loss quantity = (NB_cor - NC) -> if positive, we consumed less (Gain), if negative, we consumed more (Loss)
            // Sharing Quantity = Gain/Loss * Sharing %
            // Interest Amount = Sharing Quantity * Unit Price

            // Note: User requirement said "Gain/Pert" -> numeric value.
            // Let's assume standard P1 Sharing:
            // Delta = NB_cor - NC
            // Partage = Delta * (Percentage / 100)

            const delta = calcCorrectedNb - calculatedNc;
            // Barème P1 en vigueur : partage par tranches (RG-53) et quantité de régularisation selon le marché (RG-54),
            // positive à facturer au client. Sans barème : ancien pourcentage unique de la prestation.
            const share = p1Bareme && !existingInterest
                ? quantiteRegularisation(p1Bareme.typeMarche, delta, partage(delta, calcCorrectedNb, p1Bareme.tranches).client)
                : delta * (sharingPercentage / 100);
            setSharingQuantity(share);

            const amount = share * interestUnitPrice;
            setInterestAmount(amount);

            setGainLoss(share); // using share as the gain/loss metric? Or just 1/0? "Gain/Perte" usually refers to the financial result or the sign.
            // Let's store the signed Interest Amount as the primary financial result.

        } catch (error) {
            console.error(error);
            toast({ title: "Erreur", description: "Erreur lors du calcul.", variant: "destructive" });
        } finally {
            setIsCalculating(false);
        }
    };

    const handleSave = async () => {
        // Validation
        if (!seasonLabel || !startDate || !endDate) {
            toast({ title: "Erreur", description: "Veuillez remplir les champs obligatoires.", variant: "destructive" });
            return;
        }
        if (conversionCoefficient === null || !(conversionCoefficient > 0)) {
            toast({ title: "Coefficient QE non renseigné", description: "Un intéressement ne s'enregistre pas sans coefficient de conversion connu.", variant: "destructive" });
            return;
        }

        const data: Omit<Interest, 'id'> = {
            serviceId: service.id,
            meterId: service.meterId,
            seasonLabel,
            startDate,
            endDate,
            startReadingId: (startReadingId && startReadingId !== 'MANUAL') ? startReadingId : undefined,
            endReadingId: (endReadingId && endReadingId !== 'MANUAL') ? endReadingId : undefined,
            startIndex,
            endIndex,
            referenceDju,
            referenceNb,
            conversionCoefficient,
            ncMwh,
            measuredDju,
            correctedNb,
            deviationPercentage,
            sharingQuantity,
            unitPrice: interestUnitPrice, // Snapshot of PU
            interestAmount,
            gainLoss,
            calculationDate: new Date().toISOString(),
            comment
        };

        try {
            if (existingInterest) {
                await updateInterest(existingInterest.id, data);
                toast({ title: "Succès", description: "Campagne mise à jour." });
            } else {
                await createInterest(data);
                toast({ title: "Succès", description: "Campagne créée." });
            }
            onSaved();
        } catch (error) {
            console.error(error);
            toast({ title: "Erreur", description: "Erreur lors de l'enregistrement.", variant: "destructive" });
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{existingInterest ? 'Modifier Campagne' : 'Nouvelle Campagne d\'Intéressement'}</DialogTitle>
                    <DialogDescription>
                        Calcul de l'intéressement P1 basée sur la consommation et la rigueur climatique.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
                    {/* Colonne Gauche: Paramètres & Relevés */}
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Libellé Saison</Label>
                            <Input value={seasonLabel} onChange={e => setSeasonLabel(e.target.value)} placeholder="ex: 2024-2025" />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-2">
                                <Label>Date Début</Label>
                                <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label>Date Fin</Label>
                                <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                            </div>
                        </div>

                        <Separator />

                        <div className="space-y-2">
                            <Label className="font-semibold">Relevés Index (P1)</Label>

                            {/* Start Index */}
                            <div className="grid grid-cols-3 gap-2 items-end">
                                <div className="col-span-2 space-y-1">
                                    <Label className="text-xs">Relevé Début</Label>
                                    <SearchableSelect value={startReadingId} onValueChange={setStartReadingId} placeholder="Choisir..." searchPlaceholder="Date (jj/mm/aaaa) ou index…"
                                        options={[...readings.map(r => ({ value: r.id, label: `${new Date(r.date).toLocaleDateString('fr-FR')} - ${r.value}` })), { value: 'MANUAL', label: 'Manuel' }]} />
                                </div>
                                <Input
                                    type="number"
                                    value={startIndex}
                                    onChange={e => { setStartIndex(parseFloat(e.target.value)); setStartReadingId('MANUAL'); }}
                                    className="col-span-1"
                                />
                            </div>

                            {/* End Index */}
                            <div className="grid grid-cols-3 gap-2 items-end">
                                <div className="col-span-2 space-y-1">
                                    <Label className="text-xs">Relevé Fin</Label>
                                    <SearchableSelect value={endReadingId} onValueChange={setEndReadingId} placeholder="Choisir..." searchPlaceholder="Date (jj/mm/aaaa) ou index…"
                                        options={[...readings.map(r => ({ value: r.id, label: `${new Date(r.date).toLocaleDateString('fr-FR')} - ${r.value}` })), { value: 'MANUAL', label: 'Manuel' }]} />
                                </div>
                                <Input
                                    type="number"
                                    value={endIndex}
                                    onChange={e => { setEndIndex(parseFloat(e.target.value)); setEndReadingId('MANUAL'); }}
                                    className="col-span-1"
                                />
                            </div>

                            <div className="space-y-1">
                                <Label className="text-xs">Coefficient de Conversion</Label>
                                <Input type="number" step="0.0001" value={conversionCoefficient ?? ''} placeholder="non renseigné" onChange={e => setConversionCoefficient(e.target.value === '' ? null : parseFloat(e.target.value))} />
                            </div>
                        </div>
                    </div>

                    {/* Colonne Droite: Références & Calculs */}
                    <div className="space-y-4">
                        <div className="space-y-2 p-3 bg-muted rounded-md text-sm">
                            <h4 className="font-semibold mb-2">Paramètres Contractuels</h4>
                            {!existingInterest && (p1Bareme
                                ? <p className="text-xs">Barème {p1Bareme.typeMarche} ({p1Bareme.source}) : {formatBareme(p1Bareme.tranches)}</p>
                                : <p className="text-xs text-amber-600">Pas de barème de partage dans le paramétrage P1 : pourcentage unique de la prestation.</p>)}
                            {referenceSource === 'prestation' && <p className="text-xs text-amber-600">Cible et DJU repris de l'ancienne saisie de la prestation : renseignez-les dans le paramétrage P1 du site.</p>}
                            {referenceSource === null && !existingInterest && <p className="text-xs text-destructive">Cible NB et DJU de référence non renseignés (paramétrage P1 du site).</p>}
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <span className="text-muted-foreground block text-xs">NB Réf (MWh)</span>
                                    <span className="font-medium">{referenceNb}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground block text-xs">DJU Réf</span>
                                    <span className="font-medium">{referenceDju}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground block text-xs">Partage %</span>
                                    <span className="font-medium">{sharingPercentage}%</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground block text-xs">PU Intéressement</span>
                                    <span className="font-medium">{interestUnitPrice} €</span>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Station Météo (pour DJU)</Label>
                            <SearchableSelect value={selectedStation} onValueChange={setSelectedStation} placeholder="Choisir une station..." searchPlaceholder="Ville ou code de la station…"
                                options={[...stations.map(s => ({ value: s.code, label: `${s.name} (${s.code})` })), { value: 'MANUAL', label: 'Saisie manuelle' }]} />
                        </div>

                        <div className="space-y-2">
                            <Label>DJU Mesuré</Label>
                            <div className="flex gap-2">
                                <Input type="number" value={measuredDju} onChange={e => setMeasuredDju(parseFloat(e.target.value))} />
                                <Button variant="outline" size="icon" onClick={() => toast({ description: "Récupération auto au calcul" })} title="Récupérer DJU">
                                    <Calculator className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>

                        <Separator />

                        <div className="space-y-2 pt-2">
                            <Button className="w-full" onClick={handleCalculate} disabled={isCalculating}>
                                {isCalculating ? 'Calcul en cours...' : 'Lancer le Calcul'}
                            </Button>
                        </div>

                        <div className="space-y-2 p-3 border rounded-md bg-slate-50">
                            <h4 className="font-semibold mb-2">Résultats</h4>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                                <div>
                                    <span className="text-muted-foreground block text-xs">NC (Conso Corrigée)</span>
                                    <span className="font-medium">{ncMwh.toFixed(3)} MWh</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground block text-xs">NB Corrigé (Climat)</span>
                                    <span className="font-medium">{correctedNb.toFixed(3)} MWh</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground block text-xs">Ecart %</span>
                                    <span className={deviationPercentage > 0 ? "text-red-600 font-medium" : "text-green-600 font-medium"}>
                                        {(deviationPercentage * 100).toFixed(2)} %
                                    </span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground block text-xs">Quantité Partagée</span>
                                    <span className="font-medium">{sharingQuantity.toFixed(3)} MWh</span>
                                </div>
                                <div className="col-span-2 mt-2 pt-2 border-t flex justify-between items-center">
                                    <span className="font-semibold">Montant Intéressement</span>
                                    <span className={`text-lg font-bold ${interestAmount >= 0 ? "text-green-600" : "text-red-600"}`}>
                                        {interestAmount.toFixed(2)} €
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-2">
                    <Label>Commentaire</Label>
                    <Textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Observations..." className="h-20" />
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
                    <Button onClick={handleSave}>Enregistrer</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
