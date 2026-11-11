'use server';

import { requireUser } from '@/lib/auth/server';
import { gardePerimetre, requireUserDans } from '@/lib/auth/perimetre-server';
import { ajouterCommentaire, definirResponsable, alertesCompteurs, historiqueCommentaires, suiviFacturation, type NouveauCommentaire, type SuiviFacturation } from '@/services/pilotage-admin';
import type { CommentaireSuivi } from '@/lib/pilotage/tcd';
import type { Alerte } from '@/lib/pilotage/alertes-compteurs';

type Result<T> = { success: true; data: T } | { success: false; error: string };
const fail = (e: unknown): { success: false; error: string } => ({ success: false, error: e instanceof Error ? e.message : 'Calcul impossible.' });

export async function suiviFacturationAction(horizonJours: number): Promise<Result<SuiviFacturation>> {
    try {
        const garde = gardePerimetre(await requireUser());
        const s = await suiviFacturation(Math.min(Math.max(horizonJours, 7), 366));
        const visibles = await garde.clients();
        if (!visibles) return { success: true, data: s };
        // Périmètre : échéances, contrats en erreur, émis, commentaires et filtres des seuls clients visibles.
        const echeances = s.echeances.filter(e => visibles.has(e.clientId));
        const contratsEnErreur = s.contratsEnErreur.filter(c => !!c.dims.client && visibles.has(c.dims.client));
        const contrats = new Set([...echeances.map(e => e.contractId), ...contratsEnErreur.map(c => c.contractId)]);
        return { success: true, data: {
            ...s, echeances, contratsEnErreur, commentaires: s.commentaires.filter(c => contrats.has(c.contractId)), emis: s.emis.filter(l => !!l.client && visibles.has(l.client)),
            options: { ...s.options, client: s.options.client.filter(o => visibles.has(o.id)), site: s.options.site.filter(o => !!o.parent && visibles.has(o.parent)) },
        } };
    } catch (e) { return fail(e); }
}

export async function alertesCompteursAction(): Promise<Result<{ today: string; alertes: Alerte[]; compteurs: number }>> {
    try {
        const sites = await gardePerimetre(await requireUser()).ids('sites');
        const a = await alertesCompteurs();
        return { success: true, data: sites ? { ...a, alertes: a.alertes.filter(x => sites.has(x.siteId)) } : a };
    } catch (e) { return fail(e); }
}

export async function historiqueCommentairesAction(contractId: string): Promise<Result<CommentaireSuivi[]>> {
    try { await requireUserDans('contrat', contractId); return { success: true, data: await historiqueCommentaires(String(contractId)) }; } catch (e) { return fail(e); }
}

export async function ajouterCommentaireAction(input: NouveauCommentaire): Promise<Result<CommentaireSuivi>> {
    try { const user = await requireUserDans('contrat', input.contractId); return { success: true, data: await ajouterCommentaire(input, user) }; } catch (e) { return fail(e); }
}

export async function definirResponsableAction(contractId: string, userId: string | null): Promise<Result<null>> {
    try { const user = await requireUserDans('contrat', contractId); await definirResponsable(contractId, userId, user.email); return { success: true, data: null }; } catch (e) { return fail(e); }
}
