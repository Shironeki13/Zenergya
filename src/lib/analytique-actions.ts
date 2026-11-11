'use server';

import { requireAdmin, requireUser } from '@/lib/auth/server';
import { gardePerimetre, requireUserDans } from '@/lib/auth/perimetre-server';
import type { NiveauAnalytique } from '@/lib/analytique';
import {
    analytiqueClient, analytiqueContrat, reaffecterAnalytique, setAnalytiqueExterne, suiviVentes, type AnalytiqueContrat, type SuiviVentes,
} from '@/services/analytique-admin';

/** Analytique : consultation et code externe pour tout utilisateur ; réaffectation réservée aux administrateurs. */

type Result<T> = { success: true; data: T } | { success: false; error: string };
const fail = (e: unknown): { success: false; error: string } => ({ success: false, error: e instanceof Error ? e.message : 'Opération impossible.' });
const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export async function getAnalytiqueContratAction(contractId: string): Promise<Result<AnalytiqueContrat>> {
    try { await requireUserDans('contrat', contractId); return { success: true, data: plain(await analytiqueContrat(contractId)) }; } catch (e) { return fail(e); }
}

export async function getAnalytiqueClientAction(clientId: string): Promise<Result<Awaited<ReturnType<typeof analytiqueClient>>>> {
    try { await requireUserDans('client', clientId); return { success: true, data: plain(await analytiqueClient(clientId)) }; } catch (e) { return fail(e); }
}

export async function setAnalytiqueExterneAction(niveau: NiveauAnalytique, id: string, valeur: string): Promise<Result<null>> {
    try { const u = await requireUserDans(niveau === 'client' ? 'client' : niveau === 'contrat' ? 'contrat' : 'prestation', id); await setAnalytiqueExterne(niveau, id, valeur, u.email); return { success: true, data: null }; } catch (e) { return fail(e); }
}

export async function reaffecterAnalytiqueAction(contractId: string, motif: string, client: boolean): Promise<Result<null>> {
    try { const u = await requireAdmin(); await reaffecterAnalytique(contractId, motif, u.email, { client }); return { success: true, data: null }; } catch (e) { return fail(e); }
}

export async function suiviVentesAction(debut: string, fin: string): Promise<Result<SuiviVentes>> {
    try {
        const visibles = await gardePerimetre(await requireUser()).clients();
        const s = await suiviVentes(debut, fin);
        if (!visibles) return { success: true, data: plain(s) };
        // Périmètre : seules les lignes dont l'analytique désigne un client du périmètre (les lignes sans analytique ne sont pas attribuables).
        const somme = (l: { montant: number }[]) => Math.round(l.reduce((t, x) => t + x.montant, 0) * 100) / 100;
        const garder = <L extends { analytique: { axes: { clientId?: string } } | null }>(l: L[]) => l.filter(x => !!x.analytique?.axes.clientId && visibles.has(x.analytique.axes.clientId));
        const [lignes, achats] = [garder(s.lignes), garder(s.achats)];
        return { success: true, data: plain({ ...s, lignes, achats, total: somme(lignes), totalAchats: somme(achats), nonAffecte: 0 }) };
    } catch (e) { return fail(e); }
}
