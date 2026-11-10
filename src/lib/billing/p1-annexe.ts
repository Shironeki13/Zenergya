import type { InvoiceLineItem } from '@/lib/types';

/**
 * Annexe P1 d'une facture ou d'un avoir (logique pure) : pour chaque façon de facturer le P1 présente dans le document
 * (au compteur chauffage ou ECS, MTI au DJU, acomptes, décompte ou régularisation), la formule en clair, le tableau de
 * révision (indices à la base et du mois, coefficient) et une ligne par site et par mois qui justifie le montant.
 * Tout vient du détail figé dans les lignes du document : l'annexe d'une facture émise ne change plus.
 *
 * TVA : celle du document est calculée sur le total HT par taux. L'annexe l'affiche par ligne et ajuste la dernière
 * ligne de chaque taux pour que la somme retombe sur arrondi(total HT du taux × taux), sans correction manuelle.
 */

export type FormatColonne = 'texte' | 'nombre' | 'eur' | 'date' | 'pct' | 'coef' | 'prix';
export type ColonneAnnexe = { cle: string; libelle: string; format: FormatColonne; largeur: number; decimales?: number };
export type ValeurAnnexe = string | number | null;
export type LigneAnnexe = { valeurs: Record<string, ValeurAnnexe>; /** Ligne de sous-détail (compteur d'une formule de NC) : sans montant. */ detail?: boolean };
export type RevisionAnnexe = {
    /** Mois (AAAA-MM) et sites concernés (vide : tous). */
    mois: string; sites: string[];
    termes: { terme: string; indice: string | null; base: number | null; valeur: number | null }[];
    coefficient: number | null;
};
export type TypeAnnexe = 'compteur-chauffage' | 'compteur-ecs' | 'dju' | 'acompte' | 'decompte' | 'regularisation';
export type AnnexeP1 = {
    type: TypeAnnexe;
    titre: string;
    formule: string;
    /** Références du calcul (DJU contractuels, unité…). */
    references: [string, string][];
    revisions: RevisionAnnexe[];
    colonnes: ColonneAnnexe[];
    lignes: LigneAnnexe[];
    totaux: { ht: number; tva: number; ttc: number };
    notes: string[];
};

const cents = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const somme = (l: number[]) => cents(l.reduce((a, b) => a + b, 0));
const moisFr = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

/** Nom du site d'une ligne : celui fourni, sinon lu dans la désignation (« … — Site : X — … »). */
export function nomSite(line: Pick<InvoiceLineItem, 'siteId' | 'description'>, sites?: Record<string, string>): string {
    if (line.siteId && sites?.[line.siteId]) return sites[line.siteId];
    const m = /Site : (.+?)(?: — | : |$)/.exec(line.description ?? '');
    return m ? m[1].trim() : line.siteId ?? '';
}

const C = (cle: string, libelle: string, format: FormatColonne, largeur: number, decimales?: number): ColonneAnnexe => ({ cle, libelle, format, largeur, ...(decimales !== undefined && { decimales }) });
const FIN: ColonneAnnexe[] = [C('ht', 'Montant HT', 'eur', 9), C('tauxTva', 'TVA', 'pct', 5), C('tva', 'Mt TVA', 'eur', 8), C('ttc', 'Mt TTC', 'eur', 9)];

