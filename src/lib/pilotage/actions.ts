'use server';

import { requireUser } from '@/lib/auth/server';
import { ajouterCommentaire, definirResponsable, alertesCompteurs, historiqueCommentaires, suiviFacturation, type NouveauCommentaire, type SuiviFacturation } from '@/services/pilotage-admin';
import type { CommentaireSuivi } from '@/lib/pilotage/tcd';
import type { Alerte } from '@/lib/pilotage/alertes-compteurs';

type Result<T> = { success: true; data: T } | { success: false; error: string };
const fail = (e: unknown): { success: false; error: string } => ({ success: false, error: e instanceof Error ? e.message : 'Calcul impossible.' });

export async function suiviFacturationAction(horizonJours: number): Promise<Result<SuiviFacturation>> {
    try { await requireUser(); return { success: true, data: await suiviFacturation(Math.min(Math.max(horizonJours, 7), 366)) }; } catch (e) { return fail(e); }
}

export async function alertesCompteursAction(): Promise<Result<{ today: string; alertes: Alerte[]; compteurs: number }>> {
    try { await requireUser(); return { success: true, data: await alertesCompteurs() }; } catch (e) { return fail(e); }
}

export async function historiqueCommentairesAction(contractId: string): Promise<Result<CommentaireSuivi[]>> {
    try { await requireUser(); return { success: true, data: await historiqueCommentaires(String(contractId)) }; } catch (e) { return fail(e); }
}

export async function ajouterCommentaireAction(input: NouveauCommentaire): Promise<Result<CommentaireSuivi>> {
    try { const user = await requireUser(); return { success: true, data: await ajouterCommentaire(input, user) }; } catch (e) { return fail(e); }
}

export async function definirResponsableAction(contractId: string, userId: string | null): Promise<Result<null>> {
    try { const user = await requireUser(); await definirResponsable(contractId, userId, user.email); return { success: true, data: null }; } catch (e) { return fail(e); }
}
