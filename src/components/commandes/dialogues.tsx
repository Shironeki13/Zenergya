'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useData } from '@/context/data-context';
import { useToast } from '@/hooks/use-toast';
import { SEUILS_DEFAUT, controleSeuils, type SeuilsValidation } from '@/lib/commandes';
import { listFournisseursAction, saveFournisseurAction, setSeuilsAction, seuilsAction } from '@/lib/commandes-actions';
import type { Fournisseur } from '@/services/commandes-admin';

/** Fournisseurs : liste et création (code attribué, doublon de nom ou de SIRET refusé). */
export function FournisseursDialog({ open, onOpenChange, onChange }: { open: boolean; onOpenChange: (o: boolean) => void; onChange?: (f: Fournisseur) => void }) {
    const { toast } = useToast();
    const [liste, setListe] = useState<Fournisseur[] | null>(null);
    const [f, setF] = useState({ name: '', siret: '', email: '', phone: '' });
    const [busy, setBusy] = useState(false);
    const charger = useCallback(async () => { const r = await listFournisseursAction(); setListe(r.success ? r.data : []); }, []);
    useEffect(() => { if (open) charger(); }, [open, charger]);
    const creer = async () => {
        setBusy(true);
        const r = await saveFournisseurAction(f);
        setBusy(false);
        if (!r.success) { toast({ title: 'Fournisseur refusé', description: r.error, variant: 'destructive' }); return; }
        toast({ title: 'Fournisseur créé', description: `${r.data.code} — ${r.data.name}` });
        setF({ name: '', siret: '', email: '', phone: '' });
        onChange?.(r.data);
        await charger();
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>Fournisseurs</DialogTitle><DialogDescription>Fournisseurs des commandes d&apos;achat.</DialogDescription></DialogHeader>
                <div className="max-h-[40vh] overflow-y-auto rounded-md border">
                    {liste === null ? <Loader2 className="m-4 h-5 w-5 animate-spin" /> : liste.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Aucun fournisseur.</p> : (
                        <table className="w-full text-sm">
                            <thead><tr className="text-left text-xs text-muted-foreground"><th className="p-2 font-normal">Code</th><th className="p-2 font-normal">Nom</th><th className="p-2 font-normal">SIRET</th><th className="p-2 font-normal">Contact</th></tr></thead>
                            <tbody>{liste.map(x => <tr key={x.id} className="border-t"><td className="p-2 font-mono text-xs">{x.code}</td><td className="p-2">{x.name}</td><td className="p-2 font-mono text-xs">{x.siret ?? ''}</td><td className="p-2 text-xs">{[x.email, x.phone].filter(Boolean).join(' · ')}</td></tr>)}</tbody>
                        </table>
                    )}
                </div>
                <div className="grid grid-cols-2 gap-3 rounded-md border p-3">
                    <p className="col-span-2 text-sm font-medium">Nouveau fournisseur</p>
                    <div className="space-y-1"><Label htmlFor="frn-nom">Nom <span className="text-destructive">*</span></Label><Input id="frn-nom" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
                    <div className="space-y-1"><Label htmlFor="frn-siret">SIRET</Label><Input id="frn-siret" value={f.siret} onChange={e => setF({ ...f, siret: e.target.value })} placeholder="14 chiffres" /></div>
                    <div className="space-y-1"><Label htmlFor="frn-email">E-mail</Label><Input id="frn-email" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></div>
                    <div className="space-y-1"><Label htmlFor="frn-tel">Téléphone</Label><Input id="frn-tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></div>
                    <div className="col-span-2 flex justify-end"><Button size="sm" disabled={busy || !f.name.trim()} onClick={creer}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}Créer le fournisseur</Button></div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

/** Seuils de validation des commandes, par société (administrateur). */
export function SeuilsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
    const { companies } = useData();
    const { toast } = useToast();
    const [companyId, setCompanyId] = useState('');
    const [s, setS] = useState<SeuilsValidation>(SEUILS_DEFAUT);
    const [busy, setBusy] = useState(false);
    useEffect(() => { if (open && !companyId && companies[0]) setCompanyId(companies[0].id); }, [open, companyId, companies]);
    useEffect(() => { if (open && companyId) seuilsAction(companyId).then(r => { if (r.success) setS(r.data); }); }, [open, companyId]);
    const erreur = controleSeuils(s);
    const champ = (cle: keyof SeuilsValidation, libelle: string, aide: string) => (
        <div className="space-y-1">
            <Label htmlFor={`seuil-${cle}`}>{libelle}</Label>
            <Input id={`seuil-${cle}`} type="number" min={0} step={100} value={Number.isFinite(s[cle]) ? s[cle] : ''} onChange={e => setS({ ...s, [cle]: e.target.value === '' ? NaN : Number(e.target.value) })} />
            <p className="text-xs text-muted-foreground">{aide}</p>
        </div>
    );
    const enregistrer = async () => {
        setBusy(true);
        const r = await setSeuilsAction(companyId, s);
        setBusy(false);
        if (!r.success) { toast({ title: 'Seuils refusés', description: r.error, variant: 'destructive' }); return; }
        toast({ title: 'Seuils enregistrés' });
        onOpenChange(false);
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Seuils de validation des commandes</DialogTitle>
                    <DialogDescription>Selon le total HT de la commande. Ils s&apos;appliquent aux commandes soumises ensuite ; les responsables (N+1) se règlent dans Utilisateurs, le droit « Achats » sur les rôles.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    {companies.length > 1 && (
                        <div className="space-y-1"><Label htmlFor="seuil-societe">Société</Label>
                            <Select value={companyId} onValueChange={setCompanyId}><SelectTrigger id="seuil-societe"><SelectValue /></SelectTrigger>
                                <SelectContent>{companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
                    )}
                    {champ('auto', 'Autovalidation jusqu\'à (€ HT)', 'Jusqu\'à ce montant, la commande est validée à sa soumission. Au-delà : validation du responsable (N+1).')}
                    {champ('n2', 'N+2 au-delà de (€ HT)', 'Au-delà, le responsable du N+1 valide aussi.')}
                    {champ('achats', 'Achats au-delà de (€ HT)', 'Au-delà, un acheteur (rôle « Achats ») valide en dernier.')}
                    {erreur && <p className="text-sm text-destructive">{erreur}</p>}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
                    <Button disabled={busy || !!erreur || !companyId} onClick={enregistrer}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Enregistrer</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
