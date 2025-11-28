'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useData } from '@/context/data-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Save, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { updateSite, createService, updateService, deleteService, createMeter, updateMeter, deleteMeter } from '@/services/firestore';
import type { Site, Contract, Service, Meter, RevisionRule, Activity } from '@/lib/types';

export default function SiteDetailsPage() {
    const params = useParams();
    const router = useRouter();
    const { sites, contracts, clients, meters, services, activities, revisionRules, pricingRules, reloadData, isLoading } = useData();
    const siteId = params.id as string;

    const [site, setSite] = useState<Site | null>(null);
    const [contract, setContract] = useState<Contract | null>(null);
    const [siteMeters, setSiteMeters] = useState<Meter[]>([]);
    const [siteServices, setSiteServices] = useState<Service[]>([]);

    // ... (State for forms, dialogs, etc.)

    useEffect(() => {
        if (!isLoading && siteId) {
            const foundSite = sites.find(s => s.id === siteId);
            if (foundSite) {
                setSite(foundSite);
                // Find active contract for this site? Or just the one linked?
                // The data model links Contract -> SiteIds. 
                // We need to find the contract that contains this siteId.
                const foundContract = contracts.find(c => c.siteIds?.includes(siteId));
                setContract(foundContract || null);
            }
        }
    }, [sites, contracts, siteId, isLoading]);

    useEffect(() => {
        if (siteId) {
            setSiteMeters(meters.filter(m => m.siteId === siteId));
            setSiteServices(services.filter(s => s.siteId === siteId));
        }
    }, [meters, services, siteId]);

    if (isLoading) return <div>Chargement...</div>;
    if (!site) return <div>Site non trouvé</div>;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => router.back()}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">{site.name}</h1>
                        <div className="text-sm text-muted-foreground flex items-center gap-2">
                            <span>{contract?.clientName}</span>
                            <span>•</span>
                            <span>{contract?.id}</span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant={contract?.status === 'Actif' ? 'default' : 'secondary'}>
                        {contract?.status || 'Aucun contrat'}
                    </Badge>
                    <Button onClick={() => { /* Save logic */ }}>
                        <Save className="mr-2 h-4 w-4" />
                        Enregistrer
                    </Button>
                    <Button variant="outline" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: Info & Meters */}
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
                            {/* Add Typology, Market, etc. here */}
                            <Button variant="outline" size="sm" className="w-full">Modifier</Button>
                        </CardContent>
                    </Card>

                    {/* Meters Card */}
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-base font-medium">Compteurs</CardTitle>
                            <Button variant="ghost" size="sm"><Plus className="h-4 w-4" /></Button>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Réf</TableHead>
                                        <TableHead>Usage</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {siteMeters.map(meter => (
                                        <TableRow key={meter.id}>
                                            <TableCell className="font-medium">{meter.code}</TableCell>
                                            <TableCell>{meter.type}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>

                    {/* Services Summary */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base font-medium">Résumé des prestations</CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-wrap gap-2">
                            {siteServices.map(service => (
                                <Badge key={service.id} variant="outline">
                                    {service.type} {activities.find(a => a.id === service.activityId)?.label}
                                </Badge>
                            ))}
                        </CardContent>
                    </Card>
                </div>

                {/* Right Column: P1/P2/P3 Tabs */}
                <div className="lg:col-span-2">
                    <Tabs defaultValue="p1" className="w-full">
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="p1">P1 — Énergie</TabsTrigger>
                            <TabsTrigger value="p2">P2 — Maintenance</TabsTrigger>
                            <TabsTrigger value="p3">P3 — Renouvellement</TabsTrigger>
                        </TabsList>

                        <TabsContent value="p1" className="space-y-4 mt-4">
                            {/* List of P1 Services */}
                            {siteServices.filter(s => s.type === 'P1').map(service => (
                                <Card key={service.id}>
                                    <CardHeader>
                                        <CardTitle className="text-lg">
                                            P1 {activities.find(a => a.id === service.activityId)?.label}
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-6">
                                        {/* Section A: Price Params */}
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label>Règle de prix</Label>
                                                <Select defaultValue={service.billingMode}>
                                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {/* Map pricing rules */}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Formule de révision</Label>
                                                <Select defaultValue={service.revisionRuleId}>
                                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {revisionRules.map(rule => (
                                                            <SelectItem key={rule.id} value={rule.id}>{rule.name}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Prix unitaire de base</Label>
                                                <div className="flex items-center gap-2">
                                                    <Input type="number" defaultValue={service.basePrice} />
                                                    <span className="text-sm text-muted-foreground">€ HT</span>
                                                </div>
                                            </div>
                                            {/* ... other fields */}
                                        </div>

                                        {/* Section B: Indices (Read-only) */}
                                        {/* ... */}

                                        {/* Section C: Associated Meters */}
                                        {/* ... */}
                                    </CardContent>
                                </Card>
                            ))}

                            <Button className="w-full" variant="outline" onClick={() => { /* Open Add Service Dialog */ }}>
                                <Plus className="mr-2 h-4 w-4" /> Ajouter une prestation P1
                            </Button>
                        </TabsContent>

                        <TabsContent value="p2">
                            {/* P2 Content */}
                        </TabsContent>

                        <TabsContent value="p3">
                            {/* P3 Content */}
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </div>
    );
}
