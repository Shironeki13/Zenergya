/**
 * Adressage des factures : le facturé (le client, débiteur légal) peut être représenté par un tiers (syndic d'une
 * copropriété) à qui la facture est adressée, et payé par un autre (l'État pour un ministère). Le facturé garde son
 * nom, son SIRET et sa TVA ; le représentant donne l'adresse d'envoi ; le payeur est mentionné.
 *
 * Le client porte le nom de son représentant et de son payeur ; le tiers du même nom (casse, accents et ponctuation
 * ignorés) apporte l'adresse. Module sans dépendance serveur.
 */

export type Tiers = {
    id: string;
    name: string;
    /** Qualité imprimée après le nom : « syndic », « agent comptable »… */
    quality?: string;
    address?: string;
    postalCode?: string;
    city?: string;
    siret?: string;
    email?: string;
    phone?: string;
};

export type PartieAdresse = { name: string; quality?: string; address?: string; postalCode?: string; city?: string; siret?: string };
export type Adressage = { representative?: PartieAdresse; payer?: PartieAdresse };

export const cleTiers = (nom?: string | null) =>
    String(nom ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

export function trouverTiers<T extends Pick<Tiers, 'name'>>(tiers: T[], nom?: string | null): T | undefined {
    const k = cleTiers(nom);
    return k ? tiers.find(t => cleTiers(t.name) === k) : undefined;
}

const aAdresse = (p?: { address?: string; city?: string }) => !!(p?.address?.trim() && p?.city?.trim());

function partie(nom: string | undefined | null, tiers: Tiers[], avecSiret: boolean): PartieAdresse | undefined {
    const n = nom?.trim();
    if (!n) return undefined;
    const t = trouverTiers(tiers, n);
    if (!t) return { name: n };
    return {
        name: t.name, ...(t.quality?.trim() && { quality: t.quality.trim() }),
        ...(aAdresse(t) && { address: t.address!.trim(), postalCode: t.postalCode?.trim() ?? '', city: t.city!.trim() }),
        ...(avecSiret && t.siret?.trim() && { siret: t.siret.trim() }),
    };
}

/** Représentant et payeur d'un client, complétés par les tiers connus. Un payeur identique au client est ignoré. */
export function adressageClient(client: { name?: string; representedBy?: string; payer?: string } | null | undefined, tiers: Tiers[]): Adressage {
    const representative = partie(client?.representedBy, tiers, false);
    const payer = cleTiers(client?.payer) === cleTiers(client?.name) ? undefined : partie(client?.payer, tiers, true);
    return { ...(representative && { representative }), ...(payer && { payer }) };
}

/** Adresse imprimée sous le nom du facturé : celle du représentant quand elle est connue, sinon celle du client. */
export function adresseEnvoi<A extends { address?: string; postalCode?: string; city?: string }>(client: A, a: Adressage): { address?: string; postalCode?: string; city?: string } {
    return aAdresse(a.representative) ? { address: a.representative!.address, postalCode: a.representative!.postalCode, city: a.representative!.city } : { address: client.address, postalCode: client.postalCode, city: client.city };
}

/** « Cabinet Durand (syndic) ». */
export const libellePartie = (p: PartieAdresse) => (p.quality ? `${p.name} (${p.quality})` : p.name);

/** Ce qui manque pour adresser correctement les factures du client (affiché sur sa fiche). */
export function manquesAdressage(client: { representedBy?: string; payer?: string }, tiers: Tiers[]): string[] {
    const a = adressageClient(client, tiers);
    return [
        a.representative && !aAdresse(a.representative) && `L'adresse de ${a.representative.name} n'est pas renseignée : la facture part à l'adresse du client.`,
        a.payer && !aAdresse(a.payer) && `L'adresse du payeur ${a.payer.name} n'est pas renseignée.`,
    ].filter((x): x is string => !!x);
}
