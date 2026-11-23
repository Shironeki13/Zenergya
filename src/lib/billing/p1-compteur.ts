/**
 * Facturation P1 au compteur (chauffage et ECS), logique pure.
 *
 * Pour chaque mois couvert par l'échéance (mensuelle, trimestrielle…) :
 * - consommation de chaque compteur = index du dernier relevé du mois − index du dernier relevé facturé (à défaut,
 *   dernier relevé antérieur au mois) : « M − M-1 » ;
 * - quantité = Σ signe × consommation × conversion (chauffage en MWh : compteur en MWh, en kWh, ou QE du compteur ;
 *   ECS en m³) ; compteurs signés de la formule de NC du site, ou compteur de la prestation ;
 * - changement de compteur porté par un relevé (index de dépose et de pose) : la consommation ajoute (dépose − pose),
 *   soit (dépose − index précédent) + (index du nouveau compteur − pose) ; un index en baisse sans changement bloque ;
 * - index en baisse sans changement de compteur : passage par zéro si la **capacité** du compteur est déclarée
 *   (paramétrage P1) : index + capacité − index précédent ; sinon la facturation bloque ;
 * - plusieurs relevés le même jour à des index différents : un seul compte, le plus proche du relevé précédent
 *   (lib/releves) ; le détail du mois le signale ;
 * - mois partiel (début ou fin de contrat, de prestation) : relevé à la date de coupure s'il existe (méthode
 *   « relevé »), sinon consommation du mois × jours couverts / jours du mois, ou × DJU couverts / DJU du mois ;
 * - montant = quantité × prix du mois (prix révisé P1 ou prix de la prestation révisé) × coefficient de gestion.
 * Chaque mois garde son détail (compteurs, index, prix, coefficients) : c'est l'annexe de la facture.
 *
 * **Répartition « mois calendaire »** (option de la prestation) : la consommation entre deux relevés consécutifs est
 * étalée sur ses jours (du jour du premier relevé à la veille du second), et chaque mois prend la part de ses jours.
 * ECS (et compteurs d'ECS déduits) : uniformément, on ne consomme pas plus d'eau chaude en janvier. Chauffage : la
 * part de l'intervalle située **dans la saison de chauffe** (allumage et arrêt compris) se répartit aux **DJU** de
 * chaque jour, celle hors saison aux jours ; sans DJU ou sans saison saisie, tout l'intervalle se répartit aux jours. Un mois sans relevé se facture donc, mais seulement quand un relevé **postérieur à sa fin** est connu ;
 * les mois partiels se traitent jour par jour, sans méthode de prorata. Le premier mois facturé ainsi repart du dernier
 * relevé déjà facturé au relevé à relevé (rien n'est facturé deux fois, rien n'est perdu) ; le retour au relevé à
 * relevé après un mois calendaire est refusé.
 */

import { changementsEntre, resoudreDoublons, texteDoublon, type ChangementCompteur, type Doublon } from '@/lib/releves';

export type UsageCompteur = 'chauffage' | 'ecs';
/** Mois partiel : relevé à la date de coupure s'il existe, sinon jours ou DJU ; ou toujours jours, toujours DJU. */
export type MethodeProrata = 'releve_jours' | 'releve_dju' | 'jours' | 'dju';
export const METHODES_PRORATA: Record<MethodeProrata, string> = {
    releve_jours: 'Relevé à la date, sinon jours', releve_dju: 'Relevé à la date, sinon DJU', jours: 'Jours', dju: 'DJU',
};
/** Coefficient de gestion : aucun, celui de la prestation, celui du contrat (paramétrage P1 daté). */
export type SourceCoefGestion = 'aucun' | 'prestation' | 'contrat';
/** Consommation d'un mois : d'un relevé au suivant, ou répartie par mois calendaire au prorata des jours. */
export type RepartitionCompteur = 'releve' | 'calendaire';
export const REPARTITIONS_COMPTEUR: Record<RepartitionCompteur, string> = { releve: 'Relevé à relevé', calendaire: 'Mois calendaire (ECS aux jours, chauffage aux DJU)' };

