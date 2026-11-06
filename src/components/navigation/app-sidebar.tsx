'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { activeNavItem, navGroupsFor } from '@/components/navigation/nav-config';

const CLE = 'zenergya.menu.ouverts';

/**
 * Menu latéral par métier. L'entrée de la page courante est surlignée, fiches et sous-pages comprises ; sa rubrique est
 * ouverte. Les rubriques ouvertes ou fermées à la main sont mémorisées (navigateur).
 */
export function AppSidebar({ isAdmin, onNavigate }: { isAdmin: boolean; onNavigate?: () => void }) {
    const pathname = usePathname();
    const groups = navGroupsFor(isAdmin);
    const actif = activeNavItem(pathname, groups);
    const [ouverts, setOuverts] = useState<Record<string, boolean>>({});

    useEffect(() => {
        try { setOuverts(JSON.parse(localStorage.getItem(CLE) ?? '{}')); } catch { /* stockage indisponible */ }
    }, []);
    const basculer = (id: string, open: boolean) => setOuverts(o => {
        const n = { ...o, [id]: open };
        try { localStorage.setItem(CLE, JSON.stringify(n)); } catch { /* stockage indisponible */ }
        return n;
    });

    return (
        <nav aria-label="Navigation principale" className="grid items-start gap-1 px-3 text-sm font-medium">
            {groups.map(g => {
                const contientActif = actif?.group.id === g.id;
                const open = contientActif || (ouverts[g.id] ?? g.id === 'pilotage');
                return (
                    <Collapsible key={g.id} open={open} onOpenChange={o => basculer(g.id, o)} className="flex flex-col">
                        <CollapsibleTrigger asChild>
                            <button type="button" className={cn(
                                'flex items-center gap-3 rounded-lg px-3 py-2 text-left font-semibold transition-colors hover:bg-muted hover:text-primary',
                                contientActif ? 'text-foreground' : 'text-muted-foreground',
                            )}>
                                <g.icon className="h-4 w-4" />
                                <span className="flex-1">{g.label}</span>
                                <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
                            </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="space-y-0.5 pb-2 pl-4 pt-0.5">
                            {g.items.map(item => {
                                const isActive = actif?.item.href === item.href;
                                return (
                                    <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={isActive ? 'page' : undefined}
                                        className={cn(
                                            'flex items-center gap-3 rounded-lg px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-primary',
                                            isActive && 'bg-primary/10 font-medium text-primary',
                                        )}>
                                        <item.icon className="h-4 w-4 shrink-0" />
                                        <span className="truncate">{item.label}</span>
                                    </Link>
                                );
                            })}
                        </CollapsibleContent>
                    </Collapsible>
                );
            })}
        </nav>
    );
}
