/**
 * Facturation P1 au compteur (chauffage et ECS), logique pure.
 *
 * Pour chaque mois couvert par l'échéance (mensuelle, trimestrielle…) :
 * - consommation de chaque compteur = index du dernier relevé du mois − index du dernier relevé facturé (à défaut,
 *   dernier relevé antérieur au mois) : « M − M-1 » ;
 * - quantité = Σ signe × consommation × conversion (chauffage en MWh : compteur en MWh, en kWh, ou QE du compteur ;
 *   ECS en m³) ; compteurs signés de la formule de NC du site, ou compteur de la prestation ;
 * - mois partiel (début ou fin de contrat, de prestation) : relevé à la date de coupure s'il existe (méthode
 *   « relevé »), sinon consommation du mois × jours couverts / jours du mois, ou × DJU couverts / DJU du mois ;
 * - montant = quantité × prix du mois (prix révisé P1 ou prix de la prestation révisé) × coefficient de gestion.
 * Chaque mois garde son détail (compteurs, index, prix, coefficients) : c'est l'annexe de la facture.
 */

export type UsageCompteur = 'chauffage' | 'ecs';
/** Mois partiel : relevé à la date de coupure s'il existe, sinon jours ou DJU ; ou toujours jours, toujours DJU. */
export type MethodeProrata = 'releve_jours' | 'releve_dju' | 'jours' | 'dju';
export const METHODES_PRORATA: Record<MethodeProrata, string> = {
    releve_jours: 'Relevé à la date, sinon jours', releve_dju: 'Relevé à la date, sinon DJU', jours: 'Jours', dju: 'DJU',
};
/** Coefficient de gestion : aucun, celui de la prestation, celui du contrat (paramétrage P1 daté). */
export type SourceCoefGestion = 'aucun' | 'prestation' | 'contrat';

export type ReleveCompteur = { id: string; date: string; value: number; type?: string };
export type CompteurFacture = {
    id: string; code: string; unit?: string; signe: 1 | -1;
    /** Coefficient de conversion index → MWh (chauffage) ; null : inconnu (jamais 1 par défaut). */
    qe: number | null;
    readings: ReleveCompteur[];
};
export type PrixDuMois = {
    prix: number;
    /** Prix de base (€/MWh, €/m³) et coefficient de révision ; null si non applicable. */
    base: number | null;
    coefficient: number | null;
    source: 'p1' | 'prestation';
    provisoire?: boolean;
    /** Termes de la révision : terme, indice, pondération, valeur du mois, valeur de base, rapport. */
    indices?: { terme: string; indice: string | null; ponderation: number | null; valeur: number | null; base: number | null; ratio: number | null; periode: string | null }[];
};
export type IndexPris = { readingId: string; date: string; index: number; type?: string };

export type CompteurMois = {
    meterId: string; code: string; unit?: string; signe: 1 | -1; qe: number | null; conversion: number;
    debut: IndexPris; fin: IndexPris; volume: number; quantite: number;
};
export type MoisFacture = {
    mois: string;
    debut: string; fin: string; jours: number; joursMois: number;
    /** Méthode effective : mois complet, relevés à la date, ou prorata (jours, DJU). */
    methode: 'complet' | 'releve' | 'jours' | 'dju';
    ratio: number;
    dju?: { couverts: number; mois: number };
    compteurs: CompteurMois[];
    /** Quantité du mois complet (avant prorata) et quantité facturée. */
    quantiteMois: number;
    quantite: number;
    prix: PrixDuMois;
    coefGestion: number | null;
    prixApplique: number;
    montant: number;
};
export type DetailCompteur = {
    siteId: string; usage: UsageCompteur; unite: 'MWh' | 'm³';
    detail: MoisFacture[];
    quantite: number; montant: number;
};

export type ContexteCompteur = {
    siteId: string;
    usage: UsageCompteur;
    debut: string; fin: string;
    methode: MethodeProrata;
    compteurs: (mois: string) => CompteurFacture[] | string;
    prix: (mois: string) => PrixDuMois | string;
    coefGestion: (mois: string) => number | null | string;
    /** DJU de la station du site entre deux dates incluses ; message si indisponibles. */
    dju?: (debut: string, fin: string) => number | string;
    /** Dernier relevé déjà facturé de chaque compteur. */
    dejaFacture: Map<string, IndexPris>;
};

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const cents = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const finDuMois = (mois: string) => new Date(Date.UTC(+mois.slice(0, 4), +mois.slice(5, 7), 0)).toISOString().slice(0, 10);
const jour = (d: string, n: number) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const nbJours = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
const fr = (d: string) => d.split('-').reverse().join('/');
const moisFr = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
const pris = (r: ReleveCompteur): IndexPris => ({ readingId: r.id, date: r.date, index: r.value, ...(r.type && { type: r.type }) });

