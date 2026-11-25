/**
 * Contrats de fourniture d'énergie (gaz, électricité, réseau de chaleur…) : la base des achats du P1.
 *
 * - Un **point de livraison** (PDL / PCE) est rattaché au site du contrat client qu'il alimente.
 * - Il porte ses **périodes de fourniture** : un contrat fournisseur, de telle date à telle date, à telles conditions
 *   de prix. Renouveler, c'est ajouter une période ; rien n'est recopié.
 * - L'**état** d'une période et la **couverture** d'un point se déduisent des dates : ils ne se saisissent pas.
 * - Le **contrat fournisseur** est le regroupement des périodes de même fournisseur et de même numéro.
 * Module sans dépendance serveur.
 */

export const ENERGIES = ['GAZ', 'ELEC', 'RCU', 'EAU', 'PROPANE', 'AUTRE'] as const;
export type Energie = typeof ENERGIES[number];
export const LIBELLE_ENERGIE: Record<Energie, string> = { GAZ: 'Gaz', ELEC: 'Électricité', RCU: 'Réseau de chaleur', EAU: 'Eau', PROPANE: 'Propane', AUTRE: 'Autre' };

export type PrixFourniture = {
    indexationAchat?: string; indexationVente?: string;
    /** Date de valeur du prix de la molécule (AAAA-MM-JJ). */
    dateValeur?: string | null;
    /** €/MWh. */
    prixMolecule?: number | null; p0AchatPeg?: number | null; atrdVariable?: number | null; rfaVariable?: number | null;
    /** €/an. */
    abonnement?: number | null; termeCapacite?: number | null; atrdFixe?: number | null; atrtFixe?: number | null; stockage?: number | null;
    totalAbonnement?: number | null; cta?: number | null; rfaFixe?: number | null;
};

export type PeriodeFourniture = PrixFourniture & {
    id: string;
    /** AAAA-MM-JJ ; null : date à préciser. */
    debut: string | null; fin: string | null;
    fournisseur: string; numeroContrat: string; titulaire: string;
    /** 'oui' | 'non' | '' et sa précision (« 3 ans »). */
    tacite: '' | 'oui' | 'non'; taciteDetail?: string;
    conditions?: string;
    accesDonnees?: string; contratDisponible?: string;
    /** Mention de la source quand elle n'est pas un état calculable (« Non rattaché », « Gaz supprimé »…). */
    remarque?: string;
};

export type PointLivraison = {
    id: string;
    pdl: string; energie: Energie;
    profil?: string; segment?: string;
    /** Consommation annuelle de référence (MWh) ou puissance souscrite (kVA). */
    car?: number | null;
    /** Site du logiciel alimenté par ce point (celui du contrat client) ; null : à rattacher. */
    siteId: string | null;
    /** Repères de la source, tant que le point n'est pas rattaché : client, site, lot, agence… */
    client: string; site: string; lot?: string; agence?: string; secteur?: string; societe?: string; centreCout?: string; typeMarche?: string;
    adresse?: string; codePostal?: string; ville?: string;
    /** Contrat client d'après la source (AAAA-MM-JJ). */
    debutClient?: string | null; finClient?: string | null;
    periodes: PeriodeFourniture[];
};

// --- États ---

export type EtatPeriode = 'en_cours' | 'a_venir' | 'terminee' | 'a_dater';
export const LIBELLE_ETAT_PERIODE: Record<EtatPeriode, string> = { en_cours: 'En cours', a_venir: 'À venir', terminee: 'Terminée', a_dater: 'Dates à préciser' };

export function etatPeriode(p: Pick<PeriodeFourniture, 'debut' | 'fin'>, aujourdhui: string): EtatPeriode {
    if (!p.debut || !p.fin) return 'a_dater';
    return p.fin < aujourdhui ? 'terminee' : p.debut > aujourdhui ? 'a_venir' : 'en_cours';
}

