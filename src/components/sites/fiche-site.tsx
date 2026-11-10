'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, BookOpen, CheckCircle2, ChevronRight, Edit, Gauge, Loader2, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MeterReadingsDialog } from '@/components/meter-readings-dialog';
import { StatutFacture } from '@/components/fiches/fiche';
import { P1CompteurDialog } from '@/components/p1/p1-parametrage-panel';
import { cn } from '@/lib/utils';
import type { Activity, Invoice, Meter, Schedule, Service, Site } from '@/lib/types';

/**
 * Briques de la fiche site : indicateurs du bandeau, encart « à faire », tableaux des prestations, compteurs et
 * factures, fenêtre de modification du site. La page assemble ; les calculs restent simples et lisibles ici.
 */

export const ONGLETS_SITE = ['synthese', 'prestations', 'compteurs', 'p1', 'factures'] as const;
export type OngletSite = typeof ONGLETS_SITE[number];

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const jour = (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
export const JOURS_SANS_RELEVE = 45;

export { AFaire, Indicateur, type PointAFaire } from '@/components/fiches/fiche';

// ── Prestations ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Prestation en vigueur aujourd'hui (active, dans sa période). */
export function enVigueur(s: Service, today = new Date().toISOString().slice(0, 10)): boolean {
    if (s.isActive === false) return false;
    const debut = s.startDate ? String(s.startDate).slice(0, 10) : '';
    const fin = s.endDate ? String(s.endDate).slice(0, 10) : '';
    return (!debut || debut <= today) && (!fin || fin >= today);
}

/** Ce qui manque à une prestation pour être facturée. */
export function manquesPrestation(s: Service): string[] {
    const m: string[] = [];
    if (!s.vatRateId) m.push('TVA');
    if (!s.scheduleId) m.push('périodicité');
    if (!s.billingTermId) m.push('terme');
    if (!(Number(s.price) > 0) && !(s.type === 'P1' && (s.p1Mode === 'acompte' || s.p1Mode === 'releve' || s.p1Mode === 'dju'))) m.push('montant');
    return m;
}

export function libellePrestation(s: Service, activities: Activity[]): string {
    const a = activities.find(x => x.id === s.activityId);
    const p1 = s.type === 'P1' && s.p1Type ? ({ ECS: 'ECS', CHAUFFAGE: 'Chauffage', EAU_FROIDE: 'Eau froide', AUTRE: 'Autre' } as Record<string, string>)[s.p1Type] : '';
    return [s.label || a?.label || a?.code || s.type, p1].filter(Boolean).join(' — ');
}

export function TableauPrestations({ services, activities, schedules, onOuvrir, onAjouter }: {
    services: Service[]; activities: Activity[]; schedules: Schedule[]; onOuvrir: (s: Service) => void; onAjouter: () => void;
}) {
    return (
        <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <div>
                    <CardTitle className="text-base">Prestations</CardTitle>
                    <CardDescription>Ce qui est facturé sur ce site. Cliquez sur une ligne pour en voir le détail.</CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={onAjouter}><Plus className="mr-1 h-4 w-4" />Ajouter</Button>
            </CardHeader>
            <CardContent>
                {services.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">Aucune prestation : rien n&apos;est facturé sur ce site.</p> : (
                    <Table>
                        <TableHeader><TableRow>
                            <TableHead className="w-12">Type</TableHead><TableHead>Prestation</TableHead><TableHead className="text-right">Montant annuel HT</TableHead>
                            <TableHead>Périodicité</TableHead><TableHead>Période</TableHead><TableHead>État</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                            {services.map(s => {
                                const manques = manquesPrestation(s);
                                const actif = enVigueur(s);
                                return (
                                    <TableRow key={s.id} className="cursor-pointer" onClick={() => onOuvrir(s)}>
                                        <TableCell><Badge variant="outline">{s.type}</Badge></TableCell>
                                        <TableCell className="font-medium">{libellePrestation(s, activities)}</TableCell>
                                        <TableCell className="text-right">
                                            {s.type === 'P1' && (s.p1Mode === 'acompte' || s.p1Mode === 'releve' || s.p1Mode === 'dju')
                                                ? <span className="text-xs text-muted-foreground">{s.p1Mode === 'acompte' ? 'acomptes P1' : s.p1Mode === 'dju' ? 'au DJU' : 'au compteur'}</span>
                                                : eur(Number(s.price) || 0)}
                                        </TableCell>
                                        <TableCell className="text-sm">{schedules.find(x => x.id === s.scheduleId)?.name ?? '—'}</TableCell>
                                        <TableCell className="whitespace-nowrap text-sm">{jour(s.startDate)} → {s.endDate ? jour(s.endDate) : '…'}</TableCell>
                                        <TableCell>
                                            {manques.length ? <Badge variant="destructive" title={`Manque : ${manques.join(', ')}`}>Incomplète</Badge>
                                                : actif ? <Badge variant="secondary">En vigueur</Badge> : <Badge variant="outline">Hors période</Badge>}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
}

/** Liste des prestations groupées par type (onglet Prestations), avec ajout par type. */
export function ListePrestations({ services, activities, selection, onSelection, onAjouter }: {
    services: Service[]; activities: Activity[]; selection: string | null; onSelection: (s: Service) => void; onAjouter: (type: Service['type']) => void;
}) {
    const types: { type: Service['type']; libelle: string }[] = [{ type: 'P1', libelle: 'P1 — Énergie' }, { type: 'P2', libelle: 'P2 — Maintenance' }, { type: 'P3', libelle: 'P3 — Renouvellement' }];
    return (
        <Card>
            <CardContent className="space-y-4 p-3">
                {types.map(({ type, libelle }) => {
                    const liste = services.filter(s => s.type === type);
                    return (
                        <div key={type} className="space-y-1">
                            <div className="flex items-center justify-between px-1">
                                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{libelle}</span>
                                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => onAjouter(type)} title={`Ajouter une prestation ${type}`}><Plus className="h-3 w-3" /></Button>
                            </div>
                            {liste.length === 0 && <p className="px-1 text-xs text-muted-foreground">Aucune.</p>}
                            {liste.map(s => {
                                const manques = manquesPrestation(s);
                                return (
                                    <button key={s.id} type="button" onClick={() => onSelection(s)}
                                        className={cn('flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/50',
                                            selection === s.id && 'border-primary bg-primary/5')}>
                                        <span className="min-w-0 truncate">{libellePrestation(s, activities)}</span>
                                        {manques.length > 0 ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-label={`Incomplète : ${manques.join(', ')}`} />
                                            : !enVigueur(s) && <span className="shrink-0 text-[10px] text-muted-foreground">hors période</span>}
                                    </button>
                                );
                            })}
                        </div>
                    );
                })}
            </CardContent>
        </Card>
    );
}

// ── Compteurs ───────────────────────────────────────────────────────────────────────────────────────────────────

export function CompteursDuSite({ meters, derniersReleves, onAjouter, onModifier, onSupprimer }: {
    meters: Meter[]; derniersReleves: Map<string, string>; onAjouter: () => void; onModifier: (m: Meter) => void; onSupprimer: (id: string) => void;
}) {
    const limite = Date.now() - JOURS_SANS_RELEVE * 86_400_000;
    return (
        <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <div>
                    <CardTitle className="text-base">Compteurs et relevés</CardTitle>
                    <CardDescription>Relevés, paramétrage P1 (usage, énergie, QE) et fiche de chaque compteur du site.</CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={onAjouter}><Plus className="mr-1 h-4 w-4" />Ajouter un compteur</Button>
            </CardHeader>
            <CardContent>
                {meters.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">Aucun compteur sur ce site.</p> : (
                    <Table>
                        <TableHeader><TableRow>
                            <TableHead>Code</TableHead><TableHead>Nom</TableHead><TableHead>PDL / PCE</TableHead><TableHead>Unité</TableHead>
                            <TableHead>Dernier relevé</TableHead><TableHead>Statut</TableHead><TableHead className="text-right">Actions</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                            {meters.map(m => {
                                const dernier = derniersReleves.get(m.id);
                                const ancien = m.status !== 'off' && (!dernier || Date.parse(dernier) < limite);
                                return (
                                    <TableRow key={m.id}>
                                        <TableCell className="font-mono text-xs">{m.code}</TableCell>
                                        <TableCell className="font-medium">{m.name}</TableCell>
                                        <TableCell className="text-sm">{m.reference || '—'}</TableCell>
                                        <TableCell className="text-sm">{m.unit || '—'}</TableCell>
                                        <TableCell className={cn('text-sm', ancien && 'font-medium text-amber-700')}>
                                            {dernier ? jour(dernier) : 'Jamais relevé'}{ancien && dernier && ` (> ${JOURS_SANS_RELEVE} j)`}
                                        </TableCell>
                                        <TableCell><Badge variant={m.status === 'off' ? 'outline' : 'secondary'}>{m.status === 'off' ? 'Hors service' : 'En service'}</Badge></TableCell>
                                        <TableCell className="whitespace-nowrap text-right">
                                            <MeterReadingsDialog meter={m} trigger={<Button variant="ghost" size="icon" className="h-8 w-8" title="Relevés" aria-label="Relevés"><BookOpen className="h-4 w-4" /></Button>} />
                                            <P1CompteurDialog meterId={m.id} trigger={<Button variant="ghost" size="icon" className="h-8 w-8" title="Paramétrage P1" aria-label="Paramétrage P1"><Gauge className="h-4 w-4" /></Button>} />
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onModifier(m)} title="Modifier" aria-label="Modifier"><Edit className="h-4 w-4" /></Button>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => onSupprimer(m.id)} title="Supprimer" aria-label="Supprimer"><Trash2 className="h-4 w-4" /></Button>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
}

// ── Factures ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Montant HT d'une facture qui concerne ce site : ses lignes du site (par site ou prestation), sinon rien. */
export function montantSite(inv: Invoice, siteId: string, serviceIds: Set<string>): number | null {
    const lignes = (inv.lineItems ?? []).filter(l => l.siteId === siteId
        || (l.itemKey && (l.itemKey.startsWith(`site:${siteId}:`) || serviceIds.has(l.itemKey.slice(4))))
        || (l.serviceId && serviceIds.has(l.serviceId)));
    return lignes.length ? Math.round(lignes.reduce((t, l) => t + (Number(l.total) || 0), 0) * 100) / 100 : null;
}


export function FacturesDuSite({ factures }: { factures: { invoice: Invoice; montant: number | null }[] }) {
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-base">Factures</CardTitle>
                <CardDescription>Factures du contrat qui portent des lignes de ce site (montant HT de ces lignes).</CardDescription>
            </CardHeader>
            <CardContent>
                {factures.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">Aucune facture pour ce site.</p> : (
                    <Table>
                        <TableHeader><TableRow>
                            <TableHead>N°</TableHead><TableHead>Date</TableHead><TableHead>Période</TableHead><TableHead className="text-right">HT du site</TableHead>
                            <TableHead className="text-right">Total facture TTC</TableHead><TableHead>Statut</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                            {factures.map(({ invoice: f, montant }) => (
                                <TableRow key={f.id}>
                                    <TableCell><Link href={`/invoices/${f.id}`} className="font-mono text-xs underline">{f.invoiceNumber ?? 'Proforma'}</Link></TableCell>
                                    <TableCell className="text-sm">{jour(f.date)}</TableCell>
                                    <TableCell className="whitespace-nowrap text-sm">{f.periodStartDate ? `${jour(f.periodStartDate)} → ${jour(f.periodEndDate)}` : '—'}</TableCell>
                                    <TableCell className="text-right font-medium">{montant === null ? '—' : eur(montant)}</TableCell>
                                    <TableCell className="text-right text-sm text-muted-foreground">{eur(Number(f.total) || 0)}</TableCell>
                                    <TableCell><StatutFacture statut={f.status} /></TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
}

// ── Modifier le site ────────────────────────────────────────────────────────────────────────────────────────────

export type SiteModifiable = Pick<Site, 'name' | 'address' | 'postalCode' | 'city' | 'siteNumber' | 'externalRef'>;

export function ModifierSiteDialog({ site, open, onOpenChange, onEnregistrer }: {
    site: Site; open: boolean; onOpenChange: (o: boolean) => void; onEnregistrer: (data: SiteModifiable) => Promise<boolean>;
}) {
    const [v, setV] = useState<SiteModifiable>({ name: '', address: '' });
    const [envoi, setEnvoi] = useState(false);
    useEffect(() => {
        if (open) setV({ name: site.name ?? '', address: site.address ?? '', postalCode: site.postalCode ?? '', city: site.city ?? '', siteNumber: site.siteNumber ?? '', externalRef: site.externalRef ?? '' });
    }, [open, site]);
    const champ = (k: keyof SiteModifiable, label: string, opts: { requis?: boolean; placeholder?: string } = {}) => (
        <div className="space-y-1.5">
            <Label htmlFor={`site-${k}`}>{label}{opts.requis && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}</Label>
            <Input id={`site-${k}`} value={v[k] ?? ''} placeholder={opts.placeholder} onChange={e => setV(x => ({ ...x, [k]: e.target.value }))} />
        </div>
    );
    const invalide = !v.name?.trim() || !v.address?.trim();
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <form className="space-y-4" onSubmit={async e => {
                    e.preventDefault();
                    if (invalide) return;
                    setEnvoi(true);
                    const ok = await onEnregistrer({ ...v, name: v.name.trim(), address: v.address.trim() });
                    setEnvoi(false);
                    if (ok) onOpenChange(false);
                }}>
                    <DialogHeader>
                        <DialogTitle>Modifier le site</DialogTitle>
                        <DialogDescription>Le code {site.code ?? 'SIT'} ne change pas. Le rattachement au contrat se modifie depuis l&apos;import des sites.</DialogDescription>
                    </DialogHeader>
                    {champ('name', 'Nom du site', { requis: true })}
                    {champ('address', 'Adresse', { requis: true })}
                    <div className="grid grid-cols-3 gap-3">
                        {champ('postalCode', 'Code postal')}
                        <div className="col-span-2">{champ('city', 'Ville')}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        {champ('siteNumber', 'N° de site', { placeholder: 'Numéro libre' })}
                        {champ('externalRef', 'Réf. externe', { placeholder: 'Ancienne codification' })}
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
                        <Button type="submit" disabled={envoi || invalide}>{envoi && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Enregistrer</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
