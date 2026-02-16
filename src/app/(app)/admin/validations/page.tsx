'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, CheckCircle, XCircle, Search, Eye } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useData } from '@/context/data-context';
import type { Contract } from '@/lib/types';
import { updateContract } from '@/services/firestore';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function ValidationsPage() {
    const { contracts, clients, companies, agencies, sectors, reloadData, isLoading } = useData();
    const { toast } = useToast();
    const router = useRouter();
    const [searchTerm, setSearchTerm] = useState('');
    const [contractToProcess, setContractToProcess] = useState<{ contract: Contract, action: 'validate' | 'reject' } | null>(null);
    const [refusalReason, setRefusalReason] = useState('');

    const pendingContracts = contracts.filter(c => c.validationStatus === 'pending_validation');

    const filteredContracts = pendingContracts.filter(c =>
        c.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.contractNumber?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleProcess = async () => {
        if (!contractToProcess) return;

        const { contract, action } = contractToProcess;
        const newStatus = action === 'validate' ? 'validated' : 'refused';

        // Validation for refusal reason
        if (action === 'reject' && !refusalReason.trim()) {
            toast({
                title: "Motif requis",
                description: "Veuillez indiquer un motif de refus.",
                variant: "destructive"
            });
            return;
        }

        try {
            await updateContract(contract.id, {
                validationStatus: newStatus,
                refusalReason: action === 'reject' ? refusalReason : undefined
            });

            toast({
                title: action === 'validate' ? "Contrat validé" : "Contrat refusé",
                description: `Le contrat pour ${contract.clientName} a été ${action === 'validate' ? 'validé' : 'refusé'}.`
            });
            await reloadData();
        } catch (error) {
            toast({
                title: "Erreur",
                description: "L'opération a échoué.",
                variant: "destructive"
            });
        } finally {
            setContractToProcess(null);
            setRefusalReason('');
        }
    };

    // Helper to get hierarchy string
    const getHierarchyString = (clientId: string) => {
        const client = clients.find(c => c.id === clientId);
        if (!client) return 'Client inconnu';

        const company = companies.find(c => c.id === client.companyId)?.name || '?';
        const agency = agencies.find(a => a.id === client.agencyId)?.name || '?';
        const sector = sectors.find(s => s.id === client.sectorId)?.name || '?';

        return `${company} > ${agency} > ${sector}`;
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Validation des Contrats</h1>
                    <p className="text-muted-foreground">
                        {pendingContracts.length} contrat(s) en attente de validation.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            type="search"
                            placeholder="Rechercher..."
                            className="pl-8 sm:w-[300px]"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>File d'attente</CardTitle>
                    <CardDescription>Validez ou refusez les nouveaux contrats créés.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Contrat & Client</TableHead>
                                <TableHead>Demandeur</TableHead>
                                <TableHead>Société / Agence / Secteur</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow>
                                    <TableCell colSpan={4} className="h-24 text-center">
                                        <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                                    </TableCell>
                                </TableRow>
                            ) : filteredContracts.length > 0 ? (
                                filteredContracts.map((contract) => (
                                    <TableRow key={contract.id}>
                                        <TableCell className="font-medium">
                                            <div className="flex flex-col">
                                                <span>{contract.clientName}</span>
                                                <span className="text-xs text-muted-foreground">{contract.contractNumber || 'Sans Numéro'}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col text-sm">
                                                <span>{contract.requesterEmail || 'Inconnu'}</span>
                                                <span className="text-xs text-muted-foreground">
                                                    {contract.createdAt ? new Date(contract.createdAt).toLocaleDateString() : 'N/A'}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {getHierarchyString(contract.clientId)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                <Button size="sm" variant="ghost" asChild>
                                                    <Link href={`/contracts/${contract.id}`} target="_blank">
                                                        <Eye className="h-4 w-4" />
                                                    </Link>
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    className="bg-green-600 hover:bg-green-700 text-white"
                                                    onClick={() => setContractToProcess({ contract, action: 'validate' })}
                                                >
                                                    <CheckCircle className="h-4 w-4 mr-1" /> Valider
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="destructive"
                                                    onClick={() => setContractToProcess({ contract, action: 'reject' })}
                                                >
                                                    <XCircle className="h-4 w-4 mr-1" /> Refuser
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center h-24 text-muted-foreground">
                                        Aucun contrat en attente.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Dialog open={!!contractToProcess} onOpenChange={(open) => !open && setContractToProcess(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {contractToProcess?.action === 'validate' ? 'Valider le contrat' : 'Refuser le contrat'}
                        </DialogTitle>
                        <DialogDescription>
                            {contractToProcess?.action === 'validate'
                                ? `Voulez-vous vraiment valider le contrat pour ${contractToProcess?.contract.clientName} ? Il deviendra visible pour tous les utilisateurs.`
                                : `Voulez-vous vraiment refuser le contrat pour ${contractToProcess?.contract.clientName} ?`
                            }
                        </DialogDescription>
                    </DialogHeader>

                    {contractToProcess?.action === 'reject' && (
                        <div className="grid w-full gap-1.5 py-4">
                            <Label htmlFor="message">Motif du Refus</Label>
                            <Textarea
                                placeholder="Indiquez pourquoi ce contrat est refusé (ex: SIRET incorrect, PDF illisible...)"
                                id="message"
                                value={refusalReason}
                                onChange={(e) => setRefusalReason(e.target.value)}
                            />
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setContractToProcess(null)}>Annuler</Button>
                        <Button
                            variant={contractToProcess?.action === 'validate' ? 'default' : 'destructive'}
                            onClick={handleProcess}
                        >
                            Confirmer
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
