'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PlusCircle, Trash2, Edit, UploadCloud, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from '@/components/ui/textarea';
import type { Company, Agency, Sector, Activity, Schedule, Term, VatRate, Typology, RevisionRule, RevisionRuleType, PaymentTerm, PricingRule, Market, MeterType, WeatherStation, DjuMonthly } from "@/lib/types";
import {
    updateCompany, deleteCompany,
    updateAgency, deleteAgency,
    updateSector, deleteSector,
    updateActivity, deleteActivity,
    updateSchedule, deleteSchedule,
    updateTerm, deleteTerm,
    updateTypology, deleteTypology,
    updateVatRate, deleteVatRate,
    createRevisionRule, updateRevisionRule, deleteRevisionRule,
    updatePaymentTerm, deletePaymentTerm,
    updatePricingRule, deletePricingRule,
    updateMarket, deleteMarket,
    updateMeterType, deleteMeterType,
    createCompany, createAgency, createSector, createActivity, createSchedule, createTerm, createTypology, createVatRate, createPaymentTerm, createPricingRule, createMarket, createMeterType,
    createWeatherStation, updateWeatherStation, deleteWeatherStation, batchImportDjus, getDjuMonthliesByStation,
} from "@/services/firestore";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useData } from '@/context/data-context';


const fileToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