/** TVA par ligne, dernière ligne de chaque taux ajustée ; totaux de l'annexe. */
function fermer(lignes: LigneAnnexe[]): AnnexeP1['totaux'] {
    const parTaux = new Map<number, LigneAnnexe[]>();
    for (const l of lignes) {
        if (l.detail || typeof l.valeurs.ht !== 'number') continue;
        const taux = Number(l.valeurs.tauxTva ?? 0);
        l.valeurs.tva = cents((l.valeurs.ht * taux) / 100);
        if (!parTaux.has(taux)) parTaux.set(taux, []);
        parTaux.get(taux)!.push(l);
    }
    let tva = 0;
    for (const [taux, ls] of parTaux) {
        const attendu = cents((somme(ls.map(l => l.valeurs.ht as number)) * taux) / 100);
        const ecart = cents(attendu - somme(ls.map(l => l.valeurs.tva as number)));
        if (ecart) { const d = ls[ls.length - 1]; d.valeurs.tva = cents((d.valeurs.tva as number) + ecart); }
        tva = cents(tva + attendu);
    }
    for (const l of lignes) if (!l.detail && typeof l.valeurs.ht === 'number') l.valeurs.ttc = cents(l.valeurs.ht + (l.valeurs.tva as number));
    const ht = somme(lignes.filter(l => !l.detail && typeof l.valeurs.ht === 'number').map(l => l.valeurs.ht as number));
    return { ht, tva, ttc: cents(ht + tva) };
}

type Indices = NonNullable<import('./p1-compteur').PrixDuMois['indices']>;

/** Tableaux de révision : un par mois et par jeu d'indices distinct (sites en T2 et en T3 : deux tableaux). */
function revisions(entrees: { mois: string; site: string; indices?: Indices; coefficient: number | null }[]): RevisionAnnexe[] {
    const out = new Map<string, RevisionAnnexe>();
    for (const e of entrees) {
        const termes = (e.indices ?? []).filter(i => i.valeur !== null || i.base !== null).map(i => ({ terme: i.terme, indice: i.indice, base: i.base, valeur: i.valeur }));
        if (!termes.length && (e.coefficient === null || e.coefficient === 1)) continue;
        const cle = `${e.mois}|${JSON.stringify(termes)}|${e.coefficient}`;
        if (!out.has(cle)) out.set(cle, { mois: e.mois, sites: [], termes, coefficient: e.coefficient });
        const r = out.get(cle)!;
        if (!r.sites.includes(e.site)) r.sites.push(e.site);
    }
    const liste = [...out.values()].sort((a, b) => a.mois.localeCompare(b.mois));
    // Un seul jeu d'indices pour un mois : inutile de nommer les sites.
    for (const r of liste) if (liste.filter(x => x.mois === r.mois).length === 1) r.sites = [];
    return liste;
}

/** Le document a-t-il une annexe P1 (au moins une ligne P1 détaillée) ? */
export const aAnnexeP1 = (lineItems: InvoiceLineItem[] | undefined): boolean =>
    (lineItems ?? []).some(l => l.p1Releve?.detail || l.p1Dju || l.p1Acompte || (l.p1Regul && 'mois' in l.p1Regul));

