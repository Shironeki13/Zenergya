import {
    EXIGENCES_MARCHE, PERIODES_REFERENCE, REGIMES_CP, TYPES_MARCHE, enVigueur, exigePrixEtFormule,
    type Energie, type IsoDate, type RegimeCp, type TermeNc, type TrancheBareme, type Trace, type TypeMarche, type Version,
} from '@/lib/p1/parametrage';
import { parseBareme, validateBareme } from '@/lib/p1/bareme';
import type { FormuleVersion, PerimetreFormule } from '@/lib/p1/formules';

/**
 * Paramétrage P1 enregistré (collection `p1Parametrage`, écrite par le serveur seulement) : fondations.
 *
 * Un document par site (`site:<id>`, avec ses postes de consommation), par compteur (`meter:<id>`) et par contrat
 * (`contract:<id>`). Chaque paramètre est une liste de **versions datées** (date d'effet, motif, auteur) : une
 * nouvelle valeur ajoute une version, rien n'est écrasé ; une version erronée se **retire** (date, auteur, motif)
 * sans disparaître. La valeur d'un jour est la version active la plus récente à cette date (socle : sans date).
 * Non renseigné n'est jamais zéro : le « reste à faire » dit ce qui manque pour calculer.
 */

export type P1Version<T> = Version<T> & { id: string };
export type P1Params = Record<string, P1Version<unknown>[]>;

export type P1Poste = Trace & { id: string; designation: string; params: P1Params };
export type P1SiteDoc = { kind: 'site'; siteId: string; codeSite: string; params: P1Params; postes: Record<string, P1Poste> };
export type P1MeterDoc = { kind: 'meter'; meterId: string; codeCompteur: string; siteId: string; params: P1Params };
export type P1Formule = Trace & {
    id: string;
    nom: string;
    usage: 'chauffage' | 'ecs';
    perimetre: PerimetreFormule;
    versions: P1Version<FormuleVersion>[];
};
export type P1ContractDoc = { kind: 'contract'; contractId: string; codeContrat: string; params: P1Params; formules?: Record<string, P1Formule> };

/** Marchés avec intéressement : un barème de partage chacun (paramètre « bareme:MCI »…). */
export const MARCHES_BAREME = TYPES_MARCHE.filter(m => EXIGENCES_MARCHE[m].bareme);
export const baremeKey = (marche: TypeMarche) => `bareme:${marche}`;
export type P1Scope = 'site' | 'poste' | 'meter' | 'contract';

export const P1_DOC_ID = { site: (id: string) => `site:${id}`, meter: (id: string) => `meter:${id}`, contract: (id: string) => `contract:${id}` };

// --- Catalogue des paramètres ---

export const USAGES_COMPTEUR = ['entrant', 'vente', 'ecs', 'eau_froide', 'annexe', 'autre'] as const;
export const ENERGIES: Energie[] = ['gaz', 'fioul', 'bois', 'electricite', 'reseau_chaleur', 'propane', 'autre'];
export const UNITES_CIBLE = ['MWh', 't', 'L'] as const;
export const REPARTITIONS = ['contrat', 'prorata_nb'] as const;

export type InteressementMarche = { marche: TypeMarche; repartition: typeof REPARTITIONS[number]; plafondPct: number | null; plafonne: boolean };

type Kind = 'enum' | 'positive' | 'nonNegative' | 'text' | 'station' | 'formule' | 'interessement' | 'bareme';
export type ParamDef = { label: string; kind: Kind; options?: readonly string[]; unit?: string; help?: string };