/** Mois civils (AAAA-MM) couverts par [debut, fin]. */
export function moisCouverts(debut: string, fin: string): string[] {
    const out: string[] = [];
    let m = debut.slice(0, 7);
    while (m <= fin.slice(0, 7)) {
        out.push(m);
        const [y, mo] = m.split('-').map(Number);
        m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
    }
    return out;
}

/** Conversion d'un index en unité facturée : chauffage en MWh, ECS en m³ ; message si impossible. */
export function conversion(c: Pick<CompteurFacture, 'code' | 'unit' | 'qe'>, usage: UsageCompteur): number | string {
    const u = (c.unit ?? '').trim().toLowerCase().replace('³', '3');
    if (usage === 'ecs') {
        if (u === 'm3') return 1;
        return `compteur ${c.code} en ${c.unit || '?'} : un compteur ECS au m³ est attendu`;
    }
    if (u === 'mwh') return 1;
    if (u === 'kwh') return 0.001;
    if (c.qe !== null && c.qe > 0) return c.qe;
    return `coefficient de conversion (QE) du compteur ${c.code} (${c.unit || 'unité inconnue'}) non renseigné dans le paramétrage P1`;
}

/** Facturation au compteur d'une échéance ; message (cause) si elle n'est pas calculable. */
export function factureAuCompteur(ctx: ContexteCompteur): DetailCompteur | string {
    const unite = ctx.usage === 'ecs' ? 'm³' as const : 'MWh' as const;
    const dernier = new Map(ctx.dejaFacture);
    const detail: MoisFacture[] = [];
    for (const mois of moisCouverts(ctx.debut, ctx.fin)) {
        const debutMois = `${mois}-01`, finMois = finDuMois(mois);
        const debut = ctx.debut > debutMois ? ctx.debut : debutMois;
        const fin = ctx.fin < finMois ? ctx.fin : finMois;
        const partiel = debut !== debutMois || fin !== finMois;
        const compteurs = ctx.compteurs(mois);
        if (typeof compteurs === 'string') return compteurs;
        if (compteurs.length === 0) return `aucun compteur pour ${moisFr(mois)}`;

        // Index de départ et de fin de chaque compteur (mois complet), et relevés aux dates de coupure.
        const lignes: (CompteurMois & { exact?: { debut: IndexPris; fin: IndexPris } })[] = [];
        for (const c of compteurs) {
            const conv = conversion(c, ctx.usage);
            if (typeof conv === 'string') return conv;
            const tri = [...c.readings].sort((a, b) => a.date.localeCompare(b.date));
            const finR = tri.filter(r => r.date.slice(0, 7) === mois).pop();
            const deja = dernier.get(c.id);
            const debutR = deja ?? (() => { const r = tri.filter(x => x.date < debutMois).pop(); return r ? pris(r) : null; })();
            let exact: { debut: IndexPris; fin: IndexPris } | undefined;
            if (partiel && ctx.methode.startsWith('releve')) {
                const a = debut === debutMois ? debutR : (() => { const r = tri.find(x => x.date === jour(debut, -1) || x.date === debut); return r ? pris(r) : null; })();
                const b = fin === finMois ? (finR ? pris(finR) : null) : (() => { const r = tri.find(x => x.date === fin || x.date === jour(fin, 1)); return r ? pris(r) : null; })();
                if (a && b && a.date < b.date) exact = { debut: a, fin: b };
            }
            if (!exact) {
                if (!finR) return `aucun relevé du compteur ${c.code} en ${moisFr(mois)}`;
                if (!debutR) return `aucun relevé du compteur ${c.code} avant ${moisFr(mois)} (index de départ)`;
                if (debutR.date >= finR.date) return `relevé du compteur ${c.code} du ${fr(finR.date)} déjà facturé`;
            }
            const d = exact?.debut ?? debutR!, f = exact?.fin ?? pris(finR!);
            const volume = r6(f.index - d.index);
            if (volume < 0) return `index du compteur ${c.code} en baisse (${d.index} → ${f.index}) : changement ou remise à zéro du compteur à traiter`;
            lignes.push({ meterId: c.id, code: c.code, ...(c.unit && { unit: c.unit }), signe: c.signe, qe: c.qe, conversion: conv, debut: d, fin: f, volume, quantite: r6(c.signe * volume * conv), exact });
        }

        // Méthode effective du mois.
        const jours = nbJours(debut, fin), joursMois = nbJours(debutMois, finMois);
        let methode: MoisFacture['methode'] = 'complet';
        let ratio = 1;
        let dju: MoisFacture['dju'];
        if (partiel) {
            if (ctx.methode.startsWith('releve') && lignes.every(l => l.exact)) methode = 'releve';
            else {
                const repli = ctx.methode === 'releve_dju' || ctx.methode === 'dju' ? 'dju' : 'jours';
                if (repli === 'dju') {
                    if (!ctx.dju) return 'DJU de la station du site indisponibles pour le prorata';
                    const couverts = ctx.dju(debut, fin), total = ctx.dju(debutMois, finMois);
                    if (typeof couverts === 'string') return couverts;
                    if (typeof total === 'string') return total;
                    if (total > 0) { methode = 'dju'; ratio = couverts / total; dju = { couverts, mois: total }; }
                    else { methode = 'jours'; ratio = jours / joursMois; }   // mois sans DJU (été) : prorata des jours
                } else { methode = 'jours'; ratio = jours / joursMois; }
                // Prorata : la consommation du mois complet sert de base (relevés de fin de mois).
                for (const l of lignes) if (l.exact) {
                    const c = compteurs.find(x => x.id === l.meterId)!;
                    const tri = [...c.readings].sort((a, b) => a.date.localeCompare(b.date));
                    const finR = tri.filter(r => r.date.slice(0, 7) === mois).pop();
                    const debutR = dernier.get(c.id) ?? (() => { const r = tri.filter(x => x.date < debutMois).pop(); return r ? pris(r) : null; })();
                    if (!finR) return `aucun relevé du compteur ${c.code} en ${moisFr(mois)}`;
                    if (!debutR) return `aucun relevé du compteur ${c.code} avant ${moisFr(mois)} (index de départ)`;
                    l.debut = debutR; l.fin = pris(finR); l.volume = r6(l.fin.index - l.debut.index);
                    if (l.volume < 0) return `index du compteur ${c.code} en baisse (${l.debut.index} → ${l.fin.index}) : changement ou remise à zéro du compteur à traiter`;
                    l.quantite = r6(l.signe * l.volume * l.conversion);
                }
            }
        }
        const quantiteMois = r6(lignes.reduce((s, l) => s + l.quantite, 0));
        const quantite = r6(quantiteMois * ratio);
        if (quantite < 0) return `quantité négative en ${moisFr(mois)} (déductions supérieures aux entrées) : formule de NC à vérifier`;

        const prix = ctx.prix(mois);
        if (typeof prix === 'string') return `prix ${moisFr(mois)} : ${prix}`;
        const coef = ctx.coefGestion(mois);
        if (typeof coef === 'string') return coef;
        const prixApplique = r6(prix.prix * (coef ?? 1));
        detail.push({
            mois, debut, fin, jours, joursMois, methode, ratio: r6(ratio), ...(dju && { dju }),
            compteurs: lignes.map(({ exact: _e, ...l }) => l),
            quantiteMois, quantite, prix, coefGestion: coef, prixApplique, montant: cents(quantite * prixApplique),
        });
        for (const l of lignes) dernier.set(l.meterId, l.fin);
    }
    return {
        siteId: ctx.siteId, usage: ctx.usage, unite, detail,
        quantite: r6(detail.reduce((s, m) => s + m.quantite, 0)),
        montant: cents(detail.reduce((s, m) => s + m.montant, 0)),
    };
}

/** Texte court d'une ligne de facture (le détail complet est dans l'annexe). */
export function texteCompteur(d: DetailCompteur): string {
    const n = (x: number, dec = 3) => x.toLocaleString('fr-FR', { maximumFractionDigits: dec });
    return d.detail.map(m => {
        const compteurs = m.compteurs.map(c => `${c.signe < 0 ? '−' : ''}${c.code} : ${n(c.fin.index)} (${fr(c.fin.date)}${c.fin.type && c.fin.type !== 'REEL' ? `, ${c.fin.type.toLowerCase()}` : ''}) − ${n(c.debut.index)} (${fr(c.debut.date)})`).join(' ; ');
        const prorata = m.methode === 'jours' ? ` × ${m.jours}/${m.joursMois} j` : m.methode === 'dju' ? ` × ${n(m.dju!.couverts, 1)}/${n(m.dju!.mois, 1)} DJU` : '';
        return `${moisFr(m.mois)} : ${compteurs} → ${n(m.quantiteMois)} ${d.unite}${prorata} × ${n(m.prixApplique, 4)} €/${d.unite} = ${m.montant.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
    }).join(' | ');
}
