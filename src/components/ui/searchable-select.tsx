'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Liste de choix avec recherche, pour les longues listes (clients, sites, indices, stations…). Même usage qu'un Select :
 * `value` / `onValueChange` ; utilisable dans un FormControl (identifiant et état d'erreur transmis au bouton).
 * Recherche sur le libellé, la description et les mots-clés, accents et casse ignorés ; 100 résultats affichés.
 */

export type SearchableOption = { value: string; label: string; description?: string; keywords?: string; disabled?: boolean };

type Props = Omit<React.ComponentPropsWithoutRef<typeof Button>, 'value' | 'onChange'> & {
    value?: string | null;
    onValueChange: (value: string) => void;
    options: SearchableOption[];
    placeholder?: string;
    searchPlaceholder?: string;
    emptyText?: string;
    /** Bouton « effacer » (valeur vide). */
    clearable?: boolean;
};

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const MAX = 100;

export const SearchableSelect = React.forwardRef<HTMLButtonElement, Props>(function SearchableSelect(
    { value, onValueChange, options, placeholder = 'Choisir…', searchPlaceholder = 'Rechercher…', emptyText = 'Aucun résultat.', clearable, className, disabled, ...rest },
    ref,
) {
    const [open, setOpen] = React.useState(false);
    // Ouverte depuis une fenêtre : la liste s'affiche dans la fenêtre (focus et saisie au clavier).
    const triggerRef = React.useRef<HTMLButtonElement | null>(null);
    const [container, setContainer] = React.useState<HTMLElement | null>(null);
    const setRefs = (el: HTMLButtonElement | null) => {
        triggerRef.current = el;
        if (typeof ref === 'function') ref(el); else if (ref) ref.current = el;
    };
    const [q, setQ] = React.useState('');
    const selected = options.find(o => o.value === value);
    const index = React.useMemo(() => options.map(o => ({ o, t: norm(`${o.label} ${o.description ?? ''} ${o.keywords ?? ''}`) })), [options]);
    const visibles = React.useMemo(() => {
        const mots = norm(q).split(/\s+/).filter(Boolean);
        const r = mots.length ? index.filter(x => mots.every(m => x.t.includes(m))) : index;
        return r.slice(0, MAX).map(x => x.o);
    }, [index, q]);
    const total = q ? index.filter(x => norm(q).split(/\s+/).filter(Boolean).every(m => x.t.includes(m))).length : options.length;

    return (
        <Popover open={open} onOpenChange={o => {
            if (o) setContainer(triggerRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null);
            setOpen(o); if (!o) setQ('');
        }}>
            <PopoverTrigger asChild>
                <Button ref={setRefs} type="button" variant="outline" role="combobox" aria-expanded={open} disabled={disabled}
                    className={cn('w-full justify-between font-normal', !selected && 'text-muted-foreground', className)} {...rest}>
                    <span className="truncate">{selected ? selected.label : placeholder}</span>
                    <span className="ml-2 flex shrink-0 items-center gap-1">
                        {clearable && selected && !disabled && (
                            <X className="h-3.5 w-3.5 opacity-60 hover:opacity-100" aria-label="Effacer"
                                onPointerDown={e => { e.preventDefault(); e.stopPropagation(); onValueChange(''); }} />
                        )}
                        <ChevronsUpDown className="h-4 w-4 opacity-50" />
                    </span>
                </Button>
            </PopoverTrigger>
            <PopoverContent container={container} className="w-[--radix-popover-trigger-width] min-w-[280px] p-0" align="start">
                <Command shouldFilter={false}>
                    <CommandInput value={q} onValueChange={setQ} placeholder={searchPlaceholder} />
                    <CommandList>
                        <CommandEmpty>{emptyText}</CommandEmpty>
                        <CommandGroup>
                            {visibles.map(o => (
                                <CommandItem key={o.value} value={o.value} disabled={o.disabled}
                                    onSelect={() => { onValueChange(o.value); setOpen(false); setQ(''); }}>
                                    <Check className={cn('mr-2 h-4 w-4 shrink-0', o.value === value ? 'opacity-100' : 'opacity-0')} />
                                    <span className="min-w-0">
                                        <span className="block truncate">{o.label}</span>
                                        {o.description && <span className="block truncate text-xs text-muted-foreground">{o.description}</span>}
                                    </span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                        {total > MAX && <p className="px-3 py-2 text-xs text-muted-foreground">{total - MAX} autre(s) : précisez la recherche.</p>}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
});
