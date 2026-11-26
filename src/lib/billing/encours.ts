/**
 * Encours et relances : les factures émises non payées, regroupées par interlocuteur de paiement, c'est-à-dire celui
 * à qui s'adresser pour être payé : le payeur du client s'il en a un, sinon son représentant (syndic), sinon le client.
 * Un syndic ou un payeur commun à plusieurs clients n'a ainsi qu'une ligne, avec toutes ses factures.
 * Module sans dépendance serveur.
 */
import { cleTiers, trouverTiers, type Tiers } from './adressage';

export type RoleInterlocuteur = 'payeur' | 'representant' | 'client';
export type ClientEncours = { id: string; name: string; representedBy?: string; payer?: string };
export type ContactEncours = { name?: string; email?: string; phone?: string };
export type FactureEncours = { id: string; numero: string; clientId: string; date: string; echeance: string; total: number };

export type LigneFactureEncours = FactureEncours & { client: string; joursRetard: number };
export type Interlocuteur = {
    cle: string;
    role: RoleInterlocuteur;
    name: string;
    quality?: string;
    email?: string;
    phone?: string;
    /** Adresse du tiers (ou vide : celle du client fait foi). */
    adresse?: string;
    clients: { id: string; name: string }[];
    factures: LigneFactureEncours[];
    encours: number;
    echu: number;
    /** Retard de la plus ancienne facture échue, en jours (0 : rien d'échu). */
    retardMax: number;
};

const cents = (n: number) => Math.round(n * 100) / 100;
const jours = (de: string, a: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);

/** À qui s'adresser pour le paiement des factures d'un client. */
export function interlocuteurPaiement(client: ClientEncours, tiers: Tiers[]): { cle: string; role: RoleInterlocuteur; name: string; tiers?: Tiers } {
    const payeur = client.payer?.trim() && cleTiers(client.payer) !== cleTiers(client.name) ? client.payer.trim() : '';
    const nom = payeur || client.representedBy?.trim() || '';
    if (!nom) return { cle: `client:${client.id}`, role: 'client', name: client.name };
    const t = trouverTiers(tiers, nom);
    return { cle: `tiers:${cleTiers(nom)}`, role: payeur ? 'payeur' : 'representant', name: t?.name ?? nom, ...(t && { tiers: t }) };
}

/**
 * Encours par interlocuteur, le plus gros montant échu en tête. `contacts` : contact de facturation de chaque client,
 * utilisé quand le client est son propre interlocuteur.
 */
export function encoursParInterlocuteur(factures: FactureEncours[], clients: ClientEncours[], tiers: Tiers[], contacts: Record<string, ContactEncours>, aujourdhui: string): Interlocuteur[] {
    const parId = new Map(clients.map(c => [c.id, c]));
    const groupes = new Map<string, Interlocuteur>();
    for (const f of factures) {
        const client = parId.get(f.clientId) ?? { id: f.clientId, name: 'Client inconnu' };
        const i = interlocuteurPaiement(client, tiers);
        let g = groupes.get(i.cle);
        if (!g) {
            const contact = i.role === 'client' ? contacts[client.id] : undefined;
            const t = i.tiers;
            g = {
                cle: i.cle, role: i.role, name: i.name, ...(t?.quality && { quality: t.quality }),
                email: t?.email || contact?.email || '', phone: t?.phone || contact?.phone || '',
                ...(t?.address && t?.city && { adresse: [t.address, `${t.postalCode ?? ''} ${t.city}`.trim()].join(', ') }),
                clients: [], factures: [], encours: 0, echu: 0, retardMax: 0,
            };
            groupes.set(i.cle, g);
        }
        if (!g.clients.some(c => c.id === client.id)) g.clients.push({ id: client.id, name: client.name });
        const retard = f.echeance ? Math.max(0, jours(f.echeance, aujourdhui)) : 0;
        g.factures.push({ ...f, client: client.name, joursRetard: retard });
        g.encours = cents(g.encours + f.total);
        if (retard > 0) { g.echu = cents(g.echu + f.total); g.retardMax = Math.max(g.retardMax, retard); }
    }
    for (const g of groupes.values()) {
        g.factures.sort((a, b) => (a.echeance || '9999').localeCompare(b.echeance || '9999') || a.numero.localeCompare(b.numero));
        g.clients.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    }
    return [...groupes.values()].sort((a, b) => b.echu - a.echu || b.encours - a.encours || a.name.localeCompare(b.name, 'fr'));
}

export const LIBELLE_ROLE: Record<RoleInterlocuteur, string> = { payeur: 'Payeur', representant: 'Représentant', client: 'Client' };

/** Texte d'un relevé des factures à payer, à coller dans un courrier ou un message de relance. */
export function releveRelance(i: Pick<Interlocuteur, 'name' | 'factures' | 'encours' | 'echu'>, emetteur: string): string {
    const fr = (d: string) => (d ? d.split('-').reverse().join('/') : '—');
    const eur = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, ' ')} €`;
    const plusieurs = new Set(i.factures.map(f => f.clientId)).size > 1;
    return [
        `Relevé des factures à régler — ${i.name}`,
        '',
        ...i.factures.map(f => `- Facture n° ${f.numero} du ${fr(f.date)}${plusieurs ? ` (${f.client})` : ''} : ${eur(f.total)} TTC, échéance ${fr(f.echeance)}${f.joursRetard > 0 ? `, échue depuis ${f.joursRetard} jour${f.joursRetard > 1 ? 's' : ''}` : ''}`),
        '',
        `Total à régler : ${eur(i.encours)} TTC${i.echu > 0 ? `, dont ${eur(i.echu)} échus` : ''}.`,
        emetteur,
    ].join('\n');
}
