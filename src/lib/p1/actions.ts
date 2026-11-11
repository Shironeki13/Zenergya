'use server';

import { requireUser } from '@/lib/auth/server';
import { objetP1, requireUserDans } from '@/lib/auth/perimetre-server';
import { deleteSaisonChauffe, listSaisonsChauffe, setSaisonChauffe } from '@/services/p1-admin';
import type { SaisonChauffe } from '@/lib/p1/saisons';
import type { NewVersion } from '@/lib/p1/stockage';
import type { FormuleVersion, PerimetreFormule } from '@/lib/p1/formules';
import {
    addP1Formule, addP1FormuleVersion, addP1Poste, addP1Version, getP1Site, previewPrixP1, retireP1Formule, retireP1FormuleVersion,
    retireP1Poste, retireP1Version, getP1Contract, getP1Meter, getP1Reel,
    type P1ContractView, type P1MeterView, type P1ReelLigne, type P1SiteView, type P1Target, type PrixP1Preview,
} from '@/services/p1-admin';
import { repriseP1Contrat } from '@/services/p1-reprise-admin';

/** Paramétrage P1 : lecture et écritures par version, au nom de l'utilisateur connecté (tracé sur chaque version). */

type Result<T> = { success: true; data: T } | { success: false; error: string };
const fail = (e: unknown): { success: false; error: string } => ({ success: false, error: e instanceof Error ? e.message : 'Opération impossible.' });

export async function getP1SiteAction(siteId: string, date?: string): Promise<Result<P1SiteView>> {
    try { await requireUserDans('site', siteId); return { success: true, data: JSON.parse(JSON.stringify(await getP1Site(siteId, date))) }; } catch (e) { return fail(e); }
}

export async function addP1VersionAction(target: P1Target, key: string, version: NewVersion): Promise<Result<null>> {
    try { const u = await requireUserDans(...objetP1(target)); await addP1Version(target, key, version, u.email); return { success: true, data: null }; } catch (e) { return fail(e); }
}

export async function retireP1VersionAction(target: P1Target, key: string, versionId: string, motif: string): Promise<Result<null>> {
    try { const u = await requireUserDans(...objetP1(target)); await retireP1Version(target, key, versionId, motif, u.email); return { success: true, data: null }; } catch (e) { return fail(e); }
}

export async function addP1PosteAction(siteId: string, designation: string): Promise<Result<string>> {
    try { const u = await requireUserDans('site', siteId); return { success: true, data: await addP1Poste(siteId, designation, u.email) }; } catch (e) { return fail(e); }
}

export async function retireP1PosteAction(siteId: string, posteId: string, motif: string): Promise<Result<null>> {
    try { const u = await requireUserDans('site', siteId); await retireP1Poste(siteId, posteId, motif, u.email); return { success: true, data: null }; } catch (e) { return fail(e); }
}

export async function addP1FormuleAction(contractId: string, f: { nom: string; usage: 'chauffage' | 'ecs'; perimetre: PerimetreFormule }): Promise<Result<string>> {
    try { const u = await requireUserDans('contrat', contractId); return { success: true, data: await addP1Formule(contractId, f, u.email) }; } catch (e) { return fail(e); }
}

export async function addP1FormuleVersionAction(contractId: string, formuleId: string, version: FormuleVersion, meta: { dateEffet: string | null; motif: string; document?: string | null }): Promise<Result<null>> {
    try { const u = await requireUserDans('contrat', contractId); await addP1FormuleVersion(contractId, formuleId, version, meta, u.email); return { success: true, data: null }; } catch (e) { return fail(e); }
}

export async function retireP1FormuleVersionAction(contractId: string, formuleId: string, versionId: string, motif: string): Promise<Result<null>> {
    try { const u = await requireUserDans('contrat', contractId); await retireP1FormuleVersion(contractId, formuleId, versionId, motif, u.email); return { success: true, data: null }; } catch (e) { return fail(e); }
}

export async function retireP1FormuleAction(contractId: string, formuleId: string, motif: string): Promise<Result<null>> {
    try { const u = await requireUserDans('contrat', contractId); await retireP1Formule(contractId, formuleId, motif, u.email); return { success: true, data: null }; } catch (e) { return fail(e); }
}

export async function previewPrixP1Action(siteId: string, usage: 'chauffage' | 'ecs', debut: string): Promise<Result<PrixP1Preview>> {
    try { await requireUserDans('site', siteId); return { success: true, data: JSON.parse(JSON.stringify(await previewPrixP1(siteId, usage, debut))) }; } catch (e) { return fail(e); }
}

export async function getP1MeterAction(meterId: string): Promise<Result<P1MeterView>> {
    try { await requireUserDans('compteur', meterId); return { success: true, data: await getP1Meter(meterId) }; } catch (e) { return fail(e); }
}

export async function getP1ContractAction(contractId: string): Promise<Result<P1ContractView>> {
    try { await requireUserDans('contrat', contractId); return { success: true, data: await getP1Contract(contractId) }; } catch (e) { return fail(e); }
}

export async function getP1ReelAction(siteId: string): Promise<Result<P1ReelLigne[]>> {
    try { await requireUserDans('site', siteId); return { success: true, data: await getP1Reel(siteId) }; } catch (e) { return fail(e); }
}

/** À la validation d'un contrat : les valeurs P1 saisies à sa création deviennent des versions d'origine. */
export async function repriseP1ContratAction(contractId: string): Promise<Result<{ reprises: string[]; signalements: string[] }>> {
    try { const user = await requireUserDans('contrat', contractId); return { success: true, data: await repriseP1Contrat(contractId, user.email) }; } catch (e) { return fail(e); }
}

export async function listSaisonsChauffeAction(siteId: string): Promise<Result<SaisonChauffe[]>> {
    try { await requireUserDans('site', siteId); return { success: true, data: await listSaisonsChauffe(siteId) }; } catch (e) { return fail(e); }
}

export async function setSaisonChauffeAction(siteId: string, s: { saison: string; allumage: string; arret: string | null }): Promise<Result<null>> {
    try { const u = await requireUserDans('site', siteId); await setSaisonChauffe(siteId, s, u.email); return { success: true, data: null }; } catch (e) { return fail(e); }
}

export async function deleteSaisonChauffeAction(siteId: string, saison: string): Promise<Result<null>> {
    try { await requireUserDans('site', siteId); await deleteSaisonChauffe(siteId, saison); return { success: true, data: null }; } catch (e) { return fail(e); }
}
