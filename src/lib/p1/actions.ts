'use server';

import { requireUser } from '@/lib/auth/server';
import type { NewVersion } from '@/lib/p1/stockage';
import { addP1Poste, addP1Version, getP1Site, retireP1Poste, retireP1Version, type P1SiteView, type P1Target } from '@/services/p1-admin';

/** Paramétrage P1 : lecture et écritures par version, au nom de l'utilisateur connecté (tracé sur chaque version). */

type Result<T> = { success: true; data: T } | { success: false; error: string };
const fail = (e: unknown): { success: false; error: string } => ({ success: false, error: e instanceof Error ? e.message : 'Opération impossible.' });

export async function getP1SiteAction(siteId: string, date?: string): Promise<Result<P1SiteView>> {
    try { await requireUser(); return { success: true, data: JSON.parse(JSON.stringify(await getP1Site(siteId, date))) }; } catch (e) { return fail(e); }
}

export async function addP1VersionAction(target: P1Target, key: string, version: NewVersion): Promise<Result<null>> {
    try { const u = await requireUser(); await addP1Version(target, key, version, u.email); return { success: true, data: null }; } catch (e) { return fail(e); }
}

export async function retireP1VersionAction(target: P1Target, key: string, versionId: string, motif: string): Promise<Result<null>> {
    try { const u = await requireUser(); await retireP1Version(target, key, versionId, motif, u.email); return { success: true, data: null }; } catch (e) { return fail(e); }
}

export async function addP1PosteAction(siteId: string, designation: string): Promise<Result<string>> {
    try { const u = await requireUser(); return { success: true, data: await addP1Poste(siteId, designation, u.email) }; } catch (e) { return fail(e); }
}

export async function retireP1PosteAction(siteId: string, posteId: string, motif: string): Promise<Result<null>> {
    try { const u = await requireUser(); await retireP1Poste(siteId, posteId, motif, u.email); return { success: true, data: null }; } catch (e) { return fail(e); }
}
