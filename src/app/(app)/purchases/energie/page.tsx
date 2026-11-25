'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Link2, Loader2, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, type Colonne } from '@/components/data-table/data-table';
import { useData } from '@/context/data-context';
import { useToast } from '@/hooks/use-toast';
import { baseEnergieAction, enregistrerPeriodeAction, importerPointsAction, pointLivraisonAction, rattacherPointAction, supprimerPeriodeAction } from '@/lib/energie/actions';
import {
    LIBELLE_COUVERTURE, LIBELLE_ENERGIE, LIBELLE_ETAT_PERIODE, etatPeriode, lireFeuille, type LectureFeuille, type PeriodeFourniture, type PointLivraison, type StatutCouverture,
} from '@/lib/energie/fournitures';
import { csvToTable } from '@/lib/imports/engine';
import { readXlsxTable } from '@/lib/imports/xlsx';
import { optionsSites } from '@/lib/select-options';
import { facturesEnergieDuPointAction } from '@/lib/billing/factures-energie-actions';
import type { FactureEnergieSuivie } from '@/services/factures-energie-admin';
import type { BaseEnergie, ResumePoint } from '@/services/energie-admin';

/**
 * Contrats de fourniture d'énergie : points de livraison (PDL / PCE) des sites facturés en P1, leurs contrats
 * fournisseur par période, ce qui est à renouveler, et la synthèse annuelle.
 */

const fr = (d?: string | null) => (d ? d.split('-').reverse().join('/') : '—');
const eur = (n?: number | null) => (typeof n === 'number' ? n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) : '—');
const TON: Record<StatutCouverture, string> = {
    couvert: 'border-emerald-300 bg-emerald-50 text-emerald-800', a_renouveler: 'border-amber-400 bg-amber-50 text-amber-800', sans_couverture: 'border-red-300 bg-red-50 text-red-800',
    a_venir: 'border-blue-300 bg-blue-50 text-blue-800', termine: 'border-slate-300 bg-slate-50 text-slate-600',
};
type Filtre = 'tous' | 'a_renouveler' | 'sans_couverture' | 'non_rattaches' | 'actifs';

