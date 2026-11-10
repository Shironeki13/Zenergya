'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { useCollections, useData } from '@/context/data-context';
import { activeNavItem } from '@/components/navigation/nav-config';

/**
 * Fil d'Ariane : rubrique du menu › page › fiche (nom de l'élément) › sous-page. Calculé depuis l'adresse et la
 * navigation ; les fiches affichent le nom de leur élément quand il est connu.
 */

const SOUS_PAGES: Record<string, string> = {
    edit: 'Modifier', new: 'Nouveau', manual: 'Saisie manuelle', 'market-private': 'Marché privé', 'market-public': 'Marché public',
    'ai-validation': 'Validation assistée', chiffrage: 'Chiffrage', p5: 'P5', p6: 'P6', create: 'Création', validation: 'Validation',
    nouveau: 'Nouveau contrat',
};

type Miette = { label: string; href?: string };

export function Breadcrumbs() {
    const pathname = usePathname();
    const { clients, contracts, sites, invoices } = useData();
    // Le numéro de la facture n'est utile que sur sa fiche : la liste des factures n'est demandée que là.
    useCollections(...(/^\/invoices\/[^/]+/.test(pathname) ? ['invoices' as const] : []));
    const actif = activeNavItem(pathname);
    if (!actif) return null;

    const nomFiche = (base: string, id: string): string => {
        if (base === '/clients') return clients.find(c => c.id === id)?.name ?? 'Fiche client';
        if (base === '/contracts') {
            const c = contracts.find(x => x.id === id);
            return c ? `${c.contractNumber ?? ''}${c.contractNumber && c.clientName ? ' — ' : ''}${c.clientName ?? ''}` || 'Fiche contrat' : 'Fiche contrat';
        }
        if (base === '/sites') return sites.find(s => s.id === id)?.name ?? 'Fiche site';
        if (base === '/invoices') return invoices.find(i => i.id === id)?.invoiceNumber ?? 'Facture';
        if (base === '/quotes') return 'Devis';
        if (base === '/projects') return 'Affaire';
        return 'Fiche';
    };

    const miettes: Miette[] = [{ label: actif.group.label }, { label: actif.item.label, href: actif.item.href }];
    const reste = pathname.slice(actif.item.href.length).split('/').filter(Boolean);
    let href = actif.item.href;
    reste.forEach((segment, i) => {
        href += `/${segment}`;
        const label = SOUS_PAGES[segment] ?? (i === 0 ? nomFiche(actif.item.href, decodeURIComponent(segment)) : decodeURIComponent(segment));
        miettes.push({ label, href: i < reste.length - 1 ? href : undefined });
    });
    // La dernière miette est la page courante : pas de lien.
    const derniere = miettes.length - 1;

    return (
        <nav aria-label="Fil d'Ariane" className="min-w-0">
            <ol className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
                {miettes.map((m, i) => (
                    <li key={`${i}-${m.label}`} className="flex min-w-0 items-center gap-1">
                        {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                        {m.href && i !== derniere
                            ? <Link href={m.href} className="truncate hover:text-foreground">{m.label}</Link>
                            : <span className={i === derniere ? 'truncate font-medium text-foreground' : 'truncate'} aria-current={i === derniere ? 'page' : undefined}>{m.label}</span>}
                    </li>
                ))}
            </ol>
        </nav>
    );
}