export const P1_PARAMS: Record<P1Scope, Record<string, ParamDef>> = {
    site: {
        typeMarche: { label: 'Type de marché', kind: 'enum', options: TYPES_MARCHE, help: 'MC, MCI, MT, MTI, CP, CPI, PFI, PF : pilote tout le reste.' },
        periodeReference: { label: 'Période de référence', kind: 'enum', options: PERIODES_REFERENCE },
        prixBase: { label: 'Prix de base chauffage', kind: 'positive', unit: '€/MWh' },
        prixBaseEcs: { label: 'Prix de base ECS', kind: 'positive', unit: '€/m³' },
        stationMeteo: { label: 'Station météo', kind: 'station', help: 'Code de la station (paramétrage) : DJU de la cible corrigée.' },
        correspondanceTwimm: { label: 'Code site TWIMM', kind: 'text' },
    },
    poste: {
        formuleNc: { label: 'Formule de NC', kind: 'formule', help: 'Compteurs du site signés : « CPT-00012 + CPT-00013 - CPT-00020 ».' },
        cibleNb: { label: 'Cible NB', kind: 'positive' },
        cibleNbUnite: { label: 'Unité de la cible', kind: 'enum', options: UNITES_CIBLE },
        djuReference: { label: 'DJU de référence', kind: 'positive' },
    },
    meter: {
        usage: { label: 'Usage', kind: 'enum', options: USAGES_COMPTEUR },
        energie: { label: 'Énergie', kind: 'enum', options: ENERGIES },
        qe: { label: 'Coefficient de conversion (QE)', kind: 'positive', unit: 'MWh / unité', help: 'Index → MWh. Jamais 1 par défaut : vide tant qu\'il n\'est pas connu.' },
        qecs: { label: 'qECS', kind: 'positive', help: 'Compteurs d\'ECS volumétriques.' },
        correspondanceTwimm: { label: 'Code compteur TWIMM', kind: 'text', help: 'Change si le compteur est remplacé : nouvelle version datée.' },
    },
    contract: {
        regimeCp: { label: 'Régime du compte de prestation', kind: 'enum', options: REGIMES_CP, help: 'CP / CPI : refacturation, frais de gestion, coefficient, révisé.' },
        coefficientGestion: { label: 'Coefficient de gestion', kind: 'positive', help: 'Régime « coefficient » : HT × coefficient.' },
        fraisGestionAnnuels: { label: 'Frais de gestion annuels', kind: 'nonNegative', unit: '€ HT / an' },
        correspondanceTwimm: { label: 'Code contrat TWIMM', kind: 'text' },
        interessement: { label: 'Intéressement au contrat', kind: 'interessement', help: 'Par marché : écart partagé une fois sur la somme des sites, répartition, plafond.' },
    },
};

export type ValidationContext = {
    /** Codes des compteurs du site (formule de NC). */
    siteMeterCodes?: string[];
    /** Codes des stations météo connues. */
    stationCodes?: string[];
};

const num = (v: unknown) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')));

/** Définition d'un paramètre, y compris les barèmes par marché (« bareme:MCI » sur le contrat ou le site). */
export function paramDef(scope: P1Scope, key: string): ParamDef | undefined {
    const m = /^bareme:([A-Z]+)$/.exec(key);
    if (m && (scope === 'contract' || scope === 'site') && (MARCHES_BAREME as string[]).includes(m[1])) {
        return {
            label: `Barème de partage ${m[1]}${scope === 'site' ? ' (propre au site)' : ''}`, kind: 'bareme',
            help: 'Tranches par sens (économie, dépassement) : bornes en % du N\'B, part du client. Ex. « économie 0-10 % 50 % ; économie 10-100 % 70 % ; dépassement 0-100 % 30 % ».',
        };
    }
    return P1_PARAMS[scope][key];
}

