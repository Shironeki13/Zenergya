'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle2, ChevronLeft, Circle, Loader2, Plus, Send, Trash2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import { useConfirm, usePrompt } from '@/components/confirm-provider';
import { FournisseursDialog } from '@/components/commandes/dialogues';
import { useData } from '@/context/data-context';
import { useToast } from '@/hooks/use-toast';
import {
    LIBELLE_ETAPE, LIBELLE_NATURE_ACHAT, LIBELLE_STATUT, NATURES_ACHAT, SEUILS_DEFAUT, SUITE, annulable, etapeEnCours, factureHT, modifiable, peutDecider, rolesRequis,
    totalCommande, type CibleCommande, type Commande, type NatureAchat, type SeuilsValidation,
} from '@/lib/commandes';
import {
    annulerCommandeAction, avancerCommandeAction, deciderCommandeAction, factureFournisseurAction, getCommandeAction, listFournisseursAction, saveCommandeAction,
    seuilsAction, soumettreCommandeAction,
} from '@/lib/commandes-actions';
import { cibleDeCle, cleDeCible, useCiblesAnalytiques } from '@/components/commandes/cibles';
import type { Fournisseur } from '@/services/commandes-admin';

/**
 * Fiche d'une commande d'achat : saisie (brouillon ou refusée) des lignes avec leur affectation analytique (affaire de
 * travaux, ou contrat et activité) ; soumission ; circuit de validation ; passage au fournisseur, réception, factures
 * fournisseurs (le réel) ; annulation.
 */

type LigneSaisie = { id?: string; label: string; quantity: string; unitPrice: string; nature: NatureAchat; cible: string };
const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const num = (v: string) => Number(String(v).replace(/\s/g, '').replace(',', '.'));
const jour = (d?: string) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');
const aujourdhui = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });

export default function CommandePage() {
    const { id } = useParams<{ id: string }>();
    const nouvelle = id === 'nouvelle';
    const router = useRouter();
    const { toast } = useToast();
    const confirmer = useConfirm();
    const demander = usePrompt();
    const { companies, currentUser, authUser, isAdmin, isAcheteur } = useData();
    const moi = (authUser ?? currentUser)?.id ?? '';

    const [commande, setCommande] = useState<Commande | null>(null);
    const [chargement, setChargement] = useState(!nouvelle);
    const [busy, setBusy] = useState(false);
    const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
    const [dialogueFrn, setDialogueFrn] = useState(false);
    const [seuils, setSeuils] = useState<SeuilsValidation>(SEUILS_DEFAUT);
    // Saisie
    const [companyId, setCompanyId] = useState('');
    const [supplierId, setSupplierId] = useState('');
    const [title, setTitle] = useState('');
    const [date, setDate] = useState(aujourdhui());
    const [deliveryDate, setDeliveryDate] = useState('');
    const [notes, setNotes] = useState('');
    const [lignes, setLignes] = useState<LigneSaisie[]>([{ label: '', quantity: '1', unitPrice: '', nature: 'FOURNITURE', cible: '' }]);
    const [facture, setFacture] = useState({ numero: '', date: aujourdhui(), montantHT: '', solder: false });

    const remplir = useCallback((c: Commande) => {
        setCommande(c); setCompanyId(c.companyId); setSupplierId(c.supplierId); setTitle(c.title); setDate(c.date); setDeliveryDate(c.deliveryDate ?? ''); setNotes(c.notes ?? '');
        setLignes(c.lines.map(l => ({ id: l.id, label: l.label, quantity: String(l.quantity), unitPrice: String(l.unitPrice), nature: l.nature, cible: cleDeCible(l.cible) })));
    }, []);
    const charger = useCallback(async () => {
        if (nouvelle) return;
        const r = await getCommandeAction(id);
        setChargement(false);
        if (r.success) remplir(r.data); else toast({ title: 'Commande introuvable', description: r.error, variant: 'destructive' });
    }, [id, nouvelle, remplir, toast]);
    useEffect(() => { charger(); }, [charger]);
    useEffect(() => {
        listFournisseursAction().then(r => { if (r.success) setFournisseurs(r.data); });
    }, []);
    useEffect(() => { if (!companyId && companies[0]) setCompanyId(companies[0].id); }, [companyId, companies]);
    useEffect(() => { if (companyId) seuilsAction(companyId).then(r => { if (r.success) setSeuils(r.data); }); }, [companyId]);

    const cibles = useCiblesAnalytiques(companyId);

    const total = totalCommande(lignes.map(l => ({ quantity: num(l.quantity) || 0, unitPrice: num(l.unitPrice) || 0 })));
    const etapesPrevues = rolesRequis(total, seuils);
    const editable = nouvelle || (!!commande && modifiable(commande.status) && (commande.requesterId === moi || isAdmin));
    const majLigne = (i: number, p: Partial<LigneSaisie>) => setLignes(ls => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));

    const exec = async (titre: string, action: () => Promise<{ success: true; data: Commande } | { success: false; error: string }>) => {
        setBusy(true);
        const r = await action();
        setBusy(false);
        if (!r.success) { toast({ title: 'Opération impossible', description: r.error, variant: 'destructive' }); return null; }
        toast({ title: titre, description: r.data.number });
        remplir(r.data);
        return r.data;
    };
    const saisie = () => ({
        ...(commande && { id: commande.id }), companyId, supplierId, title, date, ...(deliveryDate && { deliveryDate }), notes,
        lines: lignes.map(l => ({ ...(l.id && { id: l.id }), label: l.label, quantity: num(l.quantity), unitPrice: num(l.unitPrice), nature: l.nature, cible: cibleDeCle(l.cible) as CibleCommande })),
    });
    const enregistrer = async () => {
        const c = await exec('Brouillon enregistré', () => saveCommandeAction(saisie()));
        if (c && nouvelle) router.replace(`/purchases/${c.id}`);
        return c;
    };
    const soumettre = async () => {
        setBusy(true);
        const s = await saveCommandeAction(saisie());
        if (!s.success) { setBusy(false); toast({ title: 'Commande incomplète', description: s.error, variant: 'destructive' }); return; }
        const r = await soumettreCommandeAction(s.data.id);
        setBusy(false);
        if (!r.success) { remplir(s.data); if (nouvelle) router.replace(`/purchases/${s.data.id}`); toast({ title: 'Soumission impossible', description: r.error, variant: 'destructive' }); return; }
        toast({ title: r.data.status === 'validee' ? 'Commande validée (sous le seuil d\'autovalidation)' : 'Commande soumise à validation', description: r.data.number });
        remplir(r.data);
        if (nouvelle) router.replace(`/purchases/${r.data.id}`);
    };
    const decider = async (decision: 'validee' | 'refusee') => {
        if (!commande) return;
        const commentaire = decision === 'refusee'
            ? await demander({ title: `Refuser la commande ${commande.number}`, description: 'Le demandeur voit le motif, corrige et soumet à nouveau.', label: 'Motif du refus', required: true, multiline: true, confirmLabel: 'Refuser' })
            : await demander({ title: `Valider la commande ${commande.number}`, description: `${commande.supplierName} — ${eur(commande.totalHT)} HT.`, label: 'Commentaire (facultatif)', confirmLabel: 'Valider' });
        if (commentaire === null) return;
        await exec(decision === 'validee' ? 'Étape validée' : 'Commande refusée', () => deciderCommandeAction(commande.id, decision, commentaire));
    };
    const annuler = async () => {
        if (!commande) return;
        const motif = await demander({ title: `Annuler la commande ${commande.number ?? ''}`, description: 'Une commande annulée ne compte plus dans l\'engagé.', label: 'Motif', required: true, multiline: true, confirmLabel: 'Annuler la commande' });
        if (motif) await exec('Commande annulée', () => annulerCommandeAction(commande.id, motif));
    };
    const ajouterFacture = async () => {
        if (!commande) return;
        const c = await exec('Facture fournisseur enregistrée', () => factureFournisseurAction(commande.id, { numero: facture.numero, date: facture.date, montantHT: num(facture.montantHT), solder: facture.solder }));
        if (c) setFacture({ numero: '', date: aujourdhui(), montantHT: '', solder: false });
    };

    if (chargement) return <Loader2 className="mx-auto mt-24 h-8 w-8 animate-spin" />;
    if (!nouvelle && !commande) return <p className="text-muted-foreground">Commande introuvable. <Link className="underline" href="/purchases">Retour</Link></p>;

    const enCours = commande ? etapeEnCours(commande) : null;
    const droit = commande ? peutDecider(commande, { id: moi, isAdmin, isAcheteur }) : { ok: false };
    const suite = commande ? SUITE[commande.status] : undefined;
    const peutAvancer = !!commande && (commande.requesterId === moi || isAdmin || isAcheteur);

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2">
                        <Link href="/purchases" className="text-muted-foreground hover:text-primary" aria-label="Retour aux commandes"><ChevronLeft className="h-4 w-4" /></Link>
                        <h1 className="text-2xl font-bold tracking-tight">{nouvelle ? 'Nouvelle commande' : commande!.number ? <span className="font-mono">{commande!.number}</span> : 'Commande (brouillon)'}</h1>
                        {commande && <Badge variant={commande.status === 'refusee' ? 'destructive' : commande.status === 'a_valider' ? 'default' : 'secondary'}>{LIBELLE_STATUT[commande.status]}</Badge>}
                    </div>
                    {commande && <p className="mt-1 text-sm text-muted-foreground">Demandée par {commande.requesterName}{commande.submittedAt ? `, soumise le ${jour(commande.submittedAt)}` : ''}{commande.externalRef ? ` — importée, référence ${commande.externalRef}` : ''}{commande.cancelReason ? ` — annulée : ${commande.cancelReason}` : ''}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                    {editable && <Button variant="outline" disabled={busy} onClick={enregistrer}>Enregistrer le brouillon</Button>}
                    {editable && <Button disabled={busy} onClick={soumettre}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}Soumettre</Button>}
                    {commande && droit.ok && (<>
                        <Button variant="outline" className="text-destructive" disabled={busy} onClick={() => decider('refusee')}><XCircle className="mr-1 h-4 w-4" />Refuser</Button>
                        <Button className="bg-green-700 hover:bg-green-800" disabled={busy} onClick={() => decider('validee')}><CheckCircle2 className="mr-1 h-4 w-4" />Valider{'secours' in droit && droit.secours ? ' (secours)' : ''}</Button>
                    </>)}
                    {commande && suite && peutAvancer && <Button disabled={busy} onClick={async () => { if (await confirmer({ title: suite === 'passee' ? 'Commande passée au fournisseur ?' : 'Commande reçue ?', confirmLabel: 'Confirmer' })) await exec(suite === 'passee' ? 'Commande passée' : 'Commande reçue', () => avancerCommandeAction(commande.id)); }}>{suite === 'passee' ? 'Passée au fournisseur' : 'Marquer reçue'}</Button>}
                    {commande && annulable(commande.status) && commande.status !== 'brouillon' && peutAvancer && factureHT(commande) === 0 && <Button variant="ghost" className="text-destructive" disabled={busy} onClick={annuler}>Annuler</Button>}
                </div>
            </div>

            {commande?.status === 'refusee' && <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">Refusée : {commande.etapes.find(e => e.decision === 'refusee')?.commentaire}. Corrigez puis soumettez à nouveau.</p>}

            <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Commande</CardTitle></CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-4">
                    {companies.length > 1 && (
                        <div className="space-y-1"><Label htmlFor="cmd-societe">Société</Label>
                            <Select value={companyId} onValueChange={setCompanyId} disabled={!editable}><SelectTrigger id="cmd-societe"><SelectValue /></SelectTrigger>
                                <SelectContent>{companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
                    )}
                    <div className="space-y-1 md:col-span-2">
                        <Label htmlFor="cmd-fournisseur">Fournisseur <span className="text-destructive">*</span></Label>
                        <div className="flex gap-2">
                            <SearchableSelect id="cmd-fournisseur" className="flex-1" value={supplierId} onValueChange={setSupplierId} disabled={!editable} placeholder="Choisir un fournisseur…"
                                options={fournisseurs.filter(f => f.active !== false || f.id === supplierId).map(f => ({ value: f.id, label: f.name, description: f.code }))} />
                            {editable && <Button type="button" variant="outline" size="icon" title="Nouveau fournisseur" onClick={() => setDialogueFrn(true)}><Plus className="h-4 w-4" /></Button>}
                        </div>
                    </div>
                    <div className="space-y-1"><Label htmlFor="cmd-date">Date <span className="text-destructive">*</span></Label><Input id="cmd-date" type="date" value={date} disabled={!editable} onChange={e => setDate(e.target.value)} /></div>
                    <div className="space-y-1 md:col-span-3"><Label htmlFor="cmd-objet">Objet <span className="text-destructive">*</span></Label><Input id="cmd-objet" value={title} disabled={!editable} onChange={e => setTitle(e.target.value)} placeholder="ex. Circulateur et accessoires" /></div>
                    <div className="space-y-1"><Label htmlFor="cmd-livraison">Livraison souhaitée</Label><Input id="cmd-livraison" type="date" value={deliveryDate} disabled={!editable} onChange={e => setDeliveryDate(e.target.value)} /></div>
                    <div className="space-y-1 md:col-span-4"><Label htmlFor="cmd-notes">Notes</Label><Textarea id="cmd-notes" rows={2} value={notes} disabled={!editable} onChange={e => setNotes(e.target.value)} /></div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
                    <div>
                        <CardTitle className="text-base">Lignes</CardTitle>
                        <CardDescription>Chaque ligne est affectée à une affaire de travaux ou à un contrat (et une activité) : c&apos;est son code analytique, figé à la soumission.</CardDescription>
                    </div>
                    {editable && <Button variant="outline" size="sm" onClick={() => setLignes(ls => [...ls, { label: '', quantity: '1', unitPrice: '', nature: 'FOURNITURE', cible: ls[ls.length - 1]?.cible ?? '' }])}><Plus className="mr-1 h-4 w-4" />Ligne</Button>}
                </CardHeader>
                <CardContent className="overflow-x-auto">
                    <table className="w-full min-w-[900px] text-sm">
                        <thead><tr className="text-left text-xs text-muted-foreground">
                            <th className="pb-1 font-normal">Désignation</th><th className="pb-1 font-normal">Nature</th><th className="w-[30%] pb-1 font-normal">Affectation analytique</th>
                            <th className="pb-1 text-right font-normal">Quantité</th><th className="pb-1 text-right font-normal">PU HT</th><th className="pb-1 text-right font-normal">Total HT</th><th />
                        </tr></thead>
                        <tbody>
                            {lignes.map((l, i) => {
                                const figee = commande?.lines.find(x => x.id === l.id);
                                return (
                                    <tr key={i} className="border-t align-top">
                                        <td className="py-1.5 pr-2"><Input aria-label={`Désignation de la ligne ${i + 1}`} value={l.label} disabled={!editable} onChange={e => majLigne(i, { label: e.target.value })} /></td>
                                        <td className="py-1.5 pr-2">
                                            <Select value={l.nature} disabled={!editable} onValueChange={v => majLigne(i, { nature: v as NatureAchat })}>
                                                <SelectTrigger aria-label={`Nature de la ligne ${i + 1}`} className="w-[150px]"><SelectValue /></SelectTrigger>
                                                <SelectContent>{NATURES_ACHAT.map(n => <SelectItem key={n} value={n}>{LIBELLE_NATURE_ACHAT[n]}</SelectItem>)}</SelectContent>
                                            </Select>
                                        </td>
                                        <td className="py-1.5 pr-2">
                                            {editable
                                                ? <SearchableSelect aria-label={`Affectation de la ligne ${i + 1}`} className="w-full" value={l.cible} onValueChange={v => majLigne(i, { cible: v })} options={cibles} placeholder="Affaire ou contrat…" />
                                                : <div><p>{figee?.cible.libelle ?? '—'}</p>{figee?.analytique && <p className="break-all font-mono text-[11px] text-muted-foreground">{figee.analytique.code}</p>}</div>}
                                        </td>
                                        <td className="py-1.5 pr-2"><Input aria-label={`Quantité de la ligne ${i + 1}`} className="w-20 text-right" inputMode="decimal" value={l.quantity} disabled={!editable} onChange={e => majLigne(i, { quantity: e.target.value })} /></td>
                                        <td className="py-1.5 pr-2"><Input aria-label={`Prix unitaire de la ligne ${i + 1}`} className="w-28 text-right" inputMode="decimal" value={l.unitPrice} disabled={!editable} onChange={e => majLigne(i, { unitPrice: e.target.value })} /></td>
                                        <td className="py-1.5 pr-2 text-right font-medium">{eur(Math.round((num(l.quantity) || 0) * (num(l.unitPrice) || 0) * 100) / 100)}</td>
                                        <td className="py-1.5">{editable && lignes.length > 1 && <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label={`Supprimer la ligne ${i + 1}`} onClick={() => setLignes(ls => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>}</td>
                                    </tr>
                                );
                            })}
                            <tr className="border-t font-semibold"><td colSpan={5} className="py-2 text-right">Total HT</td><td className="py-2 pr-2 text-right">{eur(total)}</td><td /></tr>
                        </tbody>
                    </table>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Validation</CardTitle>
                    <CardDescription>
                        Seuils de la société : autovalidation jusqu&apos;à {eur(seuils.auto)}, N+2 au-delà de {eur(seuils.n2)}, achats au-delà de {eur(seuils.achats)}.
                    </CardDescription>
                </CardHeader>
                <CardContent className="text-sm">
                    {editable || !commande ? (
                        <p>{etapesPrevues.length === 0 ? `Total de ${eur(total)} : la commande sera validée à la soumission (autovalidation).` : `Total de ${eur(total)} : à la soumission, validation par ${etapesPrevues.map(r => LIBELLE_ETAPE[r]).join(', puis ')}.`}</p>
                    ) : commande.importee ? (
                        <p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-700" />Commande importée (référence {commande.externalRef}), validée hors Zenergya ; entrée le {jour(commande.validatedAt)} par {commande.importedBy}.</p>
                    ) : commande.autoValidee ? (
                        <p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-700" />Validée à la soumission (sous le seuil d&apos;autovalidation), le {jour(commande.validatedAt)}.</p>
                    ) : (
                        <ol className="space-y-2">
                            {commande.etapes.map((e, i) => (
                                <li key={i} className="flex items-start gap-2">
                                    {e.decision === 'validee' ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-700" /> : e.decision === 'refusee' ? <XCircle className="mt-0.5 h-4 w-4 text-destructive" /> : <Circle className={`mt-0.5 h-4 w-4 ${e === enCours ? 'text-primary' : 'text-muted-foreground'}`} />}
                                    <div>
                                        <p className="font-medium">{LIBELLE_ETAPE[e.role]}{e.approverName ? ` : ${e.approverName}` : ''}{e === enCours ? ' — en attente' : ''}</p>
                                        {e.decision && <p className="text-xs text-muted-foreground">{e.decision === 'validee' ? 'Validée' : 'Refusée'} le {jour(e.decideLe)}{e.decideParNom ? ` par ${e.decideParNom}` : ''}{e.secours ? ' (administrateur, en secours)' : ''}{e.commentaire ? ` — ${e.commentaire}` : ''}</p>}
                                    </div>
                                </li>
                            ))}
                        </ol>
                    )}
                    {commande && !droit.ok && enCours && 'raison' in droit && <p className="mt-2 text-xs text-muted-foreground">{droit.raison}</p>}
                </CardContent>
            </Card>

            {commande && ['validee', 'passee', 'recue', 'soldee'].includes(commande.status) && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base">Factures du fournisseur</CardTitle>
                        <CardDescription>Engagé : {eur(commande.totalHT)} HT — facturé par le fournisseur (réel) : {eur(factureHT(commande))} HT.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                        {(commande.factures ?? []).length > 0 && (
                            <table className="w-full">
                                <tbody>{commande.factures!.map(f => <tr key={f.id} className="border-t"><td className="py-1.5 font-mono text-xs">{f.numero}</td><td className="py-1.5">{jour(f.date)}</td><td className="py-1.5 text-right">{eur(f.montantHT)} HT</td><td className="py-1.5 text-right text-xs text-muted-foreground">{f.saisiPar}</td></tr>)}</tbody>
                            </table>
                        )}
                        {commande.status !== 'soldee' && peutAvancer && (
                            <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
                                <div className="space-y-1"><Label htmlFor="ff-numero">N° de facture</Label><Input id="ff-numero" className="w-40" value={facture.numero} onChange={e => setFacture({ ...facture, numero: e.target.value })} /></div>
                                <div className="space-y-1"><Label htmlFor="ff-date">Date</Label><Input id="ff-date" type="date" className="w-40" value={facture.date} onChange={e => setFacture({ ...facture, date: e.target.value })} /></div>
                                <div className="space-y-1"><Label htmlFor="ff-montant">Montant HT</Label><Input id="ff-montant" className="w-32 text-right" inputMode="decimal" value={facture.montantHT} onChange={e => setFacture({ ...facture, montantHT: e.target.value })} /></div>
                                <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={facture.solder} onChange={e => setFacture({ ...facture, solder: e.target.checked })} />Solder la commande</label>
                                <Button disabled={busy || !facture.numero.trim() || !num(facture.montantHT)} onClick={ajouterFacture}>Enregistrer la facture</Button>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}
            <FournisseursDialog open={dialogueFrn} onOpenChange={setDialogueFrn} onChange={f => { setFournisseurs(l => [...l, f]); setSupplierId(f.id); }} />
        </div>
    );
}