export type ReleveCompteur = { id: string; date: string; value: number; type?: string; changement?: ChangementCompteur };
export type CompteurFacture = {
    id: string; code: string; unit?: string; signe: 1 | -1;
    /** Coefficient de conversion index → MWh (chauffage) ; null : inconnu (jamais 1 par défaut). */
    qe: number | null;
    /** Compteur d'ECS (déduit d'une formule de NC) : toujours réparti aux jours. */
    ecs?: boolean;
    /** Capacité déclarée (index maximal avant retour à zéro) ; absente : un index en baisse bloque. */
    capacite?: number | null;
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
    /** Changements de compteur compris dans la consommation (après l'index de début, jusqu'à celui de fin). */
    changements?: { date: string; depose: number; pose: number }[];
    /** Relevés en double (même jour, index différents) sur l'index de début ou de fin : celui qui a été retenu. */
    doublons?: Doublon[];
    /** Passage par zéro traité avec la capacité déclarée du compteur. */
    passageZero?: { capacite: number };
    /** Répartition calendaire : intervalles entre relevés dont le mois prend une part (jours pris sur jours de l'intervalle). */
    segments?: SegmentMois[];
};
export type SegmentMois = {
    debut: IndexPris; fin: IndexPris; jours: number; joursPris: number; volume: number; volumePris: number;
    /** Base de la répartition (absente : jours) ; aux DJU : part du mois, DJU pris sur DJU de l'intervalle dans la saison de chauffe. */
    base?: 'jours' | 'dju'; part?: number; dju?: { pris: number; total: number };
};
export type MoisFacture = {
    mois: string;
    debut: string; fin: string; jours: number; joursMois: number;
    /** Méthode effective : mois complet, relevés à la date, ou prorata (jours, DJU). */
    methode: 'complet' | 'releve' | 'jours' | 'dju' | 'calendaire';
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
    /** Dernier relevé déjà facturé de chaque compteur (au relevé à relevé). */
    dejaFacture: Map<string, IndexPris>;
    /** Répartition de la consommation ; absente : relevé à relevé. */
    repartition?: RepartitionCompteur;
    /** Dernier jour déjà facturé au mois calendaire, par compteur. */
    dejaCalendaire?: Map<string, string>;
    /** Mois calendaire, chauffage : DJU d'un jour (null : inconnu) et appartenance du jour à la saison de chauffe. */
    djuJour?: (jour: string) => number | null;
    dansSaison?: (jour: string) => boolean;
};

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const cents = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const finDuMois = (mois: string) => new Date(Date.UTC(+mois.slice(0, 4), +mois.slice(5, 7), 0)).toISOString().slice(0, 10);
const jour = (d: string, n: number) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const nbJours = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
const fr = (d: string) => d.split('-').reverse().join('/');
const moisFr = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
const pris = (r: ReleveCompteur): IndexPris => ({ readingId: r.id, date: r.date, index: r.value, ...(r.type && { type: r.type }) });

/** Changements de compteur entre deux index pris, et ce qu'ils ajoutent à « index de fin − index de début ». */
function changements(tri: ReleveCompteur[], d: IndexPris, f: IndexPris) {
    const liste = changementsEntre(tri, d.date, f.date).map(r => ({ date: r.date, depose: r.changement.depose, pose: r.changement.pose }));
    return { liste, correction: liste.reduce((s, x) => s + x.depose - x.pose, 0) };
}
/**
 * Consommation d'un compteur entre deux index pris : index de fin − index de début, plus les changements de compteur ;
 * index en baisse sans changement : passage par zéro si la capacité est déclarée, sinon message.
 */
