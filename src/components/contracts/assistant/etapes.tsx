'use client';

import { useMemo, useState } from 'react';
import { FileText, Loader2, MapPin, PenLine, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { optionsClients } from '@/lib/select-options';
import { cn } from '@/lib/utils';
import { doublonsClient, lignesPrestations, type Brouillon, type LignePrestation } from '@/lib/contracts/assistant';
import type { Activity, Agency, Client, Company, Schedule, Sector, Site, Term, Typology, User, VatRate } from '@/lib/types';

/** Étapes de l'assistant de création de contrat (présentation ; la logique est dans lib/contracts/assistant). */

export type Refs = {
    clients: Client[]; sites: Site[]; activities: Activity[]; typologies: Typology[]; companies: Company[]; agencies: Agency[]; sectors: Sector[];
    schedules: Schedule[]; terms: Term[]; vatRates: VatRate[]; users: User[];
};
type PropsEtape = { b: Brouillon; maj: (f: (b: Brouillon) => Brouillon) => void; refs: Refs };

/** Champ lu dans le PDF : à vérifier. */
function LuPdf({ b, champ }: { b: Brouillon; champ: string }) {
    if (!b.lusDansPdf.includes(champ)) return null;
    return <Badge variant="outline" className="ml-1.5 gap-0.5 border-violet-300 px-1 py-0 text-[10px] font-normal text-violet-700" title="Valeur lue dans le PDF : à vérifier"><Sparkles className="h-2.5 w-2.5" />PDF</Badge>;
}

function Champ({ label, requis, children, aide, pdf }: { label: string; requis?: boolean; children: React.ReactNode; aide?: string; pdf?: React.ReactNode }) {
    return (
        <div className="space-y-1.5">
            <Label className="flex items-center">{label}{requis && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}{pdf}</Label>
            {children}
            {aide && <p className="text-xs text-muted-foreground">{aide}</p>}
        </div>
    );
}

function Choix({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string }) {
    return (
        <Select value={value || undefined} onValueChange={onChange}>
            <SelectTrigger><SelectValue placeholder={placeholder ?? 'Choisir…'} /></SelectTrigger>
            <SelectContent>{options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
    );
}

// ── 0. Source ───────────────────────────────────────────────────────────────────────────────────────────────────

export function EtapeSource({ b, maj, onAnalyser, analyse, consignes, setConsignes }: PropsEtape & {
    onAnalyser: (fichier: File) => void; analyse: boolean; consignes: string; setConsignes: (s: string) => void;
}) {
    const [fichier, setFichier] = useState<File | null>(null);
    const [voirConsignes, setVoirConsignes] = useState(false);
    const sources: { id: Brouillon['source']; titre: string; texte: string; icone: React.ElementType }[] = [
        { id: 'saisie', titre: 'Saisie', texte: 'Je renseigne le contrat moi-même, étape par étape.', icone: PenLine },
        { id: 'pdf-prive', titre: 'Depuis un PDF — marché privé', texte: 'Le contrat est lu (client, dates, sites…) ; je vérifie et complète.', icone: FileText },
        { id: 'pdf-public', titre: 'Depuis un PDF — marché public', texte: 'Acte d\'engagement, CCAP, CCTP… lus ; je vérifie et complète.', icone: FileText },
    ];
    return (
        <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
                {sources.map(s => (
                    <button key={s.id} type="button" onClick={() => maj(x => ({ ...x, source: s.id, contrat: { ...x.contrat, marketType: s.id === 'pdf-public' ? 'Marché Public' : s.id === 'pdf-prive' ? 'Marché Privé' : x.contrat.marketType } }))}
                        className={cn('rounded-lg border p-4 text-left transition-colors hover:bg-muted/50', b.source === s.id && 'border-primary bg-primary/5 ring-1 ring-primary')}>
                        <s.icone className="mb-2 h-5 w-5 text-primary" />
                        <p className="font-medium">{s.titre}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{s.texte}</p>
                    </button>
                ))}
            </div>
            {b.source !== 'saisie' && (
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Document à analyser</CardTitle>
                        <CardDescription>PDF du contrat (15 Mo au plus). La lecture prend quelques dizaines de secondes ; chaque valeur lue est signalée « PDF » dans les étapes suivantes, à vérifier.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex flex-wrap items-center gap-3">
                            <Input type="file" accept="application/pdf,.pdf" className="max-w-sm" onChange={e => setFichier(e.target.files?.[0] ?? null)} />
                            <Button disabled={!fichier || analyse || (fichier?.size ?? 0) > 15 * 1024 * 1024} onClick={() => fichier && onAnalyser(fichier)}>
                                {analyse ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Analyser le PDF
                            </Button>
                            {(fichier?.size ?? 0) > 15 * 1024 * 1024 && <span className="text-sm text-destructive">Fichier trop volumineux (15 Mo au plus).</span>}
                        </div>
                        {b.lusDansPdf.length > 0 && <p className="text-sm text-green-700">{b.lusDansPdf.length} information(s) lue(s) dans le PDF : passez à l&apos;étape suivante pour les vérifier.</p>}
                        <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setVoirConsignes(v => !v)}>{voirConsignes ? 'Masquer' : 'Voir'} les consignes d&apos;analyse (avancé)</Button>
                        {voirConsignes && <Textarea rows={8} value={consignes} onChange={e => setConsignes(e.target.value)} className="font-mono text-xs" />}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

// ── 1. Client ───────────────────────────────────────────────────────────────────────────────────────────────────

export function EtapeClient({ b, maj, refs }: PropsEtape) {
    const n = b.client.nouveau;
    const majN = (p: Partial<typeof n>) => maj(x => ({ ...x, client: { ...x.client, nouveau: { ...x.client.nouveau, ...p } } }));
    const doublons = useMemo(() => (b.client.mode === 'nouveau' ? doublonsClient(n, refs.clients) : []), [b.client.mode, n, refs.clients]);
    const client = refs.clients.find(c => c.id === b.client.clientId);
    return (
        <div className="space-y-4">
            <RadioGroup value={b.client.mode} onValueChange={v => maj(x => ({ ...x, client: { ...x.client, mode: v as 'existant' | 'nouveau' } }))} className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="existant" />Client existant</label>
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="nouveau" />Nouveau client</label>
            </RadioGroup>

            {b.client.mode === 'existant' ? (
                <div className="max-w-xl space-y-3">
                    <Champ label="Client" requis>
                        <SearchableSelect value={b.client.clientId} onValueChange={v => maj(x => ({ ...x, client: { ...x.client, clientId: v }, sites: { ...x.sites, existants: [] } }))}
                            options={optionsClients(refs.clients)} placeholder="Choisir un client…" searchPlaceholder="Nom, code client, SIRET, ville…" />
                    </Champ>
                    {client && (
                        <p className="text-sm text-muted-foreground">
                            {[client.address, [client.postalCode, client.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
                            {client.siret && <> · SIRET <span className="font-mono">{client.siret}</span></>}
                        </p>
                    )}
                </div>
            ) : (
                <div className="space-y-4">
                    {doublons.length > 0 && (
                        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                            <p className="font-medium">Ce client existe peut-être déjà :</p>
                            <ul className="mt-1 space-y-1">
                                {doublons.slice(0, 3).map(d => (
                                    <li key={d.id} className="flex flex-wrap items-center gap-2">
                                        <span>{d.name} {d.externalCode && <span className="font-mono text-xs">({d.externalCode})</span>} — {[d.postalCode, d.city].filter(Boolean).join(' ')}{d.siret && ` · SIRET ${d.siret}`}</span>
                                        <Button size="sm" variant="outline" className="h-7" onClick={() => maj(x => ({ ...x, client: { ...x.client, mode: 'existant', clientId: d.id } }))}>Utiliser ce client</Button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    <div className="grid gap-4 md:grid-cols-2">
                        <Champ label="Raison sociale" requis pdf={<LuPdf b={b} champ="client.name" />}><Input value={n.name} onChange={e => majN({ name: e.target.value })} /></Champ>
                        <Champ label="Type" requis pdf={<LuPdf b={b} champ="client.clientType" />}>
                            <Choix value={n.clientType} onChange={v => majN({ clientType: v as 'private' | 'public' })} options={[{ value: 'private', label: 'Privé' }, { value: 'public', label: 'Public' }]} />
                        </Champ>
                        <Champ label="Typologie" requis pdf={<LuPdf b={b} champ="client.typologyId" />}>
                            <Choix value={n.typologyId} onChange={v => majN({ typologyId: v })} options={refs.typologies.map(t => ({ value: t.id, label: t.name }))} />
                        </Champ>
                        <Champ label="SIRET" requis={n.clientType === 'public'} pdf={<LuPdf b={b} champ="client.siret" />} aide={n.clientType === 'public' ? 'Obligatoire pour déposer les factures (Chorus Pro).' : undefined}>
                            <Input value={n.siret} onChange={e => majN({ siret: e.target.value })} placeholder="14 chiffres" />
                        </Champ>
                        <Champ label="Société" requis><Choix value={n.companyId} onChange={v => majN({ companyId: v, agencyId: '', sectorId: '' })} options={refs.companies.map(c => ({ value: c.id, label: c.name }))} /></Champ>
                        <Champ label="Agence" requis><Choix value={n.agencyId} onChange={v => majN({ agencyId: v, sectorId: '' })} options={refs.agencies.filter(a => a.companyId === n.companyId).map(a => ({ value: a.id, label: a.name }))} placeholder={n.companyId ? 'Choisir…' : 'Choisissez d\'abord la société'} /></Champ>
                        <Champ label="Secteur" requis><Choix value={n.sectorId} onChange={v => majN({ sectorId: v })} options={refs.sectors.filter(s => s.agencyId === n.agencyId).map(s => ({ value: s.id, label: s.name }))} placeholder={n.agencyId ? 'Choisir…' : 'Choisissez d\'abord l\'agence'} /></Champ>
                        <Champ label="Représenté par (syndic)" pdf={<LuPdf b={b} champ="client.representedBy" />}><Input value={n.representedBy} onChange={e => majN({ representedBy: e.target.value })} /></Champ>
                        <Champ label="Adresse" requis pdf={<LuPdf b={b} champ="client.address" />}><Input value={n.address} onChange={e => majN({ address: e.target.value })} /></Champ>
                        <div className="grid grid-cols-3 gap-3">
                            <Champ label="Code postal" requis pdf={<LuPdf b={b} champ="client.postalCode" />}><Input value={n.postalCode} onChange={e => majN({ postalCode: e.target.value })} /></Champ>
                            <div className="col-span-2"><Champ label="Ville" requis pdf={<LuPdf b={b} champ="client.city" />}><Input value={n.city} onChange={e => majN({ city: e.target.value })} /></Champ></div>
                        </div>
                    </div>
                    <div className="rounded-md border p-3">
                        <p className="mb-2 text-sm font-medium">Contact de facturation <span className="font-normal text-muted-foreground">(reçoit les factures ; facultatif)</span></p>
                        <div className="grid gap-3 md:grid-cols-3">
                            <Champ label="Nom" pdf={<LuPdf b={b} champ="client.contactFacturation.name" />}><Input value={n.contactFacturation.name} onChange={e => majN({ contactFacturation: { ...n.contactFacturation, name: e.target.value } })} /></Champ>
                            <Champ label="E-mail" pdf={<LuPdf b={b} champ="client.contactFacturation.email" />}><Input type="email" value={n.contactFacturation.email} onChange={e => majN({ contactFacturation: { ...n.contactFacturation, email: e.target.value } })} /></Champ>
                            <Champ label="Téléphone" pdf={<LuPdf b={b} champ="client.contactFacturation.phone" />}><Input value={n.contactFacturation.phone} onChange={e => majN({ contactFacturation: { ...n.contactFacturation, phone: e.target.value } })} /></Champ>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── 2. Contrat ──────────────────────────────────────────────────────────────────────────────────────────────────

export function EtapeContrat({ b, maj, refs }: PropsEtape) {
    const c = b.contrat;
    const majC = (p: Partial<typeof c>) => maj(x => ({ ...x, contrat: { ...x.contrat, ...p } }));
    const nom = (u: User) => [u.firstName, u.name].filter(Boolean).join(' ') || u.email;
    return (
        <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
                <Champ label="Libellé" requis pdf={<LuPdf b={b} champ="contrat.label" />} aide="Ce que couvre le contrat (ex. « Chauffage et ECS »)."><Input value={c.label} onChange={e => majC({ label: e.target.value })} /></Champ>
                <Champ label="Type de marché">
                    <Choix value={c.marketType} onChange={v => majC({ marketType: v as Brouillon['contrat']['marketType'] })} options={[{ value: 'Marché Privé', label: 'Privé' }, { value: 'Marché Public', label: 'Public' }]} />
                </Champ>
                <Champ label="Début" requis pdf={<LuPdf b={b} champ="contrat.startDate" />}><Input type="date" value={c.startDate} onChange={e => majC({ startDate: e.target.value })} /></Champ>
                <Champ label="Fin" requis pdf={<LuPdf b={b} champ="contrat.endDate" />}><Input type="date" value={c.endDate} onChange={e => majC({ endDate: e.target.value })} /></Champ>
            </div>
            <Champ label="Activités" requis pdf={<LuPdf b={b} champ="contrat.activityIds" />} aide="Seules les activités du contrat peuvent être facturées sur ses sites.">
                <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-md border p-3">
                    {refs.activities.map(a => (
                        <label key={a.id} className="flex items-center gap-2 text-sm">
                            <Checkbox checked={c.activityIds.includes(a.id)} onCheckedChange={v => majC({ activityIds: v ? [...c.activityIds, a.id] : c.activityIds.filter(x => x !== a.id) })} />
                            <span className="font-mono text-xs">{a.code}</span> {a.label}
                        </label>
                    ))}
                </div>
            </Champ>
            <div className="grid gap-4 md:grid-cols-4">
                <Champ label="Facturation" pdf={<LuPdf b={b} champ="contrat.invoicingType" />}>
                    <Choix value={c.invoicingType} onChange={v => majC({ invoicingType: v as 'multi-site' | 'global' })} options={[{ value: 'multi-site', label: 'Détaillée par site' }, { value: 'global', label: 'Globale' }]} />
                </Champ>
                <Champ label="Périodicité par défaut" aide="Proposée pour chaque prestation."><Choix value={c.scheduleId} onChange={v => majC({ scheduleId: v })} options={refs.schedules.map(s => ({ value: s.id, label: s.name }))} /></Champ>
                <Champ label="Terme par défaut"><Choix value={c.termId} onChange={v => majC({ termId: v })} options={refs.terms.map(t => ({ value: t.id, label: t.name }))} /></Champ>
                <Champ label="TVA par défaut"><Choix value={c.vatRateId} onChange={v => majC({ vatRateId: v })} options={refs.vatRates.map(v => ({ value: v.id, label: `${v.code} (${v.rate} %)` }))} /></Champ>
            </div>
            <div className="grid gap-4 md:grid-cols-4">
                <label className="flex items-center gap-2 pt-6 text-sm"><Switch checked={c.renewal} onCheckedChange={v => majC({ renewal: v })} />Reconduction</label>
                <label className="flex items-center gap-2 pt-6 text-sm"><Switch checked={c.tacitRenewal} onCheckedChange={v => majC({ tacitRenewal: v })} />Tacite reconduction<LuPdf b={b} champ="contrat.tacitRenewal" /></label>
                <Champ label="Durée de reconduction"><Input value={c.renewalDuration} onChange={e => majC({ renewalDuration: e.target.value })} placeholder="1 an" /></Champ>
                <Champ label="Préavis" pdf={<LuPdf b={b} champ="contrat.noticePeriod" />}><Input value={c.noticePeriod} onChange={e => majC({ noticePeriod: e.target.value })} placeholder="3 mois" /></Champ>
            </div>
            <div className="max-w-sm">
                <Champ label="Responsable facturation" aide="L'ADV qui suit ce contrat (pilotage de la facturation).">
                    <Choix value={c.billingManagerId} onChange={v => majC({ billingManagerId: v })} options={[...refs.users].sort((a, z) => nom(a).localeCompare(nom(z), 'fr')).map(u => ({ value: u.id, label: nom(u) }))} />
                </Champ>
            </div>
        </div>
    );
}

// ── 3. Sites ────────────────────────────────────────────────────────────────────────────────────────────────────

export function EtapeSites({ b, maj, refs }: PropsEtape) {
    const client = b.client.mode === 'existant' ? refs.clients.find(c => c.id === b.client.clientId) : null;
    const libres = client ? refs.sites.filter(s => s.clientId === client.id && !s.contractId) : [];
    const adresseClient = client
        ? { address: client.address ?? '', postalCode: client.postalCode ?? '', city: client.city ?? '' }
        : { address: b.client.nouveau.address, postalCode: b.client.nouveau.postalCode, city: b.client.nouveau.city };
    const ajouter = (avecAdresse: boolean) => maj(x => ({
        ...x, sites: { ...x.sites, nouveaux: [...x.sites.nouveaux, { cle: `n-${Date.now()}`, name: '', ...(avecAdresse ? adresseClient : { address: '', postalCode: '', city: '' }) }] },
    }));
    const majSite = (cle: string, p: Partial<Brouillon['sites']['nouveaux'][number]>) =>
        maj(x => ({ ...x, sites: { ...x.sites, nouveaux: x.sites.nouveaux.map(s => (s.cle === cle ? { ...s, ...p } : s)) } }));
    return (
        <div className="space-y-4">
            {libres.length > 0 && (
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-base">Sites existants du client, sans contrat</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                        {libres.map(s => (
                            <label key={s.id} className="flex items-center gap-2 text-sm">
                                <Checkbox checked={b.sites.existants.includes(s.id)} onCheckedChange={v => maj(x => ({ ...x, sites: { ...x.sites, existants: v ? [...x.sites.existants, s.id] : x.sites.existants.filter(i => i !== s.id) } }))} />
                                <span className="font-mono text-xs">{s.code}</span> {s.name} <span className="text-muted-foreground">— {[s.address, s.city].filter(Boolean).join(', ')}</span>
                            </label>
                        ))}
                    </CardContent>
                </Card>
            )}
            <Card>
                <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
                    <div>
                        <CardTitle className="flex items-center text-base">Nouveaux sites<LuPdf b={b} champ="sites" /></CardTitle>
                        <CardDescription>Un code SIT est attribué à chacun à la création.</CardDescription>
                    </div>
                    <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => ajouter(true)} disabled={!adresseClient.address}><MapPin className="mr-1 h-4 w-4" />À l&apos;adresse du client</Button>
                        <Button size="sm" variant="outline" onClick={() => ajouter(false)}><Plus className="mr-1 h-4 w-4" />Ajouter un site</Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-3">
                    {b.sites.nouveaux.length === 0 && <p className="text-sm text-muted-foreground">Aucun nouveau site.</p>}
                    {b.sites.nouveaux.map((s, i) => (
                        <div key={s.cle} className="grid items-end gap-3 rounded-md border p-3 md:grid-cols-[1.2fr_1.5fr_0.6fr_1fr_auto]">
                            <Champ label={`Site ${i + 1} — nom`} requis><Input value={s.name} onChange={e => majSite(s.cle, { name: e.target.value })} placeholder="Chaufferie, Bâtiment A…" /></Champ>
                            <Champ label="Adresse" requis><Input value={s.address} onChange={e => majSite(s.cle, { address: e.target.value })} /></Champ>
                            <Champ label="Code postal"><Input value={s.postalCode} onChange={e => majSite(s.cle, { postalCode: e.target.value })} /></Champ>
                            <Champ label="Ville"><Input value={s.city} onChange={e => majSite(s.cle, { city: e.target.value })} /></Champ>
                            <Button variant="ghost" size="icon" className="text-destructive" aria-label={`Retirer le site ${i + 1}`}
                                onClick={() => maj(x => ({ ...x, sites: { ...x.sites, nouveaux: x.sites.nouveaux.filter(y => y.cle !== s.cle) }, prestations: { ...x.prestations, lignes: x.prestations.lignes.filter(l => l.site !== s.cle) } }))}>
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
                </CardContent>
            </Card>
        </div>
    );
}

// ── 4. Prestations ──────────────────────────────────────────────────────────────────────────────────────────────

export function EtapePrestations({ b, maj, refs }: PropsEtape) {
    const lignes = lignesPrestations(b);
    const nomSite = (cle: string) => b.sites.nouveaux.find(s => s.cle === cle)?.name || refs.sites.find(s => s.id === cle)?.name || 'Site';
    const majLigne = (l: LignePrestation, p: Partial<LignePrestation>) => maj(x => {
        const toutes = lignesPrestations(x).map(y => (y.site === l.site && y.activityId === l.activityId ? { ...y, ...p } : y));
        return { ...x, prestations: { ...x.prestations, lignes: toutes } };
    });
    return (
        <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm">
                <Switch checked={b.prestations.saisir} onCheckedChange={v => maj(x => ({ ...x, prestations: { ...x.prestations, saisir: v } }))} />
                Saisir les prestations maintenant <span className="text-muted-foreground">(sinon : sur la fiche de chaque site, après la création)</span>
            </label>
            {b.prestations.saisir && (
                lignes.length === 0 ? <p className="text-sm text-muted-foreground">Ajoutez des sites et des activités aux étapes précédentes.</p> : (
                    <div className="overflow-x-auto rounded-md border">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                                <tr><th className="p-2">Site</th><th className="p-2">Activité</th><th className="p-2">Montant annuel HT</th><th className="p-2">Périodicité</th><th className="p-2">Terme</th><th className="p-2">TVA</th><th className="p-2">Début</th></tr>
                            </thead>
                            <tbody>
                                {lignes.map(l => {
                                    const a = refs.activities.find(x => x.id === l.activityId);
                                    return (
                                        <tr key={`${l.site}-${l.activityId}`} className="border-t">
                                            <td className="p-2 font-medium">{nomSite(l.site)}</td>
                                            <td className="p-2"><span className="font-mono text-xs">{a?.code}</span> {a?.label}</td>
                                            <td className="p-2"><Input className="h-8 w-32 text-right" inputMode="decimal" value={l.montant} placeholder="vide : aucune" onChange={e => majLigne(l, { montant: e.target.value })} /></td>
                                            <td className="p-2 min-w-[130px]"><Choix value={l.scheduleId} onChange={v => majLigne(l, { scheduleId: v })} options={refs.schedules.map(s => ({ value: s.id, label: s.name }))} /></td>
                                            <td className="p-2 min-w-[120px]"><Choix value={l.termId} onChange={v => majLigne(l, { termId: v })} options={refs.terms.map(t => ({ value: t.id, label: t.name }))} /></td>
                                            <td className="p-2 min-w-[120px]"><Choix value={l.vatRateId} onChange={v => majLigne(l, { vatRateId: v })} options={refs.vatRates.map(v => ({ value: v.id, label: `${v.rate} %` }))} /></td>
                                            <td className="p-2"><Input type="date" className="h-8" value={l.startDate} onChange={e => majLigne(l, { startDate: e.target.value })} /></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        <p className="border-t p-2 text-xs text-muted-foreground">Une ligne sans montant ne crée pas de prestation. Le P1 (acomptes, relevés) se paramètre ensuite sur la fiche du site.</p>
                    </div>
                )
            )}
        </div>
    );
}
