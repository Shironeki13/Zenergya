'use client';

import { useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type OptionFiltre = { id: string; label: string };

/** Filtre à choix multiple, avec recherche. Rien de coché : pas de filtre. */
export function FiltreMulti({ libelle, options, valeurs, onChange }: { libelle: string; options: OptionFiltre[]; valeurs: string[]; onChange: (v: string[]) => void }) {
    const [ouvert, setOuvert] = useState(false);
    const basculer = (id: string) => onChange(valeurs.includes(id) ? valeurs.filter(v => v !== id) : [...valeurs, id]);
    const resume = valeurs.length === 0 ? 'Tous'
        : valeurs.length === 1 ? (options.find(o => o.id === valeurs[0])?.label ?? '1 choisi')
            : `${valeurs.length} choisis`;
    return (
        <Popover open={ouvert} onOpenChange={setOuvert}>
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn('h-9 justify-between gap-1 max-w-[220px]', valeurs.length > 0 && 'border-primary')}>
                    <span className="text-muted-foreground">{libelle} :</span>
                    <span className="truncate">{resume}</span>
                    <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="start">
                <Command>
                    <CommandInput placeholder={`Rechercher (${libelle.toLowerCase()})…`} />
                    <CommandList>
                        <CommandEmpty>Aucun résultat.</CommandEmpty>
                        <CommandGroup>
                            {options.map(o => (
                                <CommandItem key={o.id} value={`${o.label} ${o.id}`} onSelect={() => basculer(o.id)}>
                                    <Check className={cn('mr-2 h-4 w-4', valeurs.includes(o.id) ? 'opacity-100' : 'opacity-0')} />
                                    {o.label}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                    {valeurs.length > 0 && (
                        <div className="border-t p-1">
                            <Button variant="ghost" size="sm" className="w-full h-8 gap-1" onClick={() => onChange([])}><X className="h-3.5 w-3.5" />Effacer</Button>
                        </div>
                    )}
                </Command>
            </PopoverContent>
        </Popover>
    );
}