function volumeEntre(c: Pick<CompteurFacture, 'code' | 'capacite'>, tri: ReleveCompteur[], d: IndexPris, f: IndexPris) {
    const chg = changements(tri, d, f);
    const volume = r6(f.index - d.index + chg.correction);
    if (volume >= 0) return { volume, chg, passageZero: undefined as { capacite: number } | undefined };
    if (chg.liste.length === 0 && c.capacite && c.capacite > 0) {
        if (d.index > c.capacite) return `index du compteur ${c.code} (${d.index} le ${fr(d.date)}) supérieur à sa capacité déclarée (${c.capacite}) : capacité à corriger dans le paramétrage P1`;
        return { volume: r6(f.index + c.capacite - d.index), chg, passageZero: { capacite: c.capacite } };
    }
    return baisse(c.code, d, f, chg.liste.length > 0);
}
/** Doublons qui touchent l'index de début ou de fin pris. */
const doublonsDe = (doublons: Doublon[], d: IndexPris, f: IndexPris) => doublons.filter(x => x.date === d.date.slice(0, 10) || x.date === f.date.slice(0, 10));
const baisse = (code: string, d: IndexPris, f: IndexPris, avecChangement: boolean) => avecChangement
    ? `consommation négative du compteur ${code} entre le ${fr(d.date)} (${d.index}) et le ${fr(f.date)} (${f.index}) malgré le changement de compteur : index de dépose et de pose à vérifier`
    : `index du compteur ${code} en baisse (${d.index} → ${f.index}) : changement de compteur à déclarer sur le relevé (index de dépose et de pose), capacité du compteur à renseigner s'il est repassé par zéro (paramétrage P1), ou index à corriger`;

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
    const calendaire = new Map(ctx.dejaCalendaire ?? []);
    const detail: MoisFacture[] = [];
    for (const mois of moisCouverts(ctx.debut, ctx.fin)) {
        const debutMois = `${mois}-01`, finMois = finDuMois(mois);
        const debut = ctx.debut > debutMois ? ctx.debut : debutMois;
        const fin = ctx.fin < finMois ? ctx.fin : finMois;
        const partiel = debut !== debutMois || fin !== finMois;
        const compteurs = ctx.compteurs(mois);
        if (typeof compteurs === 'string') return compteurs;
        if (compteurs.length === 0) return `aucun compteur pour ${moisFr(mois)}`;
        if (ctx.repartition === 'calendaire') {
            const m = moisCalendaire(ctx, mois, debut, fin, compteurs, dernier, calendaire);
            if (typeof m === 'string') return m;
            detail.push(m);
            continue;
        }
        const dejaCal = compteurs.map(c => [c, calendaire.get(c.id)] as const).find(([, j]) => j);
        if (dejaCal) return `compteur ${dejaCal[0].code} déjà facturé au mois calendaire jusqu'au ${fr(dejaCal[1]!)} : le retour au relevé à relevé n'est pas possible (garder « mois calendaire » sur la prestation)`;

        // Index de départ et de fin de chaque compteur (mois complet), et relevés aux dates de coupure.
        const lignes: (CompteurMois & { exact?: { debut: IndexPris; fin: IndexPris } })[] = [];
        for (const c of compteurs) {
            const conv = conversion(c, ctx.usage);
            if (typeof conv === 'string') return conv;
            const { retenus: tri, doublons } = resoudreDoublons(c.readings);
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
            const v = volumeEntre(c, tri, d, f);
            if (typeof v === 'string') return v;
            const { volume, chg } = v;
            lignes.push({ meterId: c.id, code: c.code, ...(c.unit && { unit: c.unit }), signe: c.signe, qe: c.qe, conversion: conv, debut: d, fin: f, volume, quantite: r6(c.signe * volume * conv), ...(chg.liste.length && { changements: chg.liste }), ...(doublonsDe(doublons, d, f).length && { doublons: doublonsDe(doublons, d, f) }), ...(v.passageZero && { passageZero: v.passageZero }), exact });
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
                    const { retenus: tri, doublons } = resoudreDoublons(c.readings);
                    const finR = tri.filter(r => r.date.slice(0, 7) === mois).pop();
                    const debutR = dernier.get(c.id) ?? (() => { const r = tri.filter(x => x.date < debutMois).pop(); return r ? pris(r) : null; })();
                    if (!finR) return `aucun relevé du compteur ${c.code} en ${moisFr(mois)}`;
                    if (!debutR) return `aucun relevé du compteur ${c.code} avant ${moisFr(mois)} (index de départ)`;
                    const v = volumeEntre(c, tri, debutR, pris(finR));
                    if (typeof v === 'string') return v;
                    const { chg } = v;
                    l.debut = debutR; l.fin = pris(finR); l.volume = v.volume;
                    if (v.passageZero) l.passageZero = v.passageZero; else delete l.passageZero;
                    if (chg.liste.length) l.changements = chg.liste; else delete l.changements;
                    if (doublonsDe(doublons, l.debut, l.fin).length) l.doublons = doublonsDe(doublons, l.debut, l.fin); else delete l.doublons;
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

/**
 * Part d'un intervalle entre deux relevés [da, db[ qui revient aux jours [d0, d1]. Aux jours ; en chauffage (hors
 * compteur d'ECS), la part de l'intervalle dans la saison de chauffe (au prorata des jours) se répartit aux DJU, celle
 * hors saison aux jours. DJU d'un jour inconnu, ou aucun DJU dans la saison : tout l'intervalle aux jours.
 */
function partDuMois(ctx: ContexteCompteur, c: CompteurFacture, da: string, db: string, d0: string, d1: string): { part: number; dju?: { pris: number; total: number } } {
    const n = nbJours(da, db) - 1;
    const auxJours = { part: nbJours(d0, d1) / n };
    if (ctx.usage !== 'chauffage' || c.ecs || !ctx.djuJour || !ctx.dansSaison) return auxJours;
    let dans = 0, total = 0, pris_ = 0, horsPris = 0;
    for (let j = da; j < db; j = jour(j, 1)) {
        const saison = ctx.dansSaison(j), duMois = j >= d0 && j <= d1;
        if (!saison) { if (duMois) horsPris++; continue; }
        const d = ctx.djuJour(j);
        if (d === null) return auxJours;
        dans++; total += d;
        if (duMois) pris_ += d;
    }
    if (!(total > 0)) return auxJours;
    return { part: (dans / n) * (pris_ / total) + horsPris / n, dju: { pris: Math.round(pris_ * 100) / 100, total: Math.round(total * 100) / 100 } };
}

/**
 * Un mois en répartition calendaire : chaque intervalle entre deux relevés consécutifs donne au mois la part de ses
 * jours (du jour du premier relevé à la veille du second). Tous les jours à facturer doivent être couverts.
 */
function moisCalendaire(ctx: ContexteCompteur, mois: string, debut: string, fin: string, compteurs: CompteurFacture[], dernier: Map<string, IndexPris>, calendaire: Map<string, string>): MoisFacture | string {
    const lignes: CompteurMois[] = [];
    for (const c of compteurs) {
        const conv = conversion(c, ctx.usage);
        if (typeof conv === 'string') return conv;
        const { retenus: tri, doublons } = resoudreDoublons(c.readings);
        // Premier jour à prendre : lendemain du dernier jour facturé au mois calendaire ; à défaut, jour du dernier
        // relevé facturé au relevé à relevé (même antérieur au mois : sa suite n'a pas encore été facturée).
        const cal = calendaire.get(c.id), releve = dernier.get(c.id);
        const premier = cal ? (jour(cal, 1) > debut ? jour(cal, 1) : debut) : releve ? releve.date.slice(0, 10) : debut;
        if (premier > fin) return `compteur ${c.code} déjà facturé jusqu'au ${fr(cal ?? releve!.date.slice(0, 10))}`;
        const aPrendre = nbJours(premier, fin);
        const segments: SegmentMois[] = [];
        const chg: NonNullable<CompteurMois['changements']> = [];
        let passageZero: CompteurMois['passageZero'];
        let pris_ = 0, volume = 0;
        for (let i = 1; i < tri.length; i++) {
            const a = tri[i - 1], b = tri[i];
            const da = a.date.slice(0, 10), db = b.date.slice(0, 10);
            const d0 = da > premier ? da : premier, d1 = jour(db, -1) < fin ? jour(db, -1) : fin;
            if (d0 > d1) continue;
            const v = volumeEntre(c, tri, pris(a), pris(b));
            if (typeof v === 'string') return v;
            const jours = nbJours(da, db) - 1, joursPris = nbJours(d0, d1);
            const p = partDuMois(ctx, c, da, db, d0, d1);
            const volumePris = v.volume * p.part;
            segments.push({ debut: pris(a), fin: pris(b), jours, joursPris, volume: v.volume, volumePris: r6(volumePris), ...(p.dju && { base: 'dju' as const, part: r6(p.part), dju: p.dju }) });
            chg.push(...v.chg.liste);
            if (v.passageZero) passageZero = v.passageZero;
            pris_ += joursPris;
            volume += volumePris;
        }
        if (pris_ < aPrendre) {
            const premierReleve = tri[0]?.date.slice(0, 10);
            if (!premierReleve || premierReleve > premier) return `aucun relevé du compteur ${c.code} le ${fr(premier)} ou avant (index de départ)`;
            return `relevé du compteur ${c.code} postérieur au ${fr(fin)} attendu : au mois calendaire, ${moisFr(mois)} se facture quand l'index suivant est connu (dernier relevé le ${fr(tri[tri.length - 1].date.slice(0, 10))})`;
        }
        const d = segments[0].debut, f = segments[segments.length - 1].fin;
        const utilises = new Set(segments.flatMap(x => [x.debut.date.slice(0, 10), x.fin.date.slice(0, 10)]));
        const dbl = doublons.filter(x => utilises.has(x.date));
        lignes.push({
            meterId: c.id, code: c.code, ...(c.unit && { unit: c.unit }), signe: c.signe, qe: c.qe, conversion: conv, debut: d, fin: f,
            volume: r6(volume), quantite: r6(c.signe * volume * conv), segments,
            ...(chg.length && { changements: chg }), ...(dbl.length && { doublons: dbl }), ...(passageZero && { passageZero }),
        });
    }
    const quantite = r6(lignes.reduce((s, l) => s + l.quantite, 0));
    if (quantite < 0) return `quantité négative en ${moisFr(mois)} (déductions supérieures aux entrées) : formule de NC à vérifier`;
    const prix = ctx.prix(mois);
    if (typeof prix === 'string') return `prix ${moisFr(mois)} : ${prix}`;
    const coef = ctx.coefGestion(mois);
    if (typeof coef === 'string') return coef;
    const prixApplique = r6(prix.prix * (coef ?? 1));
    for (const l of lignes) calendaire.set(l.meterId, fin);
    return {
        mois, debut, fin, jours: nbJours(debut, fin), joursMois: nbJours(`${mois}-01`, finDuMois(mois)), methode: 'calendaire', ratio: 1,
        compteurs: lignes, quantiteMois: quantite, quantite, prix, coefGestion: coef, prixApplique, montant: cents(quantite * prixApplique),
    };
}

/** Texte court d'une ligne de facture (le détail complet est dans l'annexe). */
export function texteCompteur(d: DetailCompteur): string {
    const n = (x: number, dec = 3) => x.toLocaleString('fr-FR', { maximumFractionDigits: dec });
    return d.detail.map(m => {
        const compteurs = m.compteurs.map(c => c.segments
            ? `${c.signe < 0 ? '−' : ''}${c.code} : ${c.segments.map(x => `${n(x.volume)} du ${fr(x.debut.date)} au ${fr(x.fin.date)} × ${x.base === 'dju' ? `${n((x.part ?? 0) * 100, 2)} % (${n(x.dju!.pris, 1)}/${n(x.dju!.total, 1)} DJU)` : `${x.joursPris}/${x.jours} j`}`).join(' + ')}${(c.changements ?? []).map(x => ` ; compteur changé le ${fr(x.date)} (dépose ${n(x.depose)}, pose ${n(x.pose)})`).join('')}${(c.doublons ?? []).map(x => ` ; ${texteDoublon(x)}`).join('')}${c.passageZero ? ` ; passage par zéro (capacité ${n(c.passageZero.capacite)})` : ''}`
            : `${c.signe < 0 ? '−' : ''}${c.code} : ${n(c.fin.index)} (${fr(c.fin.date)}${c.fin.type && c.fin.type !== 'REEL' ? `, ${c.fin.type.toLowerCase()}` : ''}) − ${n(c.debut.index)} (${fr(c.debut.date)})${(c.changements ?? []).map(x => ` ; compteur changé le ${fr(x.date)} (dépose ${n(x.depose)}, pose ${n(x.pose)})`).join('')}${(c.doublons ?? []).map(x => ` ; ${texteDoublon(x)}`).join('')}${c.passageZero ? ` ; passage par zéro (capacité ${n(c.passageZero.capacite)})` : ''}`).join(' ; ');
        const prorata = m.methode === 'jours' ? ` × ${m.jours}/${m.joursMois} j` : m.methode === 'dju' ? ` × ${n(m.dju!.couverts, 1)}/${n(m.dju!.mois, 1)} DJU` : '';
        return `${moisFr(m.mois)} : ${compteurs} → ${n(m.quantiteMois)} ${d.unite}${prorata} × ${n(m.prixApplique, 4)} €/${d.unite} = ${m.montant.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
    }).join(' | ');
}
