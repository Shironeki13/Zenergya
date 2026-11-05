import type { ImportEntityKey } from '@/lib/imports/definitions';

/**
 * API externe : ressources et droits (utilisable dans le navigateur ; les clés sont dans keys.ts, serveur).
 */

export const API_RESOURCES = ['clients', 'contracts', 'sites', 'services', 'contacts', 'meters', 'readings'] as const satisfies readonly ImportEntityKey[];
export type ApiResource = typeof API_RESOURCES[number];

export const API_RESOURCE_LABELS: Record<ApiResource, string> = {
    clients: 'Clients et prospects', contracts: 'Contrats', sites: 'Sites', services: 'Prestations', contacts: 'Contacts', meters: 'Compteurs', readings: 'Relevés de compteurs',
};

export type ApiScope = `${ApiResource}:${'read' | 'write'}`;
export const API_SCOPES: ApiScope[] = API_RESOURCES.flatMap(r => [`${r}:read`, `${r}:write`] as ApiScope[]);

export const isApiResource = (r: string): r is ApiResource => (API_RESOURCES as readonly string[]).includes(r);

/** L'écriture n'implique pas la lecture : chaque droit est accordé explicitement. */
export const hasScope = (scopes: readonly string[], needed: ApiScope) => scopes.includes(needed);