/** Contrôle (et normalisation) d'une valeur ; texte accepté (imports). */
export function validateParam(scope: P1Scope, key: string, raw: unknown, ctx: ValidationContext = {}): { value: unknown } | { error: string } {
    const def = paramDef(scope, key);
    if (!def) return { error: `Paramètre « ${key} » inconnu.` };
    const empty = raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '');
    if (empty) return { error: `${def.label} : valeur obligatoire (une valeur inconnue ne se saisit pas : elle reste vide).` };
    switch (def.kind) {
        case 'enum': {
            const v = String(raw).trim();
            const found = def.options!.find(o => o.toLowerCase() === v.toLowerCase().replace(/[\s-]+/g, '_') || o.toLowerCase() === v.toLowerCase());
            return found ? { value: found } : { error: `${def.label} : « ${v} » inconnu (${def.options!.join(', ')}).` };
        }
        case 'positive': case 'nonNegative': {
            const n = num(raw);
            if (!Number.isFinite(n) || (def.kind === 'positive' ? n <= 0 : n < 0)) return { error: `${def.label} : nombre ${def.kind === 'positive' ? 'strictement positif' : 'positif ou nul'} attendu.` };
            return { value: n };
        }
        case 'text': return { value: String(raw).trim() };
        case 'station': {
            const v = String(raw).trim();
            if (ctx.stationCodes && !ctx.stationCodes.some(c => c.toUpperCase() === v.toUpperCase())) return { error: `Station météo « ${v} » inconnue.` };
            return { value: ctx.stationCodes?.find(c => c.toUpperCase() === v.toUpperCase()) ?? v };
        }
        case 'formule': {
            const termes = typeof raw === 'string' ? parseFormuleNc(raw) : (raw as TermeNc[]);
            if (!Array.isArray(termes)) return { error: `${def.label} : ${termes}` };
            if (termes.length === 0) return { error: `${def.label} : au moins un compteur.` };
            if (!termes.some(t => t.signe === 1)) return { error: `${def.label} : au moins un compteur en entrée (+).` };
            const codes = termes.map(t => t.codeCompteur.toUpperCase());
            if (new Set(codes).size !== codes.length) return { error: `${def.label} : un compteur figure deux fois.` };
            const unknown = ctx.siteMeterCodes ? codes.filter(c => !ctx.siteMeterCodes!.some(m => m.toUpperCase() === c)) : [];
            if (unknown.length) return { error: `${def.label} : compteur(s) absent(s) du site : ${unknown.join(', ')}.` };
            return { value: termes.map(t => ({ codeCompteur: t.codeCompteur.toUpperCase(), signe: t.signe })) };
        }
        case 'bareme': {
            const tranches = typeof raw === 'string' ? parseBareme(raw) : (raw as TrancheBareme[]);
            if (!Array.isArray(tranches)) return { error: `${def.label} : ${tranches}` };
            const { errors } = validateBareme(tranches);
            if (errors.length) return { error: `${def.label} : ${errors.join(' ; ')}.` };
            return { value: tranches.map(t => ({ sens: t.sens, borneBasse: t.borneBasse, borneHaute: t.borneHaute, partClient: t.partClient })) };
        }
        case 'interessement': {
            const list = raw as InteressementMarche[];
            if (!Array.isArray(list) || list.length === 0) return { error: `${def.label} : au moins un marché.` };
            for (const i of list) {
                if (!TYPES_MARCHE.includes(i.marche)) return { error: `${def.label} : marché « ${i.marche} » inconnu.` };
                if (!EXIGENCES_MARCHE[i.marche].bareme) return { error: `${def.label} : le marché ${i.marche} n'a pas d'intéressement.` };
                if (!REPARTITIONS.includes(i.repartition)) return { error: `${def.label} : répartition « ${i.repartition} » inconnue.` };
                if (i.plafondPct !== null && !(i.plafondPct > 0 && i.plafondPct <= 100)) return { error: `${def.label} : plafond en % du P2 entre 0 et 100.` };
                if (i.plafonne && i.plafondPct === null) return { error: `${def.label} : plafonné sans plafond.` };
            }
            if (new Set(list.map(i => i.marche)).size !== list.length) return { error: `${def.label} : un marché figure deux fois.` };
            return { value: list };
        }
    }
}

/** « CPT-1 + CPT-2 - CPT-3 » → termes signés ; message d'erreur sinon. */
export function parseFormuleNc(text: string): TermeNc[] | string {
    // Les codes contiennent un tiret (CPT-00012) : les signes sont isolés par des espaces, ou collés en tête d'un code.
    const out: TermeNc[] = [];
    let sign: 1 | -1 = 1;
    let pending = false;
    for (const token of text.trim().split(/\s+/).filter(Boolean)) {
        if (token === '+' || token === '-') { sign = token === '-' ? -1 : 1; pending = true; continue; }
        let code = token;
        if (/^[+-]/.test(token)) { sign = token[0] === '-' ? -1 : 1; code = token.slice(1); }
        else if (out.length > 0 && !pending) return `signe manquant avant « ${token} » (séparez par « + » ou « - »).`;
        if (!/^[A-Za-z0-9][\w.-]*$/.test(code)) return `terme « ${token} » illisible (codes séparés par « + » ou « - » entourés d'espaces).`;
        out.push({ codeCompteur: code, signe: sign });
        sign = 1;
        pending = false;
    }
    return out.length ? out : 'formule vide.';
}

export const formatFormuleNc = (termes: TermeNc[]) =>
    termes.map((t, i) => `${i === 0 ? (t.signe === -1 ? '- ' : '') : t.signe === -1 ? ' - ' : ' + '}${t.codeCompteur}`).join('');

// --- Versions ---

export type NewVersion = { valeur: unknown; dateEffet: IsoDate | null; motif: string; document?: string | null };

