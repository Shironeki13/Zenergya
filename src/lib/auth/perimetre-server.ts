import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { dansPerimetre, estTotal, type Rattachement } from '@/lib/perimetre';
import type { SessionUser } from './server';

/**
 * Périmètre côté serveur : chaque action vérifie que l'objet lu ou modifié appartient à un client des sociétés,
 * agences et secteurs de l'utilisateur (lib/perimetre). Un administrateur voit tout.
 */

export class PerimetreError extends Error {
    constructor(objet = 'Cet élément') {
        super(`${objet} est hors de votre périmètre (société, agence, secteur).`);
    }
}

export type ObjetPerimetre = 'client' | 'contrat' | 'site' | 'compteur' | 'prestation' | 'facture' | 'avoir' | 'devis' | 'affaire' | 'situation' | 'releve';
const LIBELLE: Record<ObjetPerimetre, string> = {
    client: 'Ce client', contrat: 'Ce contrat', site: 'Ce site', compteur: 'Ce compteur', prestation: 'Cette prestation', facture: 'Cette facture', avoir: 'Cet avoir',
    devis: 'Ce devis', affaire: 'Cette affaire', situation: 'Cette situation', releve: 'Ce relevé',
};

const lire = async (coll: string, id: string) => (id ? adminDb.collection(coll).doc(String(id)).get() : null);
const champ = (d: FirebaseFirestore.DocumentSnapshot | null, k: string): string | null => (d?.exists ? (d.get(k) as string | undefined) ?? null : null);

/** Client auquel un objet est rattaché (null : objet inconnu ou sans client). */
export async function clientDe(type: ObjetPerimetre, id: string): Promise<string | null> {
    switch (type) {
        case 'client': return id || null;
        case 'contrat': return champ(await lire('contracts', id), 'clientId');
        case 'facture': return champ(await lire('invoices', id), 'clientId');
        case 'avoir': return champ(await lire('creditNotes', id), 'clientId');
        case 'devis': return champ(await lire('quotes', id), 'clientId');
        case 'affaire': return champ(await lire('projects', id), 'clientId');
        case 'situation': { const p = champ(await lire('projectSituations', id), 'projectId'); return p ? clientDe('affaire', p) : null; }
        case 'site': {
            const s = await lire('sites', id);
            const c = champ(s, 'clientId'), k = champ(s, 'contractId');
            return c ?? (k ? clientDe('contrat', k) : null);
        }
        case 'compteur': { const s = champ(await lire('meters', id), 'siteId'); return s ? clientDe('site', s) : null; }
        case 'releve': { const m = champ(await lire('meterReadings', id), 'meterId'); return m ? clientDe('compteur', m) : null; }
        case 'prestation': {
            const p = await lire('services', id);
            const k = champ(p, 'contractId'), s = champ(p, 'siteId');
            return k ? clientDe('contrat', k) : s ? clientDe('site', s) : null;
        }
    }
}

export type GardePerimetre = {
    /** Aucun filtre : administrateur, ou périmètre couvrant tout. */
    tout: boolean;
    voitClient: (clientId?: string | null) => Promise<boolean>;
    voit: (type: ObjetPerimetre, id: string) => Promise<boolean>;
    /** Refuse (PerimetreError) si l'objet est hors du périmètre. */
    exiger: (type: ObjetPerimetre, id: string) => Promise<void>;
    exigerRattachement: (r: Rattachement, objet?: string) => void;
    /** Clients du périmètre (null : tous), pour filtrer une liste en une lecture. */
    clients: () => Promise<Set<string> | null>;
    /** Ne garde d'une liste que les éléments dont le client est dans le périmètre. */
    filtrer: <T>(items: T[], clientId: (x: T) => string | null | undefined) => Promise<T[]>;
    /** Contrats, sites ou affaires du périmètre (null : tous), pour filtrer une liste qui ne porte pas le client. */
    ids: (coll: 'contracts' | 'sites' | 'projects' | 'quotes') => Promise<Set<string> | null>;
};

/** Garde de périmètre d'un utilisateur, pour la durée d'une action (les clients déjà vérifiés sont mémorisés). */
export function gardePerimetre(user: SessionUser): GardePerimetre {
    const scope = user.profile.scope;
    const tout = user.isAdmin || estTotal(scope);
    const vus = new Map<string, boolean>();
    let liste: Promise<Set<string>> | null = null;
    const voitClient = async (clientId?: string | null) => {
        if (tout) return true;
        if (!clientId) return false;
        if (!vus.has(clientId)) {
            const d = await adminDb.collection('clients').doc(clientId).get();
            vus.set(clientId, d.exists && dansPerimetre(scope, d.data() as Rattachement));
        }
        return vus.get(clientId)!;
    };
    const voit = async (type: ObjetPerimetre, id: string) => tout || voitClient(await clientDe(type, id));
    const clients = async () => {
        if (tout) return null;
        liste ??= adminDb.collection('clients').select('companyId', 'agencyId', 'sectorId').get()
            .then(s => new Set(s.docs.filter(d => dansPerimetre(scope, d.data() as Rattachement)).map(d => d.id)));
        return liste;
    };
    const ids = async (coll: 'contracts' | 'sites' | 'projects' | 'quotes') => {
        const c = await clients();
        if (!c) return null;
        const docs = (await adminDb.collection(coll).select('clientId', 'contractId').get()).docs;
        if (coll !== 'sites') return new Set(docs.filter(d => c.has(String(d.get('clientId')))).map(d => d.id));
        // Un site sans client suit son contrat.
        const contrats = new Set((await adminDb.collection('contracts').select('clientId').get()).docs.filter(d => c.has(String(d.get('clientId')))).map(d => d.id));
        return new Set(docs.filter(d => (d.get('clientId') ? c.has(String(d.get('clientId'))) : contrats.has(String(d.get('contractId'))))).map(d => d.id));
    };
    return {
        tout, voitClient, voit, clients, ids,
        exiger: async (type, id) => { if (!(await voit(type, id))) throw new PerimetreError(LIBELLE[type]); },
        exigerRattachement: (r, objet) => { if (!tout && !dansPerimetre(scope, r)) throw new PerimetreError(objet); },
        filtrer: async (items, clientId) => {
            const c = await clients();
            return c ? items.filter(x => { const id = clientId(x); return !!id && c.has(id); }) : items;
        },
    };
}

/** Import en masse et autres opérations sans objet unique : réservées à un périmètre complet. */
export function exigerPerimetreTotal(user: SessionUser, operation: string): void {
    if (!gardePerimetre(user).tout) throw new Error(`${operation} : réservé aux utilisateurs dont le périmètre couvre toutes les sociétés, agences et secteurs (ou à un administrateur).`);
}

/** Session requise, et objet dans le périmètre de l'utilisateur : en-tête des actions qui portent sur un objet. */
export async function requireUserDans(type: ObjetPerimetre, id: string): Promise<SessionUser> {
    const { requireUser } = await import('./server');
    const user = await requireUser();
    await gardePerimetre(user).exiger(type, String(id ?? ''));
    return user;
}

/** Cible du paramétrage P1 (site, poste d'un site, compteur, contrat) → objet du périmètre. */
export const objetP1 = (t: { scope: string; id: string }): [ObjetPerimetre, string] => [t.scope === 'meter' ? 'compteur' : t.scope === 'contract' ? 'contrat' : 'site', t.id];
