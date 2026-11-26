import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import type { GardePerimetre } from '@/lib/auth/perimetre-server';
import { encoursParInterlocuteur, type ClientEncours, type ContactEncours, type FactureEncours, type Interlocuteur } from '@/lib/billing/encours';
import { listerTiers } from './tiers-admin';

/** Encours et relances : factures émises non payées du périmètre, par interlocuteur de paiement. */

const texte = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const jour = (v: unknown): string => {
    const d = v && typeof v === 'object' && 'toDate' in v ? (v as { toDate: () => Date }).toDate() : typeof v === 'string' && v ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '';
};
const STATUTS = ['due', 'overdue'];

export type Encours = { aujourdhui: string; interlocuteurs: Interlocuteur[]; emetteur: string };

export async function encours(garde: GardePerimetre): Promise<Encours> {
    const visibles = await garde.clients();
    const docs = (await adminDb.collection('invoices').where('status', 'in', STATUTS).select('invoiceNumber', 'clientId', 'clientName', 'date', 'dueDate', 'total').get())
        .docs.filter(d => texte(d.get('invoiceNumber')) && (!visibles || visibles.has(texte(d.get('clientId')))));
    const factures: FactureEncours[] = docs.map(d => ({ id: d.id, numero: texte(d.get('invoiceNumber')), clientId: texte(d.get('clientId')), date: jour(d.get('date')), echeance: jour(d.get('dueDate')), total: Number(d.get('total')) || 0 }));
    const ids = [...new Set(factures.map(f => f.clientId).filter(Boolean))];
    const clients: ClientEncours[] = [];
    const contacts: Record<string, ContactEncours> = {};
    for (let i = 0; i < ids.length; i += 300) {
        const lot = await adminDb.getAll(...ids.slice(i, i + 300).map(id => adminDb.collection('clients').doc(id)));
        for (const c of lot) if (c.exists) clients.push({ id: c.id, name: texte(c.get('name')), representedBy: texte(c.get('representedBy')), payer: texte(c.get('payer')) });
    }
    // Client sans nom connu (fiche supprimée) : le nom recopié sur la facture.
    for (const d of docs) if (!clients.some(c => c.id === texte(d.get('clientId')))) clients.push({ id: texte(d.get('clientId')), name: texte(d.get('clientName')) || 'Client inconnu' });
    for (let i = 0; i < ids.length; i += 30) {
        const lot = await adminDb.collection('contacts').where('clientId', 'in', ids.slice(i, i + 30)).get();
        for (const c of lot.docs) if (c.get('type') === 'facturation' && !contacts[texte(c.get('clientId'))]) contacts[texte(c.get('clientId'))] = { name: texte(c.get('name')), email: texte(c.get('email')), phone: texte(c.get('phone')) };
    }
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const societe = (await adminDb.collection('companies').limit(2).get()).docs;
    return { aujourdhui, interlocuteurs: encoursParInterlocuteur(factures, clients, await listerTiers(), contacts, aujourdhui), emetteur: societe.length === 1 ? texte(societe[0].get('name')) : '' };
}

/**
 * Encaissement : les factures indiquées passent à « payée ». Chaque facture doit être dans le périmètre et encore à
 * payer ; rien n'est écrit si l'une ne l'est pas.
 */
export async function encaisser(ids: string[], garde: GardePerimetre, par: string): Promise<number> {
    const uniques = [...new Set(ids.filter(Boolean))];
    if (uniques.length === 0) throw new Error('Aucune facture sélectionnée.');
    if (uniques.length > 200) throw new Error('Au plus 200 factures par encaissement.');
    for (const id of uniques) await garde.exiger('facture', id);
    const refs = uniques.map(id => adminDb.collection('invoices').doc(id));
    await adminDb.runTransaction(async tx => {
        const lus = await tx.getAll(...refs);
        const refus = lus.find(d => !d.exists || !STATUTS.includes(d.get('status')));
        if (refus) throw new Error(`La facture ${texte(refus.get('invoiceNumber')) || refus.id} n'est plus à payer : rechargez la page.`);
        const le = new Date().toISOString();
        for (const d of lus) tx.update(d.ref, { status: 'paid', paidAt: le, paidMarkedBy: par });
    });
    return uniques.length;
}
