/**
 * Ventilation de TVA d'une prestation : un prix global réparti en quote-parts (en %) soumises à des taux différents,
 * typiquement un immeuble mixte dont la quote-part « habitation » est à 10 % et le reste à 20 %. À la facturation,
 * chaque échéance (après prorata et révision) est coupée en une ligne par quote-part, la somme des lignes retombant
 * exactement sur l'échéance. Module sans dépendance serveur.
 */

export type QuotePartTva = {
    vatRateId: string;
    /** Quote-part en %, deux décimales au plus. */
    part: number;
    /** Libellé imprimé sur la facture (« habitation », « commerces »). */
    libelle?: string;
};

const TOLERANCE = 0.005;
const pct = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });

/** Anomalies d'une ventilation ; aucune : utilisable. `taux` : ids des taux de TVA du paramétrage. */
export function controlerVentilation(parts: QuotePartTva[], taux: { id: string }[]): string[] {
    if (parts.length === 0) return [];
    const erreurs: string[] = [];
    if (parts.length < 2) erreurs.push('une ventilation compte au moins deux quote-parts (sinon, un seul taux suffit)');
    if (parts.some(p => !(p.part > 0) || Math.round(p.part * 100) !== Math.round(p.part * 100 * 1e6) / 1e6)) erreurs.push('chaque quote-part est un pourcentage positif, à deux décimales au plus');
    const total = parts.reduce((s, p) => s + (Number(p.part) || 0), 0);
    if (Math.abs(total - 100) > TOLERANCE) erreurs.push(`les quote-parts totalisent ${pct(total)} % au lieu de 100 %`);
    const connus = new Set(taux.map(t => t.id));
    if (parts.some(p => !connus.has(p.vatRateId))) erreurs.push('un taux de TVA de la ventilation est inconnu');
    if (new Set(parts.map(p => p.vatRateId)).size !== parts.length) erreurs.push('un même taux de TVA figure deux fois');
    return erreurs;
}

/**
 * Répartit un montant (en euros) selon les quote-parts, au centime : chaque part est arrondie à l'inférieur, puis les
 * centimes restants vont aux plus grands restes. La somme est exactement le montant, y compris négatif.
 */
export function repartir(montant: number, parts: Pick<QuotePartTva, 'part'>[]): number[] {
    const total = parts.reduce((s, p) => s + p.part, 0);
    if (parts.length === 0 || !(total > 0)) return [];
    const signe = montant < 0 ? -1 : 1;
    const cents = Math.round(Math.abs(montant) * 100);
    const exacts = parts.map(p => (cents * p.part) / total);
    const bas = exacts.map(Math.floor);
    let reste = cents - bas.reduce((s, x) => s + x, 0);
    const ordre = exacts.map((x, i) => ({ i, r: x - bas[i] })).sort((a, b) => b.r - a.r || a.i - b.i);
    for (const { i } of ordre) { if (reste <= 0) break; bas[i]++; reste--; }
    return bas.map(c => (signe * c) / 100);
}

/** « TVA10=66,67 (habitation); TVA20=33,33 » : format de l'import. `codes` : code du taux → id. */
export function lireVentilation(texte: string, codes: Map<string, string>): { parts: QuotePartTva[]; erreurs: string[] } {
    const parts: QuotePartTva[] = [];
    const erreurs: string[] = [];
    for (const brut of texte.split(';').map(x => x.trim()).filter(Boolean)) {
        const m = /^([^=]+?)\s*=\s*([\d\s.,]+?)\s*%?\s*(?:\((.*)\))?$/.exec(brut);
        if (!m) { erreurs.push(`« ${brut} » : format attendu CODE=pourcentage (libellé)`); continue; }
        const id = codes.get(m[1].trim().toLowerCase());
        const part = Number(m[2].replace(/\s/g, '').replace(',', '.'));
        if (!id) { erreurs.push(`TVA « ${m[1].trim()} » inconnue`); continue; }
        parts.push({ vatRateId: id, part, ...(m[3]?.trim() && { libelle: m[3].trim() }) });
    }
    return { parts, erreurs };
}

/** Texte d'une ventilation, dans le format de l'import. `codes` : id du taux → code. */
export function ecrireVentilation(parts: QuotePartTva[], codes: Map<string, string>): string {
    return parts.map(p => `${codes.get(p.vatRateId) ?? p.vatRateId}=${pct(p.part)}${p.libelle ? ` (${p.libelle})` : ''}`).join('; ');
}
