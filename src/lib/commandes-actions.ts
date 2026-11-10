'use server';

import { requireAdmin, requireUser } from '@/lib/auth/server';
import type { Commande, SeuilsValidation } from '@/lib/commandes';
import {
    ajouterFactureFournisseur, annulerCommande, avancerCommande, deciderCommande, getCommande, listCommandes, listFournisseurs, saveCommande, saveFournisseur,
    setSeuils, seuilsDe, soumettreCommande, type CommandeInput, type Fournisseur,
} from '@/services/commandes-admin';

/** Commandes d'achat : actions serveur (session requise ; les droits de valider sont contrôlés par le service). */

type Result<T> = { success: true; data: T } | { success: false; error: string };
const fail = (e: unknown): { success: false; error: string } => ({ success: false, error: e instanceof Error ? e.message : 'Opération impossible.' });
const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const run = async <T,>(f: (u: Awaited<ReturnType<typeof requireUser>>) => Promise<T>): Promise<Result<T>> => { try { return { success: true, data: plain(await f(await requireUser())) }; } catch (e) { return fail(e); } };

export const listCommandesAction = async (): Promise<Result<Commande[]>> => run(() => listCommandes());
export const getCommandeAction = async (id: string): Promise<Result<Commande>> => run(() => getCommande(id));
export const saveCommandeAction = async (input: CommandeInput & { id?: string }): Promise<Result<Commande>> => run(u => saveCommande(input, u));
export const soumettreCommandeAction = async (id: string): Promise<Result<Commande>> => run(u => soumettreCommande(id, u));
export const deciderCommandeAction = async (id: string, decision: 'validee' | 'refusee', commentaire: string): Promise<Result<Commande>> => run(u => deciderCommande(id, decision, commentaire, u));
export const avancerCommandeAction = async (id: string): Promise<Result<Commande>> => run(u => avancerCommande(id, u));
export const factureFournisseurAction = async (id: string, input: { numero: string; date: string; montantHT: number; solder?: boolean }): Promise<Result<Commande>> => run(u => ajouterFactureFournisseur(id, input, u));
export const annulerCommandeAction = async (id: string, motif: string): Promise<Result<Commande>> => run(u => annulerCommande(id, motif, u));

export const listFournisseursAction = async (): Promise<Result<Fournisseur[]>> => run(() => listFournisseurs());
export const saveFournisseurAction = async (input: Parameters<typeof saveFournisseur>[0]): Promise<Result<Fournisseur>> => run(u => saveFournisseur(input, u.email));

export const seuilsAction = async (companyId: string): Promise<Result<SeuilsValidation>> => run(() => seuilsDe(companyId));
export async function setSeuilsAction(companyId: string, seuils: SeuilsValidation): Promise<Result<null>> {
    try { await requireAdmin(); await setSeuils(companyId, seuils); return { success: true, data: null }; } catch (e) { return fail(e); }
}
