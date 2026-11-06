import type { SearchableOption } from '@/components/ui/searchable-select';
import type { Client, Site } from '@/lib/types';

/** Options des listes avec recherche : libellé lisible, précision en dessous, mots-clés cherchables (codes, SIRET…). */

export const optionsClients = (clients: Client[]): SearchableOption[] =>
    [...clients].sort((a, b) => a.name.localeCompare(b.name, 'fr')).map(c => ({
        value: c.id, label: c.name, description: [c.externalCode, c.city].filter(Boolean).join(' · ') || undefined,
        keywords: [c.siret, c.externalRef, c.postalCode].filter(Boolean).join(' '),
    }));

export const optionsSites = (sites: Site[]): SearchableOption[] =>
    [...sites].sort((a, b) => a.name.localeCompare(b.name, 'fr')).map(s => ({
        value: s.id, label: s.code ? `${s.code} — ${s.name}` : s.name, description: [s.clientName, s.city].filter(Boolean).join(' · ') || undefined,
        keywords: [s.externalRef, s.siteNumber, s.address, s.postalCode].filter(Boolean).join(' '),
    }));
