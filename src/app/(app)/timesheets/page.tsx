'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Pencil, Plus, Trash2, Upload, X, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, type Colonne } from '@/components/data-table/data-table';
import { Indicateur, useOngletUrl } from '@/components/fiches/fiche';
import { useConfirm, usePrompt } from '@/components/confirm-provider';
import { cibleDeCle, cleDeCible, useCiblesAnalytiques } from '@/components/commandes/cibles';
import { ImportHeuresDialog } from '@/components/heures/import-dialog';
import { useData } from '@/context/data-context';
import { useToast } from '@/hooks/use-toast';
import { LIBELLE_STATUT_HEURES, estValidee, lundiDe, statutHeures, totalHeures, type SaisieHeures } from '@/lib/heures';
import { deciderHeuresAction, deleteHeuresAction, heuresAValiderAction, listHeuresAction, saveHeuresAction } from '@/lib/heures-actions';

/**
 * Heures de main-d'œuvre : chaque technicien saisit ses heures par jour sur une affaire de travaux ou sur un contrat et
 * une activité. Un responsable saisit (ou importe) pour son équipe, un administrateur pour tous. Les heures sont
 * valorisées au coût horaire interne, figé à la saisie : c'est le réel de main-d'œuvre des affaires.
 */

const ONGLETS = ['miennes', 'a-valider', 'toutes'] as const;
type Onglet = typeof ONGLETS[number];
const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const h = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} h`;
const jour = (d: string) => d.split('-').reverse().join('/');
const iso = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
const aujourdhui = () => iso(new Date());
const debutDefaut = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 2); return iso(d); };
const nombre = (v: string) => Number(v.replace(/\s/g, '').replace(',', '.'));

export default function HeuresPage() {
    const { users, currentUser, authUser, isAdmin } = useData();
    const { toast } = useToast();
    const confirmer = useConfirm();
    const demander = usePrompt();
    const moi = (authUser ?? currentUser)?.id ?? '';
    const [onglet, changerOnglet] = useOngletUrl<Onglet>(ONGLETS, 'miennes');
    const [saisies, setSaisies] = useState<SaisieHeures[] | null>(null);
    // Saisies en attente que je peux valider : celles de mon équipe directe (toutes, pour un administrateur).
    const [aValider, setAValider] = useState<SaisieHeures[]>([]);
    const [du, setDu] = useState(debutDefaut());
    const [au, setAu] = useState(aujourdhui());
    const [importer, setImporter] = useState(false);
    const [busy, setBusy] = useState(false);
    // Saisie
    const [edition, setEdition] = useState<SaisieHeures | null>(null);
    const [technicien, setTechnicien] = useState('');
    const [date, setDate] = useState(aujourdhui());
    const [cible, setCible] = useState('');
    const [heures, setHeures] = useState('');
    const [commentaire, setCommentaire] = useState('');
    const cibles = useCiblesAnalytiques();

    const nom = (u: { firstName?: string; name: string }) => (u.firstName && u.name.toLowerCase().startsWith(u.firstName.toLowerCase()) ? u.name : [u.firstName, u.name].filter(Boolean).join(' '));
    // Pour qui je peux saisir : moi, mon équipe directe ; tout le monde pour un administrateur.
    const equipe = useMemo(() => users.filter(u => isAdmin || u.id === moi || u.managerId === moi).sort((a, b) => nom(a).localeCompare(nom(b), 'fr')), [users, isAdmin, moi]);
    const pourAutrui = equipe.some(u => u.id !== moi);
    // Mes heures se modifient tant qu'elles ne sont pas validées ; celles de mon équipe (ou de tous, pour un administrateur), toujours.
    const peutModifier = useCallback((s: SaisieHeures) => (s.userId === moi ? !estValidee(s) : isAdmin || equipe.some(u => u.id === s.userId)), [isAdmin, moi, equipe]);
    useEffect(() => { if (!technicien && moi) setTechnicien(moi); }, [technicien, moi]);

    const charger = useCallback(async () => {
        const [r, v] = await Promise.all([listHeuresAction({ from: du, to: au }), heuresAValiderAction()]);
        if (r.success) setSaisies(r.data);
        else { setSaisies([]); toast({ title: 'Heures indisponibles', description: r.error, variant: 'destructive' }); }
        if (v.success) setAValider(v.data);
    }, [du, au, toast]);
    useEffect(() => { charger(); }, [charger]);

    const lignes = useMemo(() => (onglet === 'a-valider' ? aValider : (saisies ?? []).filter(s => onglet === 'toutes' || s.userId === moi)), [saisies, aValider, onglet, moi]);
    const miennes = useMemo(() => (saisies ?? []).filter(s => s.userId === moi), [saisies, moi]);
    const semaine = totalHeures(miennes.filter(s => lundiDe(s.date) === lundiDe(aujourdhui())));
    const mois = totalHeures(miennes.filter(s => s.date.slice(0, 7) === aujourdhui().slice(0, 7)));
    const periode = totalHeures(lignes);

    const vider = () => { setEdition(null); setHeures(''); setCommentaire(''); };
    const modifier = (s: SaisieHeures) => { setEdition(s); setTechnicien(s.userId); setDate(s.date); setCible(cleDeCible(s.cible)); setHeures(String(s.hours).replace('.', ',')); setCommentaire(s.comment ?? ''); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    const enregistrer = async () => {
        const c = cibleDeCle(cible);
        if (!c) { toast({ title: 'Affectation à choisir', description: 'Une affaire de travaux, ou un contrat et une activité.', variant: 'destructive' }); return; }
        setBusy(true);
        const r = await saveHeuresAction({ ...(edition && { id: edition.id }), userId: technicien || moi, date, hours: nombre(heures), cible: c, comment: commentaire });
        setBusy(false);
        if (!r.success) { toast({ title: 'Saisie refusée', description: r.error, variant: 'destructive' }); return; }
        toast({ title: edition ? 'Heures modifiées' : 'Heures enregistrées', description: `${h(r.data.hours)} le ${jour(r.data.date)} — ${r.data.cible.libelle ?? ''}${estValidee(r.data) ? '' : ' — à valider par votre responsable'}` });
        vider();
        await charger();
    };
    const supprimer = async (s: SaisieHeures) => {
        if (!(await confirmer({ title: 'Supprimer cette saisie ?', description: `${s.userName} — ${h(s.hours)} le ${jour(s.date)} — ${s.cible.libelle ?? ''}`, confirmLabel: 'Supprimer', destructive: true }))) return;
        const r = await deleteHeuresAction(s.id);
        if (!r.success) { toast({ title: 'Suppression refusée', description: r.error, variant: 'destructive' }); return; }
        if (edition?.id === s.id) vider();
        await charger();
    };

    /** Valide ou refuse (motif) des saisies en attente. */
    const decider = async (choisies: SaisieHeures[], decision: 'validee' | 'refusee', vider?: () => void) => {
        if (!choisies.length) return;
        const total = totalHeures(choisies);
        let motif = '';
        if (decision === 'refusee') {
            const saisi = await demander({ title: `Refuser ${choisies.length} saisie(s)`, description: `${h(total.heures)} — le technicien voit le motif, corrige et la saisie repart en validation.`, label: 'Motif du refus', required: true, multiline: true, confirmLabel: 'Refuser' });
            if (!saisi) return;
            motif = saisi;
        } else if (!(await confirmer({ title: `Valider ${choisies.length} saisie(s) ?`, description: `${h(total.heures)}, ${eur(total.cout)} de main-d'œuvre : elles compteront dans le réel des affaires.`, confirmLabel: 'Valider' }))) return;
        const r = await deciderHeuresAction(choisies.map(s => s.id), decision, motif);
        if (!r.success) { toast({ title: decision === 'validee' ? 'Validation refusée' : 'Refus impossible', description: r.error, variant: 'destructive' }); return; }
        toast({ title: decision === 'validee' ? 'Heures validées' : 'Heures refusées', description: `${r.data} saisie(s), ${h(total.heures)}` });
        vider?.();
        await charger();
    };

    const colonnes: Colonne<SaisieHeures>[] = useMemo(() => [
        { id: 'date', label: 'Date', fixe: true, tri: r => r.date, exporter: r => r.date, cell: r => <span className="whitespace-nowrap">{jour(r.date)}</span> },
        { id: 'technicien', label: 'Technicien', tri: r => r.userName, exporter: r => r.userName, cell: r => <span className="whitespace-nowrap">{r.userName}</span> },
        { id: 'affectation', label: 'Affectation', tri: r => r.cible.libelle ?? '', exporter: r => r.cible.libelle ?? '', cell: r => <span className="block max-w-[320px] truncate" title={r.cible.libelle}>{r.cible.libelle}</span> },
        { id: 'analytique', label: 'Code analytique', exporter: r => r.analytique.code, cell: r => <span className="whitespace-nowrap font-mono text-xs">{r.analytique.code}</span> },
        { id: 'commentaire', label: 'Commentaire', exporter: r => r.comment ?? '', cell: r => <span className="block max-w-[220px] truncate text-muted-foreground" title={r.comment}>{r.comment}</span> },
        {
            id: 'statut', label: 'Validation', tri: r => statutHeures(r), exporter: r => LIBELLE_STATUT_HEURES[statutHeures(r)],
            cell: r => {
                const st = statutHeures(r);
                return <span className="inline-flex flex-col gap-0.5">
                    <Badge variant={st === 'refusee' ? 'destructive' : st === 'a_valider' ? 'default' : 'secondary'} className="w-fit whitespace-nowrap font-normal">{LIBELLE_STATUT_HEURES[st]}</Badge>
                    {st === 'refusee' && r.motifRefus && <span className="max-w-[220px] text-xs text-destructive">{r.motifRefus}</span>}
                </span>;
            },
        },
        { id: 'heures', label: 'Heures', align: 'right', tri: r => r.hours, exporter: r => r.hours, cell: r => <span className="font-medium">{h(r.hours)}</span> },
        { id: 'taux', label: 'Coût horaire', align: 'right', masquee: true, tri: r => r.rate, exporter: r => r.rate, cell: r => eur(r.rate) },
        { id: 'cout', label: 'Coût', align: 'right', tri: r => r.cost, exporter: r => r.cost, cell: r => eur(r.cost) },
        { id: 'source', label: 'Origine', masquee: true, exporter: r => r.source, cell: r => (r.source === 'import' ? <Badge variant="outline">Import</Badge> : 'Saisie') },
    ], []);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Heures</h1>
                    <p className="text-muted-foreground">Heures de main-d&apos;œuvre par jour, sur une affaire de travaux ou un contrat. Valorisées au coût horaire interne, figé à la saisie ; validées par le responsable avant de compter dans les affaires.</p>
                </div>
                {pourAutrui && <Button variant="outline" size="sm" onClick={() => setImporter(true)}><Upload className="mr-1 h-4 w-4" />Importer des heures</Button>}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
                <Indicateur titre="Ma semaine" valeur={h(semaine.heures)} detail={`depuis le lundi ${jour(lundiDe(aujourdhui()))}`} />
                <Indicateur titre="Mon mois" valeur={h(mois.heures)} detail={new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })} />
                <Indicateur titre={onglet === 'toutes' ? 'Toutes, sur la période' : 'Mes heures, sur la période'} valeur={h(periode.heures)} detail={`${eur(periode.cout)} de main-d'œuvre`} />
            </div>

            <Card className={edition ? 'border-primary' : undefined}>
                <CardContent className="flex flex-wrap items-end gap-3 px-4 py-4">
                    {pourAutrui && (
                        <div className="space-y-1"><Label htmlFor="h-technicien">Technicien</Label>
                            <Select value={technicien} onValueChange={setTechnicien} disabled={!!edition}>
                                <SelectTrigger id="h-technicien" className="w-[220px]"><SelectValue /></SelectTrigger>
                                <SelectContent>{equipe.map(u => <SelectItem key={u.id} value={u.id}>{nom(u)}{u.id === moi ? ' (moi)' : ''}</SelectItem>)}</SelectContent>
                            </Select></div>
                    )}
                    <div className="space-y-1"><Label htmlFor="h-date">Date</Label><Input id="h-date" type="date" className="w-[160px]" max={aujourdhui()} value={date} onChange={e => setDate(e.target.value)} /></div>
                    <div className="min-w-[280px] flex-1 space-y-1"><Label htmlFor="h-cible">Affectation</Label>
                        <SearchableSelect id="h-cible" className="w-full" value={cible} onValueChange={setCible} options={cibles} placeholder="Affaire ou contrat…" /></div>
                    <div className="space-y-1"><Label htmlFor="h-heures">Heures</Label><Input id="h-heures" className="w-24 text-right" inputMode="decimal" placeholder="7,5" value={heures} onChange={e => setHeures(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') enregistrer(); }} /></div>
                    <div className="min-w-[200px] flex-1 space-y-1"><Label htmlFor="h-commentaire">Commentaire</Label><Input id="h-commentaire" value={commentaire} onChange={e => setCommentaire(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') enregistrer(); }} /></div>
                    <Button disabled={busy || !cible || !(nombre(heures) > 0) || !date} onClick={enregistrer}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : edition ? <Pencil className="mr-1 h-4 w-4" /> : <Plus className="mr-1 h-4 w-4" />}{edition ? 'Modifier' : 'Ajouter'}</Button>
                    {edition && <Button variant="ghost" onClick={vider}><X className="mr-1 h-4 w-4" />Abandonner</Button>}
                </CardContent>
            </Card>

            <div className="flex flex-wrap items-end justify-between gap-3">
                <Tabs value={onglet} onValueChange={v => changerOnglet(v as Onglet)}>
                    <TabsList>
                        <TabsTrigger value="miennes">Mes heures</TabsTrigger>
                        {(pourAutrui || aValider.length > 0) && <TabsTrigger value="a-valider" className="gap-1.5">À valider {aValider.length > 0 && <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">{aValider.length}</Badge>}</TabsTrigger>}
                        <TabsTrigger value="toutes">Toutes</TabsTrigger>
                    </TabsList>
                </Tabs>
                <div className="flex items-end gap-2 text-sm">
                    <div className="space-y-1"><Label htmlFor="h-du">Du</Label><Input id="h-du" type="date" className="h-9 w-[150px]" value={du} onChange={e => e.target.value && setDu(e.target.value)} /></div>
                    <div className="space-y-1"><Label htmlFor="h-au">Au</Label><Input id="h-au" type="date" className="h-9 w-[150px]" value={au} onChange={e => e.target.value && setAu(e.target.value)} /></div>
                </div>
            </div>

            <DataTable
                id={`heures-${onglet}`}
                rows={lignes}
                rowId={r => r.id}
                colonnes={colonnes}
                chargement={saisies === null}
                recherche={{ placeholder: 'Technicien, affaire, contrat, code analytique…', valeurs: r => [r.userName, r.cible.libelle, r.analytique.code, r.comment] }}
                filtres={[{ id: 'technicien', label: 'Technicien', valeur: r => r.userName }, { id: 'affectation', label: 'Affectation', valeur: r => r.cible.libelle ?? '' }, { id: 'statut', label: 'Validation', valeur: r => statutHeures(r), libelle: v => LIBELLE_STATUT_HEURES[v as keyof typeof LIBELLE_STATUT_HEURES] ?? v }]}
                selection={onglet === 'a-valider' ? {
                    actions: (choisies, vider) => (<>
                        <Button size="sm" className="h-8 gap-1 bg-green-700 hover:bg-green-800" onClick={() => decider(choisies, 'validee', vider)}><CheckCircle2 className="h-4 w-4" />Valider</Button>
                        <Button size="sm" variant="outline" className="h-8 gap-1 text-destructive" onClick={() => decider(choisies, 'refusee', vider)}><XCircle className="h-4 w-4" />Refuser</Button>
                    </>),
                } : undefined}
                triInitial={{ id: 'date', sens: 'desc' }}
                export={{ fichier: 'heures.csv' }}
                actions={r => peutModifier(r) && (
                    <span className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Modifier la saisie du ${jour(r.date)}`} onClick={() => modifier(r)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label={`Supprimer la saisie du ${jour(r.date)}`} onClick={() => supprimer(r)}><Trash2 className="h-4 w-4" /></Button>
                    </span>
                )}
                vide={onglet === 'a-valider' ? { titre: 'Aucune heure à valider.', description: 'Les heures saisies par votre équipe apparaissent ici.' } : { titre: 'Aucune heure sur la période.', description: 'Saisissez vos heures ci-dessus : date, affaire ou contrat, durée.' }}
            />
            <ImportHeuresDialog open={importer} onOpenChange={setImporter} onImporte={charger} />
        </div>
    );
}