// Section pour les Sociétés
const CompaniesSection = ({ onCompaniesUpdate }: { onCompaniesUpdate: (companies: Company[]) => void }) => {
    const { toast } = useToast();
    const { companies, reloadData, isLoading } = useData();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingCompany, setEditingCompany] = useState<Company | null>(null);
    const [companyToDelete, setCompanyToDelete] = useState<Company | null>(null);

    const [name, setName] = useState('');
    const [code, setCode] = useState('');
    const [address, setAddress] = useState('');
    const [postalCode, setPostalCode] = useState('');
    const [city, setCity] = useState('');
    const [siret, setSiret] = useState('');
    const [siren, setSiren] = useState('');
    const [vatNumber, setVatNumber] = useState('');
    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [logoPreview, setLogoPreview] = useState<string | null>(null);

    useEffect(() => {
        if (siret && siret.length >= 9) {
            setSiren(siret.substring(0, 9));
        } else {
            setSiren('');
        }
    }, [siret]);

    const resetForm = () => {
        setName('');
        setCode('');
        setAddress('');
        setPostalCode('');
        setCity('');
        setSiret('');
        setSiren('');
        setVatNumber('');
        setLogoFile(null);
        setLogoPreview(null);
        setEditingCompany(null);
    };

    const handleOpenDialog = (company: Company | null = null) => {
        setEditingCompany(company);
        if (company) {
            setName(company.name);
            setCode(company.code || '');
            setAddress(company.address || '');
            setPostalCode(company.postalCode || '');
            setCity(company.city || '');
            setSiret(company.siret || '');
            setSiren(company.siren || '');
            setVatNumber(company.vatNumber || '');
            setLogoPreview(company.logoUrl || null);
        } else {
            resetForm();
        }
        setDialogOpen(true);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setLogoFile(file);
            const previewUrl = URL.createObjectURL(file);
            setLogoPreview(previewUrl);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !code.trim()) return;
        setIsSubmitting(true);

        try {
            let logoUrl: string | undefined = editingCompany?.logoUrl;
            if (logoFile) {
                logoUrl = await fileToDataUrl(logoFile);
            }

            const companyData = { name, code, address, postalCode, city, siret, siren, vatNumber, logoUrl };

            if (editingCompany) {
                await updateCompany(editingCompany.id, companyData);
                toast({ title: "Succès", description: "Société mise à jour." });
            } else {
                await createCompany(companyData as any);
                toast({ title: "Succès", description: "Société créée." });
            }

            await reloadData();
            setDialogOpen(false);
            resetForm();
        } catch (error) {
            toast({ title: "Erreur", description: "L'opération a échoué.", variant: "destructive" });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!companyToDelete) return;
        try {
            await deleteCompany(companyToDelete.id);
            toast({ title: "Succès", description: `${companyToDelete.name} a été supprimée.` });
            await reloadData();
            setCompanyToDelete(null);
        } catch (error) {
            toast({ title: "Erreur", description: "Impossible de supprimer la société.", variant: "destructive" });
        }
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle>Sociétés</CardTitle>
                        <CardDescription>Gérez vos sociétés, leurs logos et leurs adresses.</CardDescription>
                    </div>
                    <Button size="sm" className="gap-1" onClick={() => handleOpenDialog()}>
                        <PlusCircle className="h-4 w-4" /> Créer
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="border rounded-md">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[80px]">Logo</TableHead>
                                <TableHead className="w-[100px]">Code</TableHead>
                                <TableHead>Nom</TableHead>
                                <TableHead>SIRET</TableHead>
                                <TableHead>TVA Intra.</TableHead>
                                <TableHead className="w-[100px] text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow><TableCell colSpan={6} className="text-center h-24"><Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" /></TableCell></TableRow>
                            ) : companies.length === 0 ? (
                                <TableRow><TableCell colSpan={6} className="text-center">Aucune société trouvée.</TableCell></TableRow>
                            ) : (
                                companies.map((company) => (
                                    <TableRow key={company.id}>
                                        <TableCell>
                                            {company.logoUrl ? (
                                                <Image src={company.logoUrl} alt={company.name} width={40} height={40} className="rounded-md object-contain" />
                                            ) : (
                                                <div className="h-10 w-10 bg-muted rounded-md flex items-center justify-center text-muted-foreground">?</div>
                                            )}
                                        </TableCell>
                                        <TableCell className="font-medium">{company.code}</TableCell>
                                        <TableCell className="font-medium">{company.name}</TableCell>
                                        <TableCell>{company.siret || 'N/A'}</TableCell>
                                        <TableCell>{company.vatNumber || 'N/A'}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(company)}>
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Dialog open={!!companyToDelete && companyToDelete.id === company.id} onOpenChange={(isOpen) => !isOpen && setCompanyToDelete(null)}>
                                                <DialogTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setCompanyToDelete(company)}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </DialogTrigger>
                                                <DialogContent>
                                                    <DialogHeader>
                                                        <DialogTitle>Supprimer {companyToDelete?.name}</DialogTitle>
                                                        <DialogDescription>
                                                            Cette action est irréversible. La suppression de cette société entraînera la suppression de toutes les agences et secteurs associés.
                                                        </DialogDescription>
                                                    </DialogHeader>
                                                    <DialogFooter>
                                                        <Button variant="outline" onClick={() => setCompanyToDelete(null)}>Annuler</Button>
                                                        <Button variant="destructive" onClick={handleDelete}>Confirmer</Button>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>

                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogContent className="sm:max-w-[600px]">
                        <DialogHeader>
                            <DialogTitle>{editingCompany ? 'Modifier la société' : 'Nouvelle société'}</DialogTitle>
                        </DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="grid grid-cols-3 gap-4">
                                <div className="space-y-2 col-span-2">
                                    <Label htmlFor="name">Nom</Label>
                                    <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="code">Code Société</Label>
                                    <Input
                                        id="code"
                                        value={code}
                                        onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                                        maxLength={3}
                                        placeholder="EX: ABC"
                                        required
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="address">Adresse</Label>
                                <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="postalCode">Code Postal</Label>
                                    <Input id="postalCode" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="city">Ville</Label>
                                    <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="siret">SIRET</Label>
                                    <Input id="siret" value={siret} onChange={(e) => setSiret(e.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="siren">SIREN</Label>
                                    <Input id="siren" value={siren} readOnly className="bg-muted" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="vatNumber">N° TVA Intracommunautaire</Label>
                                <Input id="vatNumber" value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label>Logo</Label>
                                <div className="flex items-center gap-4">
                                    <div className="h-20 w-20 border rounded-md flex items-center justify-center bg-muted overflow-hidden">
                                        {logoPreview ? <Image src={logoPreview} alt="Aperçu" width={80} height={80} className="object-contain" /> : <UploadCloud className="h-8 w-8 text-muted-foreground" />}
                                    </div>
                                    <Input id="logo" type="file" accept="image/*" onChange={handleFileChange} className="flex-1" />
                                </div>
                            </div>
                            <DialogFooter>
                                <DialogClose asChild><Button type="button" variant="outline">Annuler</Button></DialogClose>
                                <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Enregistrement..." : "Enregistrer"}</Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
};


// Section pour les Agences
const AgenciesSection = ({ onAgenciesUpdate }: { onAgenciesUpdate: (agencies: Agency[]) => void }) => {
    const { toast } = useToast();
    const { agencies, companies, isLoading, reloadData } = useData();

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingAgency, setEditingAgency] = useState<Agency | null>(null);
    const [agencyToDelete, setAgencyToDelete] = useState<Agency | null>(null);

    const [name, setName] = useState('');
    const [companyId, setCompanyId] = useState('');

    const resetForm = () => { setName(''); setCompanyId(''); setEditingAgency(null); };

    const handleOpenDialog = (agency: Agency | null = null) => {
        setEditingAgency(agency);
        if (agency) {
            setName(agency.name);
            setCompanyId(agency.companyId);
        } else {
            resetForm();
        }
        setDialogOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !companyId) return;
        setIsSubmitting(true);
        try {
            if (editingAgency) {
                await updateAgency(editingAgency.id, name, companyId);
                toast({ title: "Succès", description: "Agence mise à jour." });
            } else {
                await createAgency(name, companyId);
                toast({ title: "Succès", description: "Agence créée." });
            }
            await reloadData();
            setDialogOpen(false);
            resetForm();
        } catch (error) {
            toast({ title: "Erreur", description: "L'opération a échoué.", variant: "destructive" });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!agencyToDelete) return;
        try {
            await deleteAgency(agencyToDelete.id);
            toast({ title: "Succès", description: "L'agence et ses secteurs ont été supprimés." });
            await reloadData();
            setAgencyToDelete(null);
        } catch (error) {
            toast({ title: "Erreur", description: "Impossible de supprimer l'agence.", variant: "destructive" });
        }
    };

    const agenciesWithDetails = useMemo(() => {
        const companyMap = new Map(companies.map(c => [c.id, c.name]));
        return agencies.map(agency => ({
            ...agency,
            companyName: companyMap.get(agency.companyId) || 'N/A',
        }));
    }, [agencies, companies]);

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle>Agences</CardTitle>
                        <CardDescription>Gérez vos agences et leur rattachement aux sociétés.</CardDescription>
                    </div>
                    <Button size="sm" className="gap-1" onClick={() => handleOpenDialog()}>
                        <PlusCircle className="h-4 w-4" /> Créer
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="border rounded-md">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Agence</TableHead>
                                <TableHead>Société</TableHead>
                                <TableHead className="w-[100px] text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (<TableRow><TableCell colSpan={3} className="text-center h-24"><Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" /></TableCell></TableRow>
                            ) : agenciesWithDetails.length === 0 ? (<TableRow><TableCell colSpan={3} className="text-center">Aucune agence.</TableCell></TableRow>
                            ) : (
                                agenciesWithDetails.map(agency => (
                                    <TableRow key={agency.id}>
                                        <TableCell className="font-medium">{agency.name}</TableCell>
                                        <TableCell>{agency.companyName}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(agency)}><Edit className="h-4 w-4" /></Button>
                                            <Dialog open={!!agencyToDelete && agencyToDelete.id === agency.id} onOpenChange={(isOpen) => !isOpen && setAgencyToDelete(null)}>
                                                <DialogTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setAgencyToDelete(agency)}><Trash2 className="h-4 w-4" /></Button>
                                                </DialogTrigger>
                                                <DialogContent>
                                                    <DialogHeader>
                                                        <DialogTitle>Supprimer {agencyToDelete?.name}</DialogTitle>
                                                        <DialogDescription>Cette action est irréversible et supprimera les secteurs associés.</DialogDescription>
                                                    </DialogHeader>
                                                    <DialogFooter>
                                                        <Button variant="outline" onClick={() => setAgencyToDelete(null)}>Annuler</Button>
                                                        <Button variant="destructive" onClick={handleDelete}>Confirmer</Button>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogContent>
                        <DialogHeader><DialogTitle>{editingAgency ? "Modifier l'agence" : "Nouvelle agence"}</DialogTitle></DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="agencyName">Nom de l'agence</Label>
                                <Input id="agencyName" value={name} onChange={e => setName(e.target.value)} required />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="company">Société</Label>
                                <Select onValueChange={setCompanyId} value={companyId}>
                                    <SelectTrigger><SelectValue placeholder="Sélectionner une société" /></SelectTrigger>
                                    <SelectContent>
                                        {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <DialogFooter>
                                <DialogClose asChild><Button variant="outline">Annuler</Button></DialogClose>
                                <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Enregistrement..." : "Enregistrer"}</Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
};


// Section pour les Secteurs
const SectorsSection = () => {
    const { toast } = useToast();
    const { sectors, agencies, isLoading, reloadData } = useData();

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingSector, setEditingSector] = useState<Sector | null>(null);
    const [sectorToDelete, setSectorToDelete] = useState<Sector | null>(null);

    const [name, setName] = useState('');
    const [agencyId, setAgencyId] = useState('');

    const resetForm = () => { setName(''); setAgencyId(''); setEditingSector(null); };

    const handleOpenDialog = (sector: Sector | null = null) => {
        setEditingSector(sector);
        if (sector) {
            setName(sector.name);
            setAgencyId(sector.agencyId);
        } else {
            resetForm();
        }
        setDialogOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !agencyId) return;
        setIsSubmitting(true);
        try {
            if (editingSector) {
                await updateSector(editingSector.id, name, agencyId);
                toast({ title: "Succès", description: "Secteur mis à jour." });
            } else {
                await createSector(name, agencyId);
                toast({ title: "Succès", description: "Secteur créé." });
            }
            await reloadData();
            setDialogOpen(false);
            resetForm();
        } catch (error) {
            toast({ title: "Erreur", description: "L'opération a échoué.", variant: "destructive" });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!sectorToDelete) return;
        try {
            await deleteSector(sectorToDelete.id);
            toast({ title: "Succès", description: "Secteur supprimé." });
            await reloadData();
            setSectorToDelete(null);
        } catch (error) {
            toast({ title: "Erreur", description: "Impossible de supprimer le secteur.", variant: "destructive" });
        }
    };

    const sectorsWithDetails = useMemo(() => {
        const agencyMap = new Map(agencies.map(a => [a.id, a.name]));
        return sectors.map(sector => ({
            ...sector,
            agencyName: agencyMap.get(sector.agencyId) || 'N/A'
        }));
    }, [sectors, agencies]);


    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle>Secteurs</CardTitle>
                        <CardDescription>Gérez vos secteurs et leur rattachement aux agences.</CardDescription>
                    </div>
                    <Button size="sm" className="gap-1" onClick={() => handleOpenDialog()}>
                        <PlusCircle className="h-4 w-4" /> Créer
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="border rounded-md">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Secteur</TableHead>
                                <TableHead>Agence</TableHead>
                                <TableHead className="w-[100px] text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (<TableRow><TableCell colSpan={3} className="text-center h-24"><Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" /></TableCell></TableRow>
                            ) : sectorsWithDetails.length === 0 ? (<TableRow><TableCell colSpan={3} className="text-center">Aucun secteur.</TableCell></TableRow>
                            ) : (
                                sectorsWithDetails.map(sector => (
                                    <TableRow key={sector.id}>
                                        <TableCell className="font-medium">{sector.name}</TableCell>
                                        <TableCell>{sector.agencyName}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(sector)}><Edit className="h-4 w-4" /></Button>
                                            <Dialog open={!!sectorToDelete && sectorToDelete.id === sector.id} onOpenChange={(isOpen) => !isOpen && setSectorToDelete(null)}>
                                                <DialogTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setSectorToDelete(sector)}><Trash2 className="h-4 w-4" /></Button>
                                                </DialogTrigger>
                                                <DialogContent>
                                                    <DialogHeader><DialogTitle>Supprimer {sectorToDelete?.name}</DialogTitle><DialogDescription>Cette action est irréversible.</DialogDescription></DialogHeader>
                                                    <DialogFooter>
                                                        <Button variant="outline" onClick={() => setSectorToDelete(null)}>Annuler</Button>
                                                        <Button variant="destructive" onClick={handleDelete}>Confirmer</Button>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogContent>
                        <DialogHeader><DialogTitle>{editingSector ? "Modifier le secteur" : "Nouveau secteur"}</DialogTitle></DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2"><Label htmlFor="sectorName">Nom du secteur</Label><Input id="sectorName" value={name} onChange={e => setName(e.target.value)} required /></div>
                            <div className="space-y-2"><Label htmlFor="agency">Agence</Label>
                                <Select onValueChange={setAgencyId} value={agencyId}>
                                    <SelectTrigger><SelectValue placeholder="Sélectionner une agence" /></SelectTrigger>
                                    <SelectContent>{agencies.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                            <DialogFooter>
                                <DialogClose asChild><Button variant="outline">Annuler</Button></DialogClose>
                                <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Enregistrement..." : "Enregistrer"}</Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
};


// Section pour les Activités
// Section pour les Activités
const ActivitiesSection = () => {
    const { toast } = useToast();
    const { activities, isLoading, reloadData } = useData();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
    const [activityToDelete, setActivityToDelete] = useState<Activity | null>(null);
    const [code, setCode] = useState('');
    const [label, setLabel] = useState('');
    const [type, setType] = useState<'P1' | 'P2' | 'P3'>('P1');

    const resetForm = () => { setCode(''); setLabel(''); setType('P1'); setEditingActivity(null); };

    const handleOpenDialog = (activity: Activity | null = null) => {
        setEditingActivity(activity);
        setCode(activity ? activity.code : '');
        setLabel(activity ? activity.label : '');
        setType(activity ? activity.type : 'P1');
        setDialogOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!code.trim() || !label.trim()) return;
        setIsSubmitting(true);
        try {
            if (editingActivity) {
                await updateActivity(editingActivity.id, { code, label, type });
                toast({ title: "Succès", description: "Activité mise à jour." });
            } else {
                await createActivity({ code, label, type });
                toast({ title: "Succès", description: "Activité créée." });
            }
            await reloadData();
            setDialogOpen(false);
            resetForm();
        } catch (error) {
            toast({ title: "Erreur", description: "L'opération a échoué.", variant: "destructive" });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!activityToDelete) return;
        try {
            await deleteActivity(activityToDelete.id);
            toast({ title: "Succès", description: "Activité supprimée." });
            await reloadData();
            setActivityToDelete(null);
        } catch (error) {
            toast({ title: "Erreur", description: "Impossible de supprimer l'activité.", variant: "destructive" });
        }
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle>Activités</CardTitle>
                        <CardDescription>Gérez les activités ou prestations facturables.</CardDescription>
                    </div>
                    <Button size="sm" className="gap-1" onClick={() => handleOpenDialog()}>
                        <PlusCircle className="h-4 w-4" /> Créer
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="border rounded-md">
                    <Table>
                        <TableHeader><TableRow><TableHead className="w-[150px]">Code</TableHead><TableHead>Libellé</TableHead><TableHead>Type</TableHead><TableHead className="w-[100px] text-right">Actions</TableHead></TableRow></TableHeader>
                        <TableBody>
                            {isLoading ? (<TableRow><TableCell colSpan={4} className="text-center h-24"><Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" /></TableCell></TableRow>
                            ) : activities.length === 0 ? (<TableRow><TableCell colSpan={4} className="text-center">Aucune activité.</TableCell></TableRow>
                            ) : (
                                activities.map(activity => (
                                    <TableRow key={activity.id}>
                                        <TableCell className="font-medium">{activity.code}</TableCell>
                                        <TableCell>{activity.label}</TableCell>
                                        <TableCell>{activity.type}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(activity)}><Edit className="h-4 w-4" /></Button>
                                            <Dialog open={!!activityToDelete && activityToDelete.id === activity.id} onOpenChange={(isOpen) => !isOpen && setActivityToDelete(null)}>
                                                <DialogTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setActivityToDelete(activity)}><Trash2 className="h-4 w-4" /></Button>
                                                </DialogTrigger>
                                                <DialogContent>
                                                    <DialogHeader><DialogTitle>Supprimer {activityToDelete?.code}</DialogTitle><DialogDescription>Cette action est irréversible.</DialogDescription></DialogHeader>
                                                    <DialogFooter>
                                                        <Button variant="outline" onClick={() => setActivityToDelete(null)}>Annuler</Button>
                                                        <Button variant="destructive" onClick={handleDelete}>Confirmer</Button>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogContent>
                        <DialogHeader><DialogTitle>{editingActivity ? "Modifier l'activité" : "Nouvelle activité"}</DialogTitle></DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="activityCode">Code</Label>
                                <Input id="activityCode" value={code} onChange={e => setCode(e.target.value)} required />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="activityLabel">Libellé</Label>
                                <Input id="activityLabel" value={label} onChange={e => setLabel(e.target.value)} required />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="activityType">Type</Label>
                                <Select onValueChange={(v: 'P1' | 'P2' | 'P3') => setType(v)} value={type}>
                                    <SelectTrigger><SelectValue placeholder="Sélectionner un type" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="P1">P1 (Énergie)</SelectItem>
                                        <SelectItem value="P2">P2 (Maintenance)</SelectItem>
                                        <SelectItem value="P3">P3 (Gros Entretien)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <DialogFooter>
                                <DialogClose asChild><Button variant="outline">Annuler</Button></DialogClose>
                                <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Enregistrement..." : "Enregistrer"}</Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
};

// Section pour les Types de Compteurs
const MeterTypesSection = () => {
    const { toast } = useToast();
    const { meterTypes, isLoading, reloadData } = useData();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<MeterType | null>(null);
    const [itemToDelete, setItemToDelete] = useState<MeterType | null>(null);
    const [code, setCode] = useState('');
    const [label, setLabel] = useState('');
    const [unit, setUnit] = useState('');

    const resetForm = () => { setCode(''); setLabel(''); setUnit(''); setEditingItem(null); };

    const handleOpenDialog = (item: MeterType | null = null) => {
        setEditingItem(item);
        setCode(item ? item.code : '');
        setLabel(item ? item.label : '');
        setUnit(item ? item.unit : '');
        setDialogOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!code.trim() || !label.trim() || !unit.trim()) return;
        setIsSubmitting(true);
        try {
            const data = { code, label, unit };
            if (editingItem) {
                await updateMeterType(editingItem.id, data);
                toast({ title: "Succès", description: "Type de compteur mis à jour." });
            } else {
                await createMeterType(data);
                toast({ title: "Succès", description: "Type de compteur créé." });
            }
            await reloadData(); setDialogOpen(false); resetForm();
        } catch (error) {
            toast({ title: "Erreur", description: "L'opération a échoué.", variant: "destructive" });
        } finally { setIsSubmitting(false); }
    };

    const handleDelete = async () => {
        if (!itemToDelete) return;
        try {
            await deleteMeterType(itemToDelete.id);
            toast({ title: "Succès", description: "Type de compteur supprimé." });
            await reloadData(); setItemToDelete(null);
        } catch (error) { toast({ title: "Erreur", description: "Impossible de supprimer le type de compteur.", variant: "destructive" }); }
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div><CardTitle>Types de Compteurs</CardTitle><CardDescription>Gérez les types de compteurs, leurs libellés et unités.</CardDescription></div>
                    <Button size="sm" className="gap-1" onClick={() => handleOpenDialog()}><PlusCircle className="h-4 w-4" /> Créer</Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="border rounded-md">
                    <Table>
                        <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Libellé</TableHead><TableHead>Unité</TableHead><TableHead className="w-[100px] text-right">Actions</TableHead></TableRow></TableHeader>
                        <TableBody>
                            {isLoading ? (<TableRow><TableCell colSpan={4} className="text-center h-24"><Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" /></TableCell></TableRow>)
                                : meterTypes.length === 0 ? (<TableRow><TableCell colSpan={4} className="text-center">Aucun type de compteur.</TableCell></TableRow>)
                                    : (meterTypes.map(item => (
                                        <TableRow key={item.id}>
                                            <TableCell className="font-medium">{item.code}</TableCell>
                                            <TableCell>{item.label}</TableCell>
                                            <TableCell>{item.unit}</TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(item)}><Edit className="h-4 w-4" /></Button>
                                                <Dialog open={!!itemToDelete && itemToDelete.id === item.id} onOpenChange={(isOpen) => !isOpen && setItemToDelete(null)}>
                                                    <DialogTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setItemToDelete(item)}><Trash2 className="h-4 w-4" /></Button></DialogTrigger>
                                                    <DialogContent>
                                                        <DialogHeader><DialogTitle>Supprimer {itemToDelete?.code}</DialogTitle><DialogDescription>Cette action est irréversible.</DialogDescription></DialogHeader>
                                                        <DialogFooter><Button variant="outline" onClick={() => setItemToDelete(null)}>Annuler</Button><Button variant="destructive" onClick={handleDelete}>Confirmer</Button></DialogFooter>
                                                    </DialogContent>
                                                </Dialog>
                                            </TableCell>
                                        </TableRow>
                                    )))}
                        </TableBody>
                    </Table>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogContent>
                        <DialogHeader><DialogTitle>{editingItem ? "Modifier le type" : "Nouveau type de compteur"}</DialogTitle></DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2"><Label htmlFor="mtCode">Code</Label><Input id="mtCode" value={code} onChange={e => setCode(e.target.value.toUpperCase())} required placeholder="Ex: ECS" /></div>
                            <div className="space-y-2"><Label htmlFor="mtLabel">Libellé</Label><Input id="mtLabel" value={label} onChange={e => setLabel(e.target.value)} required placeholder="Ex: Eau Chaude Sanitaire" /></div>
                            <div className="space-y-2"><Label htmlFor="mtUnit">Unité</Label><Input id="mtUnit" value={unit} onChange={e => setUnit(e.target.value)} required placeholder="Ex: m³, kWh" /></div>
                            <DialogFooter><DialogClose asChild><Button variant="outline">Annuler</Button></DialogClose><Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Enregistrement..." : "Enregistrer"}</Button></DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
};

// Section Règles de prix
const PricingRulesSection = () => {
    const { toast } = useToast();
    const { pricingRules, activities, isLoading, reloadData } = useData();

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingRule, setEditingRule] = useState<PricingRule | null>(null);
    const [ruleToDelete, setRuleToDelete] = useState<PricingRule | null>(null);

    const [activityId, setActivityId] = useState('');
    const [rule, setRule] = useState('');
    const [description, setDescription] = useState('');

    const resetForm = () => { setActivityId(''); setRule(''); setDescription(''); setEditingRule(null); };

    const handleOpenDialog = (rule: PricingRule | null = null) => {
        setEditingRule(rule);
        if (rule) {
            setActivityId(rule.activityId);
            setRule(rule.rule);
            setDescription(rule.description);
        } else {
            resetForm();
        }
        setDialogOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activityId || !rule.trim()) return;
        setIsSubmitting(true);
        try {
            const data = { activityId, rule, description };
            if (editingRule) {
                await updatePricingRule(editingRule.id, data);
                toast({ title: "Succès", description: "Règle de prix mise à jour." });
            } else {
                await createPricingRule(data);
                toast({ title: "Succès", description: "Règle de prix créée." });
            }
            await reloadData();
            setDialogOpen(false);
            resetForm();
        } catch (error) {
            toast({ title: "Erreur", description: "L'opération a échoué.", variant: "destructive" });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!ruleToDelete) return;
        try {
            await deletePricingRule(ruleToDelete.id);
            toast({ title: "Succès", description: "Règle de prix supprimée." });
            await reloadData();
            setRuleToDelete(null);
        } catch (error) {
            toast({ title: "Erreur", description: "Impossible de supprimer la règle.", variant: "destructive" });
        }
    };

    const rulesWithDetails = useMemo(() => {
        const activityMap = new Map(activities.map(a => [a.id, { code: a.code, label: a.label }]));
        return pricingRules.map(rule => ({
            ...rule,
            activityCode: activityMap.get(rule.activityId)?.code || 'N/A',
            activityLabel: activityMap.get(rule.activityId)?.label || 'N/A',
        }));
    }, [pricingRules, activities]);

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle>Règles de Prix</CardTitle>
                        <CardDescription>Gérez les règles de tarification associées à chaque activité.</CardDescription>
                    </div>
                    <Button size="sm" className="gap-1" onClick={() => handleOpenDialog()}>
                        <PlusCircle className="h-4 w-4" /> Créer
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="border rounded-md">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Activité</TableHead>
                                <TableHead>Règle</TableHead>
                                <TableHead>Description</TableHead>
                                <TableHead className="w-[100px] text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (<TableRow><TableCell colSpan={4} className="text-center h-24"><Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" /></TableCell></TableRow>
                            ) : rulesWithDetails.length === 0 ? (<TableRow><TableCell colSpan={4} className="text-center">Aucune règle de prix.</TableCell></TableRow>
                            ) : (
                                rulesWithDetails.map(item => (
                                    <TableRow key={item.id}>
                                        <TableCell className="font-medium">{item.activityCode} - {item.activityLabel}</TableCell>
                                        <TableCell>{item.rule}</TableCell>
                                        <TableCell>{item.description}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(item)}><Edit className="h-4 w-4" /></Button>
                                            <Dialog open={!!ruleToDelete && ruleToDelete.id === item.id} onOpenChange={(isOpen) => !isOpen && setRuleToDelete(null)}>
                                                <DialogTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setRuleToDelete(item)}><Trash2 className="h-4 w-4" /></Button>
                                                </DialogTrigger>
                                                <DialogContent>
                                                    <DialogHeader><DialogTitle>Supprimer la règle ?</DialogTitle><DialogDescription>Cette action est irréversible.</DialogDescription></DialogHeader>
                                                    <DialogFooter>
                                                        <Button variant="outline" onClick={() => setRuleToDelete(null)}>Annuler</Button>
                                                        <Button variant="destructive" onClick={handleDelete}>Confirmer</Button>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogContent>
                        <DialogHeader><DialogTitle>{editingRule ? "Modifier la règle" : "Nouvelle règle de prix"}</DialogTitle></DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="activity">Activité</Label>
                                <Select onValueChange={setActivityId} value={activityId}>
                                    <SelectTrigger><SelectValue placeholder="Sélectionner une activité" /></SelectTrigger>
                                    <SelectContent>
                                        {activities.map(a => <SelectItem key={a.id} value={a.id}>{a.code} - {a.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="rule">Règle</Label>
                                <Input id="rule" value={rule} onChange={e => setRule(e.target.value)} required />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="description">Description</Label>
                                <Textarea id="description" value={description} onChange={e => setDescription(e.target.value)} />
                            </div>
                            <DialogFooter>
                                <DialogClose asChild><Button variant="outline">Annuler</Button></DialogClose>
                                <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Enregistrement..." : "Enregistrer"}</Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
};

// Section Marchés
const MarketsSection = () => {
    const { toast } = useToast();
    const { markets, isLoading, reloadData } = useData();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<Market | null>(null);
    const [itemToDelete, setItemToDelete] = useState<Market | null>(null);
    const [code, setCode] = useState('');
    const [label, setLabel] = useState('');
    const [description, setDescription] = useState('');

    const resetForm = () => { setCode(''); setLabel(''); setDescription(''); setEditingItem(null); };

    const handleOpenDialog = (item: Market | null = null) => {
        setEditingItem(item);
        setCode(item ? item.code : '');
        setLabel(item ? item.label : '');
        setDescription(item ? item.description || '' : '');
        setDialogOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!code.trim() || !label.trim()) return;
        setIsSubmitting(true);
        try {
            const data = { code, label, description };
            if (editingItem) {
                await updateMarket(editingItem.id, data);
                toast({ title: "Succès", description: "Marché mis à jour." });
            } else {
                await createMarket(data);
                toast({ title: "Succès", description: "Marché créé." });
            }
            await reloadData();
            setDialogOpen(false);
            resetForm();
        } catch (error) {
            toast({ title: "Erreur", description: "L'opération a échoué.", variant: "destructive" });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!itemToDelete) return;
        try {
            await deleteMarket(itemToDelete.id);
            toast({ title: "Succès", description: "Marché supprimé." });
            await reloadData();
            setItemToDelete(null);
        } catch (error) {
            toast({ title: "Erreur", description: "Impossible de supprimer le marché.", variant: "destructive" });
        }
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle>Marchés</CardTitle>
                        <CardDescription>Gérez les types de marchés pour les contrats.</CardDescription>
                    </div>
                    <Button size="sm" className="gap-1" onClick={() => handleOpenDialog()}>
                        <PlusCircle className="h-4 w-4" /> Créer
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="border rounded-md">
                    <Table>
                        <TableHeader><TableRow><TableHead className="w-[150px]">Code</TableHead><TableHead>Libellé</TableHead><TableHead>Description</TableHead><TableHead className="w-[100px] text-right">Actions</TableHead></TableRow></TableHeader>
                        <TableBody>
                            {isLoading ? (<TableRow><TableCell colSpan={4} className="text-center h-24"><Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" /></TableCell></TableRow>
                            ) : markets.length === 0 ? (<TableRow><TableCell colSpan={4} className="text-center">Aucun marché.</TableCell></TableRow>
                            ) : (
                                markets.map(item => (
                                    <TableRow key={item.id}>
                                        <TableCell className="font-medium">{item.code}</TableCell>
                                        <TableCell>{item.label}</TableCell>
                                        <TableCell>{item.description}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(item)}><Edit className="h-4 w-4" /></Button>
                                            <Dialog open={!!itemToDelete && itemToDelete.id === item.id} onOpenChange={(isOpen) => !isOpen && setItemToDelete(null)}>
                                                <DialogTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setItemToDelete(item)}><Trash2 className="h-4 w-4" /></Button>
                                                </DialogTrigger>
                                                <DialogContent>
                                                    <DialogHeader><DialogTitle>Supprimer {itemToDelete?.code}</DialogTitle><DialogDescription>Cette action est irréversible.</DialogDescription></DialogHeader>
                                                    <DialogFooter>
                                                        <Button variant="outline" onClick={() => setItemToDelete(null)}>Annuler</Button>
                                                        <Button variant="destructive" onClick={handleDelete}>Confirmer</Button>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogContent>
                        <DialogHeader><DialogTitle>{editingItem ? "Modifier le marché" : "Nouveau marché"}</DialogTitle></DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="marketCode">Code</Label>
                                <Input id="marketCode" value={code} onChange={e => setCode(e.target.value)} required />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="marketLabel">Libellé</Label>
                                <Input id="marketLabel" value={label} onChange={e => setLabel(e.target.value)} required />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="marketDescription">Description</Label>
                                <Textarea id="marketDescription" value={description} onChange={e => setDescription(e.target.value)} />
                            </div>
                            <DialogFooter>
                                <DialogClose asChild><Button variant="outline">Annuler</Button></DialogClose>
                                <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Enregistrement..." : "Enregistrer"}</Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
};


// Section Taux de TVA
const VatRatesSection = () => {
    const { toast } = useToast();
    const { vatRates, isLoading, reloadData } = useData();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingVatRate, setEditingVatRate] = useState<VatRate | null>(null);
    const [vatRateToDelete, setVatRateToDelete] = useState<VatRate | null>(null);
    const [code, setCode] = useState('');
    const [rate, setRate] = useState<number | string>('');

    const resetForm = () => { setCode(''); setRate(''); setEditingVatRate(null); };

    const handleOpenDialog = (vatRate: VatRate | null = null) => {
        setEditingVatRate(vatRate);
        setCode(vatRate ? vatRate.code : '');
        setRate(vatRate ? vatRate.rate : '');
        setDialogOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const numericRate = parseFloat(rate as string);
        if (!code.trim() || isNaN(numericRate)) return;
        setIsSubmitting(true);
        try {
            if (editingVatRate) {
                await updateVatRate(editingVatRate.id, { code, rate: numericRate });
                toast({ title: "Succès", description: "Taux de TVA mis à jour." });
            } else {
                await createVatRate(code, numericRate);
                toast({ title: "Succès", description: "Taux de TVA créé." });
            }
            await reloadData();
            setDialogOpen(false);
            resetForm();
        } catch (error) {
            toast({ title: "Erreur", description: "L'opération a échoué.", variant: "destructive" });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!vatRateToDelete) return;
        try {
            await deleteVatRate(vatRateToDelete.id);
            toast({ title: "Succès", description: "Taux de TVA supprimé." });
            await reloadData();
            setVatRateToDelete(null);
        } catch (error) {
            toast({ title: "Erreur", description: "Impossible de supprimer le taux de TVA.", variant: "destructive" });
        }
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle>Taux de TVA</CardTitle>
                        <CardDescription>Gérez les différents taux de TVA applicables.</CardDescription>
                    </div>
                    <Button size="sm" className="gap-1" onClick={() => handleOpenDialog()}>
                        <PlusCircle className="h-4 w-4" /> Créer
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="border rounded-md">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Code</TableHead>
                                <TableHead>Taux (%)</TableHead>
                                <TableHead className="w-[100px] text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (<TableRow><TableCell colSpan={3} className="text-center h-24"><Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" /></TableCell></TableRow>
                            ) : vatRates.length === 0 ? (<TableRow><TableCell colSpan={3} className="text-center">Aucun taux de TVA.</TableCell></TableRow>
                            ) : (
                                vatRates.map(item => (
                                    <TableRow key={item.id}>
                                        <TableCell className="font-medium">{item.code}</TableCell>
                                        <TableCell>{item.rate}%</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(item)}><Edit className="h-4 w-4" /></Button>
                                            <Dialog open={!!vatRateToDelete && vatRateToDelete.id === item.id} onOpenChange={(isOpen) => !isOpen && setVatRateToDelete(null)}>
                                                <DialogTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setVatRateToDelete(item)}><Trash2 className="h-4 w-4" /></Button>
                                                </DialogTrigger>
                                                <DialogContent>
                                                    <DialogHeader><DialogTitle>Supprimer {vatRateToDelete?.code}</DialogTitle><DialogDescription>Cette action est irréversible.</DialogDescription></DialogHeader>
                                                    <DialogFooter>
                                                        <Button variant="outline" onClick={() => setVatRateToDelete(null)}>Annuler</Button>
                                                        <Button variant="destructive" onClick={handleDelete}>Confirmer</Button>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogContent>
                        <DialogHeader><DialogTitle>{editingVatRate ? "Modifier le taux de TVA" : "Nouveau taux de TVA"}</DialogTitle></DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="vatCode">Code</Label>
                                <Input id="vatCode" value={code} onChange={e => setCode(e.target.value)} required />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="vatRate">Taux (%)</Label>
                                <Input id="vatRate" type="number" value={rate} onChange={e => setRate(e.target.value)} required />
                            </div>
                            <DialogFooter>
                                <DialogClose asChild><Button variant="outline">Annuler</Button></DialogClose>
                                <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Enregistrement..." : "Enregistrer"}</Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
};

// Section Règles de Révision (P1)
const RevisionRulesSection = () => {
    const { toast } = useToast();
    const { revisionRules, indices, activities, isLoading, reloadData } = useData();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<RevisionRule | null>(null);
    const [itemToDelete, setItemToDelete] = useState<RevisionRule | null>(null);

    // Form state
    const [name, setName] = useState('');
    const [code, setCode] = useState('');
    const [description, setDescription] = useState('');
    const [type, setType] = useState<RevisionRuleType>('PONDERE_SIMPLE');
    const [nbMonths, setNbMonths] = useState(3);
    const [ruleIndices, setRuleIndices] = useState<{ indexId: string; coefficient: number }[]>([]);
    const [activityId, setActivityId] = useState<string>('');
    const [p1Type, setP1Type] = useState<string>('');

    const resetForm = () => {
        setName('');
        setCode('');
        setDescription('');
        setType('PONDERE_SIMPLE');
        setNbMonths(3);
        setRuleIndices([]);
        setActivityId('');
        setP1Type('');
        setEditingItem(null);
    };

    const handleOpenDialog = (item: RevisionRule | null = null) => {
        setEditingItem(item);
        if (item) {
            setName(item.name);
            setCode(item.code);
            setDescription(item.description || '');
            setType(item.type);
            setNbMonths(item.nbMonths);
            setRuleIndices(item.indices || []);
            setActivityId(item.activityId || '');
            setP1Type(item.p1Type || '');
        } else {
            resetForm();
            // Add one empty row by default for convenience
            setRuleIndices([{ indexId: '', coefficient: 0 }]);
        }
        setDialogOpen(true);
    };

    const handleAddIndexRow = () => {
        setRuleIndices([...ruleIndices, { indexId: '', coefficient: 0 }]);
    };

    const handleRemoveIndexRow = (index: number) => {
        const newIndices = [...ruleIndices];
        newIndices.splice(index, 1);
        setRuleIndices(newIndices);
    };

    const handleIndexChange = (index: number, field: 'indexId' | 'coefficient', value: string | number) => {
        const newIndices = [...ruleIndices];
        if (field === 'indexId') {
            newIndices[index].indexId = value as string;
        } else {
            newIndices[index].coefficient = Number(value);
        }
        setRuleIndices(newIndices);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !code.trim()) return;

        // Filter out incomplete rows
        const validIndices = ruleIndices.filter(i => i.indexId && i.coefficient !== 0);

        setIsSubmitting(true);
        try {
            const data = { name, code, description, type, nbMonths, indices: validIndices, activityId, p1Type };
            if (editingItem) {
                await updateRevisionRule(editingItem.id, data);
                toast({ title: "Succès", description: "Règle de révision mise à jour." });
            } else {
                await createRevisionRule(data);
                toast({ title: "Succès", description: "Règle de révision créée." });
            }
            await reloadData();
            setDialogOpen(false);
            resetForm();
        } catch (error) {
            toast({ title: "Erreur", description: "L'opération a échoué.", variant: "destructive" });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!itemToDelete) return;
        try {
            await deleteRevisionRule(itemToDelete.id);
            toast({ title: "Succès", description: "Règle de révision supprimée." });
            await reloadData();
            setItemToDelete(null);
        } catch (error) {
            toast({ title: "Erreur", description: "Impossible de supprimer la règle.", variant: "destructive" });
        }
    };

    // Helper to get index code by ID
    const getIndexCode = (id: string) => indices.find(i => i.id === id)?.code || id;

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle>Règles de Révision (P1)</CardTitle>
                        <CardDescription>Définissez les formules de révision des prix P1 (P1 = P0 * (a + b*I/I0 + ...)).</CardDescription>
                    </div>
                    <Button size="sm" className="gap-1" onClick={() => handleOpenDialog()}>
                        <PlusCircle className="h-4 w-4" /> Créer
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="border rounded-md">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Code</TableHead>
                                <TableHead>Nom</TableHead>
                                <TableHead>Formule (Aperçu)</TableHead>
                                <TableHead>Activité / Type</TableHead>
                                <TableHead className="w-[100px] text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow><TableCell colSpan={4} className="text-center h-24"><Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" /></TableCell></TableRow>
                            ) : revisionRules.length === 0 ? (
                                <TableRow><TableCell colSpan={4} className="text-center">Aucune règle de révision.</TableCell></TableRow>
                            ) : (
                                revisionRules.map(item => (
                                    <TableRow key={item.id}>
                                        <TableCell className="font-medium">{item.code}</TableCell>
                                        <TableCell>{item.name}</TableCell>
                                        <TableCell className="font-mono text-xs text-muted-foreground">
                                            {item.indices && item.indices.length > 0
                                                ? item.indices.map(i => `${i.coefficient} * (${getIndexCode(i.indexId)}/${getIndexCode(i.indexId)}0)`).join(' + ')
                                                : 'Aucune formule définie'}
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {item.activityId ? (() => {
                                                const act = activities.find(a => a.id === item.activityId);
                                                return act ? `${act.code} - ${act.label}` : '-';
                                            })() : '-'}
                                            {item.p1Type ? ` / ${item.p1Type}` : ''}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(item)}>
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Dialog open={!!itemToDelete && itemToDelete.id === item.id} onOpenChange={(isOpen) => !isOpen && setItemToDelete(null)}>
                                                <DialogTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setItemToDelete(item)}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </DialogTrigger>
                                                <DialogContent>
                                                    <DialogHeader>
                                                        <DialogTitle>Supprimer {itemToDelete?.code}</DialogTitle>
                                                        <DialogDescription>Cette action est irréversible.</DialogDescription>
                                                    </DialogHeader>
                                                    <DialogFooter>
                                                        <Button variant="outline" onClick={() => setItemToDelete(null)}>Annuler</Button>
                                                        <Button variant="destructive" onClick={handleDelete}>Confirmer</Button>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>

                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogContent className="sm:max-w-[600px]">
                        <DialogHeader>
                            <DialogTitle>{editingItem ? "Modifier la règle" : "Nouvelle règle de révision"}</DialogTitle>
                            <DialogDescription>
                                Configurez les indices et leurs coefficients pondéraux. La somme des coefficients devrait idéalement être égale à 1.
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="ruleCode">Code</Label>
                                    <Input id="ruleCode" value={code} onChange={e => setCode(e.target.value)} required placeholder="Ex: REV-GAZ" />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="ruleName">Nom</Label>
                                    <Input id="ruleName" value={name} onChange={e => setName(e.target.value)} required placeholder="Ex: Formule Gaz Standard" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="ruleDesc">Description</Label>
                                <Input id="ruleDesc" value={description} onChange={e => setDescription(e.target.value)} placeholder="Description optionnelle" />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Activité associée</Label>
                                    <Select value={activityId} onValueChange={setActivityId}>
                                        <SelectTrigger><SelectValue placeholder="Aucune (Générique)" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">Aucune (Générique)</SelectItem>
                                            {activities.map(a => (
                                                <SelectItem key={a.id} value={a.id}>{a.code} - {a.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                {activityId && activityId !== 'none' && activities.find(a => a.id === activityId)?.code.toUpperCase().startsWith('P1') && (
                                    <div className="space-y-2">
                                        <Label>Type P1</Label>
                                        <Select value={p1Type} onValueChange={setP1Type}>
                                            <SelectTrigger><SelectValue placeholder="Aucun" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">Aucun</SelectItem>
                                                <SelectItem value="CHAUFFAGE">Chauffage</SelectItem>
                                                <SelectItem value="ECS">ECS</SelectItem>
                                                <SelectItem value="EAU_FROIDE">Eau Froide</SelectItem>
                                                <SelectItem value="AUTRE">Autre</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <Label>Indices et Coefficients</Label>
                                    <Button type="button" variant="outline" size="sm" onClick={handleAddIndexRow}>
                                        <PlusCircle className="h-3 w-3 mr-1" /> Ajouter un indice
                                    </Button>
                                </div>
                                <div className="border rounded-md p-2 space-y-2 max-h-[200px] overflow-y-auto">
                                    {ruleIndices.map((row, index) => (
                                        <div key={index} className="flex items-center gap-2">
                                            <div className="flex-1">
                                                <Select value={row.indexId} onValueChange={(val) => handleIndexChange(index, 'indexId', val)}>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Choisir un indice" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {indices.map(idx => (
                                                            <SelectItem key={idx.id} value={idx.id}>
                                                                {idx.code} - {idx.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="w-[100px]">
                                                <Input
                                                    type="number"
                                                    step="0.0001"
                                                    placeholder="Coeff."
                                                    value={row.coefficient}
                                                    onChange={(e) => handleIndexChange(index, 'coefficient', e.target.value)}
                                                />
                                            </div>
                                            <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => handleRemoveIndexRow(index)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ))}
                                    {ruleIndices.length === 0 && (
                                        <p className="text-sm text-muted-foreground text-center py-2">Aucun indice défini.</p>
                                    )}
                                </div>
                                <p className="text-xs text-muted-foreground text-right">
                                    Somme des coefficients : {ruleIndices.reduce((sum, row) => sum + (Number(row.coefficient) || 0), 0).toFixed(4)}
                                </p>
                            </div>

                            <DialogFooter>
                                <DialogClose asChild><Button variant="outline">Annuler</Button></DialogClose>
                                <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Enregistrement..." : "Enregistrer"}</Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
};


// Section Règlements
const PaymentTermsSection = () => {
    const { toast } = useToast();
    const { paymentTerms, isLoading, reloadData } = useData();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<PaymentTerm | null>(null);
    const [itemToDelete, setItemToDelete] = useState<PaymentTerm | null>(null);
    const [code, setCode] = useState('');
    const [deadline, setDeadline] = useState('');

    const resetForm = () => { setCode(''); setDeadline(''); setEditingItem(null); };

    const handleOpenDialog = (item: PaymentTerm | null = null) => {
        setEditingItem(item);
        setCode(item ? item.code : '');
        setDeadline(item ? item.deadline : '');
        setDialogOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!code.trim() || !deadline.trim()) return;
        setIsSubmitting(true);
        try {
            const data = { code, deadline };
            if (editingItem) {
                await updatePaymentTerm(editingItem.id, data);
                toast({ title: "Succès", description: "Règlement mis à jour." });
            } else {
                await createPaymentTerm(data);
                toast({ title: "Succès", description: "Règlement créé." });
            }
            await reloadData(); setDialogOpen(false); resetForm();
        } catch (error) {
            toast({ title: "Erreur", description: "L'opération a échoué.", variant: "destructive" });
        } finally { setIsSubmitting(false); }
    };

    const handleDelete = async () => {
        if (!itemToDelete) return;
        try {
            await deletePaymentTerm(itemToDelete.id);
            toast({ title: "Succès", description: "Règlement supprimé." });
            await reloadData(); setItemToDelete(null);
        } catch (error) { toast({ title: "Erreur", description: "Impossible de supprimer le règlement.", variant: "destructive" }); }
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div><CardTitle>Règlements</CardTitle><CardDescription>Gérez les échéances de règlements.</CardDescription></div>
                    <Button size="sm" className="gap-1" onClick={() => handleOpenDialog()}><PlusCircle className="h-4 w-4" /> Créer</Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="border rounded-md">
                    <Table>
                        <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Échéance</TableHead><TableHead className="w-[100px] text-right">Actions</TableHead></TableRow></TableHeader>
                        <TableBody>
                            {isLoading ? (<TableRow><TableCell colSpan={3} className="text-center h-24"><Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" /></TableCell></TableRow>)
                                : paymentTerms.length === 0 ? (<TableRow><TableCell colSpan={3} className="text-center">Aucun règlement.</TableCell></TableRow>)
                                    : (paymentTerms.map(item => (
                                        <TableRow key={item.id}>
                                            <TableCell className="font-medium">{item.code}</TableCell>
                                            <TableCell>{item.deadline}</TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(item)}><Edit className="h-4 w-4" /></Button>
                                                <Dialog open={!!itemToDelete && itemToDelete.id === item.id} onOpenChange={(isOpen) => !isOpen && setItemToDelete(null)}>
                                                    <DialogTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setItemToDelete(item)}><Trash2 className="h-4 w-4" /></Button></DialogTrigger>
                                                    <DialogContent>
                                                        <DialogHeader><DialogTitle>Supprimer {itemToDelete?.code}</DialogTitle><DialogDescription>Cette action est irréversible.</DialogDescription></DialogHeader>
                                                        <DialogFooter><Button variant="outline" onClick={() => setItemToDelete(null)}>Annuler</Button><Button variant="destructive" onClick={handleDelete}>Confirmer</Button></DialogFooter>
                                                    </DialogContent>
                                                </Dialog>
                                            </TableCell>
                                        </TableRow>
                                    )))}
                        </TableBody>
                    </Table>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogContent>
                        <DialogHeader><DialogTitle>{editingItem ? "Modifier le règlement" : "Nouveau règlement"}</DialogTitle></DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2"><Label htmlFor="payCode">Code Règlement</Label><Input id="payCode" value={code} onChange={e => setCode(e.target.value)} required /></div>
                            <div className="space-y-2"><Label htmlFor="payDeadline">Échéance</Label><Input id="payDeadline" value={deadline} onChange={e => setDeadline(e.target.value)} required placeholder="Ex: 30 jours net" /></div>
                            <DialogFooter><DialogClose asChild><Button variant="outline">Annuler</Button></DialogClose><Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Enregistrement..." : "Enregistrer"}</Button></DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
};


// Generic CRUD Section for simple name-based entities
const SimpleCrudSection = ({
    title,
    description,
    dataType,
    items,
    createItem,
    updateItem,
    deleteItem,
}: {
    title: string;
    description: string;
    dataType: "schedule" | "term" | "typology";
    items: { id: string; name: string }[];
    createItem: (name: string) => Promise<any>;
    updateItem: (id: string, name: string) => Promise<void>;
    deleteItem: (id: string) => Promise<void>;
}) => {
    const { toast } = useToast();
    const { isLoading, reloadData } = useData();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<{ id: string; name: string } | null>(null);
    const [itemToDelete, setItemToDelete] = useState<{ id: string; name: string } | null>(null);
    const [name, setName] = useState('');

    const resetForm = () => { setName(''); setEditingItem(null); };

    const handleOpenDialog = (item: { id: string; name: string } | null = null) => {
        setEditingItem(item);
        setName(item ? item.name : '');
        setDialogOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        setIsSubmitting(true);
        try {
            if (editingItem) {
                await updateItem(editingItem.id, name);
                toast({ title: "Succès", description: `${title} mis à jour.` });
            } else {
                await createItem(name);
                toast({ title: "Succès", description: `${title} créé.` });
            }
            await reloadData();
            setDialogOpen(false);
            resetForm();
        } catch (error) {
            toast({ title: "Erreur", description: "L'opération a échoué.", variant: "destructive" });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!itemToDelete) return;
        try {
            await deleteItem(itemToDelete.id);
            toast({ title: "Succès", description: `${title} supprimé.` });
            await reloadData();
            setItemToDelete(null);
        } catch (error) {
            toast({ title: "Erreur", description: `Impossible de supprimer: ${title}.`, variant: "destructive" });
        }
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle>{title}</CardTitle>
                        <CardDescription>{description}</CardDescription>
                    </div>
                    <Button size="sm" className="gap-1" onClick={() => handleOpenDialog()}>
                        <PlusCircle className="h-4 w-4" /> Créer
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="border rounded-md">
                    <Table>
                        <TableHeader><TableRow><TableHead>Nom</TableHead><TableHead className="w-[100px] text-right">Actions</TableHead></TableRow></TableHeader>
                        <TableBody>
                            {isLoading ? (<TableRow><TableCell colSpan={2} className="text-center h-24"><Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" /></TableCell></TableRow>
                            ) : items.length === 0 ? (<TableRow><TableCell colSpan={2} className="text-center">Aucun élément.</TableCell></TableRow>
                            ) : (
                                items.map(item => (
                                    <TableRow key={item.id}>
                                        <TableCell className="font-medium">{item.name}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(item)}><Edit className="h-4 w-4" /></Button>
                                            <Dialog open={!!itemToDelete && itemToDelete.id === item.id} onOpenChange={(isOpen) => !isOpen && setItemToDelete(null)}>
                                                <DialogTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setItemToDelete(item)}><Trash2 className="h-4 w-4" /></Button>
                                                </DialogTrigger>
                                                <DialogContent>
                                                    <DialogHeader><DialogTitle>Supprimer {itemToDelete?.name}</DialogTitle><DialogDescription>Cette action est irréversible.</DialogDescription></DialogHeader>
                                                    <DialogFooter>
                                                        <Button variant="outline" onClick={() => setItemToDelete(null)}>Annuler</Button>
                                                        <Button variant="destructive" onClick={handleDelete}>Confirmer</Button>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogContent>
                        <DialogHeader><DialogTitle>{editingItem ? `Modifier: ${title}` : `Nouveau: ${title}`}</DialogTitle></DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2"><Label htmlFor={`${dataType}Name`}>Nom</Label><Input id={`${dataType}Name`} value={name} onChange={e => setName(e.target.value)} required /></div>
                            <DialogFooter>
                                <DialogClose asChild><Button variant="outline">Annuler</Button></DialogClose>
                                <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Enregistrement..." : "Enregistrer"}</Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
};


// ─── Helpers CSV ────────────────────────────────────────────────────────────
function parseCSV(text: string, mode: 'daily' | 'monthly'): { rows: { stationCode: string; date?: string; period?: string; value: number }[]; errors: string[] } {
    const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return { rows: [], errors: ['Fichier vide'] };
    // Detect separator
    const sep = lines[0].includes(';') ? ';' : ',';
    const header = lines[0].toLowerCase().split(sep).map(h => h.trim());
    const keyCol = mode === 'daily' ? 'date' : 'period';
    const keyIdx = header.indexOf(keyCol);
    const valIdx = header.indexOf('value');
    if (keyIdx === -1 || valIdx === -1) return { rows: [], errors: [`En-tête invalide : colonnes "${keyCol}" et "value" attendues`] };
    const rows: { stationCode: string; date?: string; period?: string; value: number }[] = [];
    const errors: string[] = [];
    lines.slice(1).forEach((line, i) => {
        const cols = line.split(sep);
        const rawKey = cols[keyIdx]?.trim();
        const rawVal = cols[valIdx]?.trim();
        const value = parseFloat(rawVal?.replace(',', '.') ?? '');
        if (!rawKey) { errors.push(`Ligne ${i + 2} : clé manquante`); return; }
        if (isNaN(value)) { errors.push(`Ligne ${i + 2} : valeur non numérique "${rawVal}"`); return; }
        if (mode === 'daily') {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(rawKey)) { errors.push(`Ligne ${i + 2} : format date invalide "${rawKey}" (attendu YYYY-MM-DD)`); return; }
            rows.push({ stationCode: '', date: rawKey, value });
        } else {
            if (!/^\d{4}-\d{2}$/.test(rawKey)) { errors.push(`Ligne ${i + 2} : format période invalide "${rawKey}" (attendu YYYY-MM)`); return; }
            rows.push({ stationCode: '', period: rawKey, value });
        }
    });
    return { rows, errors };
}

// ─── Section Stations Météo ──────────────────────────────────────────────────
const WeatherStationsSection = () => {
    const { toast } = useToast();
    const { weatherStations, isLoading, reloadData } = useData();
    const [isSubmitting, setIsSubmitting] = useState(false);

    // CRUD dialog
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingStation, setEditingStation] = useState<WeatherStation | null>(null);
    const [stationToDelete, setStationToDelete] = useState<WeatherStation | null>(null);
    const [wsCode, setWsCode] = useState('');
    const [wsName, setWsName] = useState('');
    const [wsDept, setWsDept] = useState('');
    const [wsRegion, setWsRegion] = useState('');
    const [wsRefDju, setWsRefDju] = useState<string>('');
    const [wsActive, setWsActive] = useState(true);

    // DJU monthly display
    const [expandedStationCode, setExpandedStationCode] = useState<string | null>(null);
    const [djuMonthly, setDjuMonthly] = useState<DjuMonthly[]>([]);
    const [djuYear, setDjuYear] = useState<string>('');

    // Import dialog
    const [importOpen, setImportOpen] = useState(false);
    const [importStep, setImportStep] = useState<1 | 2 | 3>(1);
    const [importStationCode, setImportStationCode] = useState('');
    const [importMode, setImportMode] = useState<'daily' | 'monthly'>('monthly');
    const [importParsed, setImportParsed] = useState<{ rows: { stationCode: string; date?: string; period?: string; value: number }[]; errors: string[] }>({ rows: [], errors: [] });
    const [isImporting, setIsImporting] = useState(false);
    const [importProgress, setImportProgress] = useState(0);

    // ── CRUD helpers ──
    const resetForm = () => { setWsCode(''); setWsName(''); setWsDept(''); setWsRegion(''); setWsRefDju(''); setWsActive(true); setEditingStation(null); };

    const handleOpenDialog = (station: WeatherStation | null = null) => {
        setEditingStation(station);
        if (station) {
            setWsCode(station.code);
            setWsName(station.name);
            setWsDept(station.department ?? '');
            setWsRegion(station.region ?? '');
            setWsRefDju(station.referenceDjuAnnual != null ? String(station.referenceDjuAnnual) : '');
            setWsActive(station.isActive);
        } else {
            resetForm();
        }
        setDialogOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!wsCode.trim() || !wsName.trim()) return;
        setIsSubmitting(true);
        const data = {
            code: wsCode.trim().toUpperCase(),
            name: wsName.trim(),
            department: wsDept.trim() || undefined,
            region: wsRegion.trim() || undefined,
            referenceDjuAnnual: wsRefDju !== '' ? parseFloat(wsRefDju) : undefined,
            isActive: wsActive,
        };
        try {
            if (editingStation) {
                await updateWeatherStation(editingStation.id, data);
                toast({ title: "Succès", description: "Station mise à jour." });
            } else {
                await createWeatherStation(data);
                toast({ title: "Succès", description: "Station créée." });
            }
            await reloadData();
            setDialogOpen(false);
            resetForm();
        } catch {
            toast({ title: "Erreur", description: "L'opération a échoué.", variant: "destructive" });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!stationToDelete) return;
        try {
            await deleteWeatherStation(stationToDelete.id);
            toast({ title: "Succès", description: "Station supprimée." });
            await reloadData();
            setStationToDelete(null);
        } catch {
            toast({ title: "Erreur", description: "Impossible de supprimer.", variant: "destructive" });
        }
    };

    // ── DJU expand ──
    const handleToggleExpand = async (code: string) => {
        if (expandedStationCode === code) { setExpandedStationCode(null); return; }
        setExpandedStationCode(code);
        const data = await getDjuMonthliesByStation(code);
        setDjuMonthly(data);
        const years = [...new Set(data.map(d => d.period.substring(0, 4)))].sort().reverse();
        setDjuYear(years[0] ?? '');
    };

    const djuYears = [...new Set(djuMonthly.map(d => d.period.substring(0, 4)))].sort().reverse();
    const filteredDju = djuYear ? djuMonthly.filter(d => d.period.startsWith(djuYear)) : djuMonthly;

    // ── Import helpers ──
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target?.result as string;
            const parsed = parseCSV(text, importMode);
            const withStation = parsed.rows.map(r => ({ ...r, stationCode: importStationCode }));
            setImportParsed({ rows: withStation, errors: parsed.errors });
        };
        reader.readAsText(file, 'UTF-8');
    };

    const resetImport = () => { setImportStep(1); setImportStationCode(''); setImportMode('monthly'); setImportParsed({ rows: [], errors: [] }); setImportProgress(0); };

    const handleConfirmImport = async () => {
        if (!importParsed.rows.length) return;
        setIsImporting(true);
        setImportProgress(0);
        try {
            await batchImportDjus(importParsed.rows, importMode);
            setImportProgress(100);
            toast({ title: "Succès", description: `${importParsed.rows.length} lignes importées.` });
            setImportOpen(false);
            resetImport();
            if (expandedStationCode === importStationCode) {
                const data = await getDjuMonthliesByStation(importStationCode);
                setDjuMonthly(data);
            }
        } catch {
            toast({ title: "Erreur", description: "Import échoué.", variant: "destructive" });
        } finally {
            setIsImporting(false);
        }
    };

    const templateDaily = "date;value\n2024-01-01;8.5\n2024-01-02;7.2";
    const templateMonthly = "period;value\n2024-01;280.5\n2024-02;310.0";

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle>Stations météo</CardTitle>
                        <CardDescription>Gérez les stations météo et importez les DJU.</CardDescription>
                    </div>
                    <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => { resetImport(); setImportOpen(true); }}>
                            <UploadCloud className="h-4 w-4" /> Importer DJU
                        </Button>
                        <Button size="sm" className="gap-1" onClick={() => handleOpenDialog()}>
                            <PlusCircle className="h-4 w-4" /> Créer
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="border rounded-md">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-8" />
                                <TableHead>Code</TableHead>
                                <TableHead>Nom</TableHead>
                                <TableHead>Département</TableHead>
                                <TableHead>DJU Référence</TableHead>
                                <TableHead>Actif</TableHead>
                                <TableHead className="w-[100px] text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow><TableCell colSpan={7} className="text-center h-24"><Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" /></TableCell></TableRow>
                            ) : weatherStations.length === 0 ? (
                                <TableRow><TableCell colSpan={7} className="text-center">Aucune station météo.</TableCell></TableRow>
                            ) : weatherStations.map(station => (
                                <React.Fragment key={station.id}>
                                    <TableRow>
                                        <TableCell>
                                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleToggleExpand(station.code)}>
                                                {expandedStationCode === station.code ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                            </Button>
                                        </TableCell>
                                        <TableCell className="font-mono font-medium">{station.code}</TableCell>
                                        <TableCell>{station.name}</TableCell>
                                        <TableCell>{station.department ?? '—'}</TableCell>
                                        <TableCell>{station.referenceDjuAnnual != null ? `${station.referenceDjuAnnual} DJU` : '—'}</TableCell>
                                        <TableCell>
                                            <Badge variant={station.isActive ? 'default' : 'secondary'}>{station.isActive ? 'Actif' : 'Inactif'}</Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(station)}><Edit className="h-4 w-4" /></Button>
                                            <Dialog open={!!stationToDelete && stationToDelete.id === station.id} onOpenChange={(open) => !open && setStationToDelete(null)}>
                                                <DialogTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setStationToDelete(station)}><Trash2 className="h-4 w-4" /></Button>
                                                </DialogTrigger>
                                                <DialogContent>
                                                    <DialogHeader><DialogTitle>Supprimer {stationToDelete?.name}</DialogTitle><DialogDescription>Cette action est irréversible.</DialogDescription></DialogHeader>
                                                    <DialogFooter>
                                                        <Button variant="outline" onClick={() => setStationToDelete(null)}>Annuler</Button>
                                                        <Button variant="destructive" onClick={handleDelete}>Confirmer</Button>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        </TableCell>
                                    </TableRow>
                                    {expandedStationCode === station.code && (
                                        <TableRow>
                                            <TableCell colSpan={7} className="bg-muted/30 p-4">
                                                <div className="space-y-3">
                                                    <div className="flex items-center justify-between">
                                                        <p className="text-sm font-medium">DJU mensuels — {station.name}</p>
                                                        <div className="flex items-center gap-2">
                                                            <Select value={djuYear} onValueChange={setDjuYear}>
                                                                <SelectTrigger className="w-28 h-7 text-xs"><SelectValue placeholder="Année" /></SelectTrigger>
                                                                <SelectContent>{djuYears.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
                                                            </Select>
                                                        </div>
                                                    </div>
                                                    {filteredDju.length === 0 ? (
                                                        <p className="text-sm text-muted-foreground">Aucune donnée DJU.</p>
                                                    ) : (
                                                        <div className="grid grid-cols-6 gap-2">
                                                            {filteredDju.sort((a, b) => a.period.localeCompare(b.period)).map(d => (
                                                                <div key={d.id} className="border rounded p-2 text-center">
                                                                    <p className="text-xs text-muted-foreground">{d.period}</p>
                                                                    <p className="font-medium text-sm">{d.value}</p>
                                                                    <p className="text-xs text-muted-foreground">{d.source}</p>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </React.Fragment>
                            ))}
                        </TableBody>
                    </Table>
                </div>

                {/* Create / Edit dialog */}
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{editingStation ? "Modifier la station" : "Nouvelle station météo"}</DialogTitle>
                        </DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="wsCode">Code *</Label>
                                    <Input id="wsCode" value={wsCode} onChange={e => setWsCode(e.target.value)} placeholder="NICE" required />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="wsDept">Département</Label>
                                    <Input id="wsDept" value={wsDept} onChange={e => setWsDept(e.target.value)} placeholder="06" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="wsName">Nom *</Label>
                                <Input id="wsName" value={wsName} onChange={e => setWsName(e.target.value)} placeholder="Nice Côte d'Azur" required />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="wsRegion">Région</Label>
                                    <Input id="wsRegion" value={wsRegion} onChange={e => setWsRegion(e.target.value)} placeholder="PACA" />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="wsRefDju">DJU Référence (trentenaire)</Label>
                                    <Input id="wsRefDju" type="number" value={wsRefDju} onChange={e => setWsRefDju(e.target.value)} placeholder="2000" />
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <Switch id="wsActive" checked={wsActive} onCheckedChange={setWsActive} />
                                <Label htmlFor="wsActive">Station active</Label>
                            </div>
                            <DialogFooter>
                                <DialogClose asChild><Button variant="outline" type="button">Annuler</Button></DialogClose>
                                <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Enregistrement..." : "Enregistrer"}</Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>

                {/* Import DJU dialog */}
                <Dialog open={importOpen} onOpenChange={(open) => { setImportOpen(open); if (!open) resetImport(); }}>
                    <DialogContent className="max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>Importer des DJU</DialogTitle>
                            <DialogDescription>Étape {importStep} / 3</DialogDescription>
                        </DialogHeader>

                        {importStep === 1 && (
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Station météo</Label>
                                    <Select value={importStationCode} onValueChange={setImportStationCode}>
                                        <SelectTrigger><SelectValue placeholder="Sélectionner une station" /></SelectTrigger>
                                        <SelectContent>
                                            {weatherStations.map(s => <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Type de données</Label>
                                    <Select value={importMode} onValueChange={v => setImportMode(v as 'daily' | 'monthly')}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="monthly">Mensuel (période YYYY-MM)</SelectItem>
                                            <SelectItem value="daily">Journalier (date YYYY-MM-DD)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label>Fichier CSV</Label>
                                        <a
                                            href={`data:text/csv;charset=utf-8,${encodeURIComponent(importMode === 'daily' ? templateDaily : templateMonthly)}`}
                                            download={`template_dju_${importMode}.csv`}
                                            className="text-xs text-primary underline"
                                        >
                                            Télécharger le modèle
                                        </a>
                                    </div>
                                    <Input type="file" accept=".csv,.txt" onChange={handleFileChange} />
                                    <p className="text-xs text-muted-foreground">
                                        {importMode === 'daily' ? 'Colonnes : date (YYYY-MM-DD) ; value' : 'Colonnes : period (YYYY-MM) ; value'}
                                        {' '}— Séparateur ; ou ,
                                    </p>
                                </div>
                                <DialogFooter>
                                    <Button variant="outline" onClick={() => setImportOpen(false)}>Annuler</Button>
                                    <Button
                                        disabled={!importStationCode || importParsed.rows.length === 0}
                                        onClick={() => setImportStep(2)}
                                    >
                                        Suivant
                                    </Button>
                                </DialogFooter>
                            </div>
                        )}

                        {importStep === 2 && (
                            <div className="space-y-4">
                                <div className="flex gap-4 text-sm">
                                    <span className="text-green-600 font-medium">{importParsed.rows.length} lignes valides</span>
                                    {importParsed.errors.length > 0 && <span className="text-destructive font-medium">{importParsed.errors.length} erreur(s)</span>}
                                </div>
                                {importParsed.errors.length > 0 && (
                                    <div className="border border-destructive/30 rounded p-3 max-h-32 overflow-y-auto space-y-1">
                                        {importParsed.errors.map((err, i) => <p key={i} className="text-xs text-destructive">{err}</p>)}
                                    </div>
                                )}
                                <div className="border rounded max-h-64 overflow-y-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>{importMode === 'daily' ? 'Date' : 'Période'}</TableHead>
                                                <TableHead>Valeur DJU</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {importParsed.rows.slice(0, 20).map((row, i) => (
                                                <TableRow key={i}>
                                                    <TableCell className="font-mono text-sm">{importMode === 'daily' ? row.date : row.period}</TableCell>
                                                    <TableCell>{row.value}</TableCell>
                                                </TableRow>
                                            ))}
                                            {importParsed.rows.length > 20 && (
                                                <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground text-xs">… et {importParsed.rows.length - 20} lignes supplémentaires</TableCell></TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                                <DialogFooter>
                                    <Button variant="outline" onClick={() => setImportStep(1)}>Retour</Button>
                                    <Button disabled={importParsed.rows.length === 0} onClick={() => setImportStep(3)}>Importer ({importParsed.rows.length} lignes)</Button>
                                </DialogFooter>
                            </div>
                        )}

                        {importStep === 3 && (
                            <div className="space-y-4">
                                <div className="text-sm space-y-1">
                                    <p><span className="text-muted-foreground">Station :</span> {importStationCode}</p>
                                    <p><span className="text-muted-foreground">Mode :</span> {importMode === 'daily' ? 'Journalier' : 'Mensuel'}</p>
                                    <p><span className="text-muted-foreground">Lignes :</span> {importParsed.rows.length}</p>
                                </div>
                                {isImporting && (
                                    <div className="space-y-2">
                                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                                            <div className="h-full bg-primary transition-all" style={{ width: `${importProgress}%` }} />
                                        </div>
                                        <p className="text-xs text-muted-foreground text-center">Import en cours…</p>
                                    </div>
                                )}
                                <DialogFooter>
                                    <Button variant="outline" onClick={() => setImportStep(2)} disabled={isImporting}>Retour</Button>
                                    <Button onClick={handleConfirmImport} disabled={isImporting}>
                                        {isImporting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Import…</> : 'Confirmer l\'import'}
                                    </Button>
                                </DialogFooter>
                            </div>
                        )}
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
};


export default function SettingsPage() {
    const { companies, agencies, activities, typologies, schedules, terms, reloadData } = useData();

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-lg font-medium">Paramétrage</h1>
                <p className="text-sm text-muted-foreground">
                    Configurez les entités de votre organisation.
                </p>
            </div>
            <Tabs defaultValue="companies" className="w-full">
                <TabsList className="flex-wrap h-auto justify-start">
                    <TabsTrigger value="companies">Sociétés</TabsTrigger>
                    <TabsTrigger value="agencies">Agences</TabsTrigger>
                    <TabsTrigger value="sectors">Secteurs</TabsTrigger>
                    <TabsTrigger value="activities">Activités</TabsTrigger>
                    <TabsTrigger value="meterTypes">Types de Compteurs</TabsTrigger>
                    <TabsTrigger value="pricing_rules">Règles de prix</TabsTrigger>
                    <TabsTrigger value="markets">Marchés</TabsTrigger>
                    <TabsTrigger value="typologies">Typologies</TabsTrigger>
                    <TabsTrigger value="schedules">Échéanciers</TabsTrigger>
                    <TabsTrigger value="terms">Termes</TabsTrigger>
                    <TabsTrigger value="vat_rates">Taux TVA</TabsTrigger>
                    <TabsTrigger value="revisions">Révisions</TabsTrigger>
                    <TabsTrigger value="payment_terms">Règlements</TabsTrigger>
                    <TabsTrigger value="weather_stations">Stations météo</TabsTrigger>
                </TabsList>
                <TabsContent value="companies">
                    <CompaniesSection onCompaniesUpdate={reloadData} />
                </TabsContent>
                <TabsContent value="agencies">
                    <AgenciesSection onAgenciesUpdate={reloadData} />
                </TabsContent>
                <TabsContent value="sectors">
                    <SectorsSection />
                </TabsContent>
                <TabsContent value="activities">
                    <ActivitiesSection />
                </TabsContent>
                <TabsContent value="meterTypes">
                    <MeterTypesSection />
                </TabsContent>
                <TabsContent value="pricing_rules">
                    <PricingRulesSection />
                </TabsContent>
                <TabsContent value="markets">
                    <MarketsSection />
                </TabsContent>
                <TabsContent value="typologies">
                    <SimpleCrudSection
                        title="Typologies"
                        description="Gérez les typologies de clients."
                        dataType="typology"
                        items={typologies}
                        createItem={createTypology}
                        updateItem={updateTypology}
                        deleteItem={deleteTypology}
                    />
                </TabsContent>
                <TabsContent value="schedules">
                    <SimpleCrudSection
                        title="Échéanciers"
                        description="Gérez les échéanciers de facturation."
                        dataType="schedule"
                        items={schedules}
                        createItem={createSchedule}
                        updateItem={updateSchedule}
                        deleteItem={deleteSchedule}
                    />
                </TabsContent>
                <TabsContent value="terms">
                    <SimpleCrudSection
                        title="Termes"
                        description="Gérez les termes de paiement."
                        dataType="term"
                        items={terms}
                        createItem={createTerm}
                        updateItem={updateTerm}
                        deleteItem={deleteTerm}
                    />
                </TabsContent>
                <TabsContent value="vat_rates">
                    <VatRatesSection />
                </TabsContent>
                <TabsContent value="revisions">
                    <RevisionRulesSection />
                </TabsContent>
                <TabsContent value="payment_terms">
                    <PaymentTermsSection />
                </TabsContent>
                <TabsContent value="weather_stations">
                    <WeatherStationsSection />
                </TabsContent>
            </Tabs>
        </div>
    );
}
