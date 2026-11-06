'use client';

import Link from 'next/link';
import { Edit, Mail, Phone, PlusCircle, Trash2, Upload, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatutFacture, eur0, jourFr } from '@/components/fiches/fiche';
import { enVigueur, manquesPrestation } from '@/components/sites/fiche-site';
import type { Contact, Contract, Invoice, Service, Site, User as Utilisateur } from '@/lib/types';

/** Tableaux des fiches contrat et client : sites, factures, contrats, contacts. */

const TYPES_CONTACT: Record<string, string> = { principal: 'Principal', technique: 'Technique', facturation: 'Facturation', autre: 'Autre' };

export function CarteContacts({ contacts, lienClient }: { contacts: Contact[]; lienClient?: string }) {
    return (
        <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
                <div>
                    <CardTitle className="text-base">Contacts</CardTitle>
                    <CardDescription>Le contact de facturation reçoit les factures.</CardDescription>
                </div>
                {lienClient && <Button variant="link" size="sm" className="h-auto p-0" asChild><Link href={lienClient}>Fiche client</Link></Button>}
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
                {contacts.length === 0 ? <p className="text-muted-foreground">Aucun contact renseigné.</p> : contacts.map(c => (
                    <div key={c.id} className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-medium">{c.name || '—'}</span>
                            <Badge variant={c.type === 'facturation' ? 'secondary' : 'outline'} className="py-0 text-[10px]">{TYPES_CONTACT[c.type] ?? c.type}</Badge>
                            {c.role && <span className="text-xs text-muted-foreground">· {c.role}</span>}
                        </div>
                        {c.email && <p className="flex items-center gap-1.5 pl-5 text-xs text-muted-foreground"><Mail className="h-3 w-3" /><a href={`mailto:${c.email}`} className="hover:underline">{c.email}</a></p>}
                        {c.phone && <p className="flex items-center gap-1.5 pl-5 text-xs text-muted-foreground"><Phone className="h-3 w-3" />{c.phone}</p>}
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}

/** Montant annuel HT en vigueur d'un site (ses prestations en vigueur) et ses prestations incomplètes. */
export function etatSite(site: Site, services: Service[]) {
    const prestations = services.filter(s => s.siteId === site.id && (!site.contractId || !s.contractId || s.contractId === site.contractId));
    const enCours = prestations.filter(s => enVigueur(s));
    return {
        prestations,
        enCours,
        montant: enCours.reduce((t, s) => t + (Number(s.price) || 0), 0),
        incompletes: prestations.filter(s => s.isActive !== false && manquesPrestation(s).length > 0),
    };
}

export function TableauSites({ sites, services, contrats, onAjouter, onImporter, onModifier, onSupprimer }: {
    sites: Site[]; services: Service[]; contrats?: Contract[];
    onAjouter?: () => void; onImporter?: () => void; onModifier?: (s: Site) => void; onSupprimer?: (s: Site) => void;
}) {
    return (
        <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
                <div>
                    <CardTitle className="text-base">Sites</CardTitle>
                    <CardDescription>Montant annuel HT des prestations en vigueur ; cliquez sur un site pour ouvrir sa fiche.</CardDescription>
                </div>
                <div className="flex gap-2">
                    {onImporter && <Button size="sm" variant="outline" onClick={onImporter}><Upload className="mr-1 h-4 w-4" />Importer</Button>}
                    {onAjouter && <Button size="sm" variant="outline" onClick={onAjouter}><PlusCircle className="mr-1 h-4 w-4" />Ajouter un site</Button>}
                </div>
            </CardHeader>
            <CardContent>
                {sites.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">Aucun site.</p> : (
                    <Table>
                        <TableHeader><TableRow>
                            <TableHead>Code</TableHead><TableHead>Nom</TableHead><TableHead>Ville</TableHead>
                            {contrats && <TableHead>Contrat</TableHead>}
                            <TableHead className="text-right">Prestations</TableHead><TableHead className="text-right">Montant annuel HT</TableHead><TableHead>État</TableHead>
                            {(onModifier || onSupprimer) && <TableHead className="text-right">Actions</TableHead>}
                        </TableRow></TableHeader>
                        <TableBody>
                            {sites.map(site => {
                                const e = etatSite(site, services);
                                const contrat = contrats?.find(c => c.id === site.contractId || c.siteIds?.includes(site.id));
                                return (
                                    <TableRow key={site.id}>
                                        <TableCell className="font-mono text-xs">{site.code ?? '—'}</TableCell>
                                        <TableCell className="font-medium"><Link href={`/sites/${site.id}`} className="hover:underline">{site.name}</Link></TableCell>
                                        <TableCell className="text-sm">{site.city || '—'}</TableCell>
                                        {contrats && <TableCell className="text-sm">{contrat ? <Link href={`/contracts/${contrat.id}`} className="font-mono text-xs hover:underline">{contrat.contractNumber ?? contrat.id}</Link> : '—'}</TableCell>}
                                        <TableCell className="text-right text-sm">{e.enCours.length}{e.prestations.length !== e.enCours.length && <span className="text-muted-foreground"> / {e.prestations.length}</span>}</TableCell>
                                        <TableCell className="text-right font-medium">{eur0(e.montant)}</TableCell>
                                        <TableCell>
                                            {e.prestations.length === 0 ? <Badge variant="destructive">Sans prestation</Badge>
                                                : e.incompletes.length ? <Link href={`/sites/${site.id}?onglet=prestations`}><Badge variant="destructive">{e.incompletes.length} incomplète(s)</Badge></Link>
                                                : <Badge variant="secondary">Complet</Badge>}
                                        </TableCell>
                                        {(onModifier || onSupprimer) && (
                                            <TableCell className="whitespace-nowrap text-right">
                                                {onModifier && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onModifier(site)} title="Modifier le site" aria-label="Modifier le site"><Edit className="h-4 w-4" /></Button>}
                                                {onSupprimer && <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => onSupprimer(site)} title="Supprimer le site" aria-label="Supprimer le site"><Trash2 className="h-4 w-4" /></Button>}
                                            </TableCell>
                                        )}
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

export function TableauFactures({ factures, contrats, onGenerer, description }: { factures: Invoice[]; contrats?: Contract[]; onGenerer?: () => void; description?: string }) {
    const triees = [...factures].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return (
        <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
                <div>
                    <CardTitle className="text-base">Factures</CardTitle>
                    <CardDescription>{description ?? 'Du plus récent au plus ancien.'}</CardDescription>
                </div>
                {onGenerer && <Button size="sm" variant="outline" onClick={onGenerer}><PlusCircle className="mr-1 h-4 w-4" />Générer une facture</Button>}
            </CardHeader>
            <CardContent>
                {triees.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">Aucune facture.</p> : (
                    <Table>
                        <TableHeader><TableRow>
                            <TableHead>N°</TableHead>{contrats && <TableHead>Contrat</TableHead>}<TableHead>Date</TableHead><TableHead>Période</TableHead>
                            <TableHead className="text-right">HT</TableHead><TableHead className="text-right">TTC</TableHead><TableHead>Échéance</TableHead><TableHead>Statut</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                            {triees.map(f => {
                                const contrat = contrats?.find(c => c.id === f.contractId);
                                return (
                                    <TableRow key={f.id}>
                                        <TableCell><Link href={`/invoices/${f.id}`} className="font-mono text-xs underline">{f.invoiceNumber ?? 'Proforma'}</Link></TableCell>
                                        {contrats && <TableCell>{contrat ? <Link href={`/contracts/${contrat.id}`} className="font-mono text-xs hover:underline">{contrat.contractNumber ?? contrat.id}</Link> : '—'}</TableCell>}
                                        <TableCell className="text-sm">{jourFr(f.date)}</TableCell>
                                        <TableCell className="whitespace-nowrap text-sm">{f.periodStartDate ? `${jourFr(f.periodStartDate)} → ${jourFr(f.periodEndDate)}` : '—'}</TableCell>
                                        <TableCell className="text-right">{eur0(Number(f.subtotal) || 0)}</TableCell>
                                        <TableCell className="text-right font-medium">{eur0(Number(f.total) || 0)}</TableCell>
                                        <TableCell className="text-sm">{jourFr(f.dueDate)}</TableCell>
                                        <TableCell><StatutFacture statut={f.status} /></TableCell>
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

export function TableauContrats({ contrats, sites, services, users, actions }: { contrats: Contract[]; sites: Site[]; services: Service[]; users: Utilisateur[]; actions?: React.ReactNode }) {
    const nom = (id?: string | null) => { const u = users.find(x => x.id === id); return u ? [u.firstName, u.name].filter(Boolean).join(' ') || u.email : null; };
    return (
        <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
                <div>
                    <CardTitle className="text-base">Contrats</CardTitle>
                    <CardDescription>Montant annuel HT des prestations en vigueur de leurs sites.</CardDescription>
                </div>
                {actions && <div className="flex gap-2">{actions}</div>}
            </CardHeader>
            <CardContent>
                {contrats.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">Aucun contrat rattaché à ce client.</p> : (
                    <Table>
                        <TableHeader><TableRow>
                            <TableHead>N°</TableHead><TableHead>Libellé</TableHead><TableHead>Statut</TableHead><TableHead>Période</TableHead>
                            <TableHead className="text-right">Sites</TableHead><TableHead className="text-right">Montant annuel HT</TableHead><TableHead>Responsable facturation</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                            {contrats.map(c => {
                                const sitesDuContrat = sites.filter(s => s.contractId === c.id || c.siteIds?.includes(s.id));
                                const montant = sitesDuContrat.reduce((t, s) => t + etatSite(s, services).montant, 0);
                                const responsable = nom(c.billingManagerId);
                                return (
                                    <TableRow key={c.id}>
                                        <TableCell><Link href={`/contracts/${c.id}`} className="font-mono text-xs underline">{c.contractNumber ?? c.id.slice(0, 8)}</Link></TableCell>
                                        <TableCell className="text-sm">{c.label || '—'}</TableCell>
                                        <TableCell><Badge variant={c.status === 'Actif' ? 'default' : c.status === 'Résilié' ? 'destructive' : 'secondary'}>{c.status}</Badge></TableCell>
                                        <TableCell className="whitespace-nowrap text-sm">{jourFr(c.startDate)} → {jourFr(c.endDate)}</TableCell>
                                        <TableCell className="text-right text-sm">{sitesDuContrat.length}</TableCell>
                                        <TableCell className="text-right font-medium">{eur0(montant)}</TableCell>
                                        <TableCell className={responsable ? 'text-sm' : 'text-sm text-amber-700'}>{responsable ?? 'Sans responsable'}</TableCell>
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
