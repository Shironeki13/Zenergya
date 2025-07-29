

'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PlusCircle, Trash2, Edit, UploadCloud } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from '@/components/ui/textarea';

import { 
  createCompany, getCompanies, updateCompany, deleteCompany,
  createAgency, getAgencies, updateAgency, deleteAgency,
  createSector, getSectors, updateSector, deleteSector,
  createActivity, getActivities, updateActivity, deleteActivity,
  createSchedule, getSchedules, updateSchedule, deleteSchedule,
  createTerm, getTerms, updateTerm, deleteTerm,
  createTypology, getTypologies, updateTypology, deleteTypology,
  createVatRate, getVatRates, updateVatRate, deleteVatRate,
  createRevisionFormula, getRevisionFormulas, updateRevisionFormula, deleteRevisionFormula,
  createPaymentTerm, getPaymentTerms, updatePaymentTerm, deletePaymentTerm,
  createPricingRule, getPricingRules, updatePricingRule, deletePricingRule,
  createMarket, getMarkets, updateMarket, deleteMarket
} from "@/services/firestore";
import type { Company, Agency, Sector, Activity, Schedule, Term, VatRate, Typology, RevisionFormula, PaymentTerm, PricingRule, Market } from "@/lib/types";


const fileToDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// Section pour les Sociétés
const CompaniesSection = () => {
    const [companies, setCompanies] = useState<Company[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingCompany, setEditingCompany] = useState<Company | null>(null);
    const [companyToDelete, setCompanyToDelete] = useState<Company | null>(null);

    const [name, setName] = useState('');
    const [address, setAddress] = useState('');
    const [postalCode, setPostalCode] = useState('');
    const [city, setCity] = useState('');
    const [siret, setSiret] = useState('');
    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [logoPreview, setLogoPreview] = useState<string | null>(null);

    const loadCompanies = useCallback(async () => {
        try {
            setIsLoading(true);
            const fetchedCompanies = await getCompanies();
            setCompanies(fetchedCompanies);
        } catch (error) {
            toast({ title: "Erreur", description: "Impossible de charger les sociétés.", variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        loadCompanies();
    }, [loadCompanies]);

    const resetForm = () => {
        setName('');
        setAddress('');
        setPostalCode('');
        setCity('');
        setSiret('');
        setLogoFile(null);
        setLogoPreview(null);
        setEditingCompany(null);
    };

    const handleOpenDialog = (company: Company | null = null) => {
        setEditingCompany(company);
        if (company) {
            setName(company.name);
            setAddress(company.address || '');
            setPostalCode(company.postalCode || '');
            setCity(company.city || '');
            setSiret(company.siret || '');
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
        if (!name.trim()) return;
        setIsSubmitting(true);

        try {
            let logoUrl: string | undefined = editingCompany?.logoUrl;
            if (logoFile) {
                logoUrl = await fileToDataUrl(logoFile);
            }

            const companyData: Partial<Company> = { name, address, postalCode, city, siret, logoUrl };
            
            if (editingCompany) {
                await updateCompany(editingCompany.id, companyData);
                toast({ title: "Succès", description: "Société mise à jour." });
            } else {
                await createCompany(companyData as any);
                toast({ title: "Succès", description: "Société créée." });
            }
            
            await loadCompanies();
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
            await loadCompanies();
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
                <TableHead>Nom</TableHead>
                <TableHead>Adresse</TableHead>
                <TableHead>SIRET</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center">Chargement...</TableCell></TableRow>
              ) : companies.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center">Aucune société trouvée.</TableCell></TableRow>
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
                    <TableCell className="font-medium">{company.name}</TableCell>
                    <TableCell>
                        {company.address ? `${company.address}, ${company.postalCode} ${company.city}` : 'N/A'}
                    </TableCell>
                    <TableCell>{company.siret || 'N/A'}</TableCell>
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
                    <div className="space-y-2">
                        <Label htmlFor="name">Nom</Label>
                        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
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
                     <div className="space-y-2">
                        <Label htmlFor="siret">SIRET</Label>
                        <Input id="siret" value={siret} onChange={(e) => setSiret(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label>Logo</Label>
                        <div className="flex items-center gap-4">
                            <div className="h-20 w-20 border rounded-md flex items-center justify-center bg-muted overflow-hidden">
                                {logoPreview ? <Image src={logoPreview} alt="Aperçu" width={80} height={80} className="object-contain"/> : <UploadCloud className="h-8 w-8 text-muted-foreground" />}
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
const AgenciesSection = () => {
    const [agencies, setAgencies] = useState<Agency[]>([]);
    const [companies, setCompanies] = useState<Company[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingAgency, setEditingAgency] = useState<Agency | null>(null);
    const [agencyToDelete, setAgencyToDelete] = useState<Agency | null>(null);

    const [name, setName] = useState('');
    const [companyId, setCompanyId] = useState('');

    const loadData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [fetchedAgencies, fetchedCompanies] = await Promise.all([getAgencies(), getCompanies()]);
            setAgencies(fetchedAgencies);
            setCompanies(fetchedCompanies);
        } catch (error) {
            toast({ title: "Erreur", description: "Impossible de charger les données.", variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => { loadData(); }, [loadData]);
    
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
            await loadData();
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
            await loadData();
            setAgencyToDelete(null);
        } catch (error) {
            toast({ title: "Erreur", description: "Impossible de supprimer l'agence.", variant: "destructive" });
        }
    };

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
                            {isLoading ? ( <TableRow><TableCell colSpan={3} className="text-center">Chargement...</TableCell></TableRow>
                            ) : agencies.length === 0 ? ( <TableRow><TableCell colSpan={3} className="text-center">Aucune agence.</TableCell></TableRow>
                            ) : (
                                agencies.map(agency => (
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
    const [sectors, setSectors] = useState<Sector[]>([]);
    const [agencies, setAgencies] = useState<Agency[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingSector, setEditingSector] = useState<Sector | null>(null);
    const [sectorToDelete, setSectorToDelete] = useState<Sector | null>(null);

    const [name, setName] = useState('');
    const [agencyId, setAgencyId] = useState('');

    const loadData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [fetchedSectors, fetchedAgencies] = await Promise.all([getSectors(), getAgencies()]);
            setSectors(fetchedSectors);
            setAgencies(fetchedAgencies);
        } catch (error) { toast({ title: "Erreur", description: "Impossible de charger les données.", variant: "destructive" }); } 
        finally { setIsLoading(false); }
    }, [toast]);

    useEffect(() => { loadData(); }, [loadData]);
    
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
            await loadData();
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
            await loadData();
            setSectorToDelete(null);
        } catch (error) {
            toast({ title: "Erreur", description: "Impossible de supprimer le secteur.", variant: "destructive" });
        }
    };

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
                            {isLoading ? ( <TableRow><TableCell colSpan={3} className="text-center">Chargement...</TableCell></TableRow>
                            ) : sectors.length === 0 ? ( <TableRow><TableCell colSpan={3} className="text-center">Aucun secteur.</TableCell></TableRow>
                            ) : (
                                sectors.map(sector => (
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
                                    <SelectContent>{agencies.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.companyName})</SelectItem>)}</SelectContent>
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
const ActivitiesSection = () => {
    const [activities, setActivities] = useState<Activity[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
    const [activityToDelete, setActivityToDelete] = useState<Activity | null>(null);
    const [code, setCode] = useState('');
    const [label, setLabel] = useState('');

    const loadActivities = useCallback(async () => {
        setIsLoading(true);
        try {
            setActivities(await getActivities());
        } catch (error) { toast({ title: "Erreur", description: "Impossible de charger les activités.", variant: "destructive" }); } 
        finally { setIsLoading(false); }
    }, [toast]);

    useEffect(() => { loadActivities(); }, [loadActivities]);
    
    const resetForm = () => { setCode(''); setLabel(''); setEditingActivity(null); };

    const handleOpenDialog = (activity: Activity | null = null) => {
        setEditingActivity(activity);
        setCode(activity ? activity.code : '');
        setLabel(activity ? activity.label : '');
        setDialogOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!code.trim() || !label.trim()) return;
        setIsSubmitting(true);
        try {
            if (editingActivity) {
                await updateActivity(editingActivity.id, { code, label });
                toast({ title: "Succès", description: "Activité mise à jour." });
            } else {
                await createActivity({ code, label });
                toast({ title: "Succès", description: "Activité créée." });
            }
            await loadActivities();
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
            await loadActivities();
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
                        <TableHeader><TableRow><TableHead className="w-[150px]">Code</TableHead><TableHead>Libellé</TableHead><TableHead className="w-[100px] text-right">Actions</TableHead></TableRow></TableHeader>
                        <TableBody>
                            {isLoading ? ( <TableRow><TableCell colSpan={3} className="text-center">Chargement...</TableCell></TableRow>
                            ) : activities.length === 0 ? ( <TableRow><TableCell colSpan={3} className="text-center">Aucune activité.</TableCell></TableRow>
                            ) : (
                                activities.map(activity => (
                                    <TableRow key={activity.id}>
                                        <TableCell className="font-medium">{activity.code}</TableCell>
                                        <TableCell>{activity.label}</TableCell>
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

// Section Règles de prix
const PricingRulesSection = () => {
    const [rules, setRules] = useState<PricingRule[]>([]);
    const [activities, setActivities] = useState<Activity[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingRule, setEditingRule] = useState<PricingRule | null>(null);
    const [ruleToDelete, setRuleToDelete] = useState<PricingRule | null>(null);

    const [activityId, setActivityId] = useState('');
    const [rule, setRule] = useState('');
    const [description, setDescription] = useState('');

    const loadData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [fetchedRules, fetchedActivities] = await Promise.all([getPricingRules(), getActivities()]);
            setRules(fetchedRules);
            setActivities(fetchedActivities);
        } catch (error) {
            toast({ title: "Erreur", description: "Impossible de charger les données.", variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => { loadData(); }, [loadData]);
    
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
            await loadData();
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
            await loadData();
            setRuleToDelete(null);
        } catch (error) {
            toast({ title: "Erreur", description: "Impossible de supprimer la règle.", variant: "destructive" });
        }
    };

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
                            {isLoading ? ( <TableRow><TableCell colSpan={4} className="text-center">Chargement...</TableCell></TableRow>
                            ) : rules.length === 0 ? ( <TableRow><TableCell colSpan={4} className="text-center">Aucune règle de prix.</TableCell></TableRow>
                            ) : (
                                rules.map(item => (
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
    const [items, setItems] = useState<Market[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<Market | null>(null);
    const [itemToDelete, setItemToDelete] = useState<Market | null>(null);
    const [code, setCode] = useState('');
    const [label, setLabel] = useState('');
    const [description, setDescription] = useState('');

    const loadItems = useCallback(async () => {
        setIsLoading(true);
        try {
            setItems(await getMarkets());
        } catch (error) { toast({ title: "Erreur", description: "Impossible de charger les marchés.", variant: "destructive" }); } 
        finally { setIsLoading(false); }
    }, [toast]);

    useEffect(() => { loadItems(); }, [loadItems]);
    
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
            await loadItems();
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
            await loadItems();
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
                            {isLoading ? ( <TableRow><TableCell colSpan={4} className="text-center">Chargement...</TableCell></TableRow>
                            ) : items.length === 0 ? ( <TableRow><TableCell colSpan={4} className="text-center">Aucun marché.</TableCell></TableRow>
                            ) : (
                                items.map(item => (
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
    const [vatRates, setVatRates] = useState<VatRate[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingVatRate, setEditingVatRate] = useState<VatRate | null>(null);
    const [vatRateToDelete, setVatRateToDelete] = useState<VatRate | null>(null);
    const [code, setCode] = useState('');
    const [rate, setRate] = useState<number | string>('');

    const loadVatRates = useCallback(async () => {
        setIsLoading(true);
        try {
            setVatRates(await getVatRates());
        } catch (error) { toast({ title: "Erreur", description: "Impossible de charger les taux de TVA.", variant: "destructive" }); } 
        finally { setIsLoading(false); }
    }, [toast]);

    useEffect(() => { loadVatRates(); }, [loadVatRates]);
    
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
            await loadVatRates();
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
            await loadVatRates();
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
                            {isLoading ? ( <TableRow><TableCell colSpan={3} className="text-center">Chargement...</TableCell></TableRow>
                            ) : vatRates.length === 0 ? ( <TableRow><TableCell colSpan={3} className="text-center">Aucun taux de TVA.</TableCell></TableRow>
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

// Section Formules de révision
const RevisionFormulasSection = () => {
    const [items, setItems] = useState<RevisionFormula[]>([]);
    const [activities, setActivities] = useState<Activity[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<RevisionFormula | null>(null);
    const [itemToDelete, setItemToDelete] = useState<RevisionFormula | null>(null);
    const [code, setCode] = useState('');
    const [formula, setFormula] = useState('');
    const [activityId, setActivityId] = useState('');

    const loadItems = useCallback(async () => {
        setIsLoading(true);
        try {
            const [formulas, acts] = await Promise.all([
                getRevisionFormulas(),
                getActivities()
            ]);
            setItems(formulas);
            setActivities(acts);
        } 
        catch (error) { toast({ title: "Erreur", description: "Impossible de charger les données.", variant: "destructive" }); } 
        finally { setIsLoading(false); }
    }, [toast]);

    useEffect(() => { loadItems(); }, [loadItems]);

    const resetForm = () => { setCode(''); setFormula(''); setActivityId(''); setEditingItem(null); };

    const handleOpenDialog = (item: RevisionFormula | null = null) => {
        setEditingItem(item);
        setCode(item ? item.code : '');
        setFormula(item ? item.formula : '');
        setActivityId(item ? item.activityId : '');
        setDialogOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!code.trim() || !formula.trim() || !activityId) return;
        setIsSubmitting(true);
        try {
            const data = { code, formula, activityId };
            if (editingItem) {
                await updateRevisionFormula(editingItem.id, data);
                toast({ title: "Succès", description: "Formule mise à jour." });
            } else {
                await createRevisionFormula(data);
                toast({ title: "Succès", description: "Formule créée." });
            }
            await loadItems(); setDialogOpen(false); resetForm();
        } catch (error) { toast({ title: "Erreur", description: "L'opération a échoué.", variant: "destructive" });
        } finally { setIsSubmitting(false); }
    };

    const handleDelete = async () => {
        if (!itemToDelete) return;
        try {
            await deleteRevisionFormula(itemToDelete.id);
            toast({ title: "Succès", description: "Formule supprimée." });
            await loadItems(); setItemToDelete(null);
        } catch (error) { toast({ title: "Erreur", description: "Impossible de supprimer la formule.", variant: "destructive" }); }
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div><CardTitle>Formules de Révision</CardTitle><CardDescription>Gérez les formules de révision pour les contrats.</CardDescription></div>
                    <Button size="sm" className="gap-1" onClick={() => handleOpenDialog()}><PlusCircle className="h-4 w-4" /> Créer</Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="border rounded-md">
                    <Table>
                        <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Activité</TableHead><TableHead>Formule</TableHead><TableHead className="w-[100px] text-right">Actions</TableHead></TableRow></TableHeader>
                        <TableBody>
                            {isLoading ? (<TableRow><TableCell colSpan={4} className="text-center">Chargement...</TableCell></TableRow>) 
                            : items.length === 0 ? (<TableRow><TableCell colSpan={4} className="text-center">Aucune formule.</TableCell></TableRow>) 
                            : (items.map(item => (
                                <TableRow key={item.id}>
                                    <TableCell className="font-medium">{item.code}</TableCell>
                                    <TableCell>{item.activityCode} - {item.activityLabel}</TableCell>
                                    <TableCell className="font-mono text-xs">{item.formula}</TableCell>
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
                        <DialogHeader><DialogTitle>{editingItem ? "Modifier la formule" : "Nouvelle formule"}</DialogTitle></DialogHeader>
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
                            <div className="space-y-2"><Label htmlFor="revCode">Code Formule</Label><Input id="revCode" value={code} onChange={e => setCode(e.target.value)} required /></div>
                            <div className="space-y-2"><Label htmlFor="revFormula">Formule</Label><Textarea id="revFormula" value={formula} onChange={e => setFormula(e.target.value)} required rows={4} className="font-mono"/></div>
                            <DialogFooter><DialogClose asChild><Button variant="outline">Annuler</Button></DialogClose><Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Enregistrement..." : "Enregistrer"}</Button></DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
};


// Section Règlements
const PaymentTermsSection = () => {
    const [items, setItems] = useState<PaymentTerm[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<PaymentTerm | null>(null);
    const [itemToDelete, setItemToDelete] = useState<PaymentTerm | null>(null);
    const [code, setCode] = useState('');
    const [deadline, setDeadline] = useState('');

    const loadItems = useCallback(async () => {
        setIsLoading(true);
        try { setItems(await getPaymentTerms()); } 
        catch (error) { toast({ title: "Erreur", description: "Impossible de charger les règlements.", variant: "destructive" }); } 
        finally { setIsLoading(false); }
    }, [toast]);

    useEffect(() => { loadItems(); }, [loadItems]);

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
            await loadItems(); setDialogOpen(false); resetForm();
        } catch (error) { toast({ title: "Erreur", description: "L'opération a échoué.", variant: "destructive" });
        } finally { setIsSubmitting(false); }
    };

    const handleDelete = async () => {
        if (!itemToDelete) return;
        try {
            await deletePaymentTerm(itemToDelete.id);
            toast({ title: "Succès", description: "Règlement supprimé." });
            await loadItems(); setItemToDelete(null);
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
                            {isLoading ? (<TableRow><TableCell colSpan={3} className="text-center">Chargement...</TableCell></TableRow>) 
                            : items.length === 0 ? (<TableRow><TableCell colSpan={3} className="text-center">Aucun règlement.</TableCell></TableRow>) 
                            : (items.map(item => (
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
                            <div className="space-y-2"><Label htmlFor="payDeadline">Échéance</Label><Input id="payDeadline" value={deadline} onChange={e => setDeadline(e.target.value)} required placeholder="Ex: 30 jours net"/></div>
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
  getItems,
  createItem,
  updateItem,
  deleteItem,
}: {
  title: string;
  description: string;
  dataType: "schedule" | "term" | "typology";
  getItems: () => Promise<{ id: string; name: string }[]>;
  createItem: (name: string) => Promise<any>;
  updateItem: (id: string, name: string) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
}) => {
    const [items, setItems] = useState<{ id: string; name: string }[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<{ id: string; name: string } | null>(null);
    const [itemToDelete, setItemToDelete] = useState<{ id: string; name: string } | null>(null);
    const [name, setName] = useState('');

    const loadItems = useCallback(async () => {
        setIsLoading(true);
        try {
            setItems(await getItems());
        } catch (error) { toast({ title: "Erreur", description: `Impossible de charger les ${title.toLowerCase()}.`, variant: "destructive" }); } 
        finally { setIsLoading(false); }
    }, [getItems, title, toast]);

    useEffect(() => { loadItems(); }, [loadItems]);
    
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
            await loadItems();
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
            await loadItems();
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
                            {isLoading ? ( <TableRow><TableCell colSpan={2} className="text-center">Chargement...</TableCell></TableRow>
                            ) : items.length === 0 ? ( <TableRow><TableCell colSpan={2} className="text-center">Aucun élément.</TableCell></TableRow>
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


export default function SettingsPage() {
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
          <TabsTrigger value="pricing_rules">Règles de prix</TabsTrigger>
          <TabsTrigger value="markets">Marchés</TabsTrigger>
          <TabsTrigger value="typologies">Typologies</TabsTrigger>
          <TabsTrigger value="schedules">Échéanciers</TabsTrigger>
          <TabsTrigger value="terms">Termes</TabsTrigger>
          <TabsTrigger value="vat_rates">Taux TVA</TabsTrigger>
          <TabsTrigger value="revisions">Révisions</TabsTrigger>
          <TabsTrigger value="payment_terms">Règlements</TabsTrigger>
        </TabsList>
        <TabsContent value="companies">
          <CompaniesSection />
        </TabsContent>
        <TabsContent value="agencies">
          <AgenciesSection />
        </TabsContent>
        <TabsContent value="sectors">
          <SectorsSection />
        </TabsContent>
        <TabsContent value="activities">
          <ActivitiesSection />
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
                getItems={getTypologies}
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
                getItems={getSchedules}
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
                getItems={getTerms}
                createItem={createTerm}
                updateItem={updateTerm}
                deleteItem={deleteTerm}
            />
        </TabsContent>
        <TabsContent value="vat_rates">
            <VatRatesSection />
        </TabsContent>
        <TabsContent value="revisions">
            <RevisionFormulasSection />
        </TabsContent>
        <TabsContent value="payment_terms">
            <PaymentTermsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
