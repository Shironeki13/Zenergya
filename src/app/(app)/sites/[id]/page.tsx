'use client';

import Link from 'next/link';
import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useData } from '@/context/data-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Plus, Trash2, Edit, Check, MoreHorizontal, Save, ChevronsUpDown, X, Calculator, Flame, Droplets, Snowflake, Wrench, ChevronDown, ChevronUp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { updateSite, createService, updateService, deleteService, createMeter, updateMeter, deleteMeter } from '@/services/firestore';
import type { Site, Contract, Service, Meter, RevisionRule, Activity, Term, Schedule, PricingRule, ServiceType, ServiceInitialIndexValue, Index, IndexValue, ServiceBillingLine, BillingLineType } from '@/lib/types';
import { MeterReadingsDialog } from '@/components/meter-readings-dialog';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { calculateIndexValue, calculateRevisionCoefficient } from '@/lib/calculations';
import { InterestManager } from '@/components/interest-manager';
import { SettlementManager } from '@/components/settlement-manager';

export default function SiteDetailsPage() {
    const params = useParams();
    const router = useRouter();
    const { sites, contracts, meters, services, activities, revisionRules, pricingRules, terms, schedules, reloadData, isLoading, indices, indexValues, settlementRules, meterReadings, vatRates, invoices, weatherStations } = useData();
    const siteId = params.id as string;

    const [site, setSite] = useState<Site | null>(null);
    const [contract, setContract] = useState<Contract | null>(null);
    const [siteMeters, setSiteMeters] = useState<Meter[]>([]);
    const [siteServices, setSiteServices] = useState<Service[]>([]);

    // Meter Dialog State
    const [isMeterDialogOpen, setIsMeterDialogOpen] = useState(false);
    const [editingMeter, setEditingMeter] = useState<Meter | null>(null);

    // Service Dialog State
    const [isServiceDialogOpen, setIsServiceDialogOpen] = useState(false);
    const [editingService, setEditingService] = useState<Service | null>(null);
    const [selectedActivityId, setSelectedActivityId] = useState<string>('');
    const [selectedType, setSelectedType] = useState<ServiceType>('P1');

    // Service Form State
    const [billingTermId, setBillingTermId] = useState<string>('');
    const [scheduleId, setScheduleId] = useState<string>('');
    const [pricingRuleId, setPricingRuleId] = useState<string>('');
    const [revisionRuleId, setRevisionRuleId] = useState<string>('');
    const [price, setPrice] = useState<number>(0);
    const [meterId, setMeterId] = useState<string>('');
    const [isMeterComboOpen, setIsMeterComboOpen] = useState(false);
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');
    const [description, setDescription] = useState<string>('');

    // New Fields
    const [unitPrice, setUnitPrice] = useState<number>(0);
    const [unit, setUnit] = useState<string>('');
    const [vatRateId, setVatRateId] = useState<string>('');
    const [energyType, setEnergyType] = useState<string>('');
    const [p1Type, setP1Type] = useState<string>('');
    const [isActive, setIsActive] = useState<boolean>(true);
    const [comment, setComment] = useState<string>('');
    const [moleculePrice, setMoleculePrice] = useState<number>(0);
    const [serviceIndices, setServiceIndices] = useState<ServiceInitialIndexValue[]>([]);
    const [isFixedPrice, setIsFixedPrice] = useState<boolean>(false);

    // Interest Params State
    const [referenceNb, setReferenceNb] = useState<number>(0);
    const [referenceDju, setReferenceDju] = useState<number>(0);
    const [heatingContractType, setHeatingContractType] = useState<string>('');
    const [heatingWeatherStation, setHeatingWeatherStation] = useState<string>('');
    const [sharingPercentage, setSharingPercentage] = useState<number>(0);
    const [interestUnitPrice, setInterestUnitPrice] = useState<number>(0);
    const [settlementRuleId, setSettlementRuleId] = useState<string>('');

    // Billing Params State (P1) — used in service edit modal
    const [includeAnnex, setIncludeAnnex] = useState<boolean>(false);
    const [paymentTermDays, setPaymentTermDays] = useState<number>(30);
    const [conversionCoefficient, setConversionCoefficient] = useState<number>(1);
    const [billingLines, setBillingLines] = useState<ServiceBillingLine[]>([
        { lineType: 'CONSOMMATION', label: '', vatRateId: '', isActive: true }
    ]);

    // Inline billing params edit (left sidebar)
    const [isEditingBillingParams, setIsEditingBillingParams] = useState(false);
    const [bpAnnex, setBpAnnex] = useState(false);
    const [bpDays, setBpDays] = useState(30);
    const [bpCoeff, setBpCoeff] = useState(1);
    const [bpLines, setBpLines] = useState<ServiceBillingLine[]>([
        { lineType: 'CONSOMMATION', label: '', vatRateId: '', isActive: true }
    ]);

    const [openCombobox, setOpenCombobox] = useState(false);
    const [showRevisionDetails, setShowRevisionDetails] = useState(false);
    const [showBillingCalendar, setShowBillingCalendar] = useState(false);

    // Selected Service for Detail View
    const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);

    // Interest Manager Dialog
    const [isInterestManagerOpen, setIsInterestManagerOpen] = useState(false);
    // Settlement Manager Dialog
    const [isSettlementManagerOpen, setIsSettlementManagerOpen] = useState(false);


    useEffect(() => {
        if (!isLoading && siteId) {
            const foundSite = sites.find(s => s.id === siteId);
            if (foundSite) {
                setSite(foundSite);
                const foundContract = contracts.find(c => c.siteIds?.includes(siteId));
                setContract(foundContract || null);
            }
        }
    }, [sites, contracts, siteId, isLoading]);

    useEffect(() => {
        if (siteId) {
            const siteServiceMeterIds = new Set(
                services.filter(s => s.siteId === siteId).map(s => s.meterId).filter(Boolean)
            );
            setSiteMeters(meters.filter(m => m.siteId === siteId || siteServiceMeterIds.has(m.id)));
            setSiteServices(services.filter(s => s.siteId === siteId));
        }
    }, [meters, services, siteId]);

    // --- Meter Handlers ---
    const handleEditMeter = (meter: Meter) => {
        setEditingMeter(meter);
        setIsMeterDialogOpen(true);
    };

    const handleAddMeter = () => {
        setEditingMeter(null);
        setIsMeterDialogOpen(true);
    };

    const handleSaveMeter = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const data = {
            name: formData.get('name') as string,
            reference: formData.get('reference') as string,
            type: formData.get('type') as string,
            unit: formData.get('unit') as string,
            siteId: siteId,
            status: 'on' as const,
            lastModified: new Date().toISOString(),
            modifiedBy: 'user',
            code: editingMeter ? editingMeter.code : `M-${Date.now()}`,
        };

        try {
            if (editingMeter) {
                await updateMeter(editingMeter.id, data);
                toast({ title: "Succès", description: "Compteur mis à jour." });
            } else {
                await createMeter(data);
                toast({ title: "Succès", description: "Compteur créé." });
            }
            await reloadData();
            setIsMeterDialogOpen(false);
        } catch (error) {
            console.error(error);
            toast({ title: "Erreur", description: "Impossible d'enregistrer le compteur.", variant: "destructive" });
        }
    };

    const handleDeleteMeter = async (id: string) => {
        if (!confirm("Supprimer ce compteur ?")) return;
        try {
            await deleteMeter(id);
            toast({ title: "Succès", description: "Compteur supprimé." });
            await reloadData();
        } catch (error) {
            toast({ title: "Erreur", description: "Impossible de supprimer le compteur.", variant: "destructive" });
        }
    };

    // --- Service Handlers ---
    const resetServiceForm = () => {
        setSelectedActivityId('');
        // setSelectedType('P1'); // Keep current type
        setBillingTermId('');
        setScheduleId('');
        setPricingRuleId('');
        setRevisionRuleId('');
        setPrice(0);
        setMeterId('');
        setStartDate(contract?.startDate || new Date().toISOString().split('T')[0]);
        setEndDate(contract?.endDate || '');
        setDescription('');

        // Reset new fields
        setUnitPrice(0);
        setUnit('');
        setVatRateId('');
        setEnergyType('');
        setP1Type('');
        setIsActive(true);
        setComment('');
        setMoleculePrice(0);
        setIsFixedPrice(false);
        setServiceIndices([]);

        setReferenceNb(0);
        setReferenceDju(0);
        setHeatingContractType('');
        setHeatingWeatherStation('');
        setSharingPercentage(0);
        setInterestUnitPrice(0);

        // Reset billing params
        setIncludeAnnex(false);
        setPaymentTermDays(30);
        setConversionCoefficient(1);
        setBillingLines([{ lineType: 'CONSOMMATION', label: '', vatRateId: '', isActive: true }]);

        setEditingService(null);
    };

    const updateBillingLine = (lineType: BillingLineType, field: string, value: string | number | boolean) => {
        setBillingLines(prev => {
            const exists = prev.some(l => l.lineType === lineType);
            if (exists) {
                return prev.map(l => l.lineType === lineType ? { ...l, [field]: value } : l);
            }
            return [...prev, { lineType, label: '', vatRateId: '', isActive: true, [field]: value }];
        });
    };

    const updateBpLine = (lineType: BillingLineType, field: string, value: string | number | boolean) => {
        setBpLines(prev => {
            const exists = prev.some(l => l.lineType === lineType);
            if (exists) {
                return prev.map(l => l.lineType === lineType ? { ...l, [field]: value } : l);
            }
            return [...prev, { lineType, label: '', vatRateId: '', isActive: true, [field]: value }];
        });
    };

    const handleStartEditBillingParams = () => {
        if (!activeService) return;
        setBpAnnex(activeService.includeAnnex ?? false);
        setBpDays(activeService.paymentTermDays ?? 30);
        setBpCoeff(activeService.conversionCoefficient ?? 1);
        const lines = activeService.billingLines ?? [];
        const hasConsomm = lines.some(l => l.lineType === 'CONSOMMATION');
        setBpLines(hasConsomm ? lines : [{ lineType: 'CONSOMMATION', label: '', vatRateId: '', isActive: true }, ...lines]);
        setIsEditingBillingParams(true);
    };

    const handleSaveBillingParams = async () => {
        if (!activeService) return;
        try {
            await updateService(activeService.id, {
                includeAnnex: bpAnnex,
                billingLines: bpLines.filter(l => l.vatRateId),
                paymentTermDays: bpDays,
                conversionCoefficient: bpCoeff,
            });
            await reloadData();
            setIsEditingBillingParams(false);
            toast({ title: 'Succès', description: 'Paramètres de facturation mis à jour.' });
        } catch {
            toast({ title: 'Erreur', description: 'Impossible de sauvegarder.', variant: 'destructive' });
        }
    };

    const handleAddService = (type: ServiceType) => {
        resetServiceForm();
        setSelectedType(type);
        setIsServiceDialogOpen(true);
    };

    const handleEditService = (service: Service) => {
        setEditingService(service);
        setSelectedActivityId(service.activityId);
        setSelectedType(service.type);
        setBillingTermId(service.billingTermId || '');
        setScheduleId(service.scheduleId || '');
        setPricingRuleId(service.pricingRuleId || '');
        setRevisionRuleId(service.revisionRuleId || '');
        setPrice(service.price || 0);
        setMeterId(service.meterId || '');
        setStartDate(service.startDate || '');
        setEndDate(service.endDate || '');
        setDescription(service.description || '');

        // Set new fields
        setUnitPrice(service.unitPrice || 0);
        setUnit(service.unit || '');
        setVatRateId(service.vatRateId || '');
        setEnergyType(service.energyType || '');
        setP1Type(service.p1Type || '');
        setIsActive(service.isActive !== undefined ? service.isActive : true);
        setComment(service.comment || '');
        setMoleculePrice(service.moleculePrice || 0);
        setIsFixedPrice(service.isFixedPrice || false);
        setServiceIndices(service.initialIndexValues || []);

        setReferenceNb(service.referenceNb || 0);
        setReferenceDju(service.referenceDju || 0);
        setHeatingContractType(service.heatingContractType || '');
        setHeatingWeatherStation(service?.heatingWeatherStation || '');
        setSharingPercentage(service?.sharingPercentage || 0);
        setInterestUnitPrice(service?.interestUnitPrice || 0);
        setSettlementRuleId(service?.settlementRuleId || '');

        // Billing Params
        setIncludeAnnex(service.includeAnnex ?? false);
        setPaymentTermDays(service.paymentTermDays ?? 30);
        setConversionCoefficient(service.conversionCoefficient ?? 1);
        const existingLines = service.billingLines ?? [];
        const hasConsomm = existingLines.some(l => l.lineType === 'CONSOMMATION');
        setBillingLines(hasConsomm ? existingLines : [{ lineType: 'CONSOMMATION', label: '', vatRateId: '', isActive: true }, ...existingLines]);

        setIsServiceDialogOpen(true);
    };

    const handleSaveService = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!contract) {
            toast({ title: "Erreur", description: "Aucun contrat associé à ce site.", variant: "destructive" });
            return;
        }
        if (!selectedActivityId) {
            toast({ title: "Erreur", description: "Veuillez sélectionner une activité.", variant: "destructive" });
            return;
        }

        const serviceData: Omit<Service, 'id'> = {
            contractId: contract.id,
            siteId: siteId,
            activityId: selectedActivityId,
            type: selectedType,
            billingTermId,
            scheduleId,
            pricingRuleId,
            revisionRuleId,
            price: Number(price),
            meterId: selectedType === 'P1' ? meterId : undefined,
            startDate,
            endDate,
            description,

            // New fields
            unitPrice: Number(unitPrice),
            unit,
            vatRateId,
            energyType: energyType as any,
            p1Type: p1Type as any,
            isActive,
            comment,
            moleculePrice: selectedType === 'P1' && isFixedPrice ? Number(moleculePrice) : undefined,
            isFixedPrice: selectedType === 'P1' ? isFixedPrice : undefined,
            initialIndexValues: serviceIndices,

            // Interest Params
            referenceNb: selectedType === 'P1' && p1Type === 'CHAUFFAGE' ? Number(referenceNb) : undefined,
            referenceDju: selectedType === 'P1' && p1Type === 'CHAUFFAGE' ? Number(referenceDju) : undefined,
            heatingContractType: selectedType === 'P1' && p1Type === 'CHAUFFAGE' ? heatingContractType : undefined,
            heatingWeatherStation: selectedType === 'P1' && p1Type === 'CHAUFFAGE' ? heatingWeatherStation : undefined,
            sharingPercentage: selectedType === 'P1' && p1Type === 'CHAUFFAGE' ? Number(sharingPercentage) : undefined,
            interestUnitPrice: selectedType === 'P1' && p1Type === 'CHAUFFAGE' ? Number(interestUnitPrice) : undefined,
            settlementRuleId: settlementRuleId || undefined,

            // Billing Params (P1)
            includeAnnex: selectedType === 'P1' ? includeAnnex : undefined,
            billingLines: selectedType === 'P1' ? billingLines.filter(l => l.vatRateId) : undefined,
            paymentTermDays: selectedType === 'P1' ? Number(paymentTermDays) : undefined,
            conversionCoefficient: selectedType === 'P1' ? Number(conversionCoefficient) : undefined,
        };

        try {
            let newServiceId;
            if (editingService) {
                await updateService(editingService.id, serviceData);
                newServiceId = editingService.id;
                toast({ title: "Succès", description: "Prestation mise à jour." });
            } else {
                const res = await createService(serviceData);
                newServiceId = res.id;
                toast({ title: "Succès", description: "Prestation créée." });
            }
            await reloadData();
            setIsServiceDialogOpen(false);
            resetServiceForm();
            if (newServiceId) setSelectedServiceId(newServiceId);
        } catch (error) {
            console.error(error);
            toast({ title: "Erreur", description: "Impossible d'enregistrer la prestation.", variant: "destructive" });
        }
    };

    const handleDeleteService = async (id: string) => {
        if (!confirm("Supprimer cette prestation ?")) return;
        try {
            await deleteService(id);
            toast({ title: "Succès", description: "Prestation supprimée." });
            await reloadData();
            if (selectedServiceId === id) setSelectedServiceId(null);
        } catch (error) {
            toast({ title: "Erreur", description: "Impossible de supprimer la prestation.", variant: "destructive" });
        }
    };

    // Filter activities based on selected type
    const filteredActivities = useMemo(() => {
        return activities.filter(a => a.type === selectedType);
    }, [activities, selectedType]);

    // Filter meters by P1 type keyword — matches against full MeterType label or simple type string
    const p1TypeKeywords: Record<string, string[]> = {
        CHAUFFAGE: ['chauffage'],
        ECS: ['ecs', 'eau chaude'],
        EAU_FROIDE: ['eau froide', 'froid'],
    };
    const filteredMeters = useMemo(() => {
        if (selectedType !== 'P1') return [];
        const keywords = p1TypeKeywords[p1Type];
        if (keywords) {
            return siteMeters.filter(m =>
                keywords.some(kw => m.type.toLowerCase().includes(kw))
            );
        }
        return siteMeters;
    }, [siteMeters, selectedType, p1Type]);

    // Sorted indices for Combobox
    const sortedIndices = useMemo(() => {
        return [...indices].sort((a, b) => a.code.localeCompare(b.code));
    }, [indices]);


    // Effect to auto-add indices from Revision Rule
    useEffect(() => {
        if (revisionRuleId) {
            const rule = revisionRules.find(r => r.id === revisionRuleId);
            if (rule && rule.indices) {
                const newIndices = [...serviceIndices];
                let changed = false;
                rule.indices.forEach(ri => {
                    if (!newIndices.find(si => si.indexId === ri.indexId)) {
                        newIndices.push({ indexId: ri.indexId, valueId: '', value: 0, period: '' });
                        changed = true;
                    }
                });
                if (changed) setServiceIndices(newIndices);
            }
        }
    }, [revisionRuleId, revisionRules]);

    if (isLoading) return <div>Chargement...</div>;
    if (!site) return <div>Site non trouvé</div>;



    const handleAddServiceIndex = (indexId: string) => {
        if (!serviceIndices.find(si => si.indexId === indexId)) {
            setServiceIndices([...serviceIndices, { indexId, valueId: '', value: 0, period: '' }]);
        }
    };

    const handleRemoveServiceIndex = (indexId: string) => {
        setServiceIndices(serviceIndices.filter(si => si.indexId !== indexId));
    };

    const handleServiceIndexValueChange = (indexId: string, valueId: string) => {
        // Handle virtual calculated values
        if (valueId.startsWith('calc-')) {
            const period = valueId.replace('calc-', '');
            const index = indices.find(i => i.id === indexId);
            if (index?.formula) {
                const calculated = calculateIndexValue(index.formula, period, indices, indexValues, index.decimals);
                if (calculated !== null) {
                    setServiceIndices(prev => prev.map(si =>
                        si.indexId === indexId ? { ...si, valueId, value: calculated, period } : si
                    ));
                }
            }
            return;
        }

        const indexValue = indexValues.find(iv => iv.id === valueId);
        if (indexValue) {
            setServiceIndices(prev => prev.map(si =>
                si.indexId === indexId ? { ...si, valueId, value: indexValue.value, period: indexValue.period } : si
            ));
        }
    };

    const handleManualServiceIndexChange = (indexId: string, field: 'value' | 'period', val: string) => {
        setServiceIndices(prev => prev.map(si => {
            if (si.indexId === indexId) {
                const updated = { ...si, valueId: undefined }; // Clear valueId as it's manual
                if (field === 'value') updated.value = parseFloat(val);
                if (field === 'period') {
                    updated.period = val;

                    // Attempt calculation if period is updated
                    const index = indices.find(i => i.id === indexId);
                    if (index?.formula) {
                        const calculated = calculateIndexValue(index.formula, val, indices, indexValues, index.decimals);
                        if (calculated !== null) {
                            updated.value = calculated;
                        }
                    }
                }
                return updated;
            }
            return si;
        }));
    };

    const activeService = siteServices.find(s => s.id === selectedServiceId);
    const activeRevisionRule = activeService ? revisionRules.find(r => r.id === activeService.revisionRuleId) : null;
    const activeMeter = activeService && activeService.meterId ? meters.find(m => m.id === activeService.meterId) : null;
    const activeActivity = activeService ? activities.find(a => a.id === activeService.activityId) : null;

    const lastMeterReadings = activeMeter
        ? [...meterReadings]
            .filter(r => r.meterId === activeMeter.id)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .slice(0, 5)
        : [];

    const activeTerm = activeService ? terms.find(t => t.id === activeService.billingTermId) : null;
    const activeSchedule = activeService ? schedules.find(s => s.id === activeService.scheduleId) : null;
    const activeVatRate = activeService ? vatRates.find(v => v.id === activeService.vatRateId) : null;

    // --- Calculs de révision ---
    // Enrichit indexValues avec les valeurs calculées à la volée pour les indices de type 'calculated'
    const expandedIndexValues = (() => {
        if (!activeRevisionRule) return indexValues;
        const extra: IndexValue[] = [];
        for (const ruleIdx of activeRevisionRule.indices) {
            const foundIndex = indices.find(i => i.id === ruleIdx.indexId);
            if (foundIndex?.type !== 'calculated' || !foundIndex.formula) continue;
            if (indexValues.some(iv => iv.indexId === ruleIdx.indexId)) continue; // déjà en base
            const periods = [...new Set(indexValues.map(v => v.period))].sort();
            for (const period of periods) {
                const value = calculateIndexValue(foundIndex.formula, period, indices, indexValues, foundIndex.decimals ?? 4);
                if (value !== null) {
                    extra.push({ id: `calc-${ruleIdx.indexId}-${period}`, indexId: ruleIdx.indexId, period, value, source: 'Calculé' } as IndexValue);
                }
            }
        }
        return extra.length > 0 ? [...indexValues, ...extra] : indexValues;
    })();

    const revisionCoefficient = (activeRevisionRule && activeService?.initialIndexValues?.length)
        ? calculateRevisionCoefficient(activeRevisionRule, activeService.initialIndexValues, expandedIndexValues)
        : (activeRevisionRule?.type === 'FIXE' ? 1 : null);

    // Diagnostic précis en cas d'échec du calcul
    const revisionDiagnostic = (() => {
        if (!activeRevisionRule || activeRevisionRule.type === 'FIXE' || revisionCoefficient !== null) return null;
        if (!activeService?.initialIndexValues?.length) return 'Valeurs I0 non renseignées';
        for (const ruleIndex of activeRevisionRule.indices) {
            const i0Entry = activeService.initialIndexValues.find(iv => iv.indexId === ruleIndex.indexId);
            if (!i0Entry || i0Entry.value === 0) {
                const idx = indices.find(i => i.id === ruleIndex.indexId);
                return `I0 manquant : ${idx?.code ?? '?'}`;
            }
            const hasCurrentValues = expandedIndexValues.some(iv => iv.indexId === ruleIndex.indexId);
            if (!hasCurrentValues) {
                const idx = indices.find(i => i.id === ruleIndex.indexId);
                return `Valeurs courantes absentes : ${idx?.code ?? '?'}`;
            }
        }
        return 'Données insuffisantes';
    })();

    const revisedUnitPrice = (activeService?.unitPrice != null && revisionCoefficient != null)
        ? activeService.unitPrice * revisionCoefficient
        : null;

    // Détail de calcul du coefficient pour vérification
    const revisionDetails = (() => {
        if (!activeRevisionRule || activeRevisionRule.type === 'FIXE' || !activeService?.initialIndexValues?.length) return null;
        return activeRevisionRule.indices.map(ruleIndex => {
            const idx = indices.find(i => i.id === ruleIndex.indexId);
            const i0Entry = activeService.initialIndexValues?.find(iv => iv.indexId === ruleIndex.indexId);
            const sortedValues = [...expandedIndexValues]
                .filter(iv => iv.indexId === ruleIndex.indexId)
                .sort((a, b) => b.period.localeCompare(a.period))
                .slice(0, activeRevisionRule.nbMonths);
            const Ir = sortedValues.length > 0 ? sortedValues.reduce((s, v) => s + v.value, 0) / sortedValues.length : null;
            const ratio = (Ir !== null && i0Entry?.value) ? Ir / i0Entry.value : null;
            return {
                code: idx?.code ?? '?',
                coefficient: ruleIndex.coefficient,
                i0: i0Entry?.value ?? null,
                i0Period: i0Entry?.period ?? null,
                periods: sortedValues,
                Ir,
                ratio,
                partial: ratio !== null ? ruleIndex.coefficient * ratio : null,
            };
        });
    })();

    // Calendrier théorique de facturation
    const scheduleToMonths: Record<string, number> = {
        'mensuel': 1, 'trimestriel': 3, 'semestriel': 6, 'annuel': 12,
    };
    const billingPeriods = (() => {
        if (!activeService || !activeTerm || !activeSchedule || !contract) return [];
        const intervalMonths = scheduleToMonths[activeSchedule.name.toLowerCase()] ?? 0;
        if (!intervalMonths) return [];
        const termLower = activeTerm.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const isEchu = termLower.includes('echu') && !termLower.includes('echoir');
        const start = new Date(activeService.startDate);
        const end = activeService.endDate ? new Date(activeService.endDate) : (contract.endDate ? new Date(contract.endDate) : null);
        const today = new Date();
        const periods: { periodStart: Date; periodEnd: Date; dueDate: Date; invoice: typeof invoices[0] | null }[] = [];
        let cursor = new Date(start);
        const limit = end ?? today;
        while (cursor <= limit) {
            const periodStart = new Date(cursor);
            const periodEnd = new Date(cursor);
            periodEnd.setMonth(periodEnd.getMonth() + intervalMonths);
            periodEnd.setDate(periodEnd.getDate() - 1);
            const dueDate = isEchu
                ? new Date(cursor.getFullYear(), cursor.getMonth() + intervalMonths, cursor.getDate())
                : new Date(cursor);
            const matched = invoices.find(inv =>
                inv.contractId === contract.id &&
                inv.periodStartDate &&
                Math.abs(new Date(inv.periodStartDate).getTime() - periodStart.getTime()) < 3 * 86400000 &&
                inv.lineItems?.some((li: any) => li.activityCode === activeService.type)
            );
            periods.push({ periodStart, periodEnd, dueDate, invoice: matched ?? null });
            cursor.setMonth(cursor.getMonth() + intervalMonths);
        }
        return periods;
    })();

    // Consommation = écart entre les deux derniers relevés réels du compteur
    const lastReal = lastMeterReadings.find(r => r.type === 'REEL' || r.type === 'CORRIGE');
    const prevReal = lastMeterReadings.find(r => (r.type === 'REEL' || r.type === 'CORRIGE') && r.id !== lastReal?.id);
    const consumption = (lastReal && prevReal) ? lastReal.value - prevReal.value : null;

    // Montant estimé HT
    const estimatedAmount = (consumption != null && revisedUnitPrice != null)
        ? consumption * revisedUnitPrice
        : null;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="space-y-2">
                {/* Breadcrumb */}
                <div className="flex items-center text-sm text-muted-foreground">
                    <Button variant="ghost" size="icon" className="h-6 w-6 mr-2" onClick={() => router.back()}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    {contract ? (
                        <>
                            <Link href={`/clients/${contract.clientId}`} className="hover:underline hover:text-foreground">
                                {contract.clientName || 'Client'}
                            </Link>
                            <span className="mx-2">›</span>
                            <Link href={`/contracts/${contract.id}`} className="hover:underline hover:text-foreground">
                                {contract.contractNumber || contract.label || contract.name || contract.id}
                            </Link>
                            <span className="mx-2">›</span>
                        </>
                    ) : (
                        <>
                            <Link href="/sites" className="hover:underline hover:text-foreground">Sites</Link>
                            <span className="mx-2">›</span>
                        </>
                    )}
                    <span className="font-medium text-foreground">{site.name}</span>
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-2xl font-bold tracking-tight">{site.name}</h1>
                                <Badge variant={contract?.status === 'Actif' ? 'default' : 'secondary'}>
                                    {contract?.status || 'Aucun contrat'}
                                </Badge>
                            </div>
                            {contract ? (
                                <div className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
                                    <Link href={`/clients/${contract.clientId}`} className="hover:underline">
                                        {contract.clientName}
                                    </Link>
                                    <span>›</span>
                                    <Link href={`/contracts/${contract.id}`} className="hover:underline">
                                        {contract.contractNumber || contract.label || contract.name}
                                    </Link>
                                </div>
                            ) : (
                                <div className="text-sm text-muted-foreground mt-0.5">
                                    Non rattaché à un contrat
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="default" onClick={() => console.log('Save')}>
                            <Save className="mr-2 h-4 w-4" /> Enregistrer
                        </Button>
                        <Button variant="outline">Plus</Button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: Sidebar */}
                <div className="space-y-6 lg:col-span-1">
                    {/* General Info Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Informations générales</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <Label className="text-xs text-muted-foreground">Adresse</Label>
                                <div className="font-medium">{site.address}</div>
                                <div>{site.postalCode} {site.city}</div>
                            </div>
                            <Button variant="outline" size="sm" className="w-full">Modifier</Button>
                        </CardContent>
                    </Card>

                    {/* Meters Card */}
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-base font-medium">Compteurs du site</CardTitle>
                            <Button variant="ghost" size="sm" onClick={handleAddMeter}><Plus className="h-4 w-4" /></Button>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[100px]">Réf</TableHead>
                                        <TableHead>Energie</TableHead>
                                        <TableHead className="text-right"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {siteMeters.length === 0 ? (
                                        <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">Aucun compteur</TableCell></TableRow>
                                    ) : (
                                        siteMeters.map(meter => (
                                            <TableRow key={meter.id}>
                                                <TableCell className="font-medium">{meter.reference || meter.name}</TableCell>
                                                <TableCell>{meter.type}</TableCell>
                                                <TableCell className="text-right">
                                                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleEditMeter(meter)}>
                                                        <Edit className="h-3 w-3" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>

                    {/* Service Summary */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base font-medium">Résumé des prestations</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            {siteServices.length === 0 ? (
                                <div className="text-sm text-muted-foreground text-center py-4">Aucune prestation</div>
                            ) : (
                                siteServices.map(service => {
                                    const act = activities.find(a => a.id === service.activityId);
                                    return (
                                        <div
                                            key={service.id}
                                            className={`flex items-center justify-between p-2 rounded-md cursor-pointer hover:bg-muted/50 ${selectedServiceId === service.id ? 'bg-muted' : 'border'}`}
                                            onClick={() => {
                                                setSelectedServiceId(service.id);
                                                setSelectedType(service.type);
                                            }}
                                        >
                                            <div className="text-sm font-medium">{service.type} {act?.label}</div>
                                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                                {service.type === 'P1' && service.p1Type === 'ECS' && <Droplets className="h-3.5 w-3.5 text-blue-500" />}
                                                {service.type === 'P1' && service.p1Type === 'CHAUFFAGE' && <Flame className="h-3.5 w-3.5 text-red-500" />}
                                                {service.type === 'P1' && service.p1Type === 'EAU_FROIDE' && <Snowflake className="h-3.5 w-3.5 text-sky-300" />}
                                                {service.type === 'P1' && service.p1Type === 'AUTRE' && <Wrench className="h-3.5 w-3.5 text-gray-400" />}
                                                {service.type === 'P1' && service.p1Type
                                                    ? (service.p1Type === 'ECS' ? 'ECS' : service.p1Type === 'CHAUFFAGE' ? 'Chauffage' : service.p1Type === 'EAU_FROIDE' ? 'Eau Froide' : 'Autre')
                                                    : service.energyType || ''}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </CardContent>
                    </Card>
                    {/* Paramètres de facturation (P1 inline edit) */}
                    {activeService?.type === 'P1' && (
                        <Card>
                            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                                <CardTitle className="text-base font-medium">Paramètres de facturation</CardTitle>
                                {!isEditingBillingParams ? (
                                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleStartEditBillingParams}>
                                        <Edit className="h-3.5 w-3.5 mr-1" /> Modifier
                                    </Button>
                                ) : (
                                    <div className="flex gap-1">
                                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setIsEditingBillingParams(false)}>Annuler</Button>
                                        <Button size="sm" className="h-7 px-2 text-xs" onClick={handleSaveBillingParams}>
                                            <Save className="h-3.5 w-3.5 mr-1" /> Enregistrer
                                        </Button>
                                    </div>
                                )}
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {!isEditingBillingParams ? (
                                    <>
                                        <div className="grid grid-cols-3 gap-2 text-xs">
                                            <div>
                                                <span className="text-muted-foreground block">Annexes</span>
                                                <span className="font-medium">{activeService.includeAnnex ? 'Incluses' : 'Non incluses'}</span>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground block">Délai règlement</span>
                                                <span className="font-medium">{activeService.paymentTermDays ? `${activeService.paymentTermDays} j` : '—'}</span>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground block">Coeff. conv.</span>
                                                <span className="font-medium">{activeService.conversionCoefficient ?? 1}</span>
                                            </div>
                                        </div>
                                        {activeService.billingLines && activeService.billingLines.length > 0 && (
                                            <div className="space-y-1">
                                                {activeService.billingLines.map((line, i) => {
                                                    const vr = vatRates.find(v => v.id === line.vatRateId);
                                                    return (
                                                        <div key={i} className="flex items-center justify-between text-xs border rounded-md px-2 py-1">
                                                            <Badge variant="outline" className="text-xs">{line.lineType === 'CONSOMMATION' ? 'Consommation' : 'Part fixe'}</Badge>
                                                            <span className="text-muted-foreground truncate mx-2 flex-1">{line.label || '—'}</span>
                                                            <span className="font-medium">{vr ? `${vr.rate} %` : '—'}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="space-y-3">
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="flex items-center gap-2">
                                                <Switch id="bpAnnex" checked={bpAnnex} onCheckedChange={setBpAnnex} />
                                                <Label htmlFor="bpAnnex" className="text-xs">Inclure les annexes</Label>
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs">Délai de règlement</Label>
                                                <Select value={String(bpDays)} onValueChange={v => setBpDays(Number(v))}>
                                                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="30">30 j</SelectItem>
                                                        <SelectItem value="45">45 j</SelectItem>
                                                        <SelectItem value="60">60 j</SelectItem>
                                                        <SelectItem value="90">90 j</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">Coefficient de conversion</Label>
                                            <Input
                                                type="number"
                                                step="0.0001"
                                                value={bpCoeff}
                                                onChange={e => setBpCoeff(parseFloat(e.target.value) || 1)}
                                                className="h-7 text-xs"
                                                placeholder="1.0"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-xs">Lignes de facturation</Label>
                                                {!bpLines.some(l => l.lineType === 'PART_FIXE') && (
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-6 text-xs px-2"
                                                        onClick={() => setBpLines(prev => [...prev, { lineType: 'PART_FIXE', label: '', vatRateId: '', annualAmount: 0, isActive: true }])}
                                                    >
                                                        <Plus className="h-3 w-3 mr-1" /> Part fixe
                                                    </Button>
                                                )}
                                            </div>
                                            {['CONSOMMATION' as BillingLineType, ...bpLines.filter(l => l.lineType === 'PART_FIXE').map(l => l.lineType)].map((lineType) => {
                                                const line = bpLines.find(l => l.lineType === lineType) ?? { lineType, label: '', vatRateId: '', isActive: true };
                                                return (
                                                    <div key={lineType} className="grid gap-1 items-center" style={{ gridTemplateColumns: 'auto 1fr 1fr auto' }}>
                                                        <Badge variant="outline" className="text-xs whitespace-nowrap">
                                                            {lineType === 'CONSOMMATION' ? 'Conso.' : 'Part fixe'}
                                                        </Badge>
                                                        <Input
                                                            placeholder="Libellé"
                                                            value={line.label ?? ''}
                                                            onChange={e => updateBpLine(lineType, 'label', e.target.value)}
                                                            className="h-7 text-xs"
                                                        />
                                                        <Select value={line.vatRateId} onValueChange={v => updateBpLine(lineType, 'vatRateId', v)}>
                                                            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="TVA" /></SelectTrigger>
                                                            <SelectContent>
                                                                {vatRates.map(vr => (
                                                                    <SelectItem key={vr.id} value={vr.id}>{vr.rate} %</SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                        {lineType === 'PART_FIXE' ? (
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7 text-destructive"
                                                                onClick={() => setBpLines(prev => prev.filter(l => l.lineType !== 'PART_FIXE'))}
                                                            >
                                                                <Trash2 className="h-3 w-3" />
                                                            </Button>
                                                        ) : <span />}
                                                    </div>
                                                );
                                            })}
                                            {bpLines.some(l => l.lineType === 'PART_FIXE') && (
                                                <div className="space-y-1">
                                                    <Label className="text-xs text-muted-foreground">Montant annuel part fixe (€ HT/an)</Label>
                                                    <Input
                                                        type="number"
                                                        step="0.01"
                                                        className="h-7 text-xs"
                                                        value={bpLines.find(l => l.lineType === 'PART_FIXE')?.annualAmount ?? 0}
                                                        onChange={e => updateBpLine('PART_FIXE', 'annualAmount', parseFloat(e.target.value) || 0)}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* Calendrier de facturation */}
                    {billingPeriods.length > 0 && (
                        <Card className="border-dashed">
                            <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowBillingCalendar(v => !v)}>
                                <CardTitle className="text-sm font-medium flex items-center justify-between">
                                    <span>Calendrier de facturation</span>
                                    <div className="flex items-center gap-1.5">
                                        <Badge variant="outline" className="text-xs">{billingPeriods.length} période(s)</Badge>
                                        {billingPeriods.filter(p => !p.invoice && p.dueDate <= new Date()).length > 0 && (
                                            <Badge variant="destructive" className="text-xs">
                                                {billingPeriods.filter(p => !p.invoice && p.dueDate <= new Date()).length} non facturée(s)
                                            </Badge>
                                        )}
                                        {showBillingCalendar ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                    </div>
                                </CardTitle>
                            </CardHeader>
                            {showBillingCalendar && (
                                <CardContent className="p-0">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="text-xs">Période</TableHead>
                                                <TableHead className="text-xs">Émission</TableHead>
                                                <TableHead className="text-xs">Statut</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {billingPeriods.map((p, i) => (
                                                <TableRow key={i}>
                                                    <TableCell className="text-xs py-1.5">
                                                        {p.periodStart.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                                                        {' → '}
                                                        {p.periodEnd.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                                                    </TableCell>
                                                    <TableCell className="text-xs py-1.5">{p.dueDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })}</TableCell>
                                                    <TableCell className="py-1.5">
                                                        {p.invoice
                                                            ? <Link href={`/invoices/${p.invoice.id}`} className="text-xs text-green-600 hover:underline font-medium">
                                                                {p.invoice.invoiceNumber ?? '✓'}
                                                              </Link>
                                                            : p.dueDate > new Date()
                                                                ? <Badge variant="outline" className="text-xs px-1 py-0 text-muted-foreground">À venir</Badge>
                                                                : <Badge variant="destructive" className="text-xs px-1 py-0">Non facturée</Badge>}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            )}
                        </Card>
                    )}
                </div>

                {/* Right Column: Main Content */}
                <div className="lg:col-span-2">
                    <Tabs value={selectedType} onValueChange={(v) => setSelectedType(v as ServiceType)} className="w-full">
                        <TabsList className="grid w-full grid-cols-3 mb-6">
                            <TabsTrigger value="P1">P1 — Énergie</TabsTrigger>
                            <TabsTrigger value="P2">P2 — Maintenance</TabsTrigger>
                            <TabsTrigger value="P3">P3 — Renouvellement</TabsTrigger>
                        </TabsList>

                        <TabsContent value={selectedType} className="space-y-6">
                            {/* Header for Service View */}
                            <div className="flex justify-between items-center">
                                <h2 className="text-xl font-semibold flex items-center gap-2">
                                    {activeService ? (
                                        <>
                                            {activeService.type} {activeActivity?.label || ''} —{' '}
                                            {activeService.type === 'P1' && activeService.p1Type ? (
                                                <span className="flex items-center gap-1">
                                                    {activeService.p1Type === 'ECS' && <Droplets className="h-5 w-5 text-blue-500" />}
                                                    {activeService.p1Type === 'CHAUFFAGE' && <Flame className="h-5 w-5 text-red-500" />}
                                                    {activeService.p1Type === 'EAU_FROIDE' && <Snowflake className="h-5 w-5 text-sky-300" />}
                                                    {activeService.p1Type === 'AUTRE' && <Wrench className="h-5 w-5 text-gray-400" />}
                                                    {activeService.p1Type === 'ECS' ? 'ECS' :
                                                     activeService.p1Type === 'CHAUFFAGE' ? 'Chauffage' :
                                                     activeService.p1Type === 'EAU_FROIDE' ? 'Eau Froide' : 'Autre'}
                                                </span>
                                            ) : (
                                                activeService.energyType || ''
                                            )}
                                        </>
                                    ) : (
                                        `Prestations ${selectedType}`
                                    )}
                                </h2>
                                {activeService ? (
                                    <div className="flex gap-2">
                                        <Button variant="outline" size="sm" onClick={() => handleEditService(activeService)}>
                                            <Edit className="mr-2 h-4 w-4" /> Modifier
                                        </Button>
                                        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDeleteService(activeService.id)}>
                                            <Trash2 className="mr-2 h-4 w-4" /> Supprimer
                                        </Button>
                                    </div>
                                ) : (
                                    <Button onClick={() => handleAddService(selectedType)}>
                                        <Plus className="mr-2 h-4 w-4" /> Ajouter une prestation
                                    </Button>
                                )}
                            </div>

                            {activeService ? (
                                <div className="space-y-6">
                                    {/* Section 1 & 2: Pricing Params & Indices */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {/* Paramètres de prix */}
                                        <Card>
                                            <CardHeader>
                                                <CardTitle className="text-base">Paramètres de prix</CardTitle>
                                            </CardHeader>
                                            <CardContent className="space-y-4">
                                                <div className="grid gap-2">
                                                    <Label className="text-xs text-muted-foreground">Energie</Label>
                                                    <div className="p-2 border rounded-md bg-muted/20 text-sm font-medium">{activeService.energyType || '-'}</div>
                                                </div>
                                                <div className="grid gap-2">
                                                    <Label className="text-xs text-muted-foreground">Activité {activeService.type}</Label>
                                                    <div className="p-2 border rounded-md bg-muted/20 text-sm font-medium">{activeActivity?.label || '-'}</div>
                                                </div>
                                                <div className="grid gap-2">
                                                    <Label className="text-xs text-muted-foreground">Formule de révision</Label>
                                                    <div className="p-2 border rounded-md bg-muted/20 text-sm font-medium">{activeRevisionRule?.name || '-'}</div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div className="grid gap-2">
                                                        <Label className="text-xs text-muted-foreground">Prix unitaire de base</Label>
                                                        <div className="flex items-center gap-2">
                                                            <div className="p-2 border rounded-md bg-muted/20 text-sm font-medium flex-1 text-right">{activeService.unitPrice?.toFixed(4) || '0.0000'}</div>
                                                            <span className="text-xs text-muted-foreground">{activeService.unit || '€'}</span>
                                                        </div>
                                                    </div>
                                                    <div className="grid gap-2">
                                                        <Label className="text-xs text-muted-foreground">TVA</Label>
                                                        <div className="p-2 border rounded-md bg-muted/20 text-sm font-medium text-center">
                                                            {activeService.billingLines && activeService.billingLines.length > 0
                                                                ? activeService.billingLines.map(l => vatRates.find(v => v.id === l.vatRateId)?.rate).filter(Boolean).join(' / ') + ' %'
                                                                : activeVatRate ? `${activeVatRate.rate} %` : '-'}
                                                        </div>
                                                    </div>
                                                </div>
                                                <Separator />
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div className="grid gap-2">
                                                        <Label className="text-xs text-muted-foreground">Terme de facturation</Label>
                                                        <div className="p-2 border rounded-md bg-muted/20 text-sm font-medium">{activeTerm?.name || '-'}</div>
                                                    </div>
                                                    <div className="grid gap-2">
                                                        <Label className="text-xs text-muted-foreground">Périodicité</Label>
                                                        <div className="p-2 border rounded-md bg-muted/20 text-sm font-medium">{activeSchedule?.name || '-'}</div>
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>

                                        {/* Indices utilisés */}
                                        <Card>
                                            <CardHeader>
                                                <CardTitle className="text-base">Indices utilisés</CardTitle>
                                            </CardHeader>
                                            <CardContent>
                                                {activeRevisionRule ? (
                                                    <div className="space-y-3">
                                                        {activeRevisionRule.type !== 'FIXE' && (
                                                            <div className="grid grid-cols-3 text-xs text-muted-foreground font-medium px-1">
                                                                <span>Indice</span>
                                                                <span className="text-center">I0 (base)</span>
                                                                <span className="text-right">Dernière valeur</span>
                                                            </div>
                                                        )}
                                                        {activeRevisionRule.indices.map((idx, i) => {
                                                            const foundIndex = indices.find(ind => ind.id === idx.indexId);
                                                            const i0Entry = activeService.initialIndexValues?.find(iv => iv.indexId === idx.indexId);
                                                            const latestValue = [...expandedIndexValues]
                                                                .filter(iv => iv.indexId === idx.indexId)
                                                                .sort((a, b) => b.period.localeCompare(a.period))[0];
                                                            return (
                                                                <div key={i} className="p-2 border rounded-md bg-muted/10 space-y-1">
                                                                    <div className="flex items-center justify-between">
                                                                        <span className="font-medium text-sm">{foundIndex ? `${foundIndex.code} - ${foundIndex.label}` : idx.indexId}</span>
                                                                        {activeRevisionRule.type !== 'FIXE' && idx.coefficient !== undefined && (
                                                                            <span className="text-xs text-muted-foreground">Poids : {(idx.coefficient * 100).toFixed(0)} %</span>
                                                                        )}
                                                                    </div>
                                                                    {activeRevisionRule.type !== 'FIXE' && (
                                                                        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-dashed mt-1">
                                                                            <div>
                                                                                <span className="text-xs text-muted-foreground block">I0</span>
                                                                                <span className="text-xs font-medium">
                                                                                    {i0Entry ? `${i0Entry.value} (${i0Entry.period})` : <span className="text-orange-500">Non défini</span>}
                                                                                </span>
                                                                            </div>
                                                                            <div>
                                                                                <span className="text-xs text-muted-foreground block">Dernière valeur</span>
                                                                                <span className="text-xs font-medium">
                                                                                    {latestValue ? `${latestValue.value} ${foundIndex?.unit || ''} (${latestValue.period})` : '-'}
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                        {activeRevisionRule.indices.length === 0 && (
                                                            <div className="text-sm text-muted-foreground">Aucun indice configuré</div>
                                                        )}
                                                        {activeRevisionRule.type === 'PONDERE_A_B' && (
                                                            <div className="text-xs text-muted-foreground pt-1 px-1">
                                                                Formule : Pa ({activeRevisionRule.paramA ?? '-'}) + Pb ({activeRevisionRule.paramB ?? '-'}) × Σ indices
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div className="text-sm text-muted-foreground py-4 text-center">Aucune formule de révision associée</div>
                                                )}
                                            </CardContent>
                                        </Card>
                                    </div>

                                    {/* Section 3: Compteurs associés */}
                                    <Card>
                                        <CardHeader>
                                            <CardTitle className="text-base">Compteurs associés</CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead>Ref compteur</TableHead>
                                                        <TableHead className="text-right">Coefficient de répartition</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {activeMeter ? (
                                                        <TableRow>
                                                            <TableCell className="font-medium">{activeMeter.reference || activeMeter.name}</TableCell>
                                                            <TableCell className="text-right">1,00</TableCell>
                                                        </TableRow>
                                                    ) : (
                                                        <TableRow>
                                                            <TableCell colSpan={2} className="text-center text-muted-foreground">Aucun compteur associé</TableCell>
                                                        </TableRow>
                                                    )}
                                                </TableBody>
                                            </Table>
                                            <div className="mt-4">
                                                <Button variant="outline" size="sm" className="gap-2">
                                                    <Plus className="h-4 w-4" /> Ajouter un compteur
                                                </Button>
                                            </div>

                                            {activeMeter && (
                                                <>
                                                    <Separator />
                                                    <div>
                                                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                                            Derniers index relevés
                                                        </div>
                                                        {lastMeterReadings.length > 0 ? (
                                                            <Table>
                                                                <TableHeader>
                                                                    <TableRow>
                                                                        <TableHead>Date</TableHead>
                                                                        <TableHead className="text-right">Index</TableHead>
                                                                        <TableHead>Type</TableHead>
                                                                    </TableRow>
                                                                </TableHeader>
                                                                <TableBody>
                                                                    {lastMeterReadings.map(reading => (
                                                                        <TableRow key={reading.id}>
                                                                            <TableCell className="text-sm">
                                                                                {new Date(reading.date).toLocaleDateString('fr-FR')}
                                                                            </TableCell>
                                                                            <TableCell className="text-right font-medium">
                                                                                {reading.value.toLocaleString('fr-FR')} {reading.unit || activeMeter.unit}
                                                                            </TableCell>
                                                                            <TableCell>
                                                                                <span className={`text-xs px-1.5 py-0.5 rounded-sm font-medium ${
                                                                                    reading.type === 'REEL' ? 'bg-green-100 text-green-700' :
                                                                                    reading.type === 'ESTIME' ? 'bg-yellow-100 text-yellow-700' :
                                                                                    reading.type === 'CORRIGE' ? 'bg-blue-100 text-blue-700' :
                                                                                    'bg-muted text-muted-foreground'
                                                                                }`}>
                                                                                    {reading.type}
                                                                                </span>
                                                                            </TableCell>
                                                                        </TableRow>
                                                                    ))}
                                                                </TableBody>
                                                            </Table>
                                                        ) : (
                                                            <p className="text-sm text-muted-foreground text-center py-2">Aucun relevé enregistré</p>
                                                        )}
                                                    </div>
                                                </>
                                            )}
                                        </CardContent>
                                    </Card>

                                    {/* Section 4: Aperçu de calcul */}
                                    <Card className="bg-muted/10 border-dashed">
                                        <CardHeader>
                                            <CardTitle className="text-base">Aperçu de calcul</CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-2">
                                            {/* Coefficient révisé */}
                                            <div className="space-y-1">
                                                <div className="flex justify-between items-center text-sm">
                                                    <button
                                                        type="button"
                                                        className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                                                        onClick={() => setShowRevisionDetails(v => !v)}
                                                    >
                                                        {showRevisionDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                                        Coefficient révisé
                                                        {activeRevisionRule && ` (${activeRevisionRule.type}${activeRevisionRule.nbMonths > 1 ? `, moy. ${activeRevisionRule.nbMonths} mois` : ''})`}
                                                    </button>
                                                    <span className="font-bold">
                                                        {revisionCoefficient != null
                                                            ? revisionCoefficient.toFixed(4)
                                                            : <span className="text-orange-500 italic text-xs">{revisionDiagnostic ?? '-'}</span>}
                                                    </span>
                                                </div>

                                                {showRevisionDetails && revisionDetails && (
                                                    <div className="ml-4 border-l-2 border-muted pl-3 space-y-2 text-xs text-muted-foreground">
                                                        {revisionDetails.map((d, i) => (
                                                            <div key={i} className="space-y-0.5">
                                                                <div className="font-medium text-foreground">{d.code} <span className="font-normal text-muted-foreground">(coeff. {d.coefficient})</span></div>
                                                                <div className="flex justify-between">
                                                                    <span>I0 ({d.i0Period ?? '?'})</span>
                                                                    <span className="font-mono">{d.i0 ?? '—'}</span>
                                                                </div>
                                                                {d.periods.map(p => (
                                                                    <div key={p.period} className="flex justify-between text-muted-foreground/70">
                                                                        <span>Ir {p.period}</span>
                                                                        <span className="font-mono">{p.value}</span>
                                                                    </div>
                                                                ))}
                                                                <div className="flex justify-between">
                                                                    <span>Ir moyen</span>
                                                                    <span className="font-mono">{d.Ir?.toFixed(4) ?? '—'}</span>
                                                                </div>
                                                                <div className="flex justify-between">
                                                                    <span>Ir / I0</span>
                                                                    <span className="font-mono">{d.ratio?.toFixed(4) ?? '—'}</span>
                                                                </div>
                                                                <div className="flex justify-between font-medium text-foreground">
                                                                    <span>Contribution ({d.coefficient} × {d.ratio?.toFixed(4)})</span>
                                                                    <span className="font-mono">{d.partial?.toFixed(4) ?? '—'}</span>
                                                                </div>
                                                            </div>
                                                        ))}
                                                        {activeRevisionRule?.type === 'PONDERE_A_B' && (
                                                            <div className="pt-1 border-t border-muted text-foreground">
                                                                Pa={activeRevisionRule.paramA ?? 0} + Pb={activeRevisionRule.paramB ?? 1} × Σ = {revisionCoefficient?.toFixed(4)}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Prix unitaire révisé */}
                                            <div className="flex justify-between items-center text-sm">
                                                <span className="text-muted-foreground">Prix unitaire révisé</span>
                                                <span className="font-bold">
                                                    {revisedUnitPrice != null
                                                        ? `${revisedUnitPrice.toFixed(4)} ${activeService.unit || '€'}`
                                                        : <span className="text-muted-foreground italic text-xs">-</span>}
                                                </span>
                                            </div>

                                            {/* Consommation (uniquement si compteur lié) */}
                                            {activeMeter && (
                                                <div className="flex justify-between items-center text-sm">
                                                    <span className="text-muted-foreground">
                                                        Consommation relevée
                                                        {lastReal && prevReal && (
                                                            <span className="text-xs ml-1 text-muted-foreground/70">
                                                                ({new Date(prevReal.date).toLocaleDateString('fr-FR')} → {new Date(lastReal.date).toLocaleDateString('fr-FR')})
                                                            </span>
                                                        )}
                                                    </span>
                                                    <span className="font-bold">
                                                        {consumption != null
                                                            ? `${consumption.toLocaleString('fr-FR')} ${activeMeter.unit}`
                                                            : <span className="text-muted-foreground italic text-xs">Relevés insuffisants</span>}
                                                    </span>
                                                </div>
                                            )}

                                            <Separator className="my-2" />

                                            {/* Montant estimé */}
                                            <div className="flex justify-between items-center text-base">
                                                <span className="font-medium">Montant {activeService.type} estimé</span>
                                                <span className="font-bold text-primary">
                                                    {estimatedAmount != null
                                                        ? `${estimatedAmount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € HT`
                                                        : <span className="text-muted-foreground text-sm font-normal italic">Données incomplètes</span>}
                                                </span>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    {/* Action Buttons */}
                                    <div className="flex justify-end gap-2">
                                        <Button variant="secondary" onClick={() => setIsSettlementManagerOpen(true)}>
                                            <Calculator className="mr-2 h-4 w-4" /> Gérer les Décomptes
                                        </Button>
                                        {(activeService.energyType === 'Gaz' || activeService.energyType === 'Réseau de chaleur') && (
                                            <Button variant="secondary" onClick={() => setIsInterestManagerOpen(true)}>
                                                <Calculator className="mr-2 h-4 w-4" /> Gérer l'Intéressement
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center py-12 border rounded-lg border-dashed text-muted-foreground bg-muted/5">
                                    <p className="mb-4">Sélectionnez une prestation à gauche ou créez-en une nouvelle.</p>
                                    <Button onClick={() => handleAddService(selectedType)}>
                                        <Plus className="mr-2 h-4 w-4" /> Créer une prestation {selectedType}
                                    </Button>
                                </div>
                            )}
                        </TabsContent>
                    </Tabs>
                </div>
            </div>

            {/* Meter Dialog */}
            <Dialog open={isMeterDialogOpen} onOpenChange={setIsMeterDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingMeter ? "Modifier le compteur" : "Nouveau compteur"}</DialogTitle>
                        <DialogDescription>Renseignez les informations du compteur.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleSaveMeter} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">Nom</Label>
                            <Input id="name" name="name" defaultValue={editingMeter?.name} required />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="reference">Référence (PDL/PCE)</Label>
                            <Input id="reference" name="reference" defaultValue={editingMeter?.reference} placeholder="Ex: 0123456789" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="type">Type</Label>
                                <Select name="type" defaultValue={editingMeter?.type || "Chauffage"}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Chauffage">Chauffage</SelectItem>
                                        <SelectItem value="ECS">ECS</SelectItem>
                                        <SelectItem value="Eau Chaude">Eau Chaude</SelectItem>
                                        <SelectItem value="Electricité">Electricité</SelectItem>
                                        <SelectItem value="Eau Froide">Eau Froide</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="unit">Unité</Label>
                                <Select name="unit" defaultValue={editingMeter?.unit || "kWh"}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="kWh">kWh</SelectItem>
                                        <SelectItem value="m3">m3</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setIsMeterDialogOpen(false)}>Annuler</Button>
                            <Button type="submit">Enregistrer</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Service Dialog */}
            <Dialog open={isServiceDialogOpen} onOpenChange={setIsServiceDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingService ? "Modifier la prestation" : "Nouvelle prestation"}</DialogTitle>
                        <DialogDescription>Configuration de la prestation {selectedType}.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleSaveService} className="space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Activité</Label>
                                <Select value={selectedActivityId} onValueChange={(val) => {
                                    setSelectedActivityId(val);
                                    const act = activities.find(a => a.id === val);
                                    if (act) {
                                        if (act.type) {
                                            setSelectedType(act.type);
                                        } else if (act.code.toUpperCase().startsWith('P1')) {
                                            setSelectedType('P1');
                                        } else if (act.code.toUpperCase().startsWith('P2')) {
                                            setSelectedType('P2');
                                        } else if (act.code.toUpperCase().startsWith('P3')) {
                                            setSelectedType('P3');
                                        }
                                    }
                                }}>
                                    <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                                    <SelectContent>
                                        {activities.map(a => (
                                            <SelectItem key={a.id} value={a.id}>{a.code} - {a.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            {selectedType === 'P1' && selectedActivityId && (
                                <div className="space-y-2">
                                    <Label>Type d'énergie</Label>
                                    <Select value={energyType} onValueChange={setEnergyType}>
                                        <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="Gaz">Gaz</SelectItem>
                                            <SelectItem value="Electricité">Electricité</SelectItem>
                                            <SelectItem value="Réseau de chaleur">Réseau de chaleur</SelectItem>
                                            <SelectItem value="Fioul">Fioul</SelectItem>
                                            <SelectItem value="Biomasse">Biomasse</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        </div>

                        {selectedType === 'P1' && selectedActivityId && (
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Type P1</Label>
                                        <Select value={p1Type} onValueChange={setP1Type}>
                                            <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="CHAUFFAGE">Chauffage</SelectItem>
                                                <SelectItem value="ECS">ECS</SelectItem>
                                                <SelectItem value="EAU_FROIDE">Eau Froide</SelectItem>
                                                <SelectItem value="AUTRE">Autre</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Prix fixe</Label>
                                        <Select value={isFixedPrice ? "oui" : "non"} onValueChange={(v) => setIsFixedPrice(v === "oui")}>
                                            <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="oui">Oui</SelectItem>
                                                <SelectItem value="non">Non</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                {isFixedPrice && (
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label>Prix Molécule base (€/MWh)</Label>
                                            <Input type="number" step="0.0001" value={moleculePrice} onChange={e => setMoleculePrice(parseFloat(e.target.value))} />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {selectedType === 'P1' && p1Type === 'CHAUFFAGE' && (
                            <div className="space-y-4 border p-4 rounded-md mt-4">
                                <h3 className="font-semibold text-sm">Paramètres d'Intéressement</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>NB de Référence (MWh)</Label>
                                        <Input type="number" step="0.001" value={referenceNb} onChange={e => setReferenceNb(parseFloat(e.target.value))} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>DJU de Référence</Label>
                                        <Input type="number" step="1" value={referenceDju} onChange={e => setReferenceDju(parseFloat(e.target.value))} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Type de Contrat</Label>
                                        <Select value={heatingContractType} onValueChange={setHeatingContractType}>
                                            <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="MCI">MCI</SelectItem>
                                                <SelectItem value="MTI">MTI</SelectItem>
                                                <SelectItem value="MF">MF</SelectItem>
                                                <SelectItem value="AUTRE">Autre</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Station Météo</Label>
                                        <Select value={heatingWeatherStation} onValueChange={setHeatingWeatherStation}>
                                            <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                                            <SelectContent>
                                                {weatherStations.map(ws => (
                                                    <SelectItem key={ws.code} value={ws.code}>{ws.name} ({ws.code})</SelectItem>
                                                ))}
                                                <SelectItem value="MANUAL">Saisie Manuelle (Si absente)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Pourcentage de Partage (%)</Label>
                                        <Input type="number" step="0.1" value={sharingPercentage} onChange={e => setSharingPercentage(parseFloat(e.target.value))} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>PU Intéressement (€/MWh)</Label>
                                        <Input type="number" step="0.0001" value={interestUnitPrice} onChange={e => setInterestUnitPrice(parseFloat(e.target.value))} />
                                    </div>
                                </div>
                            </div>
                        )}

                        <Separator />

                        {selectedActivityId && (
                            selectedType === 'P1' ? (
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Prix Unitaire</Label>
                                        <Input type="number" step="0.0001" value={unitPrice} onChange={e => setUnitPrice(parseFloat(e.target.value))} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Unité</Label>
                                        <Select value={unit} onValueChange={setUnit}>
                                            <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="€/MWh">€/MWh</SelectItem>
                                                <SelectItem value="€/kWh">€/kWh</SelectItem>
                                                <SelectItem value="€/m3">€/m3</SelectItem>
                                                <SelectItem value="€/an">€/an</SelectItem>
                                                <SelectItem value="€/mois">€/mois</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <Label>Montant Forfaitaire (€ HT/an)</Label>
                                    <Input type="number" step="0.01" value={price} onChange={e => setPrice(parseFloat(e.target.value))} />
                                </div>
                            )
                        )}

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Terme de facturation</Label>
                                <Select value={billingTermId} onValueChange={setBillingTermId}>
                                    <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                                    <SelectContent>
                                        {terms.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Périodicité de facturation</Label>
                                <Select value={scheduleId} onValueChange={setScheduleId}>
                                    <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                                    <SelectContent>
                                        {schedules.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Règle de prix</Label>
                                <Select value={pricingRuleId} onValueChange={setPricingRuleId}>
                                    <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                                    <SelectContent>
                                        {pricingRules.map(r => <SelectItem key={r.id} value={r.id}>{r.rule}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Formule de révision</Label>
                                <Select value={revisionRuleId} onValueChange={setRevisionRuleId}>
                                    <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                                    <SelectContent>
                                        {revisionRules
                                            .filter(r => {
                                                // If rule has specific activity, it must match selected activity
                                                if (r.activityId && r.activityId !== selectedActivityId) return false;
                                                // If rule has specific P1 type, it must match selected P1 type (only if we are in P1 mode)
                                                if (selectedType === 'P1' && r.p1Type && r.p1Type !== p1Type) return false;
                                                return true;
                                            })
                                            .map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <Label>Valeurs initiales des indices (I0)</Label>
                                {!openCombobox ? (
                                    <Button variant="outline" className="w-[250px] justify-between h-8 text-xs" onClick={() => setOpenCombobox(true)}>
                                        Ajouter un indice...
                                        <Plus className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                ) : (
                                    <div className="w-[250px] border rounded-md shadow-sm bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95">
                                        <Command
                                            className="h-auto"
                                            filter={(value, search) => {
                                                if (value.toLowerCase().includes(search.toLowerCase())) return 1;
                                                return 0;
                                            }}
                                        >
                                            <div className="flex items-center border-b px-3">
                                                <CommandInput placeholder="Rechercher..." autoFocus className="flex h-9 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50" />
                                                <Button variant="ghost" size="icon" className="h-6 w-6 ml-1" onClick={() => setOpenCombobox(false)}>
                                                    <X className="h-3 w-3" />
                                                </Button>
                                            </div>
                                            <CommandList className="max-h-[200px] overflow-y-auto">
                                                <CommandEmpty>Aucun indice trouvé.</CommandEmpty>
                                                <CommandGroup>
                                                    {sortedIndices.filter(i => !serviceIndices.find(si => si.indexId === i.id)).map((index) => (
                                                        <CommandItem
                                                            key={index.id}
                                                            value={`${index.code} ${index.label}`}
                                                            onSelect={() => {
                                                                handleAddServiceIndex(index.id);
                                                                setOpenCombobox(false);
                                                            }}
                                                        >
                                                            {index.code} - {index.label}
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            </CommandList>
                                        </Command>
                                    </div>
                                )}
                            </div>
                            <div className="border rounded-md p-2 space-y-2 max-h-[200px] overflow-y-auto bg-muted/20">
                                {serviceIndices.map(si => {
                                    const idx = indices.find(i => i.id === si.indexId);

                                    // Generate virtual values for calculated indices
                                    let virtualValues: any[] = [];
                                    if (idx?.type === 'calculated' && idx.formula) {
                                        const periods = Array.from(new Set(indexValues.map(v => v.period))).sort().reverse();
                                        virtualValues = periods.map(period => {
                                            const val = calculateIndexValue(idx.formula!, period, indices, indexValues, idx.decimals);
                                            if (val !== null) {
                                                return {
                                                    id: `calc-${period}`,
                                                    indexId: idx.id,
                                                    period,
                                                    value: val,
                                                    source: 'Calculé'
                                                };
                                            }
                                            return null;
                                        }).filter(v => v !== null);
                                    }

                                    const relevantValues = [
                                        ...indexValues.filter(iv => iv.indexId === si.indexId),
                                        ...virtualValues
                                    ].sort((a, b) => b.period.localeCompare(a.period)); // Sort by period desc

                                    return (
                                        <div key={si.indexId} className="flex items-center gap-2 text-sm">
                                            <div className="w-1/3 font-medium truncate" title={idx?.label}>
                                                {idx?.code}
                                            </div>
                                            <div className="flex-1">
                                                {relevantValues.length > 0 ? (
                                                    <Select value={si.valueId} onValueChange={(val) => handleServiceIndexValueChange(si.indexId, val)}>
                                                        <SelectTrigger className="h-8">
                                                            <SelectValue placeholder="Sélectionner une valeur" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {relevantValues.map(iv => (
                                                                <SelectItem key={iv.id} value={iv.id}>
                                                                    {iv.period} : {iv.value}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                ) : (
                                                    <div className="flex gap-2">
                                                        <Input
                                                            placeholder="Période (AAAA-MM)"
                                                            className="h-8 w-32"
                                                            value={si.period || ''}
                                                            onChange={(e) => handleManualServiceIndexChange(si.indexId, 'period', e.target.value)}
                                                        />
                                                        <Input
                                                            type="number"
                                                            step="any"
                                                            placeholder="Valeur"
                                                            className="h-8 w-24"
                                                            value={si.value || ''}
                                                            onChange={(e) => handleManualServiceIndexChange(si.indexId, 'value', e.target.value)}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleRemoveServiceIndex(si.indexId)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    );
                                })}
                                {serviceIndices.length === 0 && (
                                    <p className="text-xs text-muted-foreground text-center py-2">Aucun indice configuré.</p>
                                )}
                            </div>
                        </div>

                        {selectedType === 'P1' && (
                            <div className="space-y-2">
                                <Label>Compteur associé</Label>
                                {!isMeterComboOpen ? (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="w-full justify-between font-normal"
                                        onClick={() => setIsMeterComboOpen(true)}
                                    >
                                        {meterId
                                            ? (() => { const m = filteredMeters.find(m => m.id === meterId); return m ? `${m.reference || m.name} — ${m.type}` : 'Compteur inconnu'; })()
                                            : 'Rechercher un compteur...'}
                                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                ) : (
                                    <div className="border rounded-md shadow-sm bg-popover text-popover-foreground">
                                        <Command filter={(value, search) => value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0}>
                                            <div className="flex items-center border-b px-3">
                                                <CommandInput placeholder="Référence, nom ou type..." autoFocus className="flex h-9 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground" />
                                                <Button type="button" variant="ghost" size="icon" className="h-6 w-6 ml-1" onClick={() => setIsMeterComboOpen(false)}>
                                                    <X className="h-3 w-3" />
                                                </Button>
                                            </div>
                                            <CommandList className="max-h-[160px] overflow-y-auto">
                                                <CommandEmpty>Aucun compteur trouvé.</CommandEmpty>
                                                <CommandGroup>
                                                    {filteredMeters.map(m => (
                                                        <CommandItem
                                                            key={m.id}
                                                            value={`${m.reference || ''} ${m.name} ${m.type}`}
                                                            onSelect={() => { setMeterId(m.id); setIsMeterComboOpen(false); }}
                                                        >
                                                            <span className="font-medium">{m.reference || m.name}</span>
                                                            <span className="ml-2 text-muted-foreground text-xs">{m.type}</span>
                                                            {meterId === m.id && <Check className="ml-auto h-4 w-4" />}
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            </CommandList>
                                        </Command>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Date de début</Label>
                                <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
                            </div>
                            <div className="space-y-2">
                                <Label>Date de fin</Label>
                                <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Commentaire</Label>
                            <Textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Commentaire optionnel..." />
                        </div>

                        <div className="flex items-center space-x-2">
                            <Switch id="active" checked={isActive} onCheckedChange={setIsActive} />
                            <Label htmlFor="active">Prestation active</Label>
                        </div>

                        {/* Settlement Method Selector */}
                        <div className="space-y-2">
                            <Label>Méthode de Décompte</Label>
                            <Select value={settlementRuleId} onValueChange={setSettlementRuleId}>
                                <SelectTrigger><SelectValue placeholder="Selectionner une méthode..." /></SelectTrigger>
                                <SelectContent>
                                    {settlementRules
                                        .filter(r => r.targetType === null || r.targetType === selectedType)
                                        .map(r => (
                                            <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                                        ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">Détermine comment le solde de fin d'exercice sera calculé.</p>
                        </div>

                        {/* Billing Params — P1 only */}
                        {selectedType === 'P1' && (
                            <div className="space-y-4 border p-4 rounded-md">
                                <h3 className="font-semibold text-sm">Paramètres de facturation</h3>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="flex items-center gap-2 pt-5">
                                        <Switch id="includeAnnex" checked={includeAnnex} onCheckedChange={setIncludeAnnex} />
                                        <Label htmlFor="includeAnnex">Inclure les annexes</Label>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Délai de règlement</Label>
                                        <Select value={String(paymentTermDays)} onValueChange={v => setPaymentTermDays(Number(v))}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="30">30 jours</SelectItem>
                                                <SelectItem value="45">45 jours</SelectItem>
                                                <SelectItem value="60">60 jours</SelectItem>
                                                <SelectItem value="90">90 jours</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Coefficient de conversion</Label>
                                        <Input
                                            type="number"
                                            step="0.0001"
                                            value={conversionCoefficient}
                                            onChange={e => setConversionCoefficient(parseFloat(e.target.value) || 1)}
                                            placeholder="1.0"
                                        />
                                        <p className="text-xs text-muted-foreground">Ex : 11.6 pour m³→kWh (PCS gaz naturel)</p>
                                    </div>
                                </div>

                                {/* Billing Lines */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label>Lignes de facturation</Label>
                                        {!billingLines.some(l => l.lineType === 'PART_FIXE') && (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="h-7 text-xs"
                                                onClick={() => setBillingLines(prev => [...prev, { lineType: 'PART_FIXE', label: '', vatRateId: '', annualAmount: 0, isActive: true }])}
                                            >
                                                <Plus className="h-3 w-3 mr-1" /> Ajouter part fixe
                                            </Button>
                                        )}
                                    </div>
                                    <div className="space-y-2">
                                        {['CONSOMMATION' as BillingLineType, ...billingLines.filter(l => l.lineType === 'PART_FIXE').map(l => l.lineType)].map((lineType) => {
                                            const line = billingLines.find(l => l.lineType === lineType) ?? { lineType, label: '', vatRateId: '', isActive: true };
                                            return (
                                                <div key={lineType} className="grid gap-2 items-center" style={{ gridTemplateColumns: 'auto 1fr 1fr auto' }}>
                                                    <Badge variant="outline" className="text-xs whitespace-nowrap">
                                                        {lineType === 'CONSOMMATION' ? 'Consommation' : 'Part fixe'}
                                                    </Badge>
                                                    <Input
                                                        placeholder="Libellé sur facture"
                                                        value={line.label ?? ''}
                                                        onChange={e => updateBillingLine(lineType, 'label', e.target.value)}
                                                        className="h-8 text-xs"
                                                    />
                                                    <Select value={line.vatRateId} onValueChange={v => updateBillingLine(lineType, 'vatRateId', v)}>
                                                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="TVA" /></SelectTrigger>
                                                        <SelectContent>
                                                            {vatRates.map(vr => (
                                                                <SelectItem key={vr.id} value={vr.id}>{vr.rate} %</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                    {lineType === 'PART_FIXE' ? (
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 text-destructive"
                                                            onClick={() => setBillingLines(prev => prev.filter(l => l.lineType !== 'PART_FIXE'))}
                                                        >
                                                            <Trash2 className="h-3 w-3" />
                                                        </Button>
                                                    ) : (
                                                        <span />
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {billingLines.some(l => l.lineType === 'PART_FIXE') && (
                                        <div className="mt-1">
                                            <Label className="text-xs text-muted-foreground">Montant annuel part fixe (€ HT/an)</Label>
                                            <Input
                                                type="number"
                                                step="0.01"
                                                className="mt-1 h-8 text-xs"
                                                value={billingLines.find(l => l.lineType === 'PART_FIXE')?.annualAmount ?? 0}
                                                onChange={e => updateBillingLine('PART_FIXE', 'annualAmount', parseFloat(e.target.value) || 0)}
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setIsServiceDialogOpen(false)}>Annuler</Button>
                            <Button type="submit">Enregistrer</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
            {/* Interest Manager Dialog */}
            <Dialog open={isInterestManagerOpen} onOpenChange={setIsInterestManagerOpen}>
                <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Gestion de l'Intéressement - {activeService?.type} {activeService?.energyType}</DialogTitle>
                        <DialogDescription>
                            Historique et création des campagnes pour cette prestation.
                        </DialogDescription>
                    </DialogHeader>
                    {activeService && <InterestManager service={activeService} />}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsInterestManagerOpen(false)}>Fermer</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Settlement Manager Dialog */}
            <Dialog open={isSettlementManagerOpen} onOpenChange={setIsSettlementManagerOpen}>
                <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Décomptes Définitifs - {activeService?.type} {activeService?.energyType}</DialogTitle>
                        <DialogDescription>
                            Gérer les décomptes de régularisation pour cette prestation.
                        </DialogDescription>
                    </DialogHeader>
                    {activeService && <SettlementManager service={activeService} />}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsSettlementManagerOpen(false)}>Fermer</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div >
    );
}
