'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { CheckCircle2, Loader2, MapPin, Pencil, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { trouverTiers, type Tiers } from '@/lib/billing/adressage';
import { enregistrerTiersAction, listerTiersAction } from '@/lib/tiers/actions';

/**
 * Adressage des factures d'un client : son représentant (syndic d'une copropriété), à qui la facture est adressée, et
 * son payeur quand ce n'est pas lui. Le nom saisi est rapproché de l'annuaire des tiers, qui porte l'adresse.
 */
export function ClientAdressageFields() {
    const form = useFormContext();
    const [tiers, setTiers] = useState<Tiers[]>([]);
    const [edition, setEdition] = useState<{ champ: 'representedBy' | 'payer'; tiers: Partial<Tiers> } | null>(null);
    const charger = useCallback(async () => { const r = await listerTiersAction(); if (r.success) setTiers(r.data); }, []);
    useEffect(() => { void charger(); }, [charger]);

    const champ = (name: 'representedBy' | 'payer', libelle: string, exemple: string, aide: string, qualite: string) => (
        <FormField control={form.control} name={name} render={({ field }) => {
            const nom = String(field.value ?? '').trim();
            const t = trouverTiers(tiers, nom);
            const complet = !!(t?.address && t?.city);
            return (
                <FormItem>
                    <FormLabel>{libelle}</FormLabel>
                    <FormControl><Input placeholder={exemple} list={`tiers-${name}`} autoComplete="off" {...field} value={field.value ?? ''} /></FormControl>
                    <datalist id={`tiers-${name}`}>{tiers.map(x => <option key={x.id} value={x.name}>{[x.quality, x.city].filter(Boolean).join(' · ')}</option>)}</datalist>
                    {!nom ? <FormDescription>{aide}</FormDescription> : (
                        <div data-adressage={name} className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2.5 py-1.5 text-xs ${complet ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
                            {complet
                                ? <><CheckCircle2 className="h-3.5 w-3.5 shrink-0" /><span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{[t!.address, `${t!.postalCode ?? ''} ${t!.city}`.trim()].join(', ')}{t!.quality ? ` · ${t!.quality}` : ''}</span></>
                                : <><TriangleAlert className="h-3.5 w-3.5 shrink-0" /><span>{name === 'representedBy' ? "Adresse inconnue : la facture partira à l'adresse du client." : 'Adresse du payeur inconnue.'}</span></>}
                            <Button type="button" variant="link" size="sm" className="ml-auto h-auto gap-1 p-0 text-xs" onClick={() => setEdition({ champ: name, tiers: t ?? { name: nom, quality: qualite } })}>
                                <Pencil className="h-3 w-3" />{complet ? 'Modifier' : "Renseigner l'adresse"}
                            </Button>
                        </div>
                    )}
                    <FormMessage />
                </FormItem>
            );
        }} />
    );

    return (
        <>
            {champ('representedBy', 'Représenté par', 'Syndic de copropriété, mandataire…', "Syndic ou mandataire à qui les factures sont adressées. Laisser vide si le client reçoit lui-même ses factures.", 'syndic')}
            {champ('payer', 'Payeur (si différent du client)', "Organisme ou société qui règle les factures", "À renseigner seulement quand un autre que le client règle les factures : il est mentionné sur la facture.", '')}
            <DialogueTiers edition={edition?.tiers ?? null} onClose={() => setEdition(null)} onSaved={async t => {
                if (edition) form.setValue(edition.champ, t.name, { shouldDirty: true });
                setEdition(null); await charger();
            }} />
        </>
    );
}

const VIDE = { name: '', quality: '', address: '', postalCode: '', city: '', siret: '', email: '', phone: '' };

export function DialogueTiers({ edition, onClose, onSaved }: { edition: Partial<Tiers> | null; onClose: () => void; onSaved: (t: Tiers) => void | Promise<void> }) {
    const { toast } = useToast();
    const [s, setS] = useState(VIDE);
    const [envoi, setEnvoi] = useState(false);
    useEffect(() => { if (edition) setS({ ...VIDE, ...Object.fromEntries(Object.entries(edition).filter(([k, v]) => k !== 'id' && v != null)) }); }, [edition]);
    const maj = (k: keyof typeof VIDE) => (e: React.ChangeEvent<HTMLInputElement>) => setS(x => ({ ...x, [k]: e.target.value }));
    const enregistrer = async () => {
        setEnvoi(true);
        const r = await enregistrerTiersAction(edition?.id ?? null, s);
        setEnvoi(false);
        if (!r.success) { toast({ variant: 'destructive', title: 'Enregistrement impossible', description: r.error }); return; }
        toast({ title: 'Tiers enregistré', description: 'Son adresse sera imprimée sur les prochaines factures.' });
        await onSaved(r.data);
    };
    const ligne = (k: keyof typeof VIDE, libelle: string, placeholder = '', classe = '') => (
        <div className={`space-y-1 ${classe}`}><Label htmlFor={`tiers-${k}`} className="text-xs">{libelle}</Label><Input id={`tiers-${k}`} value={s[k]} onChange={maj(k)} placeholder={placeholder} /></div>
    );
    return (
        <Dialog open={!!edition} onOpenChange={o => { if (!o) onClose(); }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{edition?.id ? 'Modifier le tiers' : 'Nouveau tiers'}</DialogTitle>
                    <DialogDescription>Un tiers est saisi une fois et sert à tous les clients qui le citent : un changement d&apos;adresse se fait ici.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-3 sm:grid-cols-6">
                    {ligne('name', 'Nom', 'Cabinet Durand', 'sm:col-span-4')}
                    {ligne('quality', 'Qualité', 'syndic', 'sm:col-span-2')}
                    {ligne('address', 'Adresse', '12 rue de la République', 'sm:col-span-6')}
                    {ligne('postalCode', 'Code postal', '69002', 'sm:col-span-2')}
                    {ligne('city', 'Ville', 'Lyon', 'sm:col-span-4')}
                    {ligne('siret', 'SIRET (facultatif)', '', 'sm:col-span-3')}
                    {ligne('phone', 'Téléphone (facultatif)', '', 'sm:col-span-3')}
                    {ligne('email', 'Adresse électronique (facultatif)', '', 'sm:col-span-6')}
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>Annuler</Button>
                    <Button type="button" onClick={enregistrer} disabled={envoi || s.name.trim().length < 2}>{envoi && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Enregistrer</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/** Fiche client : représentant et payeur, avec l'adresse qui sera imprimée (lignes d'une liste de définitions). */
export function LignesAdressage({ client }: { client: { representedBy?: string; payer?: string } }) {
    const [tiers, setTiers] = useState<Tiers[] | null>(null);
    const cite = !!(client.representedBy?.trim() || client.payer?.trim());
    useEffect(() => { if (cite) void listerTiersAction().then(r => setTiers(r.success ? r.data : [])); }, [cite]);
    const ligne = (libelle: string, nom: string | undefined, manque: string) => {
        if (!nom?.trim()) return null;
        const t = trouverTiers(tiers ?? [], nom);
        const complet = !!(t?.address && t?.city);
        return (
            <>
                <dt className="text-muted-foreground">{libelle}</dt>
                <dd>
                    {t?.name ?? nom}{t?.quality ? <span className="text-muted-foreground"> ({t.quality})</span> : null}
                    {tiers && (complet
                        ? <span className="block text-xs text-muted-foreground">{[t!.address, `${t!.postalCode ?? ''} ${t!.city}`.trim()].join(', ')}</span>
                        : <span className="flex items-center gap-1 text-xs text-amber-700"><TriangleAlert className="h-3 w-3" />{manque}</span>)}
                </dd>
            </>
        );
    };
    return <>{ligne('Représenté par', client.representedBy, "Adresse inconnue : factures envoyées à l'adresse du client")}{ligne('Payeur', client.payer, 'Adresse du payeur inconnue')}</>;
}
