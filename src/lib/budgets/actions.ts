'use server';

import { requireUser } from '@/lib/auth/server';
import { gardePerimetre } from '@/lib/auth/perimetre-server';
import { budgetClient, enregistrerBudget, figerBudget, pilotageBudgets, suiviBudget, type BudgetDeContrat, type PilotageBudgets, type SuiviBudget } from '@/services/budgets-admin';

/**
 * Budgets des contrats. Lecture : qui voit le contrat. Saisie : modules Contrats ou Facturation (ou administrateur).
 * Gel du budget initial : administrateurs.
 */
type Result<T> = { success: true; data: T } | { success: false; error: string };
const run = async <T,>(f: (u: Awaited<ReturnType<typeof requireUser>>) => Promise<T>): Promise<Result<T>> => {
    try { return { success: true, data: JSON.parse(JSON.stringify(await f(await requireUser()))) as T }; }
    catch (e) { return { success: false, error: e instanceof Error ? e.message : 'Opération impossible.' }; }
};

export const suiviBudgetAction = async (contractId: string, annee: number): Promise<Result<SuiviBudget>> =>
    run(async u => { await gardePerimetre(u).exiger('contrat', String(contractId)); return suiviBudget(String(contractId), Number(annee)); });

export const enregistrerBudgetAction = async (contractId: string, annee: number, lignes: unknown): Promise<Result<null>> => run(async u => {
    if (!u.isAdmin && !u.profile.modules?.some(m => m === 'contracts' || m === 'billing')) throw new Error('Réservé aux modules Contrats et Facturation.');
    await gardePerimetre(u).exiger('contrat', String(contractId));
    await enregistrerBudget(String(contractId), Number(annee), lignes, u.email);
    return null;
});

export const figerBudgetAction = async (contractId: string, annee: number): Promise<Result<null>> => run(async u => {
    if (!u.isAdmin) throw new Error('Seul un administrateur fige le budget initial.');
    await gardePerimetre(u).exiger('contrat', String(contractId));
    await figerBudget(String(contractId), Number(annee), u.email);
    return null;
});

/** Pilotage des budgets : contrats du périmètre ; modules Contrats ou Facturation (ou administrateur). */
export const pilotageBudgetsAction = async (annee: number, forcer = false): Promise<Result<PilotageBudgets>> => run(async u => {
    if (!u.isAdmin && !u.profile.modules?.some(m => m === 'contracts' || m === 'billing')) throw new Error('Réservé aux modules Contrats et Facturation.');
    return pilotageBudgets(Number(annee), await gardePerimetre(u).ids('contracts'), forcer === true);
});

export const budgetClientAction = async (clientId: string, annee: number): Promise<Result<{ annee: number; contrats: BudgetDeContrat[] }>> => run(async u => {
    const garde = gardePerimetre(u);
    await garde.exiger('client', String(clientId));
    return budgetClient(String(clientId), Number(annee), await garde.ids('contracts'));
});
