/**
 * Décompte MTI d'une saison (acomptes puis décompte) : P1 dû = arrondi(P1₀ × C/C0 annuel × DJU de la saison / DJU
 * contractuels, 2), où P1₀ = quantité de référence (MWh) × prix de base, C/C0 annuel = moyenne des coefficients
 * mensuels pondérée par les DJU (mois d'allumage et d'arrêt au prorata). Réparti par mois au prorata des DJU (le
 * dernier mois prend le reste au centime) pour être comparé aux acomptes de chaque mois.
 */

export type DecompteSaison = {
    saison: string; p1Base: number; quantite: number; prixBase: number; coefficient: number;
    dju: number; djuReference: number; du: number;
    mois: { mois: string; dju: number; montant: number }[];
};

const cents = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

export function decompteSaison(p: { saison: string; quantite: number; prixBase: number; coefficient: number; djuReference: number; djuParMois: Record<string, number> }): DecompteSaison | string {
    if (!(p.quantite > 0)) return 'quantité de référence (cible NB ou quantité annuelle des acomptes) non renseignée';
    if (!(p.prixBase > 0)) return 'prix de base du site non renseigné';
    if (!(p.djuReference > 0)) return 'DJU de référence (contractuels) non renseignés';
    const mois = Object.entries(p.djuParMois).filter(([, d]) => d > 0).sort(([a], [b]) => a.localeCompare(b));
    const dju = Math.round(mois.reduce((s, [, d]) => s + d, 0) * 100) / 100;
    if (!(dju > 0)) return `aucun DJU sur la saison ${p.saison}`;
    const p1Base = p.quantite * p.prixBase;
    const du = cents((p1Base * p.coefficient * dju) / p.djuReference);
    const parMois = mois.map(([m, d]) => ({ mois: m, dju: d, montant: cents((du * d) / dju) }));
    const ecart = cents(du - parMois.reduce((s, x) => s + x.montant, 0));
    if (ecart && parMois.length) parMois[parMois.length - 1].montant = cents(parMois[parMois.length - 1].montant + ecart);
    return { saison: p.saison, p1Base, quantite: p.quantite, prixBase: p.prixBase, coefficient: p.coefficient, dju, djuReference: p.djuReference, du, mois: parMois };
}