/** Annexes P1 d'un document, dans l'ordre : chauffage au compteur, ECS au compteur, MTI au DJU, acomptes, décompte, régularisation. */
export function annexesP1(lineItems: InvoiceLineItem[], sites?: Record<string, string>): AnnexeP1[] {
    const annexes: AnnexeP1[] = [];
    const site = (l: InvoiceLineItem) => nomSite(l, sites);

    // --- Au compteur (chauffage, ECS) ---
    for (const usage of ['chauffage', 'ecs'] as const) {
        const items = lineItems.filter(l => l.p1Releve?.detail && (l.p1Releve.usage ?? 'ecs') === usage);
        if (!items.length) continue;
        const unite = usage === 'ecs' ? 'm³' : 'MWh';
        const lignes: LigneAnnexe[] = [];
        const rev: Parameters<typeof revisions>[0] = [];
        const notes = new Set<string>();
        let gestion = false, prorata = false, conversion = false;
        for (const l of items) for (const m of l.p1Releve!.detail!) {
            rev.push({ mois: m.mois, site: site(l), indices: m.prix.indices, coefficient: m.prix.coefficient });
            if (m.coefGestion !== null) gestion = true;
            if (m.methode !== 'complet') prorata = true;
            if (m.compteurs.some(c => c.conversion !== 1)) conversion = true;
            if (m.prix.provisoire) notes.add('Prix provisoire : un indice du mois n\'est pas encore publié, sa dernière valeur connue est reprise.');
            const estime = m.compteurs.filter(c => c.fin.type && c.fin.type !== 'REEL');
            if (estime.length) notes.add('Index estimé (et non relevé) : signalé par « (e) » après la date.');
            const date = (c: { date: string; type?: string }) => `${c.date.split('-').reverse().join('/')}${c.type && c.type !== 'REEL' ? ' (e)' : ''}`;
            const multi = m.compteurs.length > 1 || m.compteurs[0]?.signe === -1;
            const tete = { site: site(l), mois: moisFr(m.mois) };
            const cpt = (c: typeof m.compteurs[number]) => ({
                compteur: `${c.signe < 0 ? '− ' : ''}${c.code}`, indexDebut: c.debut.index, dateDebut: date(c.debut), indexFin: c.fin.index, dateFin: date(c.fin),
                conso: c.volume, conversion: c.conversion, quantiteCompteur: c.quantite,
            });
            if (multi) for (const c of m.compteurs) lignes.push({ detail: true, valeurs: { ...tete, ...cpt(c) } });
            const pr = m.methode === 'releve' ? `relevés du ${m.debut.split('-').reverse().join('/')} au ${m.fin.split('-').reverse().join('/')}`
                : m.methode === 'jours' ? `${m.jours}/${m.joursMois} jours` : m.methode === 'dju' ? `${m.dju!.couverts.toLocaleString('fr-FR')}/${m.dju!.mois.toLocaleString('fr-FR')} DJU` : '';
            lignes.push({
                valeurs: {
                    ...tete, ...(multi ? { compteur: 'Total' } : cpt(m.compteurs[0])), quantiteMois: m.quantiteMois, prorata: pr ? `  ${pr}` : '', quantite: m.quantite,
                    prixBase: m.prix.base, coefficient: m.prix.coefficient, coefGestion: m.coefGestion, prixApplique: m.prixApplique, ht: m.montant, tauxTva: l.vatRate ?? 0,
                },
            });
        }
        const colonnes = [
            C('site', 'Site', 'texte', 14), C('mois', 'Mois', 'texte', 6), C('compteur', 'Compteur', 'texte', 9),
            C('indexDebut', 'Index M-1', 'nombre', 8, 1), C('dateDebut', 'relevé le', 'texte', 8), C('indexFin', 'Index M', 'nombre', 8, 1), C('dateFin', 'relevé le', 'texte', 8),
            C('conso', 'Conso.', 'nombre', 6, 1),
            ...(conversion ? [C('conversion', 'Coef. conv.', 'coef', 6, 5), C('quantiteCompteur', unite, 'nombre', 6, 3)] : []),
            ...(lignes.some(l => l.detail) || prorata ? [C('quantiteMois', `${unite} du mois`, 'nombre', 6, 3)] : []),
            ...(prorata ? [C('prorata', '  Prorata', 'texte', 10)] : []),
            C('quantite', `${unite} facturés`, 'nombre', 6, 3),
            C('prixBase', `PU base €/${unite}`, 'prix', 6, 4), C('coefficient', 'C/C0', 'coef', 6, 5),
            ...(gestion ? [C('coefGestion', 'Coef. gestion', 'coef', 6, 4)] : []),
            C('prixApplique', `PU final €/${unite}`, 'prix', 7, 4), ...FIN,
        ];
        annexes.push({
            type: usage === 'ecs' ? 'compteur-ecs' : 'compteur-chauffage',
            titre: usage === 'ecs' ? 'P1 ECS au compteur' : 'P1 chauffage au compteur',
            formule: `P1 = (compteur M − compteur M-1)${conversion ? ' × coefficient de conversion' : ''} × PU de base × C/C0${gestion ? ' × coefficient de gestion' : ''}`,
            references: [['Unité facturée', unite]], revisions: revisions(rev), colonnes, lignes, totaux: fermer(lignes), notes: [...notes],
        });
    }

    // --- MTI au DJU ---
    const dju = lineItems.filter(l => l.p1Dju);
    if (dju.length) {
        const lignes: LigneAnnexe[] = dju.flatMap(l => l.p1Dju!.mois.map(m => ({
            valeurs: {
                site: site(l), mois: moisFr(m.mois), base: l.p1Dju!.base, coefficient: m.coefficient, revise: cents(m.revise),
                du: `  ${m.debut.split('-').reverse().join('/')}`, au: m.fin.split('-').reverse().join('/'), dju: m.dju, djuReference: l.p1Dju!.djuReference, ht: m.montant, tauxTva: l.vatRate ?? 0,
            },
        })));
        const refs = [...new Set(dju.map(l => l.p1Dju!.djuReference))];
        annexes.push({
            type: 'dju', titre: 'P1 chauffage MTI au DJU',
            formule: 'P1 MTI = P1 annuel de base × C/C0 × DJU de la période de chauffe / DJU contractuels',
            references: [['DJU contractuels', refs.map(r => r.toLocaleString('fr-FR')).join(', ')]],
            revisions: revisions(dju.flatMap(l => l.p1Dju!.mois.map(m => ({ mois: m.mois, site: site(l), indices: m.indices, coefficient: m.coefficient })))),
            colonnes: [
                C('site', 'Site', 'texte', 18), C('mois', 'Mois', 'texte', 6), C('base', 'Base contrat € HT/an', 'eur', 10), C('coefficient', 'C/C0', 'coef', 7, 5),
                C('revise', 'Montant révisé', 'eur', 10), C('du', '  Chauffe du', 'texte', 9), C('au', 'au', 'texte', 8), C('dju', 'DJU réels', 'nombre', 7, 2),
                ...(refs.length > 1 ? [C('djuReference', 'DJU contrat', 'nombre', 7, 0)] : []), ...FIN,
            ],
            lignes, totaux: fermer(lignes), notes: [],
        });
    }

    // --- Acomptes ---
    const acomptes = lineItems.filter(l => l.p1Acompte);
    if (acomptes.length) {
        const lignes: LigneAnnexe[] = acomptes.flatMap(l => l.p1Acompte!.mois.map(m => ({
            valeurs: { site: site(l), usage: l.p1Acompte!.usage === 'ecs' ? 'ECS' : 'Chauffage', mois: moisFr(m.mois), quantite: m.quantite, unite: l.p1Acompte!.usage === 'ecs' ? 'm³' : 'MWh', prix: m.prix, ht: m.montant, tauxTva: l.vatRate ?? 0 },
        })));
        annexes.push({
            type: 'acompte', titre: 'Acomptes P1',
            formule: 'Acompte = quantité annuelle de référence × part du mois × prix révisé P1 du mois',
            references: [], revisions: [],
            colonnes: [C('site', 'Site', 'texte', 22), C('usage', 'Usage', 'texte', 8), C('mois', 'Mois', 'texte', 7), C('quantite', 'Quantité du mois', 'nombre', 10, 3), C('unite', 'Unité', 'texte', 5), C('prix', 'Prix révisé', 'prix', 9, 4), ...FIN],
            lignes, totaux: fermer(lignes), notes: ['Les acomptes sont régularisés en fin de saison (décompte ou réel).'],
        });
    }

    // --- Décompte MTI, régularisation sur le réel ---
    const reguls = lineItems.filter(l => l.p1Regul && 'mois' in l.p1Regul);
    const decomptes = reguls.filter(l => (l.p1Regul as { decompte?: unknown[] }).decompte?.length);
    if (decomptes.length) {
        const lignes: LigneAnnexe[] = decomptes.flatMap(l => {
            const r = l.p1Regul as Extract<NonNullable<InvoiceLineItem['p1Regul']>, { mois: string[] }>;
            const d = r.decompte!;
            // Sous-détail : DJU et part du P1 dû de chaque mois de la saison.
            const parMois: LigneAnnexe[] = d.flatMap(x => x.mois.map(m => ({ detail: true, valeurs: { site: site(l), saison: moisFr(m.mois), dju: m.dju, du: m.montant } })));
            return [...parMois, {
                valeurs: {
                    site: site(l), saison: d.map(x => x.saison).join(', '), p1Base: somme(d.map(x => cents(x.p1Base))), coefficient: d.length === 1 ? d[0].coefficient : null,
                    dju: somme(d.map(x => x.dju)), djuReference: d[0].djuReference, du: somme(d.map(x => x.du)), periode: `  ${moisFr(r.mois[0])} → ${moisFr(r.mois[r.mois.length - 1])}`,
                    duPeriode: r.reel, acomptes: r.acomptes, ht: l.total, tauxTva: l.vatRate ?? 0,
                },
            }];
        });
        annexes.push({
            type: 'decompte', titre: 'Décompte P1 chauffage MTI',
            formule: 'P1 dû = P1 annuel de base × C/C0 annuel (moyenne pondérée par les DJU) × DJU réels de la saison / DJU contractuels ; décompte = P1 dû − acomptes facturés',
            references: [], revisions: [],
            colonnes: [
                C('site', 'Site', 'texte', 16), C('saison', 'Saison / mois', 'texte', 8), C('p1Base', 'P1 annuel base', 'eur', 9), C('coefficient', 'C/C0 annuel', 'coef', 7, 5), C('dju', 'DJU réels', 'nombre', 6, 1),
                C('djuReference', 'DJU contrat', 'nombre', 7, 0), C('du', 'P1 dû', 'eur', 9), C('periode', '  Période', 'texte', 12), C('duPeriode', 'P1 dû période', 'eur', 9), C('acomptes', 'Acomptes', 'eur', 9),
                { ...FIN[0], libelle: 'Décompte HT' }, ...FIN.slice(1),
            ],
            lignes, totaux: fermer(lignes), notes: ['DJU réels : de l\'allumage à l\'arrêt de la saison de chauffe du site.'],
        });
    }
    const reels = reguls.filter(l => !decomptes.includes(l));
    if (reels.length) {
        const lignes: LigneAnnexe[] = reels.map(l => {
            const r = l.p1Regul as Extract<NonNullable<InvoiceLineItem['p1Regul']>, { mois: string[] }>;
            return { valeurs: { site: site(l), usage: r.usage === 'ecs' ? 'ECS' : r.usage === 'chauffage' ? 'Chauffage' : 'P1', periode: `${moisFr(r.mois[0])} → ${moisFr(r.mois[r.mois.length - 1])}`, reel: r.reel, acomptes: r.acomptes, ht: l.total, tauxTva: l.vatRate ?? 0 } };
        });
        annexes.push({
            type: 'regularisation', titre: 'Régularisation P1', formule: 'Régularisation = P1 réel de la période − acomptes facturés', references: [], revisions: [],
            colonnes: [C('site', 'Site', 'texte', 24), C('usage', 'Usage', 'texte', 9), C('periode', 'Période', 'texte', 13), C('reel', 'P1 réel', 'eur', 11), C('acomptes', 'Acomptes facturés', 'eur', 11), { ...FIN[0], libelle: 'Régularisation HT' }, ...FIN.slice(1)],
            lignes, totaux: fermer(lignes), notes: [],
        });
    }
    return annexes;
}

/** Valeur affichée d'une cellule (PDF) ; le tableur garde la valeur brute. */
export function afficher(v: ValeurAnnexe, c: Pick<ColonneAnnexe, 'format' | 'decimales'>): string {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'string') return v;
    const n = (x: number, min: number, max: number) => {
        const [int, dec = ''] = Math.abs(x).toFixed(max).split('.');
        const d = dec.replace(/0+$/, '').padEnd(min, '0');
        return `${x < 0 ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${d ? `,${d}` : ''}`;
    };
    switch (c.format) {
        case 'eur': return `${n(v, 2, 2)} €`;
        case 'pct': return `${n(v, 0, 2)} %`;
        case 'coef': return n(v, 0, c.decimales ?? 5);
        case 'prix': return n(v, 2, c.decimales ?? 4);
        default: return n(v, 0, c.decimales ?? 2);
    }
}
