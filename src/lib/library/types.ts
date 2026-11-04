import type { ComponentKind } from '@/lib/quotes/types';

/**
 * Bibliothèque de prix (collections `priceArticles` et `priceWorks`).
 * Insérés dans un devis par recopie : modifier la bibliothèque ne change jamais un devis existant.
 */

export const ARTICLE_KINDS: ComponentKind[] = ['FOURNITURE', 'MAIN_OEUVRE', 'SOUS_TRAITANCE', 'DIVERS'];

export type PriceArticle = {
    id: string;
    code: string;                  // unique (référence interne ou fournisseur), ex. ART-00001
    label: string;
    description?: string;
    kind: ComponentKind;
    unit: string;                  // u, m, m², h, ens…
    /** Déboursé unitaire HT. Main-d'œuvre : vide = coût horaire du devis. */
    unitCost: number | null;
    family?: string;               // famille / catégorie (ex. Chaufferie, Robinetterie)
    supplier?: string;
    supplierRef?: string;
    active: boolean;               // inactif : n'est plus proposé, reste lisible
    costUpdatedAt?: string;        // dernière mise à jour du déboursé
    createdAt: string;
    createdBy?: string;
    updatedAt: string;
    updatedBy?: string;
};

/** Ouvrage : articles et quantités pour UNE unité d'ouvrage. */
export type PriceWork = {
    id: string;
    code: string;                  // ex. OUV-00001
    label: string;
    description?: string;
    unit: string;
    family?: string;
    components: { articleId: string; quantity: number }[];
    active: boolean;
    createdAt: string;
    createdBy?: string;
    updatedAt: string;
    updatedBy?: string;
};
