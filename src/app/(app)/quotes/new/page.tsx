'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useData } from '@/context/data-context';
import { CompanyLookupDialog } from '@/components/clients/company-lookup';
import { entrepriseToClientFields, type EntrepriseResult } from '@/lib/entreprises';
import { resolvePricing } from '@/lib/quotes/pricing';
import type { QuoteMode } from '@/lib/quotes/types';
import type { Client } from '@/lib/types';
import { createProspect, createQuote } from '@/services/quotes';

const NO_SITE = '__none__';
const today = () => new Date().toISOString().slice(0, 10);

type ProspectDraft = {
    name: string; address: string; postalCode: string; city: string; siret: string;
    clientType: 'private' | 'public'; typologyId: string; companyId: string; agencyId: string; sectorId: string; useChorus: boolean;
};

export default function NewQuotePage() {
    return <Suspense><NewQuoteForm /></Suspense>;
}

function NewQuoteForm() {
    const router = useRouter();
    const params = useSearchParams();
    const { toast } = useToast();
    const { clients, sites, companies, agencies, sectors, typologies, currentUser, reloadData } = useData();

    const [who, setWho] = useState<'client' | 'prospect'>('client');
    const [clientSearch, setClientSearch] = useState('');
    const [clientId, setClientId] = useState(params.get('clientId') ?? '');
    const [siteId, setSiteId] = useState(params.get('siteId') ?? NO_SITE);
    const [address, setAddress] = useState({ address: '', postalCode: '', city: '' });
    const [title, setTitle] = useState('');
    const [mode, setMode] = useState<QuoteMode>('P5');
    const [saving, setSaving] = useState(false);
    const scope = currentUser?.scope;
    const [prospect, setProspect] = useState<ProspectDraft>({
        name: '', address: '', postalCode: '', city: '', siret: '', clientType: 'private', typologyId: '', useChorus: false,
        companyId: scope?.companyIds?.[0] && scope.companyIds[0] !== '*' ? scope.companyIds[0] : '',
        agencyId: scope?.agencyIds?.[0] && scope.agencyIds[0] !== '*' ? scope.agencyIds[0] : '',
        sectorId: scope?.sectorIds?.[0] && scope.sectorIds[0] !== '*' ? scope.sectorIds[0] : '',
    });

    // Arrivée depuis une fiche site : son client.
    useEffect(() => {
        const s = sites.find(x => x.id === params.get('siteId'));
        if (s?.clientId && !clientId) setClientId(s.clientId);
    }, [sites, params, clientId]);

    const client = clients.find(c => c.id === clientId);
    const clientSites = useMemo(() => sites.filter(s => s.clientId === clientId), [sites, clientId]);
    const site = clientSites.find(s => s.id === siteId);

    // Sans site : adresse d'intervention proposée = adresse du client.
    useEffect(() => {
        if (client && siteId === NO_SITE) setAddress({ address: client.address, postalCode: client.postalCode, city: client.city });
    }, [client, siteId]);

    const matches = useMemo(() => {
        const s = clientSearch.trim().toLowerCase();
        return clients
            .filter(c => !s || c.name.toLowerCase().includes(s) || (c.siret ?? '').includes(s) || (c.city ?? '').toLowerCase().includes(s))
            .sort((a, b) => a.name.localeCompare(b.name))
            .slice(0, 30);
    }, [clients, clientSearch]);

    const applyEntreprise = (r: EntrepriseResult) => {
        const f = entrepriseToClientFields(r);
        setProspect(p => ({ ...p, ...f, useChorus: f.useChorus === true }));
        setAddress({ address: f.address, postalCode: f.postalCode, city: f.city });
    };

    const prospectIssues = who !== 'prospect' ? [] : [
        !prospect.name.trim() && 'raison sociale',
        !prospect.address.trim() && 'adresse',
        !prospect.postalCode.trim() && 'code postal',
        !prospect.city.trim() && 'ville',
        !prospect.typologyId && 'typologie',
        !prospect.companyId && 'société',
        !prospect.agencyId && 'agence',
        !prospect.sectorId && 'secteur',
        prospect.clientType === 'public' && !prospect.siret.trim() && 'SIRET (client public)',
    ].filter(Boolean) as string[];
    const ready = title.trim() && (who === 'client' ? !!client : prospectIssues.length === 0)
        && (site || address.address.trim());

    const create = async () => {
        setSaving(true);
        try {
            let target: Client | undefined = client;
            if (who === 'prospect') {
                target = await createProspect({
                    name: prospect.name.trim(), address: prospect.address.trim(), postalCode: prospect.postalCode.trim(), city: prospect.city.trim(),
                    siret: prospect.siret.trim(), clientType: prospect.clientType, typologyId: prospect.typologyId,
                    companyId: prospect.companyId, agencyId: prospect.agencyId, sectorId: prospect.sectorId,
                    isBe: false, useChorus: prospect.useChorus,
                });
            }
            if (!target) throw new Error('Client introuvable.');
            const company = companies.find(c => c.id === target!.companyId) ?? (companies.length === 1 ? companies[0] : undefined);
            if (!company) throw new Error("Société émettrice introuvable : renseignez la société du client.");

            const quote = await createQuote({
                companyId: company.id,
                clientId: target.id,
                clientName: target.name,
                ...(target.relation === 'prospect' && { prospect: true }),
                ...(site ? { siteId: site.id, siteName: site.name, ...(site.contractId && { contractId: site.contractId }) }
                    : { interventionAddress: { address: address.address.trim(), postalCode: address.postalCode.trim(), city: address.city.trim() } }),
                title: title.trim(),
                mode,
                // Rédacteur : l'utilisateur qui crée le devis (modifiable ensuite).
                ...(currentUser && {
                    authorId: currentUser.id,
                    authorName: [currentUser.firstName, currentUser.name].filter(Boolean).join(' ') || currentUser.email,
                    authorEmail: currentUser.email,
                }),
                agencyId: target.agencyId,
                sectorId: target.sectorId,
                date: today(),
                validityDays: company.quoteValidityDays ?? 30,
                pricing: resolvePricing(target, company),
                lines: [],
                createdBy: currentUser?.email,
            }, company);
            if (who === 'prospect') await reloadData();
            toast({ title: 'Devis créé', description: quote.number });
            router.push(`/quotes/${quote.id}`);
        } catch (e) {
            toast({ title: 'Création impossible', description: (e as Error).message, variant: 'destructive' });
            setSaving(false);
        }
    };

    const field = (key: keyof ProspectDraft, label: string, extra?: Partial<React.ComponentProps<typeof Input>>) => (
        <div className="space-y-1">
            <Label htmlFor={`p-${key}`}>{label}</Label>
            <Input id={`p-${key}`} value={String(prospect[key])} onChange={e => setProspect(p => ({ ...p, [key]: e.target.value }))} {...extra} />
        </div>
    );

    return (
        <div className="space-y-6 max-w-4xl">
            <div className="flex items-center gap-2">
                <Link href="/quotes" className="text-muted-foreground hover:text-primary"><ChevronLeft className="h-4 w-4" /></Link>
                <h1 className="text-2xl font-bold tracking-tight">Nouveau devis</h1>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>1. Client</CardTitle>
                    <CardDescription>Un client existant, ou un prospect : il deviendra client si le devis est accepté.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <RadioGroup value={who} onValueChange={v => setWho(v as 'client' | 'prospect')} className="flex gap-6">
                        <label className="flex items-center gap-2"><RadioGroupItem value="client" />Client ou prospect existant</label>
                        <label className="flex items-center gap-2"><RadioGroupItem value="prospect" />Nouveau prospect</label>
                    </RadioGroup>

                    {who === 'client' ? (
                        client ? (
                            <div className="flex items-center justify-between rounded-md border p-3">
                                <div>
                                    <p className="font-medium">{client.name} {client.relation === 'prospect' && <Badge variant="outline" className="ml-1">Prospect</Badge>}</p>
                                    <p className="text-sm text-muted-foreground">{client.address}, {client.postalCode} {client.city}</p>
                                </div>
                                <Button variant="ghost" onClick={() => { setClientId(''); setSiteId(NO_SITE); }}>Changer</Button>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <Input placeholder="Rechercher : nom, SIRET, ville…" value={clientSearch} onChange={e => setClientSearch(e.target.value)} />
                                <ul className="max-h-64 overflow-auto rounded-md border divide-y">
                                    {matches.map(c => (
                                        <li key={c.id}>
                                            <button type="button" className="w-full text-left px-3 py-2 hover:bg-muted" onClick={() => setClientId(c.id)}>
                                                {c.name} {c.relation === 'prospect' && <Badge variant="outline" className="ml-1">Prospect</Badge>}
                                                <span className="block text-xs text-muted-foreground">{c.postalCode} {c.city}{c.siret ? ` — ${c.siret}` : ''}</span>
                                            </button>
                                        </li>
                                    ))}
                                    {matches.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Aucun client : créez un prospect.</li>}
                                </ul>
                            </div>
                        )
                    ) : (
                        <div className="space-y-4">
                            <CompanyLookupDialog onSelect={applyEntreprise} defaultQuery={prospect.siret || prospect.name} />
                            <div className="grid gap-4 md:grid-cols-2">
                                {field('name', 'Raison sociale *')}
                                {field('siret', 'SIRET')}
                                {field('address', 'Adresse *')}
                                <div className="grid grid-cols-[7rem_1fr] gap-2">
                                    {field('postalCode', 'Code postal *', { maxLength: 5, inputMode: 'numeric' })}
                                    {field('city', 'Ville *')}
                                </div>
                                <div className="space-y-1">
                                    <Label>Type *</Label>
                                    <Select value={prospect.clientType} onValueChange={v => setProspect(p => ({ ...p, clientType: v as 'private' | 'public', useChorus: v === 'public' }))}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent><SelectItem value="private">Privé</SelectItem><SelectItem value="public">Public</SelectItem></SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label>Typologie *</Label>
                                    <Select value={prospect.typologyId} onValueChange={v => setProspect(p => ({ ...p, typologyId: v }))}>
                                        <SelectTrigger><SelectValue placeholder="Choisir" /></SelectTrigger>
                                        <SelectContent>{typologies.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label>Société *</Label>
                                    <Select value={prospect.companyId} onValueChange={v => setProspect(p => ({ ...p, companyId: v, agencyId: '', sectorId: '' }))}>
                                        <SelectTrigger><SelectValue placeholder="Choisir" /></SelectTrigger>
                                        <SelectContent>{companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label>Agence *</Label>
                                    <Select value={prospect.agencyId} onValueChange={v => setProspect(p => ({ ...p, agencyId: v, sectorId: '' }))} disabled={!prospect.companyId}>
                                        <SelectTrigger><SelectValue placeholder="Choisir" /></SelectTrigger>
                                        <SelectContent>{agencies.filter(a => a.companyId === prospect.companyId).map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label>Secteur *</Label>
                                    <Select value={prospect.sectorId} onValueChange={v => setProspect(p => ({ ...p, sectorId: v }))} disabled={!prospect.agencyId}>
                                        <SelectTrigger><SelectValue placeholder="Choisir" /></SelectTrigger>
                                        <SelectContent>{sectors.filter(s => s.agencyId === prospect.agencyId).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                                    </Select>
                                </div>
                            </div>
                            {prospectIssues.length > 0 && <p className="text-sm text-muted-foreground">À compléter : {prospectIssues.join(', ')}.</p>}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>2. Lieu d'intervention</CardTitle>
                    <CardDescription>Un site existant du client, ou une adresse : un site pourra être créé à l'acceptation.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {who === 'client' && clientSites.length > 0 && (
                        <Select value={siteId} onValueChange={setSiteId}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NO_SITE}>Aucun site : adresse d'intervention</SelectItem>
                                {clientSites.map(s => <SelectItem key={s.id} value={s.id}>{s.code ? `${s.code} — ` : ''}{s.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    )}
                    {!site && (
                        <div className="grid gap-4 md:grid-cols-[1fr_7rem_1fr]">
                            <div className="space-y-1"><Label htmlFor="ia">Adresse *</Label><Input id="ia" value={address.address} onChange={e => setAddress(a => ({ ...a, address: e.target.value }))} /></div>
                            <div className="space-y-1"><Label htmlFor="ip">Code postal</Label><Input id="ip" maxLength={5} value={address.postalCode} onChange={e => setAddress(a => ({ ...a, postalCode: e.target.value }))} /></div>
                            <div className="space-y-1"><Label htmlFor="ic">Ville</Label><Input id="ic" value={address.city} onChange={e => setAddress(a => ({ ...a, city: e.target.value }))} /></div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle>3. Devis</CardTitle></CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-[1fr_12rem]">
                    <div className="space-y-1">
                        <Label htmlFor="title">Objet *</Label>
                        <Input id="title" placeholder="ex. Remplacement du brûleur de la chaufferie" value={title} onChange={e => setTitle(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                        <Label>Type de travaux</Label>
                        <Select value={mode} onValueChange={v => setMode(v as QuoteMode)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="P5">P5 — intervention</SelectItem>
                                <SelectItem value="P6">P6 — projet à l'avancement</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            <div className="flex justify-end">
                <Button onClick={create} disabled={!ready || saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Créer le devis
                </Button>
            </div>
        </div>
    );
}
