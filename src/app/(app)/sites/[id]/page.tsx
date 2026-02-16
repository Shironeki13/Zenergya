'use client';

import Link from 'next/link';
import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useData } from '@/context/data-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Plus, Trash2, Edit, Check, MoreHorizontal, Save, ChevronsUpDown, X, Calculator } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { updateSite, createService, updateService, deleteService, createMeter, updateMeter, deleteMeter, getWeatherStations } from '@/services/firestore';
import type { Site, Contract, Service, Meter, RevisionRule, Activity, Term, Schedule, PricingRule, ServiceType, ServiceInitialIndexValue, Index, IndexValue } from '@/lib/types';
import { MeterReadingsDialog } from '@/components/meter-readings-dialog';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { calculateIndexValue } from '@/lib/calculations';
import { InterestManager } from '@/components/interest-manager';
import { SettlementManager } from '@/components/settlement-manager';

export default function SiteDetailsPage() {
    const params = useParams();
    const router = useRouter();
    const { sites, contracts, meters, services, activities, revisionRules, pricingRules, terms, schedules, reloadData, isLoading, indices, indexValues, settlementRules } = useData();
    const siteId = params.id as string;

    const [site, setSite] = useState<Site | null>(null);
    const [contract, setContract] = useState<Contract | null>(null);
    const [siteMeters, setSiteMeters] = useState<Meter[]>([]);
    const [siteServices, setSiteServices] = useState<Service[]>([]);
    const [weatherStations, setWeatherStations] = useState<{ code: string, name: string }[]>([]);

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

    const [openCombobox, setOpenCombobox] = useState(false);

    // Selected Service for Detail View
    const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);

    // Interest Manager Dialog
    const [isInterestManagerOpen, setIsInterestManagerOpen] = useState(false);
    // Settlement Manager Dialog
    const [isSettlementManagerOpen, setIsSettlementManagerOpen] = useState(false);


    useEffect(() => {
        const loadWeatherStations = async () => {
            try {
                const loadedStations = await getWeatherStations();
                setWeatherStations(loadedStations);
            } catch (error) {
                console.error("Failed to load weather stations:", error);
                toast({ title: "Erreur", description: "Impossible de charger les stations météo.", variant: "destructive" });
            }
        };

        if (!isLoading && siteId) {
            const foundSite = sites.find(s => s.id === siteId);
            if (foundSite) {
                setSite(foundSite);
                const foundContract = contracts.find(c => c.siteIds?.includes(siteId));
                setContract(foundContract || null);
            }
            loadWeatherStations();
        }
    }, [sites, contracts, siteId, isLoading]);

    useEffect(() => {
        if (siteId) {
            setSiteMeters(meters.filter(m => m.siteId === siteId));
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

        setEditingService(null);
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

    // Filter meters based on P1 Type
    // Filter meters based on P1 Type
    const filteredMeters = useMemo(() => {
        if (selectedType !== 'P1') return [];
        // Return all meters for P1 to allow flexibility (e.g. using an Electric meter for ECS)
        return siteMeters;
    }, [siteMeters, selectedType]);

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
                                {contract.label || contract.name || contract.id}
                            </Link>
                            <span className="mx-2">›</span>
                        </>
                    ) : (
                        <>
                            <span>Site</span>
                            <span className="mx-2">›</span>
                        </>
                    )}
                    <span className="font-medium text-foreground">Site</span>
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
                            <div className="text-sm text-muted-foreground flex items-center gap-2">
                                <span>{contract?.clientName}</span>
                            </div>
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
                                            <div className="text-xs text-muted-foreground">{service.energyType || ''}</div>
                                        </div>
                                    );
                                })
                            )}
                        </CardContent>
                    </Card>
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
                                <h2 className="text-xl font-semibold">
                                    {activeService ? (
                                        `${activeService.type} ${activeActivity?.label || ''} — ${activeService.energyType || ''}`
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
                                                        <Label className="text-xs text-muted-foreground">Indice de base</Label>
                                                        <div className="p-2 border rounded-md bg-muted/20 text-sm font-medium text-center">-</div>
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
                                                    <div className="space-y-4">
                                                        <div className="flex justify-between text-xs text-muted-foreground mb-2">
                                                            <span>Indice</span>
                                                            <span>Utilisé dans révision</span>
                                                        </div>
                                                        {activeRevisionRule.indices.map((idx, i) => {
                                                            const foundIndex = indices.find(ind => ind.id === idx.indexId);
                                                            return (
                                                                <div key={i} className="flex items-center justify-between p-2 border rounded-md bg-muted/10">
                                                                    <span className="font-medium text-sm">{foundIndex ? `${foundIndex.code} - ${foundIndex.label}` : idx.indexId}</span>
                                                                    <Check className="h-4 w-4 text-primary" />
                                                                </div>
                                                            );
                                                        })}
                                                        {activeRevisionRule.indices.length === 0 && <div className="text-sm text-muted-foreground">Aucun indice configuré</div>}
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
                                        <CardContent>
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
                                        </CardContent>
                                    </Card>

                                    {/* Section 4: Aperçu de calcul */}
                                    <Card className="bg-muted/10 border-dashed">
                                        <CardHeader>
                                            <CardTitle className="text-base">Aperçu de calcul</CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-2">
                                            <div className="flex justify-between items-center text-sm">
                                                <span className="text-muted-foreground">Coefficient révisé estimé</span>
                                                <span className="font-bold">11,23 € HT</span>
                                            </div>
                                            <div className="flex justify-between items-center text-sm">
                                                <span className="text-muted-foreground">Consommation estimée</span>
                                                <span className="font-bold">35 {activeService.unit?.includes('m3') ? 'm3' : 'MWh'}</span>
                                            </div>
                                            <Separator className="my-2" />
                                            <div className="flex justify-between items-center text-base">
                                                <span className="font-medium">Montant {activeService.type} estimé</span>
                                                <span className="font-bold text-primary">393,05 € HT</span>
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
                                <Select value={meterId} onValueChange={setMeterId}>
                                    <SelectTrigger><SelectValue placeholder="Sélectionner un compteur" /></SelectTrigger>
                                    <SelectContent>
                                        {filteredMeters.map(m => (
                                            <SelectItem key={m.id} value={m.id}>{m.code} - {m.type}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
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
