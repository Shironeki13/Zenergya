/**
 * Périmètre d'un utilisateur (logique pure) : les sociétés, agences et secteurs qu'il peut voir et modifier (« * » :
 * tous). Le périmètre d'un objet est celui de **son client** (société, agence, secteur) : un contrat, un site, une
 * prestation, un compteur, une facture, un devis ou une affaire suivent le client auquel ils sont rattachés.
 * Un administrateur voit tout. Les autres rôles (contrathèque, achats…) restent dans leur périmètre.
 */

export type Perimetre = { companyIds: string[]; agencyIds: string[]; sectorIds: string[] };
export type Rattachement = { companyId?: string | null; agencyId?: string | null; sectorId?: string | null };

export const PERIMETRE_TOTAL: Perimetre = { companyIds: ['*'], agencyIds: ['*'], sectorIds: ['*'] };
export const PERIMETRE_VIDE: Perimetre = { companyIds: [], agencyIds: [], sectorIds: [] };

const ok = (liste: string[] | undefined, id?: string | null) => !!liste && (liste.includes('*') || (!!id && liste.includes(id)));

export const estTotal = (p: Perimetre | null | undefined) => !!p && ['companyIds', 'agencyIds', 'sectorIds'].every(k => p[k as keyof Perimetre]?.includes('*'));

/** L'objet rattaché à cette société, cette agence et ce secteur est-il dans le périmètre ? Les trois axes se cumulent. */
export function dansPerimetre(p: Perimetre | null | undefined, r: Rattachement | null | undefined, isAdmin = false): boolean {
    if (isAdmin) return true;
    if (!p) return false;
    if (estTotal(p)) return true;
    if (!r) return false;
    return ok(p.companyIds, r.companyId) && ok(p.agencyIds, r.agencyId) && ok(p.sectorIds, r.sectorId);
}

/** Identifiants des clients du périmètre. */
export function clientsDuPerimetre<C extends Rattachement & { id: string }>(clients: C[], p: Perimetre | null | undefined, isAdmin = false): Set<string> {
    return new Set(clients.filter(c => dansPerimetre(p, c, isAdmin)).map(c => c.id));
}

type AvecId = { id: string };
/** Collections partagées entre les écrans, telles que les charge le navigateur. */
export type CollectionsPerimetre = {
    clients: (AvecId & Rattachement)[]; contracts: (AvecId & { clientId?: string })[]; sites: (AvecId & { clientId?: string; contractId?: string })[];
    services: (AvecId & { contractId?: string; siteId?: string })[]; meters: (AvecId & { siteId?: string })[];
    contacts: (AvecId & { clientId?: string })[];
};

/**
 * Ne garde que les objets du périmètre : clients par leur rattachement ; contrats, sites et contacts
 * par leur client ; prestations par leur contrat ou leur site ; compteurs par leur site.
 * Les référentiels (sociétés, agences, activités…) ne sont pas filtrés : leurs libellés servent partout.
 */
export function filtrerPerimetre<T extends CollectionsPerimetre>(d: T, p: Perimetre | null | undefined, isAdmin = false): T {
    if (isAdmin || estTotal(p)) return d;
    const cli = clientsDuPerimetre(d.clients, p);
    const parClient = <X extends { clientId?: string }>(l: X[]) => l.filter(x => !!x.clientId && cli.has(x.clientId));
    const contracts = parClient(d.contracts);
    const ctr = new Set(contracts.map(c => c.id));
    const sites = d.sites.filter(s => (s.clientId ? cli.has(s.clientId) : !!s.contractId && ctr.has(s.contractId)));
    const sit = new Set(sites.map(s => s.id));
    const meters = d.meters.filter(m => !!m.siteId && sit.has(m.siteId));
    return {
        ...d,
        clients: d.clients.filter(c => cli.has(c.id)), contracts, sites,
        services: d.services.filter(s => (s.contractId ? ctr.has(s.contractId) : !!s.siteId && sit.has(s.siteId))),
        meters,
        contacts: parClient(d.contacts),
    };
}

// --- Modules ---

export const MODULES = [
    { id: 'contracts', label: 'Clients et contrats' }, { id: 'billing', label: 'Facturation et compteurs' }, { id: 'works', label: 'Travaux' },
    { id: 'purchases', label: 'Achats' }, { id: 'settings', label: 'Paramétrage et imports' },
] as const;
export type ModuleId = typeof MODULES[number]['id'];

/** Module requis par une adresse de l'application ; null : accessible à tous (tableau de bord, pilotage). */
export function moduleDeRoute(pathname: string): ModuleId | 'admin' | null {
    const debut = (...p: string[]) => p.some(x => pathname === x || pathname.startsWith(`${x}/`));
    if (debut('/users', '/api-keys')) return 'admin';
    if (debut('/settings', '/imports')) return 'settings';
    if (debut('/purchases')) return 'purchases';
    if (debut('/works', '/quotes', '/projects', '/timesheets', '/library')) return 'works';
    if (debut('/billing/suivi')) return null;
    if (debut('/billing', '/invoices', '/credit-notes', '/meters')) return 'billing';
    if (debut('/clients', '/contracts', '/sites', '/admin/validations')) return 'contracts';
    return null;
}

export function accesRoute(pathname: string, modules: string[] | undefined, isAdmin: boolean): boolean {
    const m = moduleDeRoute(pathname);
    return isAdmin || m === null || (m !== 'admin' && !!modules?.includes(m));
}

/** Collections à périmètre : le navigateur les obtient du serveur (filtrées), pas de la base directement. */
export const COLLECTIONS_PERIMETRE = ['clients', 'contracts', 'sites', 'services', 'meters', 'contacts'] as const;
export type CollectionPerimetre = typeof COLLECTIONS_PERIMETRE[number];
