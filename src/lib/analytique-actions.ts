'use server';

import { requireAdmin, requireUser } from '@/lib/auth/server';
import type { NiveauAnalytique } from '@/lib/analytique';
import {
    analytiqueClient, analytiqueContrat, reaffecterAnalytique, setAnalytiqueExterne, suiviVentes, type AnalytiqueContrat, type SuiviVentes,
} from '@/services/analytique-admin';

/** Analytique : consultation et code externe pour tout utilisateur ; réaffectation réservée aux administrateurs. */

type Result<T> = { success: true; data: T } | { success: false; error: string };
const fail = (e: unknown): { success: false; error: string } => ({ success: false, error: e instanceof Error ? e.message : 'Opération impossible.' });
const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export async function getAnalytiqueContratAction(contractId: string): Promise<Result<AnalytiqueContrat>> {
    try { await requireUser(); return { success: true, data: plain(await analytiqueContrat(contractId)) }; } catch (e) { return fail(e); }
}

export async function getAnalytiqueClientAction(clientId: string): Promise<Result<Awaited<ReturnType<typeof analytiqueClient>>>> {
    try { await requireUser(); return { success: true, data: plain(await analytiqueClient(clientId)) }; } catch (e) { return fail(e); }
}

export async function setAnalytiqueExterneAction(niveau: NiveauAnalytique, id: string, valeur: string): Promise<Result<null>> {
    try { const u = await requireUser(); await setAnalytiqueExterne(niveau, id, valeur, u.email); return { success: true, data: null }; } catch (e) { return fail(e); }
}

export async function reaffecterAnalytiqueAction(contractId: string, motif: string, client: boolean): Promise<Result<null>> {
    try { const u = await requireAdmin(); await reaffecterAnalytique(contractId, motif, u.email, { client }); return { success: true, data: null }; } catch (e) { return fail(e); }
}

export async function suiviVentesAction(debut: string, fin: string): Promise<Result<SuiviVentes>> {
    try { await requireUser(); return { success: true, data: plain(await suiviVentes(debut, fin)) }; } catch (e) { return fail(e); }
}
