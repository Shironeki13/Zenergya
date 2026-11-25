/**
 * Familles du P1 : ce qu'une prestation P1 facture. Le type enregistré sur la prestation (`p1Type`) ne change pas ;
 * chaque famille a son code métier, affiché à l'écran et sur les factures.
 *
 *   P1C  chauffage                  P1E  eau chaude sanitaire
 *   P1A  abonnement (part fixe)     €€   refacturation à l'euro l'euro des factures du fournisseur d'énergie
 */
export const FAMILLES_P1 = {
    CHAUFFAGE: { code: 'P1C', libelle: 'Chauffage' },
    ECS: { code: 'P1E', libelle: 'Eau chaude sanitaire' },
    ABONNEMENT: { code: 'P1A', libelle: 'Abonnement' },
    REFACTURATION: { code: '€€', libelle: "Refacturation à l'euro l'euro" },
    EAU_FROIDE: { code: 'P1', libelle: 'Eau froide' },
    AUTRE: { code: 'P1', libelle: 'Autre' },
} as const;

export type TypeP1 = keyof typeof FAMILLES_P1;
export const TYPES_P1 = Object.keys(FAMILLES_P1) as TypeP1[];

export const familleP1 = (type?: string | null) => (type && type in FAMILLES_P1 ? FAMILLES_P1[type as TypeP1] : null);

/** « P1A — Abonnement » ; vide si le type est inconnu ou absent. */
export function libelleFamilleP1(type?: string | null): string {
    const f = familleP1(type);
    return f ? (f.code === 'P1' ? f.libelle : `${f.code} — ${f.libelle}`) : '';
}