export type StatutCouverture = 'couvert' | 'a_renouveler' | 'sans_couverture' | 'a_venir' | 'termine';
export const LIBELLE_COUVERTURE: Record<StatutCouverture, string> = {
    couvert: 'Couvert', a_renouveler: 'À renouveler', sans_couverture: 'Sans contrat en cours', a_venir: 'Fourniture à venir', termine: 'Terminé',
};
export type Couverture = {
    statut: StatutCouverture;
    courante: PeriodeFourniture | null; suivante: PeriodeFourniture | null;
    /** Dernier jour couvert sans interruption à partir d'aujourd'hui (périodes qui s'enchaînent). */
    finCouverture: string | null;
    /** Jours restants jusqu'à la fin de couverture. */
    jours: number | null;
};

const lendemain = (j: string) => new Date(Date.parse(`${j}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const ecart = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * Couverture d'un point de livraison aujourd'hui : période en cours, fin de la couverture continue, et statut.
 * « À renouveler » : la couverture s'arrête dans moins de `seuilJours` jours et rien ne la prolonge. Un point dont le
 * contrat client est terminé et qui n'a plus de fourniture est « terminé », pas « sans contrat ».
 */
export function couverture(point: Pick<PointLivraison, 'periodes' | 'finClient'>, aujourdhui: string, seuilJours = 180): Couverture {
    const datees = point.periodes.filter(p => p.debut && p.fin).sort((a, b) => a.debut!.localeCompare(b.debut!));
    const courante = datees.filter(p => p.debut! <= aujourdhui && p.fin! >= aujourdhui).sort((a, b) => b.fin!.localeCompare(a.fin!))[0] ?? null;
    const futures = datees.filter(p => p.debut! > aujourdhui);
    if (!courante) {
        const clientFini = !!point.finClient && point.finClient < aujourdhui;
        return { statut: futures.length ? 'a_venir' : clientFini || !datees.length ? (datees.length || clientFini ? 'termine' : 'sans_couverture') : 'sans_couverture', courante: null, suivante: futures[0] ?? null, finCouverture: null, jours: null };
    }
    // Périodes qui s'enchaînent sans trou (une période peut commencer avant la fin de la précédente).
    let fin = courante.fin!;
    for (const p of futures) { if (p.debut! <= lendemain(fin)) { if (p.fin! > fin) fin = p.fin!; } else break; }
    const jours = ecart(aujourdhui, fin);
    // Le contrat client s'arrête avant ou avec la fourniture : rien à renouveler.
    const clientSuit = !point.finClient || point.finClient > fin;
    return { statut: jours <= seuilJours && clientSuit ? 'a_renouveler' : 'couvert', courante, suivante: futures[0] ?? null, finCouverture: fin, jours };
}

// --- Contrats fournisseur ---

export type ContratFournisseur = {
    cle: string; fournisseur: string; numero: string; titulaires: string[];
    debut: string | null; fin: string | null; etat: EtatPeriode;
    points: number; energies: Energie[];
    /** Périodes sans le contrat signé à disposition. */
    sansDocument: number;
};

const norm = (t: string | null | undefined) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/** Contrats fournisseur : périodes regroupées par fournisseur et numéro (sans numéro : un groupe par fournisseur). */
export function contratsFournisseur(points: Pick<PointLivraison, 'id' | 'energie' | 'periodes'>[], aujourdhui: string): ContratFournisseur[] {
    const m = new Map<string, { c: ContratFournisseur; pts: Set<string>; tit: Set<string>; en: Set<Energie> }>();
    for (const pt of points) for (const p of pt.periodes) {
        const cle = `${norm(p.fournisseur)}|${norm(p.numeroContrat)}`;
        let g = m.get(cle);
        if (!g) { g = { c: { cle, fournisseur: p.fournisseur, numero: p.numeroContrat, titulaires: [], debut: null, fin: null, etat: 'a_dater', points: 0, energies: [], sansDocument: 0 }, pts: new Set(), tit: new Set(), en: new Set() }; m.set(cle, g); }
        g.pts.add(pt.id); g.en.add(pt.energie); if (p.titulaire) g.tit.add(p.titulaire);
        if (p.debut && (!g.c.debut || p.debut < g.c.debut)) g.c.debut = p.debut;
        if (p.fin && (!g.c.fin || p.fin > g.c.fin)) g.c.fin = p.fin;
        if (norm(p.contratDisponible ?? '') !== 'OUI') g.c.sansDocument++;
    }
    return [...m.values()].map(g => ({ ...g.c, points: g.pts.size, titulaires: [...g.tit].sort(), energies: [...g.en].sort(), etat: etatPeriode(g.c, aujourdhui) }))
        .sort((a, b) => (b.fin ?? '').localeCompare(a.fin ?? '') || a.fournisseur.localeCompare(b.fournisseur, 'fr') || a.numero.localeCompare(b.numero));
}

// --- Synthèse annuelle ---

export type LigneSynthese = { energie: Energie; agence: string; client: string; parAnnee: number[] };

/** Nombre de points de livraison fournis chaque année (au moins un jour de fourniture dans l'année), par énergie, agence et client. */
export function syntheseAnnuelle(points: Pick<PointLivraison, 'energie' | 'agence' | 'client' | 'periodes'>[], annees: number[]): { lignes: LigneSynthese[]; totaux: number[] } {
    const m = new Map<string, LigneSynthese>();
    for (const pt of points) {
        const fournies = annees.map(a => pt.periodes.some(p => p.debut && p.fin && p.debut <= `${a}-12-31` && p.fin >= `${a}-01-01`));
        if (!fournies.some(Boolean)) continue;
        const cle = `${pt.energie}|${pt.agence ?? ''}|${pt.client}`;
        const l = m.get(cle) ?? { energie: pt.energie, agence: pt.agence ?? '', client: pt.client, parAnnee: annees.map(() => 0) };
        fournies.forEach((f, i) => { if (f) l.parAnnee[i]++; });
        m.set(cle, l);
    }
    const lignes = [...m.values()].sort((a, b) => a.energie.localeCompare(b.energie) || a.agence.localeCompare(b.agence, 'fr') || a.client.localeCompare(b.client, 'fr'));
    return { lignes, totaux: annees.map((_, i) => lignes.reduce((s, l) => s + l.parAnnee[i], 0)) };
}

// --- Lecture de la feuille « SITES P1 » ---

export type AnomalieImport = { ligne: number; message: string };
export type PointImporte = Omit<PointLivraison, 'id' | 'siteId' | 'periodes'> & { periodes: Omit<PeriodeFourniture, 'id'>[] };
export type LectureFeuille = { points: PointImporte[]; lignes: number; periodes: number; anomalies: AnomalieImport[] };

/** Colonnes reconnues : clé interne → mots de l'en-tête (accents, casse et retours à la ligne ignorés). */
const COLONNES: Record<string, string[]> = {
    societe: ['CODE SOCIETE SAP'], centreCout: ['CODE OTP', 'CENTRE DE COUT'], energie: ['ENERGIE'], typeMarche: ['TYPE DE MARCHE'], agence: ['AGENCE'], secteur: ['SECTEUR / SOUS-SECTEUR', 'SOUS-SECTEUR'],
    titulaire: ['TITULAIRE CONTRAT ENERGIE'], client: ['CLIENT'], lot: ['LOT'], site: ['SITE'], pdl: ['PDL', 'PCE'], profil: ['PROFIL'], segment: ['TARIF ACH', 'SEGMENT'], car: ['CAR / PUISS', 'CAR'],
    debutClient: ['DEBUT CONTRAT CLIENT'], finClient: ['FIN CONTRAT CLIENT'], debut: ['DEBUT CONTRAT FOURNISSEUR'], fin: ['FIN CONTRAT FOURNISSEUR'], etatFournisseur: ['ETAT CONTRAT FOURNISSEUR'],
    fournisseur: ['FOURNISSEUR'], numeroContrat: ['CONTRAT FOURNISSEUR N'], tacite: ['TACITE RECONDUCTION'], conditions: ['AUTRE'], accesDonnees: ['ACCES DONNEES DEMAT'], contratDisponible: ['CONTRAT FOURNISSEUR SUR LE DRIVE'],
    indexationVente: ['INDEXATION VENTE'], indexationAchat: ['INDEXATION ACHAT'], dateValeur: ['DATE DE VALEUR MOLECULE'], p0AchatPeg: ['PO ACHAT SUR PEG'], prixMolecule: ['PRIX MOLECULE'], atrdVariable: ['ATRD VARIABLE'],
    abonnement: ['PO ABONNEMENT'], termeCapacite: ['TERME CAPACITE'], atrdFixe: ['ATRD DISTRI FIXE'], atrtFixe: ['ATRT TRANSPORT'], stockage: ['ATR STOCKAGE'], totalAbonnement: ['TOTAL ABONNEMENT'], cta: ['CTA'],
    rfaVariable: ['DONT RFA 1'], rfaFixe: ['DONT RFA 2'], adresse: ['ADRESSE'], ville: ['VILLE'], codePostal: ['CODE POSTAL'],
};

/** Colonne d'un en-tête : égalité d'abord (« SITE », « CLIENT », « FOURNISSEUR »), sinon début de l'en-tête. */
export function reconnaitreColonnes(entetes: unknown[]): Record<string, number> {
    const h = entetes.map(e => norm(String(e ?? '').replace(/\n/g, ' ')));
    const out: Record<string, number> = {};
    for (const [cle, mots] of Object.entries(COLONNES)) {
        const exact = h.findIndex(x => mots.some(m => x === m));
        const debut = exact >= 0 ? exact : h.findIndex((x, i) => mots.some(m => x.startsWith(m)) && !Object.values(out).includes(i));
        if (debut >= 0) out[cle] = debut;
    }
    return out;
}

/** « 01/06/2016 » → « 2016-06-01 » ; déjà ISO accepté ; autre chose : null. */
export function lireDate(v: unknown): string | null {
    const t = String(v ?? '').trim();
    let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
    if (m) { const [j, mo, a] = [+m[1], +m[2], +m[3]]; return mo >= 1 && mo <= 12 && j >= 1 && j <= 31 ? `${a}-${String(mo).padStart(2, '0')}-${String(j).padStart(2, '0')}` : null; }
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** « 1 000,00 € » → 1000 ; vide ou illisible : null. */
export function lireNombre(v: unknown): number | null {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const t = String(v ?? '').replace(/[\s  €]/g, '').replace(',', '.');
    if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null;
    return Number(t);
}

const INDEXATIONS: Record<string, string> = { PEGEOD: 'PEG EOD', 'PEG EOD': 'PEG EOD', PEGMI: 'PEG MI', 'PEG MI': 'PEG MI', FIXE: 'FIXE', 'PRIX FIXE': 'FIXE', PRIXINDEXE: 'Prix indexé', PEG: 'PEG', B1: 'B1', CRE: 'CRE' };
export const lireIndexation = (v: unknown) => { const t = norm(String(v ?? '')); return t ? INDEXATIONS[t] ?? String(v).replace(/\s+/g, ' ').trim() : ''; };

const MARCHES: Record<string, string> = { 'CP REVISE': 'CP révisé', CPREVISE: 'CP révisé', 'NON RENSEIGNE': '' };
export const lireMarche = (v: unknown) => { const t = norm(String(v ?? '')); return t in MARCHES ? MARCHES[t] : t; };

export function lireEnergie(v: unknown): Energie {
    const t = norm(String(v ?? ''));
    return (ENERGIES as readonly string[]).includes(t) ? t as Energie : /ELEC/.test(t) ? 'ELEC' : 'AUTRE';
}

const ETATS_CALCULES = ['ACTIF', 'TERMINE', 'A VENIR', ''];

/** Feuille « SITES P1 » (en-têtes en première ligne) lue en points de livraison et périodes. */
export function lireFeuille(table: unknown[][]): LectureFeuille {
    const col = reconnaitreColonnes(table[0] ?? []);
    const anomalies: AnomalieImport[] = [];
    for (const requis of ['pdl', 'energie', 'fournisseur', 'debut', 'fin'] as const) if (!(requis in col)) anomalies.push({ ligne: 1, message: `Colonne « ${COLONNES[requis][0]} » introuvable.` });
    if (anomalies.length) return { points: [], lignes: 0, periodes: 0, anomalies };
    const points = new Map<string, PointImporte>();
    let lignes = 0, periodes = 0;
    table.slice(1).forEach((r, k) => {
        const n = k + 2;
        const lu = (c: string) => (c in col ? String(r[col[c]] ?? '').replace(/\s+/g, ' ').trim() : '');
        if (!r.some(c => String(c ?? '').trim())) return;
        lignes++;
        const pdl = lu('pdl');
        if (!pdl || /^PAS DE P/i.test(pdl)) { anomalies.push({ ligne: n, message: `Point de livraison absent (${lu('site') || lu('client') || 'ligne sans repère'}) : ligne ignorée.` }); return; }
        const energie = lireEnergie(lu('energie'));
        const cle = `${energie}|${pdl}`;
        let pt = points.get(cle);
        const ident = {
            client: lu('client'), site: lu('site'), lot: lu('lot'), agence: lu('agence'), secteur: lu('secteur'), societe: lu('societe'), centreCout: lu('centreCout'), typeMarche: lireMarche(lu('typeMarche')),
            profil: lu('profil'), segment: lu('segment'), car: lireNombre(lu('car')), adresse: lu('adresse'), codePostal: lu('codePostal'), ville: lu('ville'),
            debutClient: lireDate(lu('debutClient')), finClient: lireDate(lu('finClient')),
        };
        if (!pt) { pt = { pdl, energie, ...ident, periodes: [] }; points.set(cle, pt); }
        const [debut, fin] = [lireDate(lu('debut')), lireDate(lu('fin'))];
        if (!debut || !fin) anomalies.push({ ligne: n, message: `PDL ${pdl} : dates du contrat fournisseur à préciser (« ${lu('debut')} » → « ${lu('fin')} »).` });
        else if (debut > fin) anomalies.push({ ligne: n, message: `PDL ${pdl} : la fin du contrat fournisseur (${lu('fin')}) précède son début (${lu('debut')}).` });
        // Vrai doublon : mêmes dates, même fournisseur, même numéro. Deux lignes de même début mais de fins différentes
        // sont deux périodes (le contrat client a changé en cours de route).
        if (debut && pt.periodes.some(p => p.debut === debut && p.fin === fin && norm(p.fournisseur) === norm(lu('fournisseur')) && norm(p.numeroContrat) === norm(lu('numeroContrat')))) { anomalies.push({ ligne: n, message: `PDL ${pdl} : période du ${lu('debut')} chez ${lu('fournisseur')} en double, ligne ignorée.` }); return; }
        // La période la plus récente donne les repères du point (client, site, agence… changent parfois d'une ligne à l'autre).
        if (debut && pt.periodes.every(p => !p.debut || p.debut < debut)) Object.assign(pt, Object.fromEntries(Object.entries(ident).filter(([, v]) => v !== '' && v !== null)));
        const tacite = norm(lu('tacite'));
        const etat = norm(lu('etatFournisseur'));
        const nombres = Object.fromEntries((['prixMolecule', 'p0AchatPeg', 'atrdVariable', 'rfaVariable', 'abonnement', 'termeCapacite', 'atrdFixe', 'atrtFixe', 'stockage', 'totalAbonnement', 'cta', 'rfaFixe'] as const)
            .map(c => [c, lireNombre(lu(c))]).filter(([, v]) => v !== null));
        pt.periodes.push({
            debut, fin, fournisseur: lu('fournisseur'), numeroContrat: lu('numeroContrat'), titulaire: lu('titulaire'),
            tacite: tacite.startsWith('OUI') ? 'oui' : tacite === 'NON' ? 'non' : '', ...(tacite.startsWith('OUI') && tacite !== 'OUI' && { taciteDetail: lu('tacite').replace(/^oui\s*/i, '').replace(/[()]/g, '').trim() }),
            ...(lu('conditions') && { conditions: lu('conditions') }), ...(lu('accesDonnees') && { accesDonnees: lu('accesDonnees') }), ...(lu('contratDisponible') && { contratDisponible: lu('contratDisponible') }),
            ...(lireIndexation(lu('indexationAchat')) && { indexationAchat: lireIndexation(lu('indexationAchat')) }), ...(lireIndexation(lu('indexationVente')) && { indexationVente: lireIndexation(lu('indexationVente')) }),
            ...(lireDate(lu('dateValeur')) && { dateValeur: lireDate(lu('dateValeur')) }), ...nombres,
            ...(!ETATS_CALCULES.includes(etat) && !/^DATE/.test(etat) && { remarque: lu('etatFournisseur') }),
        });
        periodes++;
    });
    return { points: [...points.values()], lignes, periodes, anomalies };
}