/** Ajoute une version (jamais d'écrasement) ; refus si une version active existe déjà à cette date. */
export function addVersion(versions: P1Version<unknown>[] | undefined, v: NewVersion, by: string, now: string, id: string): P1Version<unknown>[] | { error: string } {
    const list = versions ?? [];
    if (!v.motif?.trim()) return { error: 'Motif obligatoire (ex. « contrat d\'origine », « avenant n°2 », « correction »).' };
    if (v.dateEffet !== null && !/^\d{4}-\d{2}-\d{2}$/.test(v.dateEffet)) return { error: 'Date d\'effet AAAA-MM-JJ (vide : valeur d\'origine).' };
    const clash = list.find(x => !x.retireLe && (x.dateEffet ?? null) === v.dateEffet);
    if (clash) {
        return { error: `Une version active existe déjà ${v.dateEffet ? `au ${v.dateEffet.split('-').reverse().join('/')}` : 'comme valeur d\'origine'} : retirez-la d'abord (avec son motif) pour la remplacer.` };
    }
    const version: P1Version<unknown> = {
        id, valeur: v.valeur, dateEffet: v.dateEffet, motif: v.motif.trim(), document: v.document ?? null, saisiLe: now, saisiPar: by,
    };
    return [...list, version].sort((a, b) => (a.dateEffet ?? '').localeCompare(b.dateEffet ?? '') || a.saisiLe.localeCompare(b.saisiLe));
}

/** Retire une version (elle reste dans l'historique). */
export function retireVersion(versions: P1Version<unknown>[] | undefined, id: string, motif: string, by: string, now: string): P1Version<unknown>[] | { error: string } {
    const list = versions ?? [];
    const target = list.find(v => v.id === id);
    if (!target) return { error: 'Version introuvable.' };
    if (target.retireLe) return { error: 'Version déjà retirée.' };
    if (!motif?.trim()) return { error: 'Motif du retrait obligatoire.' };
    return list.map(v => (v.id === id ? { ...v, retireLe: now, retirePar: by, motifRetrait: motif.trim() } : v));
}

/** Valeur en vigueur d'un paramètre à une date (null : non renseigné). */
export function valeurAu<T>(params: P1Params | undefined, key: string, date: IsoDate): T | null {
    const v = enVigueur((params?.[key] ?? []) as Version<T>[], date);
    return v ? v.valeur : null;
}

// --- Reste à faire ---

export type ResteAFaire = {
    typeMarche: TypeMarche | null;
    /** Signalements non bloquants (barème sans tranche pour un sens : partage nul ; contrôle M0 contractuel…). */
    alertes: string[];
    /** Le site est suivi (tout sauf PF) et rien ne manque pour calculer. */
    calculable: boolean;
    suivi: boolean;
    manque: string[];
    /** Exigences des lots suivants (barème, formules P1 complètes, prix PFI) : signalées, non bloquantes ici. */
    aVenir: string[];
};

export type ResteInput = {
    site: P1SiteDoc | null;
    meters: { code: string; unit?: string; doc: P1MeterDoc | null }[];
    contract: P1ContractDoc | null;
    /** Formule de révision P1 (chauffage) retenue pour le site à la date, avec ses anomalies de contrôle. */
    formuleChauffage: { nom: string; errors: string[]; warnings: string[] } | null;
    date: IsoDate;
};

/** Barème en vigueur d'un marché : celui du site s'il en a un, sinon celui du contrat. */
export function baremeAu(site: P1SiteDoc | null, contract: P1ContractDoc | null, marche: TypeMarche, date: IsoDate): { tranches: TrancheBareme[]; source: 'site' | 'contrat' } | null {
    const propre = valeurAu<TrancheBareme[]>(site?.params, baremeKey(marche), date);
    if (propre) return { tranches: propre, source: 'site' };
    const commun = valeurAu<TrancheBareme[]>(contract?.params, baremeKey(marche), date);
    return commun ? { tranches: commun, source: 'contrat' } : null;
}

/**
 * Formule de révision d'un site pour un usage à une date : parmi les formules actives du contrat qui ont une
 * version en vigueur, la plus précise (sites, puis énergies, puis tout le contrat).
 */
export function formuleAu(contract: P1ContractDoc | null, siteId: string, energies: Energie[], usage: 'chauffage' | 'ecs', date: IsoDate): { formule: P1Formule; version: FormuleVersion } | null {
    const rang = (f: P1Formule) => f.perimetre.type === 'sites' ? (f.perimetre.siteIds.includes(siteId) ? 3 : 0)
        : f.perimetre.type === 'energies' ? (f.perimetre.energies.some(e => energies.includes(e)) ? 2 : 0) : 1;
    const candidates = Object.values(contract?.formules ?? {})
        .filter(f => !f.retireLe && f.usage === usage && rang(f) > 0)
        .map(f => ({ f, v: enVigueur(f.versions, date) }))
        .filter((x): x is { f: P1Formule; v: Version<FormuleVersion> } => !!x.v)
        .sort((a, b) => rang(b.f) - rang(a.f));
    return candidates[0] ? { formule: candidates[0].f, version: candidates[0].v.valeur } : null;
}

