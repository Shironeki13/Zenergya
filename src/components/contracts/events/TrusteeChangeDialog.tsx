import { useState, useEffect } from "react";
import { PieceJustificative, deposerPiece, pieceValide } from './piece-justificative';
import { signalerErreurs } from '@/lib/forms/signaler-erreurs';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { optionsClients } from '@/lib/select-options';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createTrusteeChange } from "@/services/firestore";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { useData } from "@/context/data-context";
import { trouverTiers, type Tiers } from "@/lib/billing/adressage";
import { listerTiersAction } from "@/lib/tiers/actions";

const formSchema = z.object({
    newRepresentative: z.string().min(1, "Nouveau syndic requis"),
    newAddress: z.string().optional(),
    newPostalCode: z.string().optional(),
    newCity: z.string().optional(),
    contactEmail: z.string().email("Email invalide").optional().or(z.literal('')),
    effectiveDate: z.string().min(1, "Date requise"),
});

interface TrusteeChangeDialogProps {
    contractId?: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}

export function TrusteeChangeDialog({ contractId, open, onOpenChange, onSuccess }: TrusteeChangeDialogProps) {
    const { toast } = useToast();
    const { clients, contracts, currentUser } = useData();
    const [piece, setPiece] = useState<File | null>(null);
    const [erreurPiece, setErreurPiece] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const [selectedClientId, setSelectedClientId] = useState<string>("");
    const [selectedContractId, setSelectedContractId] = useState<string>(contractId || "");

    useEffect(() => {
        if (contractId) {
            setSelectedContractId(contractId);
        } else {
            setSelectedContractId("");
            setSelectedClientId("");
        }
    }, [contractId, open]);

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            newRepresentative: "",
            newAddress: "", newPostalCode: "", newCity: "",
            contactEmail: "",
            effectiveDate: new Date().toISOString().split('T')[0],
        },
    });

    // Annuaire des tiers : un syndic déjà connu apporte son adresse.
    const [tiers, setTiers] = useState<Tiers[]>([]);
    useEffect(() => { if (open) void listerTiersAction().then(r => { if (r.success) setTiers(r.data); }); }, [open]);
    const nomSaisi = form.watch('newRepresentative');
    const connu = trouverTiers(tiers, nomSaisi);
    const adresseConnue = !!(connu?.address && connu?.city);
    const contratChoisi = contracts.find(c => c.id === selectedContractId);
    const sortant = clients.find(c => c.id === contratChoisi?.clientId)?.representedBy?.trim() ?? '';

    async function onSubmit(values: z.infer<typeof formSchema>) {
        if (!selectedContractId) return;
        // Pièce justificative obligatoire : c'est elle qui fait foi.
        if (!pieceValide(piece)) { setErreurPiece(true); return; }

        setIsLoading(true);
        try {
            const document = await deposerPiece(piece, selectedContractId, 'changements-syndic');
            await createTrusteeChange({
                contractId: selectedContractId,
                newRepresentative: connu?.name ?? values.newRepresentative.trim(),
                ...(values.newAddress?.trim() && values.newCity?.trim() && { newAddress: values.newAddress.trim(), newPostalCode: values.newPostalCode?.trim() ?? '', newCity: values.newCity.trim() }),
                contactEmail: values.contactEmail,
                effectiveDate: values.effectiveDate,
                createdAt: new Date().toISOString(),
                createdBy: currentUser?.email ?? 'inconnu', ...document, validationStatus: 'pending_validation',
                ...(sortant && { currentRepresentative: sortant }),
            });
            toast({ title: "Changement de syndic enregistré", description: "Enregistré, en attente de validation par un administrateur." });
            form.reset();
            setPiece(null);
            onSuccess();
            onOpenChange(false);
        } catch (error) {
            console.error(error);
            toast({ title: "Erreur", description: "Impossible d'enregistrer le changement.", variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    }

    const filteredContracts = contracts.filter(c => c.clientId === selectedClientId && c.status === 'Actif');

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Changement de Syndic</DialogTitle>
                </DialogHeader>

                {!contractId && !selectedContractId ? (
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Client</label>
                            <SearchableSelect value={selectedClientId} onValueChange={setSelectedClientId} options={optionsClients(clients)} placeholder="Sélectionner un client" searchPlaceholder="Nom, code client, SIRET, ville…" />
                        </div>

                        {selectedClientId && (
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Contrat</label>
                                <Select value={selectedContractId} onValueChange={setSelectedContractId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Sélectionner un contrat" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {filteredContracts.length > 0 ? (
                                            filteredContracts.map(contract => (
                                                <SelectItem key={contract.id} value={contract.id}>{contract.contractNumber || contract.name || 'Contrat sans nom'}</SelectItem>
                                            ))
                                        ) : (
                                            <SelectItem value="none" disabled>Aucun contrat actif</SelectItem>
                                        )}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    </div>
                ) : (
                    <Form {...form} schema={formSchema}>
                        <form onSubmit={form.handleSubmit(onSubmit, signalerErreurs)} className="space-y-4">
                            <FormField
                                control={form.control}
                                name="newRepresentative"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Nouveau Syndic</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Nom du syndic" list="syndics-connus" autoComplete="off" {...field} />
                                        </FormControl>
                                        <datalist id="syndics-connus">{tiers.map(t => <option key={t.id} value={t.name}>{[t.quality, t.city].filter(Boolean).join(' · ')}</option>)}</datalist>
                                        {sortant && <p className="text-xs text-muted-foreground">Syndic actuel : {sortant}</p>}
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            {adresseConnue ? (
                                <p data-syndic="connu" className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-900">
                                    Syndic connu : les factures partiront au {[connu!.address, `${connu!.postalCode ?? ''} ${connu!.city}`.trim()].join(', ')}.
                                </p>
                            ) : (
                                <div className="space-y-2 rounded-md border p-3" data-syndic="adresse">
                                    <p className="text-xs text-muted-foreground">Adresse du nouveau syndic : c&apos;est là que partiront les factures. Sans elle, elles restent adressées à la copropriété.</p>
                                    <FormField control={form.control} name="newAddress" render={({ field }) => (
                                        <FormItem><FormLabel>Adresse</FormLabel><FormControl><Input placeholder="12 rue de la République" {...field} /></FormControl><FormMessage /></FormItem>
                                    )} />
                                    <div className="grid grid-cols-3 gap-2">
                                        <FormField control={form.control} name="newPostalCode" render={({ field }) => (
                                            <FormItem><FormLabel>Code postal</FormLabel><FormControl><Input placeholder="69002" {...field} /></FormControl><FormMessage /></FormItem>
                                        )} />
                                        <FormField control={form.control} name="newCity" render={({ field }) => (
                                            <FormItem className="col-span-2"><FormLabel>Ville</FormLabel><FormControl><Input placeholder="Lyon" {...field} /></FormControl><FormMessage /></FormItem>
                                        )} />
                                    </div>
                                </div>
                            )}
                            <FormField
                                control={form.control}
                                name="contactEmail"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Email Contact</FormLabel>
                                        <FormControl>
                                            <Input type="email" placeholder="contact@syndic.com" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="effectiveDate"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Date d'effet</FormLabel>
                                        <FormControl>
                                            <Input type="date" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <PieceJustificative fichier={piece} onChange={f => { setPiece(f); setErreurPiece(false); }} erreur={erreurPiece} />
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
                                <Button type="submit" disabled={isLoading}>
                                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Enregistrer
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                )}
            </DialogContent>
        </Dialog>
    );
}

