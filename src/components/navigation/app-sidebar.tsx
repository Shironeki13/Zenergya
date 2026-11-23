'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { activeNavItem, navGroupsFor, type NavTon } from '@/components/navigation/nav-config';

const CLE = 'zenergya.menu.ouverts';

/** Classes de chaque couleur de thème (écrites en entier : Tailwind ne garde que les classes qu'il lit dans le code). */
const TONS: Record<NavTon, { pastille: string; pastilleActive: string; filet: string; actif: string; survol: string }> = {
    rose: { pastille: 'bg-rose-100 text-rose-700', pastilleActive: 'bg-rose-600 text-white', filet: 'border-rose-200', actif: 'bg-rose-50 text-rose-800', survol: 'hover:bg-rose-50 hover:text-rose-800' },
    blue: { pastille: 'bg-blue-100 text-blue-700', pastilleActive: 'bg-blue-600 text-white', filet: 'border-blue-200', actif: 'bg-blue-50 text-blue-800', survol: 'hover:bg-blue-50 hover:text-blue-800' },
    emerald: { pastille: 'bg-emerald-100 text-emerald-700', pastilleActive: 'bg-emerald-600 text-white', filet: 'border-emerald-200', actif: 'bg-emerald-50 text-emerald-800', survol: 'hover:bg-emerald-50 hover:text-emerald-800' },
    amber: { pastille: 'bg-amber-100 text-amber-700', pastilleActive: 'bg-amber-600 text-white', filet: 'border-amber-200', actif: 'bg-amber-50 text-amber-800', survol: 'hover:bg-amber-50 hover:text-amber-800' },
    orange: { pastille: 'bg-orange-100 text-orange-700', pastilleActive: 'bg-orange-600 text-white', filet: 'border-orange-200', actif: 'bg-orange-50 text-orange-800', survol: 'hover:bg-orange-50 hover:text-orange-800' },
    violet: { pastille: 'bg-violet-100 text-violet-700', pastilleActive: 'bg-violet-600 text-white', filet: 'border-violet-200', actif: 'bg-violet-50 text-violet-800', survol: 'hover:bg-violet-50 hover:text-violet-800' },
    slate: { pastille: 'bg-slate-200 text-slate-700', pastilleActive: 'bg-slate-700 text-white', filet: 'border-slate-300', actif: 'bg-slate-100 text-slate-900', survol: 'hover:bg-slate-100 hover:text-slate-900' },
};

/**
 * Menu latéral par métier. Chaque thème a sa couleur (pastille de la rubrique, filet et surlignage de ses entrées) et
 * les rubriques sont séparées par un trait. L'entrée de la page courante est surlignée, fiches et sous-pages comprises ;
 * sa rubrique est ouverte. Les rubriques ouvertes ou fermées à la main sont mémorisées (navigateur).
 */
export function AppSidebar({ isAdmin, isContratheque = false, modules, onNavigate }: { isAdmin: boolean; isContratheque?: boolean; modules?: string[]; onNavigate?: () => void }) {
    const pathname = usePathname();
    const groups = navGroupsFor(isAdmin, isContratheque, modules);
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
        <nav aria-label="Navigation principale" className="grid items-start px-3 text-sm font-medium">
            {groups.map((g, i) => {
                const ton = TONS[g.ton];
                const contientActif = actif?.group.id === g.id;
                const open = contientActif || (ouverts[g.id] ?? g.id === 'pilotage');
                return (
                    <Collapsible key={g.id} open={open} onOpenChange={o => basculer(g.id, o)} className={cn('flex flex-col py-1.5', i > 0 && 'border-t')}>
                        <CollapsibleTrigger asChild>
                            <button type="button" className={cn(
                                'flex items-center gap-3 rounded-lg px-2 py-1.5 text-left font-semibold transition-colors', ton.survol,
                                contientActif ? 'text-foreground' : 'text-foreground/80',
                            )}>
                                <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', contientActif ? ton.pastilleActive : ton.pastille)}>
                                    <g.icon className="h-4 w-4" />
                                </span>
                                <span className="flex-1">{g.label}</span>
                                <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
                            </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className={cn('ml-[1.35rem] mt-1 space-y-0.5 border-l-2 pl-2', ton.filet)}>
                            {g.items.map(item => {
                                const isActive = actif?.item.href === item.href;
                                return (
                                    <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={isActive ? 'page' : undefined}
                                        className={cn(
                                            'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 font-normal text-muted-foreground transition-colors', ton.survol,
                                            isActive && cn('font-semibold', ton.actif),
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
