'use client';

import { useFormContext } from 'react-hook-form';
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Send } from 'lucide-react';
import { CHANNEL_LABELS, REGIME_LABELS, REGIME_SHORT_LABELS, resolveEInvoicing } from '@/lib/einvoicing';
import { EINVOICING_REGIMES, type Typology } from '@/lib/types';

const SOURCE_LABELS = {
    client: 'réglage de la fiche client',
    clientType: 'client public',
    typology: 'typologie du client',
    default: 'par défaut (client privé)',
} as const;

/**
 * Bloc « Facturation électronique » des formulaires client (création / édition).
 * À placer dans un <Form> (react-hook-form) dont le schéma étend ClientBaseSchema.
 */
export function ClientEInvoicingFields({ typologies }: { typologies: Typology[] }) {
    const form = useFormContext();
    const [clientType, typologyId, siret, useChorus, einvoicingRegime, einvoicingAddress] = form.watch([
        'clientType', 'typologyId', 'siret', 'useChorus', 'einvoicingRegime', 'einvoicingAddress',
    ]);
    const typology = typologies.find(t => t.id === typologyId);
    const resolution = resolveEInvoicing({
        client: { clientType, typologyId, siret, useChorus, einvoicingRegime, einvoicingAddress },
        typology,
    });
    // L'aperçu ne connaît ni la société ni le contrat : on ignore l'avertissement sur la date d'entrée en vigueur.
    const warnings = resolution.warnings.filter(w => !w.includes("Date d'entrée en vigueur"));
    const autoRegime = resolveEInvoicing({
        client: { clientType, typologyId, siret, useChorus, einvoicingRegime: 'auto' },
        typology,
    }).regime;

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-xl font-semibold">Facturation électronique</h2>
                <p className="text-sm text-muted-foreground">
                    Détermine si les factures de ce client passent par la plateforme agréée, Chorus Pro ou l'e-reporting.
                </p>
            </div>
            <div className="grid md:grid-cols-2 gap-8 items-start">
                <FormField control={form.control} name="einvoicingRegime" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Régime</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || 'auto'}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                                <SelectItem value="auto">Automatique ({REGIME_SHORT_LABELS[autoRegime]})</SelectItem>
                                {EINVOICING_REGIMES.map(r => <SelectItem key={r} value={r}>{REGIME_LABELS[r]}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <FormDescription>
                            « Automatique » : déduit du type public / privé et de la typologie (paramétrable dans Paramétrage → Typologies).
                        </FormDescription>
                        <FormMessage />
                    </FormItem>
                )} />
                {resolution.channel === 'pa' && (
                    <FormField control={form.control} name="einvoicingAddress" render={({ field }) => (
                        <FormItem>
                            <FormLabel>Adresse électronique de facturation</FormLabel>
                            <FormControl><Input placeholder="SIREN, SIREN_SIRET ou SIREN_SIRET_CODE" {...field} value={field.value ?? ''} /></FormControl>
                            <FormDescription>
                                Telle qu'inscrite par le client dans l'annuaire de la facturation électronique.
                                Vide : son SIREN est utilisé. Un contrat peut définir une adresse plus précise (service, site…).
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )} />
                )}
            </div>
            <Alert variant={resolution.blocking.length ? 'destructive' : 'default'}>
                <Send className="h-4 w-4" />
                <AlertTitle>
                    {CHANNEL_LABELS[resolution.channel]} — {REGIME_SHORT_LABELS[resolution.regime]} ({SOURCE_LABELS[resolution.regimeSource]})
                </AlertTitle>
                <AlertDescription>
                    {resolution.channel === 'pa' && (resolution.address
                        ? <p>Factures adressées à <strong>{resolution.address}</strong>{resolution.addressSource === 'siren' ? ' (SIREN du client)' : ''}.</p>
                        : null)}
                    {resolution.channel === 'chorus' && <p>Factures déposées sur Chorus Pro (SIRET et, le cas échéant, code service requis).</p>}
                    {resolution.channel === 'ereporting' && <p>Pas de facture électronique : les données de transaction relèvent de l'e-reporting.</p>}
                    {resolution.channel === 'none' && <p>Aucune transmission électronique.</p>}
                    {[...resolution.blocking, ...warnings].map(message => <p key={message}>• {message}</p>)}
                </AlertDescription>
            </Alert>
        </div>
    );
}
