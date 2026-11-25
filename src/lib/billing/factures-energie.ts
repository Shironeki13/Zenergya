/**
 * Factures des fournisseurs d'énergie à refacturer à l'euro l'euro (prestation P1 « €€ ») : contrôle de la saisie.
 * Module sans dépendance serveur.
 */
export type SaisieFactureEnergie = {
    fournisseur: string; numero: string; date: string; debut?: string | null; fin?: string | null; montantHT: number; serviceId?: string | null; commentaire?: string;
    /** Point de livraison (contrats d'énergie) que la facture concerne, et quantité facturée en MWh. */
    pointId?: string | null; quantite?: number | null;
};

const JOUR = /^\d{4}-\d{2}-\d{2}$/;

/** Saisie nettoyée, ou la liste de ce qui ne va pas. */
export function controlerFactureEnergie(v: Partial<Record<keyof SaisieFactureEnergie, unknown>>): { ok: true; valeur: SaisieFactureEnergie } | { ok: false; erreurs: string[] } {
    const erreurs: string[] = [];
    const texte = (x: unknown) => String(x ?? '').trim();
    const fournisseur = texte(v.fournisseur), numero = texte(v.numero), date = texte(v.date), debut = texte(v.debut), fin = texte(v.fin);
    const montantHT = Math.round(Number(v.montantHT) * 100) / 100;
    if (!fournisseur) erreurs.push('Fournisseur obligatoire.');
    if (!numero) erreurs.push('Numéro de la facture du fournisseur obligatoire.');
    if (!JOUR.test(date)) erreurs.push('Date de la facture obligatoire.');
    if (!Number.isFinite(montantHT) || montantHT === 0) erreurs.push('Montant HT obligatoire (négatif pour un avoir du fournisseur).');
    const quantite = v.quantite === null || v.quantite === undefined || v.quantite === '' ? null : Number(v.quantite);
    if (quantite !== null && !(Number.isFinite(quantite) && quantite > 0)) erreurs.push('Quantité : un nombre de MWh positif, ou rien.');
    if ((debut || fin) && !(JOUR.test(debut) && JOUR.test(fin))) erreurs.push('Période de consommation : début et fin, ou aucune des deux.');
    else if (debut && fin && debut > fin) erreurs.push('Période de consommation : la fin précède le début.');
    if (erreurs.length) return { ok: false, erreurs };
    return { ok: true, valeur: { fournisseur, numero, date, debut: debut || null, fin: fin || null, montantHT, serviceId: texte(v.serviceId) || null, pointId: texte(v.pointId) || null, quantite, ...(texte(v.commentaire) && { commentaire: texte(v.commentaire) }) } };
}
