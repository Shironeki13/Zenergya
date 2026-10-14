/**
 * Calculs monétaires : tous les montants facturés sont arrondis au centime,
 * ligne par ligne, puis les totaux sont calculés à partir des lignes arrondies.
 */

/** Arrondi au centime, « demi vers l'extérieur » (1,005 → 1,01 ; -1,005 → -1,01), sans erreur de virgule flottante. */
export function roundCents(value: number): number {
    if (!Number.isFinite(value)) throw new Error(`Montant invalide : ${value}`);
    const sign = value < 0 ? -1 : 1;
    // toPrecision(15) élimine le bruit de la virgule flottante avant l'arrondi (1.005 * 100 = 100.49999… → 100.5).
    const rounded = Math.round(Number((Math.abs(value) * 100).toPrecision(15))) / 100;
    return rounded === 0 ? 0 : sign * rounded;
}

/** Somme de montants arrondie au centime. */
export function sumCents(values: number[]): number {
    // Somme en centimes entiers : pas d'accumulation d'erreurs.
    return values.reduce((acc, v) => acc + Math.round(roundCents(v) * 100), 0) / 100;
}

/** Totaux d'une facture ou d'un avoir à partir de lignes déjà arrondies. */
export function computeTotals(lineTotals: number[], taxRate: number): { subtotal: number; tax: number; total: number } {
    const subtotal = sumCents(lineTotals);
    const tax = roundCents(subtotal * taxRate);
    return { subtotal, tax, total: sumCents([subtotal, tax]) };
}
