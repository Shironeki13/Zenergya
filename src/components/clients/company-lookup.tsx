'use client';

import { useState } from 'react';
import { Building2, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { EntrepriseResult, EntrepriseSearchParams, EntrepriseSearchResponse } from '@/lib/entreprises';

/** Appel de la route serveur de recherche (session requise). */
export async function fetchEntreprises(params: EntrepriseSearchParams): Promise<EntrepriseSearchResponse> {
    const sp = new URLSearchParams({ q: params.q });
    if (params.codePostal) sp.set('codePostal', params.codePostal);
    if (params.departement) sp.set('departement', params.departement);
    if (params.inclureCessees) sp.set('inclureCessees', '1');
    if (params.page) sp.set('page', String(params.page));
    const res = await fetch(`/api/entreprises/search?${sp}`, { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Erreur ${res.status}`);
    return body as EntrepriseSearchResponse;
}

export function EntrepriseBadges({ r }: { r: EntrepriseResult }) {
    return (
        <div className="flex flex-wrap gap-1">
            {!r.entrepriseActive ? <Badge variant="destructive">Cessée</Badge>
                : !r.etablissement.actif ? <Badge variant="destructive">Établissement fermé</Badge>
                    : <Badge variant="secondary">Active</Badge>}
            {r.estPublic && <Badge>{r.collectivite ? `Collectivité – ${r.collectivite}` : 'Entité publique'}</Badge>}
            {r.etablissement.estSiege && <Badge variant="outline">Siège</Badge>}
        </div>
    );
}

/**
 * Recherche d'une entreprise ou d'une entité publique dans le répertoire de l'État
 * (nom, SIREN ou SIRET, filtrée par code postal ou département), pour remplir une fiche client.
 */
export function CompanyLookupDialog({ onSelect, triggerLabel = 'Rechercher dans le répertoire', defaultQuery = '' }: {
    onSelect: (result: EntrepriseResult) => void;
    triggerLabel?: string;
    defaultQuery?: string;
}) {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState(defaultQuery);
    const [codePostal, setCodePostal] = useState('');
    const [departement, setDepartement] = useState('');
    const [inclureCessees, setInclureCessees] = useState(false);
    const [page, setPage] = useState(1);
    const [data, setData] = useState<EntrepriseSearchResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const search = async (targetPage = 1) => {
        setLoading(true);
        setError(null);
        try {
            setData(await fetchEntreprises({ q, codePostal: codePostal || undefined, departement: departement || undefined, inclureCessees, page: targetPage }));
            setPage(targetPage);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={o => { setOpen(o); if (o && defaultQuery && !q) setQ(defaultQuery); }}>
            <DialogTrigger asChild>
                <Button type="button" variant="outline"><Building2 className="mr-2 h-4 w-4" />{triggerLabel}</Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Répertoire des entreprises</DialogTitle>
                    <DialogDescription>Données publiques de l'État (Sirene / RNE) : entreprises, associations et entités publiques.</DialogDescription>
                </DialogHeader>
                <form className="grid gap-3 md:grid-cols-[1fr_8rem_7rem_auto] items-end"
                    // stopPropagation : la fenêtre est ouverte depuis le formulaire client ; sans cela, l'envoi
                    // remonterait (arbre React) jusqu'à lui et enregistrerait la fiche.
                    onSubmit={e => { e.preventDefault(); e.stopPropagation(); search(1); }}>
                    <div className="space-y-1">
                        <Label htmlFor="lookup-q">Nom, SIREN ou SIRET</Label>
                        <Input id="lookup-q" value={q} onChange={e => setQ(e.target.value)} placeholder="ex. Commune de Lyon, 216901231" autoFocus />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="lookup-cp">Code postal</Label>
                        <Input id="lookup-cp" value={codePostal} onChange={e => setCodePostal(e.target.value)} inputMode="numeric" maxLength={5} />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="lookup-dep">Département</Label>
                        <Input id="lookup-dep" value={departement} onChange={e => setDepartement(e.target.value)} maxLength={3} />
                    </div>
                    <Button type="submit" disabled={loading || q.trim().length < 3}>
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    </Button>
                    <label className="flex items-center gap-2 text-sm md:col-span-4">
                        <Checkbox checked={inclureCessees} onCheckedChange={v => setInclureCessees(v === true)} />
                        Inclure les entreprises cessées
                    </label>
                </form>

                {error && <p className="text-sm text-destructive">{error}</p>}
                {data && (
                    <>
                        <p className="text-sm text-muted-foreground">
                            {data.total === 0 ? 'Aucun résultat.' : `${data.total} résultat${data.total > 1 ? 's' : ''}`}
                            {data.totalPages > 1 && ` — page ${page} / ${data.totalPages}`}
                        </p>
                        <ScrollArea className="max-h-[50vh] pr-3">
                            <ul className="space-y-2">
                                {data.results.map(r => (
                                    <li key={`${r.siren}-${r.etablissement.siret}`} className="rounded-md border p-3 flex items-start justify-between gap-3">
                                        <div className="space-y-1 min-w-0">
                                            <p className="font-medium">{r.nom}{r.sigle ? ` (${r.sigle})` : ''}</p>
                                            <p className="text-sm text-muted-foreground font-mono">SIRET {r.etablissement.siret || '—'} · SIREN {r.siren}</p>
                                            <p className="text-sm text-muted-foreground">{r.etablissement.adresse || '—'}</p>
                                            <EntrepriseBadges r={r} />
                                        </div>
                                        <Button type="button" size="sm" onClick={() => { onSelect(r); setOpen(false); }}>Utiliser</Button>
                                    </li>
                                ))}
                            </ul>
                        </ScrollArea>
                        {data.totalPages > 1 && (
                            <div className="flex justify-end gap-2">
                                <Button type="button" variant="outline" size="sm" disabled={loading || page <= 1} onClick={() => search(page - 1)}>Précédent</Button>
                                <Button type="button" variant="outline" size="sm" disabled={loading || page >= data.totalPages} onClick={() => search(page + 1)}>Suivant</Button>
                            </div>
                        )}
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
