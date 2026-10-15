'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useData } from '@/context/data-context';
import { updateContract } from '@/services/firestore';
import { CHANNEL_LABELS, REGIME_SHORT_LABELS, resolveEInvoicing } from '@/lib/einvoicing';
import type { Client, Contract } from '@/lib/types';

const ADDRESS_FORMAT = /^\d{9}(_[A-Za-z0-9.-]+){0,2}$/;

/**
 * Facturation électronique au niveau du contrat : adresse de facturation propre au contrat
 * (service, site, code de routage…), prioritaire sur celle du client.
 */
export function ContractEInvoicingCard({ contract, client, onSaved }: { contract: Contract; client: Client | null; onSaved: () => void }) {
    const { typologies, companies } = useData();
    const { toast } = useToast();
    const [address, setAddress] = useState(contract.einvoicingAddress ?? '');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => { setAddress(contract.einvoicingAddress ?? ''); }, [contract.einvoicingAddress]);

    if (!client) return null;

    const typology = typologies.find(t => t.id === client.typologyId);
    const company = companies.find(c => c.id === (contract.companyId || client.companyId));
    const resolution = resolveEInvoicing({ client, typology, contract: { einvoicingAddress: address }, company });
    const invalid = address.trim() !== '' && !ADDRESS_FORMAT.test(address.trim());
    const dirty = address.trim() !== (contract.einvoicingAddress ?? '');

    const save = async () => {
        setIsSaving(true);
        try {
            await updateContract(contract.id, { einvoicingAddress: address.trim() });
            toast({ title: 'Enregistré', description: "Adresse de facturation électronique du contrat mise à jour." });
            onSaved();
        } catch {
            toast({ title: 'Erreur', description: "Enregistrement impossible.", variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    Facturation électronique
                    <Badge variant="outline">{CHANNEL_LABELS[resolution.channel]}</Badge>
                    <Badge variant="secondary">{REGIME_SHORT_LABELS[resolution.regime]}</Badge>
                </CardTitle>
                <CardDescription>
                    Régime et adresse par défaut définis sur la <Link className="underline" href={`/clients/${client.id}/edit`}>fiche client</Link>.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {resolution.channel === 'pa' ? (
                    <>
                        <div className="space-y-2">
                            <Label htmlFor="contractEinvoicingAddress">Adresse électronique de facturation propre au contrat (facultatif)</Label>
                            <div className="flex gap-2">
                                <Input
                                    id="contractEinvoicingAddress"
                                    placeholder={client.einvoicingAddress || 'SIREN_SIRET_CODE (service, site…)'}
                                    value={address}
                                    onChange={e => setAddress(e.target.value)}
                                />
                                <Button onClick={save} disabled={!dirty || invalid || isSaving}>{isSaving ? 'Enregistrement…' : 'Enregistrer'}</Button>
                            </div>
                            {invalid && <p className="text-sm text-destructive">Format attendu : SIREN (9 chiffres), éventuellement suivi de _SIRET et/ou _code de routage.</p>}
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Factures de ce contrat adressées à <strong>{resolution.address ?? '—'}</strong>
                            {resolution.addressSource === 'contract' && ' (adresse du contrat)'}
                            {resolution.addressSource === 'client' && ' (adresse du client)'}
                            {resolution.addressSource === 'siren' && ' (SIREN du client)'}.
                        </p>
                    </>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        {resolution.channel === 'chorus' && 'Factures déposées sur Chorus Pro (client public).'}
                        {resolution.channel === 'ereporting' && "Pas de facture électronique pour ce client : e-reporting."}
                        {resolution.channel === 'none' && 'Aucune transmission électronique.'}
                    </p>
                )}
                {[...resolution.blocking, ...resolution.warnings].map(m => (
                    <p key={m} className={resolution.blocking.includes(m) ? 'text-sm text-destructive' : 'text-sm text-amber-600'}>• {m}</p>
                ))}
            </CardContent>
        </Card>
    );
}
