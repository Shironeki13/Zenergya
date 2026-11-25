'use server';

import { requireUser } from '@/lib/auth/server';
import { gardePerimetre, requireUserDans } from '@/lib/auth/perimetre-server';
import { exigerAchatsEnergie } from '@/services/energie-admin';
import { bigQueryActif } from '@/services/energie-bigquery';
import {
    creerFactureEnergie, facturesEnergieDuPoint, facturesEnergieDuSiteAvecEtat, modifierFactureEnergie, pointsDuSite, siteDeFactureEnergie, supprimerFactureEnergie, type FactureEnergieSuivie, type PointDuSite,
} from '@/services/factures-energie-admin';

/** Factures des fournisseurs d'énergie d'un site (refacturation à l'euro l'euro) : réservé aux utilisateurs du périmètre du site. */

type Result<T> = { success: true; data: T } | { success: false; error: string };
const fail = (e: unknown): { success: false; error: string } => ({ success: false, error: e instanceof Error ? e.message : 'Opération impossible.' });

export async function facturesEnergieAction(siteId: string): Promise<Result<{ factures: FactureEnergieSuivie[]; points: PointDuSite[]; avertissement?: string; flux: boolean }>> {
    try {
        await requireUserDans('site', siteId);
        const [etat, pts] = await Promise.all([facturesEnergieDuSiteAvecEtat(siteId), pointsDuSite(siteId)]);
        return { success: true, data: JSON.parse(JSON.stringify({ ...etat, points: pts.points, flux: bigQueryActif() })) };
    } catch (e) { return fail(e); }
}

/** Factures du fournisseur d'un point de livraison (fiche du point, module Achats). */
export async function facturesEnergieDuPointAction(pointId: string): Promise<Result<FactureEnergieSuivie[]>> {
    try {
        const user = await requireUser();
        exigerAchatsEnergie(user);
        const factures = await facturesEnergieDuPoint(pointId);
        const garde = gardePerimetre(user);
        const visibles: FactureEnergieSuivie[] = [];
        for (const f of factures) if (await garde.voit('site', f.siteId)) visibles.push(f);
        return { success: true, data: JSON.parse(JSON.stringify(visibles)) };
    } catch (e) { return fail(e); }
}

export async function enregistrerFactureEnergieAction(siteId: string, id: string | null, saisie: Record<string, unknown>): Promise<Result<null>> {
    try {
        const user = await requireUserDans('site', siteId);
        if (id) {
            if ((await siteDeFactureEnergie(id)) !== siteId) throw new Error('Facture du fournisseur introuvable sur ce site.');
            await modifierFactureEnergie(id, saisie, user.email);
        } else await creerFactureEnergie(siteId, saisie, user.email);
        return { success: true, data: null };
    } catch (e) { return fail(e); }
}

export async function supprimerFactureEnergieAction(siteId: string, id: string): Promise<Result<null>> {
    try {
        await requireUserDans('site', siteId);
        if ((await siteDeFactureEnergie(id)) !== siteId) throw new Error('Facture du fournisseur introuvable sur ce site.');
        await supprimerFactureEnergie(id);
        return { success: true, data: null };
    } catch (e) { return fail(e); }
}