/** Ce qui manque pour que le site soit calculable à une date, selon la grille de son type de marché. */
export function resteAFaire(input: ResteInput): ResteAFaire {
    const { site, meters, contract, date } = input;
    const manque: string[] = [];
    const aVenir: string[] = [];
    const alertes: string[] = [];
    const typeMarche = valeurAu<TypeMarche>(site?.params, 'typeMarche', date);
    if (!typeMarche) return { typeMarche: null, alertes, calculable: false, suivi: true, manque: ['Type de marché'], aVenir };
    const ex = EXIGENCES_MARCHE[typeMarche];
    if (!ex.suivi) return { typeMarche, alertes, calculable: false, suivi: false, manque: [], aVenir };

    if (!valeurAu(site?.params, 'periodeReference', date)) manque.push('Période de référence');
    const regime = valeurAu<RegimeCp>(contract?.params, 'regimeCp', date);
    if (ex.regimeCp) {
        if (!regime) manque.push('Régime du compte de prestation (contrat)');
        else if (regime === 'coefficient' && !valeurAu(contract?.params, 'coefficientGestion', date)) manque.push('Coefficient de gestion (contrat)');
        else if (regime === 'frais_gestion' && valeurAu(contract?.params, 'fraisGestionAnnuels', date) === null) manque.push('Frais de gestion annuels (contrat)');
    }
    if (exigePrixEtFormule(typeMarche, regime)) {
        if (!valeurAu(site?.params, 'prixBase', date)) manque.push('Prix de base chauffage');
        if (!input.formuleChauffage) manque.push('Formule de révision P1 (chauffage) du contrat');
        else if (input.formuleChauffage.errors.length) manque.push(`Formule « ${input.formuleChauffage.nom} » à corriger : ${input.formuleChauffage.errors.join(' ; ')}`);
        if (input.formuleChauffage?.warnings.length) alertes.push(...input.formuleChauffage.warnings.map(w => `Formule « ${input.formuleChauffage!.nom} » : ${w}`));
    }

    // Plan de comptage : nécessaire pour tous les marchés suivis.
    const postes = Object.values(site?.postes ?? {}).filter(p => !p.retireLe);
    const formules = postes.map(p => ({ p, f: valeurAu<TermeNc[]>(p.params, 'formuleNc', date) }));
    if (!formules.some(x => x.f?.length)) manque.push('Poste de consommation avec sa formule de NC');
    const used = new Set(formules.flatMap(x => x.f ?? []).map(t => t.codeCompteur));
    for (const m of meters.filter(m => used.has(m.code))) {
        if (!valeurAu(m.doc?.params, 'qe', date) && (m.unit ?? '').toLowerCase() !== 'mwh') manque.push(`Coefficient QE du compteur ${m.code}`);
        if (valeurAu(m.doc?.params, 'usage', date) === 'ecs' && /m3|m³/i.test(m.unit ?? '') && !valeurAu(m.doc?.params, 'qecs', date)) manque.push(`qECS du compteur ${m.code}`);
    }
    for (const code of used) if (!meters.some(m => m.code === code)) manque.push(`Compteur ${code} de la formule absent du site`);

    if (ex.cible) {
        if (!valeurAu(site?.params, 'stationMeteo', date)) manque.push('Station météo');
        for (const { p, f } of formules.filter(x => x.f?.length)) {
            if (!valeurAu(p.params, 'cibleNb', date)) manque.push(`Cible NB du poste « ${p.designation} »`);
            if (!valeurAu(p.params, 'cibleNbUnite', date)) manque.push(`Unité de la cible du poste « ${p.designation} »`);
            if (!valeurAu(p.params, 'djuReference', date)) manque.push(`DJU de référence du poste « ${p.designation} »`);
        }
    }
    if (ex.bareme) {
        const bareme = baremeAu(site, contract, typeMarche, date);
        if (!bareme) manque.push(`Barème de partage ${typeMarche} (contrat ou site)`);
        else alertes.push(...validateBareme(bareme.tranches).warnings.map(w => `Barème ${typeMarche} : ${w}`));
    }
    if (ex.prixEnergieClient) aVenir.push("Prix de l'énergie du client (PFI)");
    return { typeMarche, alertes, calculable: manque.length === 0, suivi: true, manque: [...new Set(manque)], aVenir };
}
