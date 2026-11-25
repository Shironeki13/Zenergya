/**
 * Marge P1 d'un site : ce qui est facturé au client en P1 face aux factures du fournisseur d'énergie.
 *
 * - Ventes et achats sont répartis par mois au prorata des jours de leur période (une facture trimestrielle compte
 *   pour chacun de ses trois mois ; une facture du fournisseur sans période de consommation compte au mois de sa date).
 * - La marge n'a de sens que sur un mois où les deux sont connus : un mois facturé au client sans facture du
 *   fournisseur saisie est « incomplet » et n'entre pas dans le taux (sinon la marge paraîtrait de 100 %).
 * Module sans dépendance serveur.
 */

export type Vente = { debut: string; fin: string; montantHT: number };
export type Achat = { date: string; debut?: string | null; fin?: string | null; montantHT: number; quantite?: number | null };

export type MoisMarge = {
    mois: string; ventes: number; achats: number; quantite: number;
    /** Ventes et achats connus : la marge du mois est significative. */
    complet: boolean;
    marge: number | null;
};
export type MargeP1 = {
    mois: MoisMarge[];
    /** Sur les mois complets seulement. */
    ventes: number; achats: number; marge: number; taux: number | null; moisComplets: number;
    /** Hors taux : facturé au client sans achat saisi, et achats sans vente. */
    ventesSansAchat: number; achatsSansVente: number;
};

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const jourUTC = (j: string) => Date.parse(`${j}T00:00:00Z`);
const finDeMois = (m: string) => { const [a, mo] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(a, mo, 0)).getUTCDate()).padStart(2, '0')}`; };
const moisSuivant = (m: string) => { const [a, mo] = m.split('-').map(Number); return mo === 12 ? `${a + 1}-01` : `${a}-${String(mo + 1).padStart(2, '0')}`; };

/** Montant réparti par mois au prorata des jours (bornes incluses) ; le dernier mois prend l'arrondi. */
export function repartirParMois(debut: string, fin: string, montant: number): Map<string, number> {
    const out = new Map<string, number>();
    if (!debut || !fin || debut > fin) return out;
    const total = (jourUTC(fin) - jourUTC(debut)) / 86_400_000 + 1;
    let reste = montant;
    for (let m = debut.slice(0, 7); m <= fin.slice(0, 7); m = moisSuivant(m)) {
        const [a, b] = [m === debut.slice(0, 7) ? debut : `${m}-01`, m === fin.slice(0, 7) ? fin : finDeMois(m)];
        const part = m === fin.slice(0, 7) ? cents(reste) : cents(montant * ((jourUTC(b) - jourUTC(a)) / 86_400_000 + 1) / total);
        out.set(m, part); reste -= part;
    }
    return out;
}

/** Marge P1 mois par mois sur la fenêtre [de, a] (AAAA-MM, bornes incluses). */
export function margeP1(ventes: Vente[], achats: Achat[], de: string, a: string): MargeP1 {
    const parMois = new Map<string, { ventes: number; achats: number; quantite: number; aVente: boolean; aAchat: boolean }>();
    const mois = (m: string) => { if (!parMois.has(m)) parMois.set(m, { ventes: 0, achats: 0, quantite: 0, aVente: false, aAchat: false }); return parMois.get(m)!; };
    for (const v of ventes) for (const [m, x] of repartirParMois(v.debut, v.fin, v.montantHT)) if (m >= de && m <= a) { const c = mois(m); c.ventes += x; c.aVente = true; }
    for (const h of achats) {
        const [du, au] = h.debut && h.fin && h.debut <= h.fin ? [h.debut, h.fin] : [h.date, h.date];
        const parts = repartirParMois(du, au, h.montantHT);
        const q = h.quantite && h.quantite > 0 ? repartirParMois(du, au, h.quantite) : new Map<string, number>();
        for (const [m, x] of parts) if (m >= de && m <= a) { const c = mois(m); c.achats += x; c.quantite += q.get(m) ?? 0; c.aAchat = true; }
    }
    const lignes: MoisMarge[] = [...parMois].sort(([x], [y]) => x.localeCompare(y)).map(([m, c]) => {
        const complet = c.aVente && c.aAchat;
        return { mois: m, ventes: cents(c.ventes), achats: cents(c.achats), quantite: Math.round(c.quantite * 1000) / 1000, complet, marge: complet ? cents(c.ventes - c.achats) : null };
    });
    const complets = lignes.filter(l => l.complet);
    const [v, h] = [cents(complets.reduce((s, l) => s + l.ventes, 0)), cents(complets.reduce((s, l) => s + l.achats, 0))];
    return {
        mois: lignes, ventes: v, achats: h, marge: cents(v - h), taux: v > 0 ? Math.round(((v - h) / v) * 1000) / 10 : null, moisComplets: complets.length,
        ventesSansAchat: cents(lignes.filter(l => !l.complet).reduce((s, l) => s + l.ventes, 0)), achatsSansVente: cents(lignes.filter(l => !l.complet).reduce((s, l) => s + l.achats, 0)),
    };
}

/** Fenêtre des 12 derniers mois terminés à `aujourdhui` (AAAA-MM-JJ) : [mois − 11, mois]. */
export function douzeMois(aujourdhui: string): { de: string; a: string } {
    const [an, mo] = aujourdhui.slice(0, 7).split('-').map(Number);
    const t = an * 12 + (mo - 1) - 11;
    return { de: `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`, a: aujourdhui.slice(0, 7) };
}