export default function ContratsEnergiePage() {
    const { toast } = useToast();
    const [base, setBase] = useState<BaseEnergie | null>(null);
    const [erreur, setErreur] = useState<string | null>(null);
    const [filtre, setFiltre] = useState<Filtre>('actifs');
    const [ouvert, setOuvert] = useState<string | null>(null);
    const [importOuvert, setImportOuvert] = useState(false);

    const charger = useCallback(async () => {
        const r = await baseEnergieAction();
        if (r.success) { setBase(r.data); setErreur(null); } else setErreur(r.error);
    }, []);
    useEffect(() => { void charger(); }, [charger]);

    const points = base?.points ?? [];
    const chiffres = useMemo(() => ({
        actifs: points.filter(p => p.statut === 'couvert' || p.statut === 'a_renouveler').length,
        aRenouveler: points.filter(p => p.statut === 'a_renouveler').length,
        sans: points.filter(p => p.statut === 'sans_couverture').length,
        nonRattaches: points.filter(p => !p.siteId && p.statut !== 'termine').length,
    }), [points]);
    const lignes = useMemo(() => points.filter(p => filtre === 'tous' || (filtre === 'actifs' ? p.statut !== 'termine' : filtre === 'non_rattaches' ? !p.siteId && p.statut !== 'termine' : p.statut === filtre)), [points, filtre]);

    const colonnes: Colonne<ResumePoint>[] = useMemo(() => [
        { id: 'statut', label: 'Couverture', fixe: true, tri: r => ['sans_couverture', 'a_renouveler', 'a_venir', 'couvert', 'termine'].indexOf(r.statut), cell: r => <Badge variant="outline" className={TON[r.statut]}>{LIBELLE_COUVERTURE[r.statut]}</Badge>, exporter: r => LIBELLE_COUVERTURE[r.statut] },
        { id: 'client', label: 'Client', tri: r => r.client, cell: r => <span className="block max-w-[200px] truncate" title={r.client}>{r.client}</span>, exporter: r => r.client },
        { id: 'site', label: 'Site', tri: r => r.site, cell: r => r.siteId ? <Link href={`/sites/${r.siteId}`} className="block max-w-[240px] truncate text-primary hover:underline" title={r.siteNom ?? r.site} onClick={e => e.stopPropagation()}>{r.siteNom ?? r.site}</Link>
            : <span className="block max-w-[240px] truncate text-muted-foreground" title={`${r.site} — à rattacher à un site`}>{r.site}</span>, exporter: r => r.siteNom ?? r.site },
        { id: 'pdl', label: 'PDL / PCE', tri: r => r.pdl, cell: r => <span className="font-mono text-xs">{r.pdl}</span>, exporter: r => r.pdl },
        { id: 'energie', label: 'Énergie', tri: r => r.energie, cell: r => LIBELLE_ENERGIE[r.energie], exporter: r => LIBELLE_ENERGIE[r.energie] },
        { id: 'fournisseur', label: 'Fournisseur', tri: r => r.fournisseur, cell: r => <span>{r.fournisseur || '—'}<span className="block max-w-[180px] truncate text-xs text-muted-foreground" title={r.numeroContrat}>{r.numeroContrat}</span></span>, exporter: r => `${r.fournisseur} ${r.numeroContrat}`.trim() },
        { id: 'fin', label: 'Couvert jusqu\'au', tri: r => r.finCouverture ?? '', cell: r => <span>{fr(r.finCouverture)}{r.jours !== null && r.statut === 'a_renouveler' ? <span className="block text-xs text-amber-700">dans {r.jours} jour{r.jours > 1 ? 's' : ''}</span> : r.suivant ? <span className="block text-xs text-muted-foreground">{r.suivant}</span> : null}</span>, exporter: r => r.finCouverture ?? '' },
        { id: 'agence', label: 'Agence', tri: r => r.agence, cell: r => r.agence || '—', exporter: r => r.agence },
        { id: 'marche', label: 'Marché', masquee: true, tri: r => r.typeMarche, cell: r => r.typeMarche || '—', exporter: r => r.typeMarche },
        { id: 'indexation', label: 'Indexation achat', masquee: true, tri: r => r.indexationAchat, cell: r => r.indexationAchat || '—', exporter: r => r.indexationAchat },
        { id: 'prix', label: 'Prix molécule', align: 'right', masquee: true, tri: r => r.prixMolecule ?? 0, cell: r => (r.prixMolecule !== null ? `${eur(r.prixMolecule)}/MWh` : '—'), exporter: r => r.prixMolecule ?? '' },
        { id: 'centre', label: 'Centre de coût', masquee: true, tri: r => r.centreCout, cell: r => <span className="font-mono text-xs">{r.centreCout || '—'}</span>, exporter: r => r.centreCout },
    ], []);

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Contrats d'énergie</h1>
                    <p className="text-sm text-muted-foreground">Les points de livraison des sites facturés en P1 et leurs contrats fournisseur, période par période.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={charger}><RefreshCw className="mr-2 h-4 w-4" />Actualiser</Button>
                    <Button size="sm" onClick={() => setImportOuvert(true)}><Upload className="mr-2 h-4 w-4" />Importer la feuille</Button>
                </div>
            </div>

            {erreur && <p className="text-sm text-destructive">{erreur}</p>}
            {!base && !erreur && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Lecture des points de livraison…</div>}

            {base && (
                <>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-bloc="chiffres">
                        <Tuile titre="Points de livraison fournis" valeur={chiffres.actifs} detail={`${points.length} suivis au total`} actif={filtre === 'actifs'} onClick={() => setFiltre('actifs')} />
                        <Tuile titre="À renouveler sous 6 mois" valeur={chiffres.aRenouveler} detail="fin de couverture sans suite" ton="text-amber-700" actif={filtre === 'a_renouveler'} onClick={() => setFiltre(f => (f === 'a_renouveler' ? 'actifs' : 'a_renouveler'))} />
                        <Tuile titre="Sans contrat en cours" valeur={chiffres.sans} detail="contrat client actif, pas de fourniture" ton="text-red-700" actif={filtre === 'sans_couverture'} onClick={() => setFiltre(f => (f === 'sans_couverture' ? 'actifs' : 'sans_couverture'))} />
                        <Tuile titre="À rattacher à un site" valeur={chiffres.nonRattaches} detail="pas encore reliés à un site facturé" actif={filtre === 'non_rattaches'} onClick={() => setFiltre(f => (f === 'non_rattaches' ? 'actifs' : 'non_rattaches'))} />
                    </div>

                    <Tabs defaultValue="points">
                        <TabsList>
                            <TabsTrigger value="points">Points de livraison ({lignes.length})</TabsTrigger>
                            <TabsTrigger value="contrats">Contrats fournisseur ({base.contrats.length})</TabsTrigger>
                            <TabsTrigger value="synthese">Synthèse annuelle</TabsTrigger>
                        </TabsList>

                        <TabsContent value="points" className="mt-4">
                            <DataTable id="energie-points" rows={lignes} rowId={r => r.id} colonnes={colonnes}
                                recherche={{ placeholder: 'Client, site, PDL, fournisseur, n° de contrat, ville…', valeurs: r => [r.client, r.site, r.siteNom, r.pdl, r.fournisseur, r.numeroContrat, r.ville, r.agence, r.centreCout] }}
                                filtres={[
                                    { id: 'energie', label: 'Énergie', valeur: r => LIBELLE_ENERGIE[r.energie] },
                                    { id: 'fournisseur', label: 'Fournisseur', valeur: r => r.fournisseur || '—' },
                                    { id: 'agence', label: 'Agence', valeur: r => r.agence || '—' },
                                ]}
                                triInitial={{ id: 'fin', sens: 'asc' }} export={{ fichier: 'contrats-energie' }}
                                boutons={filtre !== 'actifs' ? <Button variant="ghost" size="sm" onClick={() => setFiltre(filtre === 'tous' ? 'actifs' : 'tous')}>{filtre === 'tous' ? 'Masquer les terminés' : 'Voir tous les points'}</Button> : <Button variant="ghost" size="sm" onClick={() => setFiltre('tous')}>Inclure les terminés</Button>}
                                actions={r => <Button size="sm" variant="outline" className="h-8" onClick={() => setOuvert(r.id)}>Ouvrir</Button>}
                                vide={{ titre: points.length ? 'Aucun point de livraison dans cette catégorie.' : 'Aucun point de livraison.', description: points.length ? undefined : 'Importez votre feuille de suivi pour démarrer.' }} />
                        </TabsContent>

                        <TabsContent value="contrats" className="mt-4">
                            <Card><CardContent className="overflow-x-auto pt-6">
                                <table className="w-full min-w-[820px] text-sm" data-tableau="contrats">
                                    <thead><tr className="border-b text-xs text-muted-foreground">
                                        <th className="py-2 text-left font-medium">Fournisseur</th><th className="px-2 text-left font-medium">N° de contrat</th><th className="px-2 text-left font-medium">Titulaire</th>
                                        <th className="px-2 text-left font-medium">Période</th><th className="px-2 text-left font-medium">État</th><th className="px-2 text-right font-medium">Points</th><th className="pl-2 text-right font-medium">Sans contrat signé</th>
                                    </tr></thead>
                                    <tbody>{base.contrats.map(k => (
                                        <tr key={k.cle} className="border-b last:border-0">
                                            <td className="py-2 font-medium">{k.fournisseur || '—'}</td>
                                            <td className="px-2">{k.numero || <span className="text-muted-foreground">sans numéro</span>}</td>
                                            <td className="px-2"><span className="block max-w-[220px] truncate" title={k.titulaires.join(', ')}>{k.titulaires.join(', ') || '—'}</span></td>
                                            <td className="px-2 tabular-nums">{fr(k.debut)} → {fr(k.fin)}</td>
                                            <td className="px-2">{LIBELLE_ETAT_PERIODE[k.etat]}</td>
                                            <td className="px-2 text-right tabular-nums">{k.points}</td>
                                            <td className={`pl-2 text-right tabular-nums ${k.sansDocument && k.etat !== 'terminee' ? 'text-amber-700' : 'text-muted-foreground'}`}>{k.sansDocument || '—'}</td>
                                        </tr>
                                    ))}</tbody>
                                </table>
                                {base.contrats.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Aucun contrat fournisseur.</p>}
                            </CardContent></Card>
                        </TabsContent>

                        <TabsContent value="synthese" className="mt-4">
                            <Card>
                                <CardHeader className="pb-3"><CardTitle className="text-base">Nombre de points de livraison fournis par année</CardTitle><CardDescription>Un point compte pour une année dès qu'il y a été fourni au moins un jour. Calculé à partir des périodes.</CardDescription></CardHeader>
                                <CardContent className="overflow-x-auto">
                                    <table className="w-full min-w-[700px] text-sm tabular-nums" data-tableau="synthese">
                                        <thead><tr className="border-b text-xs text-muted-foreground"><th className="py-2 text-left font-medium">Énergie</th><th className="px-2 text-left font-medium">Agence</th><th className="px-2 text-left font-medium">Client</th>{base.synthese.annees.map(a => <th key={a} className="px-2 text-right font-medium">{a}</th>)}</tr></thead>
                                        <tbody>{base.synthese.lignes.map((l, i) => (
                                            <tr key={i} className="border-b last:border-0"><td className="py-1.5">{LIBELLE_ENERGIE[l.energie]}</td><td className="px-2">{l.agence || '—'}</td><td className="px-2">{l.client}</td>{l.parAnnee.map((n, j) => <td key={j} className={`px-2 text-right ${n ? '' : 'text-muted-foreground'}`}>{n || '—'}</td>)}</tr>
                                        ))}</tbody>
                                        <tfoot><tr className="border-t font-semibold"><td className="py-2" colSpan={3}>Total</td>{base.synthese.totaux.map((n, j) => <td key={j} className="px-2 text-right">{n}</td>)}</tr></tfoot>
                                    </table>
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>
                </>
            )}

            <FichePoint id={ouvert} aujourdhui={base?.aujourdhui ?? ''} onClose={() => setOuvert(null)} onChange={charger} />
            <ImportFeuille ouvert={importOuvert} onClose={() => setImportOuvert(false)} onFait={async r => { toast({ title: 'Import terminé', description: r }); await charger(); }} />
        </div>
    );
}

