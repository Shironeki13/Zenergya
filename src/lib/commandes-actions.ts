'use server';

import { requireAdmin, requireUser, type SessionUser } from '@/lib/auth/server';
import { ciblesDuPerimetre, HORS_PERIMETRE } from '@/lib/auth/perimetre-cibles';
import type { CibleCommande, Commande, SeuilsValidation } from '@/lib/commandes';
import {
    ajouterFactureFournisseur, annulerCommande, avancerCommande, deciderCommande, getCommande, listCommandes, listFournisseurs, saveCommande, saveFournisseur,
    importerCommandes, setSeuils, seuilsDe, soumettreCommande, type CommandeInput, type Fournisseur, type RapportImportCommandes,
} from '@/services/commandes-admin';

/** Commandes d'achat : actions serveur (session requise ; les droits de valider sont contrôlés par le service). */

type Result<T> = { success: true; data: T } | { success: false; error: string };
const fail = (e: unknown): { success: false; error: string } => ({ success: false, error: e instanceof Error ? e.message : 'Opération impossible.' });
const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const run = async <T,>(f: (u: Awaited<ReturnType<typeof requireUser>>) => Promise<T>): Promise<Result<T>> => { try { return { success: true, data: plain(await f(await requireUser())) }; } catch (e) { return fail(e); } };

/**
 * Périmètre : un utilisateur voit une commande s'il en est le demandeur ou un valideur désigné, ou si l'une de ses
 * lignes est affectée à une affaire ou à un contrat de son périmètre. Il n'en crée que sur son périmètre.
 */
type Vue = { cible: ((c: CibleCommande) => boolean) | null; moi: string };
const vue = async (u: SessionUser): Promise<Vue> => ({ cible: await ciblesDuPerimetre(u), moi: u.profile.id });
const voit = (c: Commande, v: Vue) => !v.cible || c.requesterId === v.moi || c.etapes.some(e => e.approverId === v.moi) || c.lines.some(l => v.cible!(l.cible));
async function accessible(id: string, u: SessionUser): Promise<void> {
    if (!voit(await getCommande(id), await vue(u))) throw new Error(`Cette commande ${HORS_PERIMETRE}.`);
}

export const listCommandesAction = async (): Promise<Result<Commande[]>> => run(async u => { const v = await vue(u); return (await listCommandes()).filter(c => voit(c, v)); });
export const getCommandeAction = async (id: string): Promise<Result<Commande>> => run(async u => { await accessible(id, u); return getCommande(id); });
export const saveCommandeAction = async (input: CommandeInput & { id?: string }): Promise<Result<Commande>> => run(async u => {
    const { cible } = await vue(u);
    (input?.lines ?? []).forEach((l, i) => { if (cible && l.cible && !cible(l.cible)) throw new Error(`Ligne ${i + 1} : l'affaire ou le contrat choisi ${HORS_PERIMETRE}.`); });
    return saveCommande(input, u);
});
export const soumettreCommandeAction = async (id: string): Promise<Result<Commande>> => run(async u => { await accessible(id, u); return soumettreCommande(id, u); });
export const deciderCommandeAction = async (id: string, decision: 'validee' | 'refusee', commentaire: string): Promise<Result<Commande>> => run(async u => { await accessible(id, u); return deciderCommande(id, decision, commentaire, u); });
export const importerCommandesAction = async (table: unknown[][], companyId: string, appliquer: boolean): Promise<Result<RapportImportCommandes>> => run(async u => importerCommandes(table, companyId, u, appliquer, (await vue(u)).cible ?? undefined));
export const avancerCommandeAction = async (id: string): Promise<Result<Commande>> => run(async u => { await accessible(id, u); return avancerCommande(id, u); });
export const factureFournisseurAction = async (id: string, input: { numero: string; date: string; montantHT: number; solder?: boolean }): Promise<Result<Commande>> => run(async u => { await accessible(id, u); return ajouterFactureFournisseur(id, input, u); });
export const annulerCommandeAction = async (id: string, motif: string): Promise<Result<Commande>> => run(async u => { await accessible(id, u); return annulerCommande(id, motif, u); });

export const listFournisseursAction = async (): Promise<Result<Fournisseur[]>> => run(() => listFournisseurs());
export const saveFournisseurAction = async (input: Parameters<typeof saveFournisseur>[0]): Promise<Result<Fournisseur>> => run(u => saveFournisseur(input, u.email));

export const seuilsAction = async (companyId: string): Promise<Result<SeuilsValidation>> => run(() => seuilsDe(companyId));
export async function setSeuilsAction(companyId: string, seuils: SeuilsValidation): Promise<Result<null>> {
    try { await requireAdmin(); await setSeuils(companyId, seuils); return { success: true, data: null }; } catch (e) { return fail(e); }
}
