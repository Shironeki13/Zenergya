'use server';

import { requireUserDans } from '@/lib/auth/perimetre-server';
import {
    creerFactureEnergie, facturesEnergieDuSite, modifierFactureEnergie, siteDeFactureEnergie, supprimerFactureEnergie, type FactureEnergieSuivie,
} from '@/services/factures-energie-admin';

/** Factures des fournisseurs d'énergie d'un site (refacturation à l'euro l'euro) : réservé aux utilisateurs du périmètre du site. */

type Result<T> = { success: true; data: T } | { success: false; error: string };
const fail = (e: unknown): { success: false; error: string } => ({ success: false, error: e instanceof Error ? e.message : 'Opération impossible.' });

export async function facturesEnergieAction(siteId: string): Promise<Result<FactureEnergieSuivie[]>> {
    try { await requireUserDans('site', siteId); return { success: true, data: await facturesEnergieDuSite(siteId) }; } catch (e) { return fail(e); }
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
