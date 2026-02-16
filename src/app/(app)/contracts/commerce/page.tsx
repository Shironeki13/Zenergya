'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useData } from '@/context/data-context';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export default function CommercePage() {
    const { contracts, currentUser, isLoading } = useData();
    const router = useRouter();

    if (isLoading) {
        return (
            <div className="flex h-96 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    // Filter contracts requested by the current user
    const myRequests = contracts.filter(c =>
        c.requesterEmail === currentUser?.email &&
        (c.validationStatus === 'pending_validation' || c.validationStatus === 'refused')
    );

    // Sort: Refused first, then Pending
    myRequests.sort((a, b) => {
        if (a.validationStatus === 'refused' && b.validationStatus !== 'refused') return -1;
        if (a.validationStatus !== 'refused' && b.validationStatus === 'refused') return 1;
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Commerce - Mes Demandes</h1>
                    <p className="text-muted-foreground">
                        Suivez l'état de validation de vos contrats.
                    </p>
                </div>
                <Button asChild>
                    <Link href="/contracts/new">
                        Nouvelle Demande
                    </Link>
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Demandes en cours</CardTitle>
                    <CardDescription>
                        Consultez les refus et les validations en attente.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Contrat & Client</TableHead>
                                <TableHead>Date demande</TableHead>
                                <TableHead>Statut</TableHead>
                                <TableHead className="text-right">Action</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {myRequests.length > 0 ? (
                                myRequests.map((contract) => (
                                    <TableRow key={contract.id}>
                                        <TableCell className="font-medium">
                                            <div className="flex flex-col">
                                                <span>{contract.clientName}</span>
                                                <span className="text-xs text-muted-foreground">{contract.contractNumber || 'En cours de génération'}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {contract.createdAt ? new Date(contract.createdAt).toLocaleDateString() : 'N/A'}
                                        </TableCell>
                                        <TableCell>
                                            {contract.validationStatus === 'refused' ? (
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <div className="flex items-center gap-2 cursor-help">
                                                                <Badge variant="destructive" className="gap-1">
                                                                    <AlertCircle className="h-3 w-3" />
                                                                    Refusé
                                                                </Badge>
                                                                <span className="text-sm text-destructive underline decoration-dotted">
                                                                    Voir le motif
                                                                </span>
                                                            </div>
                                                        </TooltipTrigger>
                                                        <TooltipContent className="max-w-xs">
                                                            <p className="font-semibold">Motif du refus :</p>
                                                            <p>{contract.refusalReason || "Aucun motif précisé."}</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            ) : (
                                                <Badge variant="secondary" className="gap-1 animate-pulse">
                                                    <Clock className="h-3 w-3" />
                                                    En attente validation
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {contract.validationStatus === 'refused' && (
                                                <Button size="sm" asChild>
                                                    <Link href={`/contracts/${contract.id}/edit`}>
                                                        Corriger
                                                    </Link>
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center h-24 text-muted-foreground">
                                        Aucune demande en cours.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
