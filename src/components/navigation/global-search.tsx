'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building, FileSignature, FileText, Gauge, MapPin, Search, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useCollectionsPonctuelles, useData } from '@/context/data-context';
import { navGroupsFor } from '@/components/navigation/nav-config';

/**
 * Recherche globale (Ctrl+K ou ⌘K) : pages de l'application, clients, contrats, sites, compteurs et factures, par nom,
 * code, réf. externe, SIRET, PDL/PCE, ville… Filtrage maison (accents et casse ignorés), 6 résultats par rubrique.
 */

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

type Resultat = { id: string; href: string; titre: string; detail?: string; texte: string };
type Rubrique = { label: string; icon: LucideIcon; items: Resultat[] };

const PAR_RUBRIQUE = 6;

/** Résultats d'une rubrique : tous les mots cherchés présents ; ceux dont le titre commence par la recherche d'abord. */
function chercher(items: Resultat[], q: string): Resultat[] {
    const mots = norm(q).split(/\s+/).filter(Boolean);
    if (!mots.length) return [];
    const trouves: { r: Resultat; score: number }[] = [];
    for (const r of items) {
        if (!mots.every(m => r.texte.includes(m))) continue;
        trouves.push({ r, score: norm(r.titre).startsWith(mots[0]) ? 0 : 1 });
        if (trouves.length > 200) break;
    }
    return trouves.sort((a, b) => a.score - b.score || a.r.titre.localeCompare(b.r.titre, 'fr')).slice(0, PAR_RUBRIQUE).map(t => t.r);
}

export function GlobalSearch() {
    const router = useRouter();
    const { clients, contracts, sites, meters, invoices, isAdmin, isContratheque, toutVoir, modules } = useData();
    const [open, setOpen] = useState(false);
    // Compteurs et factures ne sont chargés qu'à l'ouverture de la recherche.
    useCollectionsPonctuelles(...(open ? ['meters' as const, 'invoices' as const] : []));
    const [q, setQ] = useState('');

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);
    useEffect(() => { if (!open) setQ(''); }, [open]);

    // Index construit une fois par jeu de données (texte normalisé pour la recherche).
    const index = useMemo(() => {
        const r = (id: string, href: string, titre: string, detail: string | undefined, ...champs: unknown[]): Resultat =>
            ({ id, href, titre, detail, texte: norm([titre, detail, ...champs].join(' ')) });
        return {
            pages: navGroupsFor(toutVoir, isContratheque, modules).flatMap(g => g.items.map(i => r(i.href, i.href, i.label, g.label, i.keywords))),
            clients: clients.map(c => r(c.id, `/clients/${c.id}`, c.name, [c.externalCode, c.city].filter(Boolean).join(' · '), c.siret, c.externalRef, c.postalCode)),
            contrats: contracts.map(c => r(c.id, `/contracts/${c.id}`, `${c.contractNumber ?? 'Contrat'} — ${c.clientName ?? ''}`, [c.label, c.status].filter(Boolean).join(' · '), c.name, c.externalRef)),
            sites: sites.map(s => r(s.id, `/sites/${s.id}`, s.name, [s.code, s.clientName, s.city].filter(Boolean).join(' · '), s.externalRef, s.siteNumber, s.address, s.postalCode)),
            compteurs: meters.map(m => r(m.id, `/meters?q=${encodeURIComponent(m.code ?? m.name)}`, `${m.code ?? ''} — ${m.name}`, [m.siteName, m.clientName].filter(Boolean).join(' · '), m.reference, m.externalRef)),
            factures: invoices.filter(i => i.invoiceNumber).map(i => r(i.id, `/invoices/${i.id}`, i.invoiceNumber!, i.clientName, i.status)),
        };
    }, [clients, contracts, sites, meters, invoices, isAdmin, isContratheque, toutVoir, modules]);

    const rubriques: Rubrique[] = useMemo(() => [
        { label: 'Pages', icon: Search, items: chercher(index.pages, q) },
        { label: 'Clients', icon: Building, items: chercher(index.clients, q) },
        { label: 'Contrats', icon: FileSignature, items: chercher(index.contrats, q) },
        { label: 'Sites', icon: MapPin, items: chercher(index.sites, q) },
        { label: 'Compteurs', icon: Gauge, items: chercher(index.compteurs, q) },
        { label: 'Factures', icon: FileText, items: chercher(index.factures, q) },
    ].filter(r => r.items.length > 0), [index, q]);

    const aller = (href: string) => { setOpen(false); router.push(href); };

    return (
        <>
            <Button variant="outline" className="h-9 w-full justify-start gap-2 overflow-hidden text-muted-foreground" onClick={() => setOpen(true)}>
                <Search className="h-4 w-4" />
                <span className="min-w-0 flex-1 truncate text-left">Rechercher un client, contrat, site…</span>
                <kbd className="pointer-events-none hidden shrink-0 select-none rounded border bg-muted px-1.5 font-mono text-[10px] font-medium sm:inline-block">Ctrl K</kbd>
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="overflow-hidden p-0 shadow-lg sm:max-w-2xl">
                    <DialogTitle className="sr-only">Recherche globale</DialogTitle>
                    <DialogDescription className="sr-only">Clients, contrats, sites, compteurs, factures et pages de l&apos;application.</DialogDescription>
                    <Command shouldFilter={false} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-input]]:h-12">
                        <CommandInput value={q} onValueChange={setQ} placeholder="Nom, code (CLI, CTN, SIT, CPT), SIRET, PDL, ville, n° de facture…" />
                        <CommandList className="max-h-[60vh]">
                            {q.trim() === ''
                                ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">Tapez quelques lettres : clients, contrats, sites, compteurs, factures ou pages.</p>
                                : <CommandEmpty>Aucun résultat pour « {q} ».</CommandEmpty>}
                            {rubriques.map(rub => (
                                <CommandGroup key={rub.label} heading={rub.label}>
                                    {rub.items.map(it => (
                                        <CommandItem key={`${rub.label}-${it.id}`} value={`${rub.label}-${it.id}`} onSelect={() => aller(it.href)} className="gap-3 py-2">
                                            <rub.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate">{it.titre}</span>
                                                {it.detail && <span className="block truncate text-xs text-muted-foreground">{it.detail}</span>}
                                            </span>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            ))}
                        </CommandList>
                    </Command>
                </DialogContent>
            </Dialog>
        </>
    );
}

