'use server';

import { requireUser } from '@/lib/auth/server';
import { gardePerimetre } from '@/lib/auth/perimetre-server';
import type { PeriodeFourniture, PointImporte, PointLivraison } from '@/lib/energie/fournitures';
import { margeSite, margesP1, type MargeSite } from '@/services/energie-marge-admin';
import {
    baseEnergie, enregistrerPeriode, exigerAchatsEnergie, importerPoints, pointLivraison, rattacherPoint, supprimerPeriode, type BaseEnergie, type RapportImportEnergie,
} from '@/services/energie-admin';

/** Contrats de fourniture d'énergie : administrateurs et utilisateurs du module Achats, dans leur périmètre. */

type Result<T> = { success: true; data: T } | { success: false; error: string };
const run = async <T,>(f: (u: Awaited<ReturnType<typeof requireUser>>) => Promise<T>): Promise<Result<T>> => {
    try { const u = await requireUser(); exigerAchatsEnergie(u); return { success: true, data: JSON.parse(JSON.stringify(await f(u))) as T }; }
    catch (e) { return { success: false, error: e instanceof Error ? e.message : 'Opération impossible.' }; }
};

export const baseEnergieAction = async (): Promise<Result<BaseEnergie>> => run(u => baseEnergie(gardePerimetre(u)));
export const pointLivraisonAction = async (id: string): Promise<Result<PointLivraison>> => run(u => pointLivraison(id, gardePerimetre(u)));

/** Import par paquets (au plus 250 points par appel) ; réservé à qui voit tout le périmètre. */
export const importerPointsAction = async (points: PointImporte[]): Promise<Result<RapportImportEnergie>> => run(async u => {
    if (!gardePerimetre(u).tout) throw new Error("L'import de la base des contrats d'énergie demande un périmètre complet.");
    if (!Array.isArray(points) || points.length > 250) throw new Error('Au plus 250 points de livraison par envoi.');
    return importerPoints(points, u.email);
});

export const rattacherPointAction = async (id: string, siteId: string | null): Promise<Result<null>> => run(async u => {
    const garde = gardePerimetre(u);
    await pointLivraison(id, garde).catch(e => { if (!garde.tout) throw e; });
    if (siteId) await garde.exiger('site', siteId);
    await rattacherPoint(id, siteId, u.email); return null;
});

export const enregistrerPeriodeAction = async (id: string, saisie: Partial<PeriodeFourniture>): Promise<Result<null>> => run(async u => { await pointLivraison(id, gardePerimetre(u)); await enregistrerPeriode(id, saisie, u.email); return null; });
export const supprimerPeriodeAction = async (id: string, periodeId: string): Promise<Result<null>> => run(async u => { await pointLivraison(id, gardePerimetre(u)); await supprimerPeriode(id, periodeId, u.email); return null; });

/** Marge P1 d'un site (achats d'énergie face au P1 facturé), et de tous les sites qui ont des achats saisis. */
export const margeSiteAction = async (siteId: string): Promise<Result<MargeSite>> => run(async u => { await gardePerimetre(u).exiger('site', siteId); return margeSite(siteId); });
export const margesP1Action = async (): Promise<Result<MargeSite[]>> => run(u => margesP1(gardePerimetre(u)));