function Tuile({ titre, valeur, detail, ton = '', actif, onClick }: { titre: string; valeur: number; detail: string; ton?: string; actif?: boolean; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} aria-pressed={actif} className={`rounded-lg border bg-card p-4 text-left transition hover:bg-muted/40 ${actif ? 'ring-2 ring-primary' : ''}`}>
            <p className="text-xs text-muted-foreground">{titre}</p>
            <p className={`text-2xl font-bold tabular-nums ${valeur ? ton : ''}`}>{valeur.toLocaleString('fr-FR')}</p>
            <p className="text-xs text-muted-foreground">{detail}</p>
        </button>
    );
}

const PERIODE_VIDE = { id: '', debut: '', fin: '', fournisseur: '', numeroContrat: '', titulaire: '', tacite: '', indexationAchat: '', prixMolecule: '', totalAbonnement: '', contratDisponible: '' };

/** Fiche d'un point de livraison : repères, site rattaché, périodes de fourniture (ajout, modification, suppression). */
function FichePoint({ id, aujourdhui, onClose, onChange }: { id: string | null; aujourdhui: string; onClose: () => void; onChange: () => Promise<void> | void }) {
    const { sites } = useData();
    const { toast } = useToast();
    const [p, setP] = useState<PointLivraison | null>(null);
    const [saisie, setSaisie] = useState<typeof PERIODE_VIDE | null>(null);
    const [envoi, setEnvoi] = useState(false);
    const [factures, setFactures] = useState<FactureEnergieSuivie[]>([]);
    const lire = useCallback(async (x: string) => { const r = await pointLivraisonAction(x); if (r.success) setP(r.data); else { toast({ title: 'Point de livraison indisponible', description: r.error, variant: 'destructive' }); onClose(); } }, [toast, onClose]);
    useEffect(() => { setP(null); setSaisie(null); setFactures([]); if (id) { void lire(id); void facturesEnergieDuPointAction(id).then(r => { if (r.success) setFactures(r.data); }); } }, [id, lire]);

    const fait = async (r: { success: boolean; error?: string }, message: string) => {
        setEnvoi(false);
        if (!r.success) { toast({ title: 'Modification refusée', description: r.error, variant: 'destructive' }); return; }
        toast({ title: message }); setSaisie(null);
        if (id) await lire(id);
        await onChange();
    };
    const rattacher = async (siteId: string) => { if (!id) return; setEnvoi(true); await fait(await rattacherPointAction(id, siteId || null), siteId ? 'Point rattaché au site' : 'Point détaché'); };
    const enregistrer = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!id || !saisie) return;
        setEnvoi(true);
        const n = (t: string) => (t.trim() ? Number(t.replace(/\s/g, '').replace(',', '.')) : null);
        await fait(await enregistrerPeriodeAction(id, { ...saisie, tacite: saisie.tacite as PeriodeFourniture['tacite'], prixMolecule: n(saisie.prixMolecule), totalAbonnement: n(saisie.totalAbonnement) }), saisie.id ? 'Période modifiée' : 'Période ajoutée');
    };
    const modifier = (x: PeriodeFourniture) => setSaisie({ id: x.id, debut: x.debut ?? '', fin: x.fin ?? '', fournisseur: x.fournisseur, numeroContrat: x.numeroContrat, titulaire: x.titulaire, tacite: x.tacite, indexationAchat: x.indexationAchat ?? '',
        prixMolecule: x.prixMolecule != null ? String(x.prixMolecule).replace('.', ',') : '', totalAbonnement: x.totalAbonnement != null ? String(x.totalAbonnement).replace('.', ',') : '', contratDisponible: x.contratDisponible ?? '' });
    const champ = (cle: keyof typeof PERIODE_VIDE, libelle: string, type = 'text', requis = false) => (
        <div className="space-y-1"><Label htmlFor={`pe-${cle}`} className="text-xs">{libelle}</Label>
            <Input id={`pe-${cle}`} type={type} required={requis} value={saisie?.[cle] ?? ''} onChange={e => setSaisie(s => (s ? { ...s, [cle]: e.target.value } : s))} /></div>
    );

    return (
        <Dialog open={!!id} onOpenChange={o => { if (!o) onClose(); }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[900px]">
                <DialogHeader>
                    <DialogTitle>{p ? `${LIBELLE_ENERGIE[p.energie]} · ${p.pdl}` : 'Point de livraison'}</DialogTitle>
                    <DialogDescription>{p ? [p.client, p.site, [p.adresse, p.codePostal, p.ville].filter(Boolean).join(' ')].filter(Boolean).join(' — ') : 'Chargement…'}</DialogDescription>
                </DialogHeader>
                {!p ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
                    <div className="space-y-5 text-sm">
                        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                            {([['Agence', p.agence], ['Type de marché', p.typeMarche], ['Centre de coût', p.centreCout], ['Société', p.societe], ['Profil', p.profil], ['Tarif / segment', p.segment],
                                ['CAR / puissance', p.car != null ? p.car.toLocaleString('fr-FR') : ''], ['Contrat client', p.debutClient || p.finClient ? `${fr(p.debutClient)} → ${fr(p.finClient)}` : '']] as [string, string | undefined][])
                                .filter(([, v]) => v).map(([l, v]) => <div key={l} className="flex justify-between gap-3"><span className="text-muted-foreground">{l}</span><span className="text-right font-medium">{v}</span></div>)}
                        </div>

                        <div className="rounded-md border p-3" data-bloc="rattachement">
                            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Link2 className="h-4 w-4" />Site facturé alimenté par ce point</p>
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="min-w-[320px] flex-1"><SearchableSelect value={p.siteId} onValueChange={rattacher} options={optionsSites(sites)} clearable disabled={envoi} placeholder="Rattacher à un site…" searchPlaceholder="Nom, code, ville du site…" className="w-full" /></div>
                                {p.siteId ? <Button asChild variant="outline" size="sm"><Link href={`/sites/${p.siteId}`}>Ouvrir le site</Link></Button> : <span className="flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="h-4 w-4" />Pas encore rattaché : le lien avec la facturation du client n'est pas fait.</span>}
                            </div>
                        </div>

                        <div>
                            <div className="mb-2 flex items-center justify-between">
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Périodes de fourniture ({p.periodes.length})</p>
                                {!saisie && <Button size="sm" variant="outline" onClick={() => setSaisie({ ...PERIODE_VIDE, fournisseur: p.periodes[0]?.fournisseur ?? '', titulaire: p.periodes[0]?.titulaire ?? '' })}><Plus className="mr-1 h-4 w-4" />Ajouter une période</Button>}
                            </div>
                            {saisie && (
                                <form onSubmit={enregistrer} className="mb-3 space-y-3 rounded-md border bg-muted/20 p-3" data-bloc="saisie-periode">
                                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{champ('debut', 'Début', 'date', true)}{champ('fin', 'Fin', 'date', true)}{champ('fournisseur', 'Fournisseur', 'text', true)}{champ('numeroContrat', 'N° de contrat')}</div>
                                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{champ('titulaire', 'Titulaire')}{champ('indexationAchat', 'Indexation achat')}{champ('prixMolecule', 'Prix molécule (€/MWh)')}{champ('totalAbonnement', 'Abonnement (€/an)')}</div>
                                    <div className="flex justify-end gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setSaisie(null)}>Annuler</Button><Button type="submit" size="sm" disabled={envoi}>{envoi ? 'Enregistrement…' : 'Enregistrer'}</Button></div>
                                </form>
                            )}
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[760px] text-sm" data-tableau="periodes">
                                    <thead><tr className="border-b text-xs text-muted-foreground"><th className="py-2 text-left font-medium">Période</th><th className="px-2 text-left font-medium">État</th><th className="px-2 text-left font-medium">Fournisseur</th><th className="px-2 text-left font-medium">Contrat</th>
                                        <th className="px-2 text-left font-medium">Indexation</th><th className="px-2 text-right font-medium">Molécule</th><th className="px-2 text-right font-medium">Abonnement</th><th className="px-2 text-left font-medium">Signé</th><th className="w-20" /></tr></thead>
                                    <tbody>{p.periodes.map(x => {
                                        const etat = etatPeriode(x, aujourdhui);
                                        return (
                                            <tr key={x.id} className={`border-b last:border-0 ${etat === 'terminee' ? 'text-muted-foreground' : ''}`}>
                                                <td className="py-2 tabular-nums">{fr(x.debut)} → {fr(x.fin)}</td>
                                                <td className="px-2">{etat === 'en_cours' ? <Badge variant="outline" className={TON.couvert}>En cours</Badge> : LIBELLE_ETAT_PERIODE[etat]}{x.remarque ? <span className="block text-xs text-amber-700">{x.remarque}</span> : null}</td>
                                                <td className="px-2">{x.fournisseur}<span className="block text-xs text-muted-foreground">{x.titulaire}</span></td>
                                                <td className="px-2"><span className="block max-w-[160px] truncate" title={x.numeroContrat}>{x.numeroContrat || '—'}</span>{x.tacite === 'oui' && <span className="block text-xs text-muted-foreground">tacite{x.taciteDetail ? ` (${x.taciteDetail})` : ''}</span>}</td>
                                                <td className="px-2">{x.indexationAchat || '—'}</td>
                                                <td className="px-2 text-right tabular-nums">{x.prixMolecule != null ? `${eur(x.prixMolecule)}` : '—'}</td>
                                                <td className="px-2 text-right tabular-nums">{x.totalAbonnement != null ? eur(x.totalAbonnement) : '—'}</td>
                                                <td className="px-2">{/^oui$/i.test(x.contratDisponible ?? '') ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="Contrat signé disponible" /> : <span className="text-xs text-muted-foreground">{x.contratDisponible || '—'}</span>}</td>
                                                <td className="text-right">
                                                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => modifier(x)}>Modifier</Button>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" aria-label="Supprimer la période" disabled={envoi}
                                                        onClick={async () => { if (id && window.confirm(`Supprimer la période du ${fr(x.debut)} au ${fr(x.fin)} ?`)) { setEnvoi(true); await fait(await supprimerPeriodeAction(id, x.id), 'Période supprimée'); } }}><Trash2 className="h-4 w-4" /></Button>
                                                </td>
                                            </tr>
                                        );
                                    })}</tbody>
                                </table>
                            </div>
                        </div>

                        <div data-bloc="factures-point">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Factures du fournisseur ({factures.length})</p>
                            {factures.length === 0 ? <p className="text-muted-foreground">Aucune facture du fournisseur rattachée à ce point. Elles se saisissent sur la fiche du site, onglet Factures.</p> : (
                                <table className="w-full text-sm">
                                    <thead><tr className="border-b text-xs text-muted-foreground"><th className="py-2 text-left font-medium">Date</th><th className="px-2 text-left font-medium">Fournisseur</th><th className="px-2 text-left font-medium">N° de facture</th><th className="px-2 text-left font-medium">Consommation</th><th className="px-2 text-right font-medium">Montant HT</th><th className="pl-2 text-left font-medium">Facturé au client</th></tr></thead>
                                    <tbody>{factures.map(f => (
                                        <tr key={f.id} className="border-b align-top last:border-0">
                                            <td className="py-2 tabular-nums">{fr(f.date)}</td>
                                            <td className="px-2">{f.fournisseur}{(f.controle?.alertes ?? []).filter(a => a.gravite === 'attention').map((a, i) => <span key={i} className="mt-0.5 flex items-start gap-1 text-xs text-amber-700"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{a.texte}</span>)}</td>
                                            <td className="px-2 font-mono text-xs">{f.numero}</td>
                                            <td className="px-2 text-muted-foreground">{f.debut && f.fin ? `${fr(f.debut)} → ${fr(f.fin)}` : '—'}{f.quantite ? ` · ${f.quantite.toLocaleString('fr-FR')} MWh` : ''}</td>
                                            <td className="px-2 text-right tabular-nums">{eur(f.montantHT)}</td>
                                            <td className="pl-2">{f.refacturee ? <Link href={`/invoices/${f.refacturee.invoiceId}`} className="text-primary hover:underline">{f.refacturee.proforma ? 'proforma' : f.refacturee.numero}</Link> : <span className="text-muted-foreground">—</span>}</td>
                                        </tr>
                                    ))}</tbody>
                                </table>
                            )}
                        </div>
                    </div>
                )}
                <DialogFooter><Button variant="outline" onClick={onClose}>Fermer</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/** Import de la feuille de suivi (onglet « SITES P1 ») : lecture et contrôle dans le navigateur, puis envoi par paquets. */
function ImportFeuille({ ouvert, onClose, onFait }: { ouvert: boolean; onClose: () => void; onFait: (resume: string) => Promise<void> | void }) {
    const [lecture, setLecture] = useState<LectureFeuille | null>(null);
    const [erreur, setErreur] = useState<string | null>(null);
    const [avancement, setAvancement] = useState<number | null>(null);
    useEffect(() => { if (!ouvert) { setLecture(null); setErreur(null); setAvancement(null); } }, [ouvert]);

    const lireFichier = async (f: File | undefined) => {
        setLecture(null); setErreur(null);
        if (!f) return;
        try {
            const table = /\.(xlsx|xlsm|xls)$/i.test(f.name) ? await readXlsxTable(await f.arrayBuffer(), 'SITES P1') : csvToTable(await f.text());
            setLecture(lireFeuille(table));
        } catch (e) { setErreur(e instanceof Error ? e.message : 'Fichier illisible.'); }
    };
    const importer = async () => {
        if (!lecture) return;
        const total = { crees: 0, misAJour: 0, periodes: 0, rattaches: 0 };
        for (let i = 0; i < lecture.points.length; i += 150) {
            setAvancement(Math.round((i / lecture.points.length) * 100));
            const r = await importerPointsAction(lecture.points.slice(i, i + 150));
            if (!r.success) { setErreur(`Import interrompu après ${i} points : ${r.error}`); setAvancement(null); return; }
            total.crees += r.data.crees; total.misAJour += r.data.misAJour; total.periodes += r.data.periodes; total.rattaches += r.data.rattaches;
        }
        setAvancement(null);
        await onFait(`${total.crees} points créés, ${total.misAJour} mis à jour, ${total.periodes} périodes, ${total.rattaches} rattachés à un site par leur PDL.`);
        onClose();
    };
    const bloquant = !!lecture && lecture.points.length === 0;

    return (
        <Dialog open={ouvert} onOpenChange={o => { if (!o && avancement === null) onClose(); }}>
            <DialogContent className="sm:max-w-[640px]">
                <DialogHeader>
                    <DialogTitle>Importer la feuille de suivi</DialogTitle>
                    <DialogDescription>Fichier Excel du classeur (l'onglet « SITES P1 » est lu) ou cet onglet enregistré en CSV. L'import se rejoue sans doublon : les périodes saisies dans le logiciel sont conservées.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3 text-sm">
                    <Input type="file" accept=".xlsx,.xlsm,.csv" disabled={avancement !== null} onChange={e => lireFichier(e.target.files?.[0])} aria-label="Fichier de la feuille de suivi" />
                    {erreur && <p className="text-destructive">{erreur}</p>}
                    {lecture && (
                        <div className="space-y-2 rounded-md border p-3" data-bloc="lecture-feuille">
                            <p className="font-medium">{lecture.lignes.toLocaleString('fr-FR')} lignes lues : {lecture.points.length.toLocaleString('fr-FR')} points de livraison, {lecture.periodes.toLocaleString('fr-FR')} périodes.</p>
                            {lecture.anomalies.length > 0 && (
                                <div>
                                    <p className="text-amber-700">{lecture.anomalies.length} remarque{lecture.anomalies.length > 1 ? 's' : ''} (les lignes concernées sont importées, sauf mention « ignorée ») :</p>
                                    <ul className="mt-1 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs text-muted-foreground">
                                        {lecture.anomalies.slice(0, 200).map((a, i) => <li key={i}>Ligne {a.ligne} : {a.message}</li>)}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                    {avancement !== null && <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Import en cours… {avancement} %</p>}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={avancement !== null}>Annuler</Button>
                    <Button onClick={importer} disabled={!lecture || bloquant || avancement !== null}>Importer {lecture && !bloquant ? `${lecture.points.length.toLocaleString('fr-FR')} points` : ''}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
