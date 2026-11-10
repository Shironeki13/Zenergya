import { roundCents, sumCents } from '@/lib/money';
import { partieChauffee, type SaisonChauffe } from '@/lib/p1/saisons';
import { toDay } from '@/lib/services/site-amounts';
import {
    factureAuCompteur, texteCompteur, type CompteurFacture, type IndexPris, type MethodeProrata, type PrixDuMois, type SourceCoefGestion, type UsageCompteur,
} from './p1-compteur';
import type { Index, IndexValue, InvoiceLineItem, RevisionRule, ServiceInitialIndexValue, VatBreakdown } from '@/lib/types';
import {
    revisionAt, revisionConfig, revisionDatesWithin, revisionInForce, revisionText, type RevisionConfig, type RevisionSnapshot,
} from '@/lib/billing/revision';

/**
 * Facturation des contrats : échéancier calculé à partir des prestations (calcul pur, partagé par le serveur, la
 * facturation groupée et la fiche site).
 *
 * - **Éléments facturables** : chaque prestation active d'un site piloté par ses prestations ; pour un site sans
 *   prestation, chaque montant saisi (site × activité), aux conditions du contrat.
 * - **Périodicité** : celle de la prestation, sinon celle du site, sinon l'échéancier du contrat. Les périodes sont
 *   **calées sur le début du contrat** (toutes les prestations d'un contrat tombent sur les mêmes bornes).
 * - **Terme** : à échoir (facturable dès le début de la période) ou échu (facturable le lendemain de sa fin) ;
 *   celui de la prestation, sinon du site, sinon à échoir (signalé).
 * - **Échéances** : de la fin du dernier facturé jusqu'à la date demandée ; une échéance raccourcie (début ou fin
 *   de prestation ou de contrat en cours de période) est proratisée au jour près sur la période pleine.
 * - **Déjà facturé** : lignes des factures (et proformas) non annulées, par prestation et période ; les factures
 *   antérieures (sans détail par ligne) comptent par site et activité jusqu'à leur fin de période.
 * - **TVA par ligne** : celle de la prestation, sinon celle de l'activité ; jamais supposée (facture bloquée).
 * - **Révision** (lib/billing/revision) : coefficient de la révision en vigueur, appliqué à l'échéance (coupée à
 *   chaque date de révision) et imprimé sur la ligne ; un coefficient déjà facturé pour une révision est réutilisé
 *   tel quel (une correction d'indice ultérieure ne change pas ce qui a été facturé).
 */

// --- Jours (« AAAA-MM-JJ », sans fuseau) ---

const parse = (day: string) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => fmt(parse(day) + n * 86_400_000);
/** Ajoute des mois en restant dans le mois visé (31/01 + 1 mois = 28 ou 29/02). */
export function addMonths(day: string, n: number): string {
    const [y, m, d] = day.split('-').map(Number);
    const target = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    return fmt(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last)));
}
/** Nombre de jours de [début, fin], bornes incluses. */
export const daysIn = (start: string, end: string) => Math.round((parse(end) - parse(start)) / 86_400_000) + 1;
export const frDay = (day: string) => day.split('-').reverse().join('/');
const maxDay = (...days: (string | null | undefined)[]) => days.filter(Boolean).sort().pop() as string;
const minDay = (...days: (string | null | undefined)[]) => days.filter(Boolean).sort()[0] as string;
const normText = (s: unknown) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

// --- Périodicité et terme ---

const SCHEDULES: { months: number; label: string; match: RegExp }[] = [
    { months: 1, label: 'Mensuel', match: /mensuel/ },
    { months: 3, label: 'Trimestriel', match: /trimestriel/ },
    { months: 6, label: 'Semestriel', match: /semestriel/ },
    { months: 12, label: 'Annuel', match: /annuel/ },
];

/** Périodicité d'un échéancier (nom du paramétrage) ; null si inconnue (pas d'annuel supposé). */
export function scheduleOf(name: string | undefined | null): { months: number; label: string } | null {
    const found = SCHEDULES.find(s => s.match.test(normText(name)));
    return found ? { months: found.months, label: found.label } : null;
}

export type Terme = 'echoir' | 'echu';
/** Terme d'après son nom (« À échoir », « Terme échu »…) ; null si illisible. */
export function termeOf(name: string | undefined | null): Terme | null {
    const n = normText(name);
    if (/echoir|avance/.test(n)) return 'echoir';
    if (/echu/.test(n)) return 'echu';
    return null;
}
export const TERME_LABEL: Record<Terme, string> = { echoir: 'à échoir', echu: 'à terme échu' };

// --- Données ---

export type BillingContract = {
    id: string; siteIds: string[]; activityIds: string[]; invoicingType?: 'multi-site' | 'global';
    startDate: unknown; endDate: unknown; billingSchedule?: string;
};
export type BillingSite = {
    id: string; name: string; contractId?: string; amounts?: { activityId: string; amount: number }[]; amountsSource?: string;
    billingSchedule?: string; termId?: string;
    revisionP1?: { ruleId?: string; formulaId?: string | null }; revisionP2?: { ruleId?: string; formulaId?: string | null }; revisionP3?: { ruleId?: string; formulaId?: string | null };
};
export type BillingService = {
    id?: string; siteId: string; contractId: string; activityId: string; price?: number | null; startDate?: unknown; endDate?: unknown;
    isActive?: boolean; vatRateId?: string; label?: string; scheduleId?: string; billingTermId?: string;
    revisionRuleId?: string; initialIndexValues?: ServiceInitialIndexValue[]; revisionMonths?: number; revisionAnchor?: string; revisionFromStart?: boolean;
    p1Mode?: 'forfait' | 'acompte' | 'releve' | 'dju';
    p1Type?: string;
    p1PrixSource?: 'p1' | 'prestation';
    coefficientPrix?: number;
    unitPrice?: number;
    meterId?: string;
    /** Au compteur : méthode du prorata d'un mois partiel (défaut : relevé à la date, sinon jours). */
    p1Prorata?: MethodeProrata;
    /** Au compteur : coefficient de gestion (défaut : celui de la prestation s'il est renseigné, sinon aucun). */
    p1CoefGestion?: SourceCoefGestion;
};

/** Relevé d'un compteur (date AAAA-MM-JJ, heure de Paris). */
export type ReleveReading = { id: string; date: string; value: number; type?: string };

/** P1 au compteur : compteurs facturés d'une prestation et leurs relevés, coefficient du contrat, DJU (calculé au serveur). */
export type P1ReleveSource = {
    /**
     * Compteurs facturés d'une prestation pour un mois : son compteur ; sinon, en chauffage, les compteurs signés de la
     * formule de NC des postes du site (à défaut, ceux d'usage vente, sinon entrant), en ECS ceux d'usage ECS ; message si aucun.
     */
    meters: (siteId: string, serviceMeterId: string | undefined, mois: string, usage?: UsageCompteur) => CompteurFacture[] | string;
    /** Coefficient de gestion du contrat (paramétrage P1 daté) au mois ; null si non renseigné. */
    coefContrat?: (mois: string) => number | null;
    /** DJU de la station du site entre deux dates incluses ; message si indisponibles. */
    dju?: (siteId: string, debut: string, fin: string) => number | string;
};

export type UsageP1 = 'chauffage' | 'ecs';

/** Acomptes P1 (calculés au serveur à partir du paramétrage P1 daté) : quantité, répartition, prix révisé du mois. */
export type P1AcompteSource = {
    /** Quantité annuelle du site (MWh en chauffage, m³ en ECS) à une date ; message si non renseignée. */
    quantite: (siteId: string, mois: string, usage: UsageP1) => number | string;
    /** 12 parts mensuelles (%) du contrat pour l'usage, à une date ; message si non renseignée. */
    repartition: (mois: string, usage: UsageP1) => number[] | string;
    /** Prix révisé P1 du site pour l'usage et le mois (€/MWh, €/m³ en ECS) ; message si non calculable. */
    prix: (siteId: string, mois: string, usage: UsageP1) => number | string;
    /** Même prix, détaillé (prix de base, coefficient, indices) pour l'annexe. */
    prixDetail?: (siteId: string, mois: string, usage: UsageP1) => PrixDuMois | string;
    /** Coefficient de révision P1 seul (formule du site), et ses termes. */
    coefficient?: P1DjuSource['coefficient'];
    /** DJU de référence (contractuels) du site : DJU de référence de son poste de consommation. */
    djuReference?: P1DjuSource['djuReference'];
};

/** MTI au DJU : coefficient de révision, DJU contractuels, DJU de la station et saisons de chauffe du site (serveur). */
export type P1DjuSource = {
    /** Coefficient de révision P1 (formule du site, arrondi comme elle) du mois, et ses termes. */
    coefficient: (siteId: string, mois: string) => { coefficient: number; indices: NonNullable<PrixDuMois['indices']> } | string;
    /** DJU de référence (contractuels) du site au jour. */
    djuReference: (siteId: string, jour: string) => number | string;
    /** DJU de la station du site entre deux dates incluses. */
    dju: (siteId: string, debut: string, fin: string) => number | string;
    saisons: (siteId: string) => SaisonChauffe[];
};
export type BillingActivity = { id: string; code: string; label: string; vatRateId?: string };
export type BillingVatRate = { id: string; code: string; rate: number };
export type NamedRef = { id: string; name: string };

export type BillingInput = {
    contract: BillingContract;
    sites: BillingSite[];
    services: BillingService[];
    activities: BillingActivity[];
    vatRates: BillingVatRate[];
    schedules: NamedRef[];
    terms: NamedRef[];
    /** Révision des prix (sans elles : aucune prestation révisable ne peut être facturée). */
    revisionRules?: RevisionRule[];
    indices?: Index[];
    indexValues?: IndexValue[];
    /** Acomptes P1 : sans source, une prestation en acompte ne peut pas être facturée. */
    p1?: P1AcompteSource;
    /** ECS au relevé : sans source, une prestation au relevé ne peut pas être facturée. */
    releves?: P1ReleveSource;
    /** MTI au DJU : sans source, une prestation au DJU ne peut pas être facturée. */
    p1Dju?: P1DjuSource;
};

/** Élément facturable : une prestation, ou un montant saisi d'un site sans prestation. */
export type BillingItem = {
    key: string;
    serviceId?: string;
    site: BillingSite;
    activity: BillingActivity;
    label?: string;
    annual: number;
    from: string;
    to: string;
    months: number;
    scheduleLabel: string;
    terme: Terme;
    vatRateId?: string;
    /** Révision des prix ; absente : prix ferme. */
    revision?: RevisionConfig;
    /** Acompte P1 : montant calculé par mois (paramétrage P1), le prix de la prestation est ignoré. */
    p1Acompte?: boolean;
    /** Usage de l'acompte P1 (prestation P1 de type ECS : ECS ; sinon chauffage). */
    p1Usage?: UsageP1;
    /** P1 au compteur : consommation relevée chaque mois × prix (paramétrage P1 ou prestation révisée) × coefficient de gestion. */
    /** MTI au DJU : P1 annuel de base (montant de la prestation) × C/C0 du mois × DJU chauffés / DJU contractuels. */
    p1Dju?: boolean;
    p1Releve?: {
        meterId?: string; usage: UsageCompteur; prixSource: 'p1' | 'prestation'; unitPrice: number | null;
        coefficient: number | null; coefGestion: SourceCoefGestion; prorata: MethodeProrata;
    };
};

export type Echeance = {
    item: BillingItem;
    /** Période facturée (raccourcie le cas échéant). */
    start: string;
    end: string;
    /** Période pleine de l'échéancier (base du prorata). */
    nominalStart: string;
    nominalEnd: string;
    days: number;
    nominalDays: number;
    /** Date à partir de laquelle l'échéance peut être facturée (terme). */
    billableOn: string;
    amount: number;
};

/** Facture déjà émise (ou proforma) : ce qu'il faut pour savoir ce qui est facturé. */
export type BilledInvoice = {
    status?: string;
    cancelledByCreditNoteId?: string;
    periodEndDate?: unknown;
    lineItems?: Partial<Pick<InvoiceLineItem, 'itemKey' | 'itemKeys' | 'periodEndDate' | 'siteId' | 'activityCode' | 'revision' | 'p1Regul' | 'p1Releve'>>[];
};

// --- Éléments facturables ---

export function billingItems(input: BillingInput): { items: BillingItem[]; errors: string[]; warnings: string[] } {
    const { contract } = input;
    const errors: string[] = [];
    const warnings: string[] = [];
    const contractStart = toDay(contract.startDate);
    const contractEnd = toDay(contract.endDate);
    if (!contractStart || !contractEnd) return { items: [], errors: ['Dates de début et de fin du contrat obligatoires pour facturer.'], warnings };
    const activity = new Map(input.activities.map(a => [a.id, a]));
    const scheduleName = new Map(input.schedules.map(s => [s.id, s.name]));
    const termName = new Map(input.terms.map(t => [t.id, t.name]));
    const items: BillingItem[] = [];

    const periodicity = (where: string, ...names: (string | undefined)[]) => {
        const name = names.find(n => n);
        const s = scheduleOf(name);
        if (!s) errors.push(`${where} : périodicité de facturation ${name ? `« ${name} » inconnue` : 'non renseignée (prestation, site ou contrat)'}.`);
        return s;
    };
    const termeFor = (where: string, ...ids: (string | undefined)[]): Terme => {
        const id = ids.find(i => i);
        const t = id ? termeOf(termName.get(id)) : null;
        if (id && !t) errors.push(`${where} : terme « ${termName.get(id) ?? id} » illisible (à échoir ou échu).`);
        if (!id) warnings.push(`${where} : terme non renseigné, facturé à échoir.`);
        return t ?? 'echoir';
    };

    for (const site of input.sites.filter(s => contract.siteIds.includes(s.id))) {
        const own = input.services.filter(s => s.siteId === site.id && s.contractId === contract.id && s.isActive !== false);
        if (site.amountsSource === 'services' || own.length > 0) {
            for (const s of own) {
                const a = activity.get(s.activityId);
                const acompte = s.p1Mode === 'acompte';
                const releve = s.p1Mode === 'releve';
                const auDju = s.p1Mode === 'dju';
                if (!a || !contract.activityIds.includes(a.id) || (!acompte && !releve && !Number(s.price))) continue;
                if (auDju && s.p1Type && s.p1Type !== 'CHAUFFAGE') { errors.push(`${a.code} sur le site ${site.name} : MTI au DJU pour une prestation P1 chauffage seulement (type ${s.p1Type}).`); continue; }
                if (releve && !['CHAUFFAGE', 'ECS'].includes(s.p1Type ?? '')) { errors.push(`${a.code} sur le site ${site.name} : facturation au compteur pour une prestation P1 de type chauffage ou ECS (type ${s.p1Type || 'non renseigné'}).`); continue; }
                if (acompte && s.p1Type && !['CHAUFFAGE', 'ECS'].includes(s.p1Type)) {
                    errors.push(`${a.code} sur le site ${site.name} : acompte P1 pour le chauffage ou l'ECS seulement (type ${s.p1Type}).`);
                    continue;
                }
                const where = `${a.code} sur le site ${site.name}`;
                const sched = periodicity(where, scheduleName.get(s.scheduleId ?? ''), site.billingSchedule, contract.billingSchedule);
                if (!sched) continue;
                if ((s.p1Mode === 'releve' || auDju) && termeOf(termName.get(s.billingTermId || site.termId || '')) !== 'echu') {
                    errors.push(`${where} : facturation ${auDju ? 'au DJU' : 'au compteur'} à terme échu (${auDju ? 'les DJU' : 'le relevé'} du mois ne sont connus qu'en fin de mois).`); continue;
                }
                // Un acompte P1 (ou un relevé au prix P1) est déjà au prix révisé P1 : pas de révision de la prestation par-dessus.
                const prixP1 = acompte || auDju || (releve && (s.p1PrixSource ?? 'p1') === 'p1');
                const revision = prixP1 ? null : revisionConfig(s, contractStart, input.revisionRules ?? []);
                if (revision && 'error' in revision) { errors.push(`${where} : ${revision.error}.`); continue; }
                items.push({
                    ...(revision && { revision }),
                    ...(acompte && { p1Acompte: true, p1Usage: s.p1Type === 'ECS' ? 'ecs' as const : 'chauffage' as const }),
                    ...(auDju && { p1Dju: true }),
                    ...(releve && {
                        p1Releve: {
                            ...(s.meterId && { meterId: s.meterId }), usage: s.p1Type === 'ECS' ? 'ecs' as const : 'chauffage' as const, prixSource: s.p1PrixSource ?? 'p1',
                            unitPrice: typeof s.unitPrice === 'number' && s.unitPrice > 0 ? s.unitPrice : null,
                            coefficient: typeof s.coefficientPrix === 'number' && s.coefficientPrix > 0 ? s.coefficientPrix : null,
                            coefGestion: s.p1CoefGestion ?? (typeof s.coefficientPrix === 'number' && s.coefficientPrix > 0 ? 'prestation' : 'aucun'),
                            prorata: s.p1Prorata ?? 'releve_jours',
                        },
                    }),
                    key: `svc:${s.id}`, serviceId: s.id, site, activity: a, label: s.label, annual: Number(s.price),
                    from: maxDay(contractStart, toDay(s.startDate)), to: minDay(contractEnd, toDay(s.endDate)),
                    months: sched.months, scheduleLabel: sched.label, terme: termeFor(where, s.billingTermId, site.termId),
                    vatRateId: s.vatRateId || a.vatRateId,
                });
            }
        } else {
            for (const amount of site.amounts ?? []) {
                const a = activity.get(amount.activityId);
                if (!a || !contract.activityIds.includes(a.id) || !amount.amount) continue;
                const where = `${a.code} sur le site ${site.name}`;
                const sched = periodicity(where, site.billingSchedule, contract.billingSchedule);
                if (!sched) continue;
                const legacy = [site.revisionP1, site.revisionP2, site.revisionP3].some(r => r?.ruleId || r?.formulaId);
                if (legacy) warnings.push(`Site ${site.name} : révision portée par le site, non appliquée (la révision se règle sur les prestations).`);
                items.push({
                    key: `site:${site.id}:${a.id}`, site, activity: a, annual: amount.amount, from: contractStart, to: contractEnd,
                    months: sched.months, scheduleLabel: sched.label, terme: termeFor(where, site.termId), vatRateId: a.vatRateId,
                });
            }
        }
    }
    return { items, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

// --- Déjà facturé ---

/** Dernier jour facturé de chaque élément (null : rien de facturé). */
export function billedUntil(items: BillingItem[], invoices: BilledInvoice[]): Map<string, string | null> {
    const result = new Map<string, string | null>(items.map(i => [i.key, null]));
    const bump = (key: string, day: string | null) => {
        if (day && result.has(key) && (!result.get(key) || day > result.get(key)!)) result.set(key, day);
    };
    for (const inv of invoices) {
        if (inv.status === 'cancelled' || inv.cancelledByCreditNoteId) continue;
        const invoiceEnd = toDay(inv.periodEndDate);
        for (const line of inv.lineItems ?? []) {
            const keys = lineItemKeys(line);
            if (keys.length) { for (const key of keys) bump(key, toDay(line.periodEndDate)); continue; }
            // Régularisation P1 : les mois régularisés comptent comme facturés pour les acomptes du site ; un intéressement, pour rien.
            if (line.p1Regul) {
                if ('mois' in line.p1Regul && line.p1Regul.mois.length) {
                    const last = line.p1Regul.mois[line.p1Regul.mois.length - 1];
                    const end = new Date(Date.UTC(+last.slice(0, 4), +last.slice(5, 7), 0)).toISOString().slice(0, 10);
                    for (const item of items) if (item.p1Acompte && item.site.id === line.p1Regul.siteId) bump(item.key, end);
                }
                continue;
            }
            // Facture antérieure à l'échéancier : par site et activité (ou activité seule en facturation globale).
            for (const item of items) {
                if (line.activityCode === item.activity.code && (!line.siteId || line.siteId === item.site.id)) bump(item.key, invoiceEnd);
            }
        }
    }
    return result;
}

// --- Échéancier ---

/** Période pleine (calée sur le début du contrat) qui contient un jour. */
export function nominalPeriod(contractStart: string, months: number, day: string): { start: string; end: string } {
    let k = Math.max(0, Math.floor(((parse(day) - parse(contractStart)) / 86_400_000) / (months * 31)) - 1);
    while (addMonths(contractStart, (k + 1) * months) <= day) k++;
    const start = addMonths(contractStart, k * months);
    return { start, end: addDays(addMonths(contractStart, (k + 1) * months), -1) };
}

/** Échéances d'un élément, du lendemain du dernier facturé jusqu'à `until` (date de facturation possible). */
export function echeancesOf(item: BillingItem, contractStart: string, last: string | null, until: string, max = 400): Echeance[] {
    const out: Echeance[] = [];
    let cursor = last ? maxDay(addDays(last, 1), item.from) : item.from;
    // Au compteur : périodes calées sur les mois civils (la consommation se relève par mois), dès le mois du début du contrat.
    const anchor = item.p1Releve || item.p1Dju ? `${contractStart.slice(0, 7)}-01` : contractStart;
    while (cursor <= item.to && out.length < max) {
        const nominal = nominalPeriod(anchor, item.months, cursor);
        const end = minDay(nominal.end, item.to);
        const billableOn = item.terme === 'echoir' ? cursor : addDays(end, 1);
        if (billableOn > until) break;
        const days = daysIn(cursor, end);
        const nominalDays = daysIn(nominal.start, nominal.end);
        out.push({
            item, start: cursor, end, nominalStart: nominal.start, nominalEnd: nominal.end, days, nominalDays, billableOn,
            amount: roundCents(item.annual * (item.months / 12) * (days / nominalDays)),
        });
        cursor = addDays(end, 1);
    }
    return out;
}

export type DueResult = { echeances: Echeance[]; lines: InvoiceLineItem[]; errors: string[]; warnings: string[] };

/** Échéances facturables d'un contrat à la date `until`, et lignes de facture correspondantes. */
export function dueInvoiceLines(input: BillingInput, invoices: BilledInvoice[], until: string): DueResult {
    const { items, errors, warnings } = billingItems(input);
    const contractStart = toDay(input.contract.startDate)!;
    if (errors.length) return { echeances: [], lines: [], errors, warnings };
    const billed = billedUntil(items, invoices);
    const echeances = items.flatMap(item => echeancesOf(item, contractStart, billed.get(item.key) ?? null, until))
        .filter(e => e.amount !== 0 || e.item.p1Acompte || e.item.p1Releve || e.item.p1Dju)
        .sort((a, b) => a.start.localeCompare(b.start) || a.item.site.name.localeCompare(b.item.site.name) || a.item.activity.code.localeCompare(b.item.activity.code));

    // Révisions déjà facturées : réutilisées telles quelles (même coefficient pour une même révision).
    const frozen = new Map<string, RevisionSnapshot>();
    for (const inv of invoices) {
        if (inv.status === 'cancelled' || inv.cancelledByCreditNoteId) continue;
        for (const line of inv.lineItems ?? []) if (line.revision) for (const key of lineItemKeys(line)) frozen.set(`${key}|${line.revision.date}`, line.revision);
    }
    const vat = new Map(input.vatRates.map(v => [v.id, v]));
    const lineErrors: string[] = [];
    const rateOf = (e: Echeance) => {
        const v = e.item.vatRateId ? vat.get(e.item.vatRateId) : undefined;
        if (!v) lineErrors.push(`TVA non renseignée : ${e.item.activity.code} sur le site ${e.item.site.name} (à définir sur la prestation ou sur l'activité, dans le paramétrage).`);
        return v?.rate;
    };

    // Morceaux facturés : l'échéance, coupée à chaque date de révision, au coefficient de la révision en vigueur.
    type Piece = { e: Echeance; start: string; end: string; days: number; base: number; amount: number; revision?: RevisionSnapshot; p1?: P1Mois[]; releve?: NonNullable<InvoiceLineItem['p1Releve']>; dju?: NonNullable<InvoiceLineItem['p1Dju']> };
    const pieces: Piece[] = [];
    const lastIndex = dernierIndexFacture(invoices);
    for (const e of echeances) {
        if (e.item.p1Releve) {
            const r = releveCompteur(e, input, lastIndex, frozen);
            if (typeof r === 'string') { lineErrors.push(`${e.item.p1Releve.usage === 'ecs' ? 'ECS' : 'Chauffage'} au compteur impossible : site ${e.item.site.name}, ${r}.`); continue; }
            for (const c of r.detail.compteurs) lastIndex.set(`${e.item.key}|${c.meterId}`, c.fin);   // échéances suivantes du même appel
            pieces.push({ e, start: e.start, end: e.end, days: e.days, base: r.detail.montant, amount: r.detail.montant, releve: r.detail, ...(r.revision && { revision: r.revision }) });
            continue;
        }
        if (e.item.p1Dju) {
            const r = mtiAuDju(e, input.p1Dju);
            if (typeof r === 'string') { lineErrors.push(`MTI au DJU impossible : site ${e.item.site.name}, ${r}.`); continue; }
            pieces.push({ e, start: e.start, end: e.end, days: e.days, base: r.montant, amount: r.montant, dju: r });
            continue;
        }
        if (e.item.p1Acompte) {
            const r = acompteP1(e, input.p1);
            if (typeof r === 'string') { lineErrors.push(`Acompte P1 impossible : site ${e.item.site.name}, ${r}.`); continue; }
            pieces.push({ e, start: e.start, end: e.end, days: e.days, base: r.total, amount: r.total, p1: r.mois });
            continue;
        }
        const config = e.item.revision;
        const cuts = config ? revisionDatesWithin(config, e.start, e.end) : [];
        const bounds = [e.start, ...cuts];
        bounds.forEach((start, k) => {
            const end = k + 1 < bounds.length ? addDays(bounds[k + 1], -1) : e.end;
            const days = daysIn(start, end);
            const exact = e.item.annual * (e.item.months / 12) * (days / e.nominalDays);
            let revision: RevisionSnapshot | undefined;
            const date = config ? revisionInForce(config, start) : null;
            if (config && date) {
                const known = frozen.get(`${e.item.key}|${date}`);
                const computed = known ?? revisionAt(config, date, input.indices ?? [], input.indexValues ?? []);
                if ('error' in computed) {
                    lineErrors.push(`Révision impossible : ${e.item.activity.code} sur le site ${e.item.site.name}, ${computed.error}.`);
                    return;
                }
                revision = computed;
            }
            pieces.push({ e, start, end, days, base: roundCents(exact), amount: roundCents(exact * (revision?.coefficient ?? 1)), ...(revision && { revision }) });
        });
    }

    const prorata = (p: { days: number; e: Echeance; p1?: P1Mois[]; releve?: unknown; dju?: unknown }) => (p.days < p.e.nominalDays && !p.p1 && !p.releve && !p.dju ? ` — prorata ${p.days}/${p.e.nominalDays} j` : '');
    const djuText = (p: Piece) => (p.dju ? ` — ${p.dju.mois.map(m => `${m.mois.slice(5)}/${m.mois.slice(0, 4)} : ${eurFr(p.dju!.base)} × ${m.coefficient.toLocaleString('fr-FR', { maximumFractionDigits: 6 })} / ${p.dju!.djuReference.toLocaleString('fr-FR')} × ${m.dju.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} DJU (${frDay(m.debut)} → ${frDay(m.fin)}) = ${eurFr(m.montant)}`).join(' | ')}` : '');
    const releveText = (p: Piece) => (p.releve?.detail ? ` — ${texteCompteur(p.releve as never)}` : '');
    const p1Text = (p: Piece) => {
        if (!p.p1) return '';
        const q = p.p1.reduce((a, m) => a + m.quantite, 0);
        const ecs = p.e.item.p1Usage === 'ecs';
        const unite = ecs ? 'm³' : 'MWh';
        return ` — acompte${ecs ? ' ECS' : ''} sur ${q.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${unite} estimés au prix révisé P1 `
            + `(${p.p1.map(m => `${m.mois} : ${m.prix.toLocaleString('fr-FR', { maximumFractionDigits: 4 })} €/${unite}`).join(', ')})`;
    };
    const period = (p: Piece) => `du ${frDay(p.start)} au ${frDay(p.end)}`;
    const revised = (p: Piece) => (p.revision ? ` — ${revisionText(p.revision)}` : '');
    const lines: InvoiceLineItem[] = [];

    if (input.contract.invoicingType === 'global') {
        // Une ligne par activité, taux, période et révision ; le détail par élément reste dans `itemKeys` (suivi du facturé).
        const groups = new Map<string, { p: Piece; rate: number; amounts: number[]; bases: number[]; keys: string[] }>();
        for (const p of pieces) {
            const rate = rateOf(p.e);
            if (rate === undefined) continue;
            if (p.p1 || p.releve || p.dju) { lineErrors.push(`${p.p1 ? 'Acompte P1' : p.dju ? 'MTI au DJU' : 'P1 au compteur'} : facturation globale non prise en charge (site ${p.e.item.site.name}) ; passez le contrat en multi-site.`); continue; }
            const key = `${p.e.item.activity.id}|${rate}|${p.start}|${p.end}|${p.revision ? `${p.revision.rule}@${p.revision.date}=${p.revision.coefficient}` : ''}`;
            if (!groups.has(key)) groups.set(key, { p, rate, amounts: [], bases: [], keys: [] });
            const g = groups.get(key)!;
            g.amounts.push(p.amount);
            g.bases.push(p.base);
            g.keys.push(p.e.item.key);
        }
        for (const g of groups.values()) {
            const total = sumCents(g.amounts);
            lines.push({
                description: `${g.p.e.item.activity.label} (${g.p.e.item.scheduleLabel}, ${TERME_LABEL[g.p.e.item.terme]}) — ${period(g.p)}${prorata(g.p)}${revised(g.p)}`,
                quantity: 1, unitPrice: total, total, activityCode: g.p.e.item.activity.code, vatRate: g.rate,
                periodStartDate: g.p.start, periodEndDate: g.p.end, itemKeys: g.keys,
                ...(g.p.revision && { baseAmount: sumCents(g.bases), revision: g.p.revision }),
            });
        }
    } else {
        for (const p of pieces) {
            const rate = rateOf(p.e);
            if (rate === undefined) continue;
            const item = p.e.item;
            lines.push({
                description: `${p.p1 ? 'Acompte ' : p.releve ? `P1 au compteur (${p.releve.usage === 'ecs' ? 'ECS' : 'chauffage'}) — ` : p.dju ? 'P1 MTI au DJU — ' : ''}${item.activity.label}${item.label ? ` — ${item.label}` : ''} (${item.scheduleLabel}, ${TERME_LABEL[item.terme]}) — Site : ${item.site.name} — ${period(p)}${prorata(p)}${p1Text(p)}${releveText(p)}${djuText(p)}${revised(p)}`,
                quantity: 1, unitPrice: p.amount, total: p.amount, siteId: item.site.id, activityCode: item.activity.code, vatRate: rate,
                itemKey: item.key, ...(item.serviceId && { serviceId: item.serviceId }), periodStartDate: p.start, periodEndDate: p.end,
                ...(p.revision && { baseAmount: p.base, revision: p.revision }),
                ...(p.p1 && { p1Acompte: { siteId: item.site.id, usage: item.p1Usage ?? 'chauffage', mois: p.p1 } }),
                ...(p.releve && { p1Releve: p.releve }),
                ...(p.dju && { p1Dju: p.dju }),
            });
        }
    }
    return { echeances, lines: lines.filter(l => l.total !== 0), errors: [...new Set(lineErrors)], warnings };
}

export type P1Mois = { mois: string; quantite: number; prix: number; montant: number };

type IndexFacture = IndexPris;

/**
 * Dernier relevé facturé de chaque compteur, par élément facturé (`clé|compteur`) : un même compteur peut servir à
 * deux prestations (ECS facturée, et déduite de la formule de NC du chauffage).
 */
export function dernierIndexFacture(invoices: BilledInvoice[]): Map<string, IndexFacture> {
    const out = new Map<string, IndexFacture>();
    for (const inv of invoices) {
        if (inv.status === 'cancelled' || inv.cancelledByCreditNoteId) continue;
        for (const l of inv.lineItems ?? []) for (const c of l.p1Releve?.compteurs ?? []) {
            for (const key of lineItemKeys(l)) {
                const k = `${key}|${c.meterId}`;
                const cur = out.get(k);
                if (!cur || c.fin.date > cur.date) out.set(k, { readingId: c.fin.readingId, date: c.fin.date, index: c.fin.index });
            }
        }
    }
    return out;
}

/**
 * P1 au compteur d'une échéance (mensuelle, trimestrielle…), chauffage ou ECS : voir `p1-compteur.ts`. Prix du mois :
 * paramétrage P1 (prix de base × formule de révision P1) ou prix unitaire de la prestation × sa révision ; coefficient de
 * gestion de la prestation, du contrat (daté) ou aucun.
 */
function releveCompteur(e: Echeance, input: BillingInput, lastIndex: Map<string, IndexFacture>, frozen: Map<string, RevisionSnapshot>):
    { detail: NonNullable<InvoiceLineItem['p1Releve']>; revision?: RevisionSnapshot } | string {
    const cfg = e.item.p1Releve!;
    const src = input.releves;
    if (!src) return 'relevés indisponibles pour ce calcul';
    let revision: RevisionSnapshot | undefined;
    const prix = (mois: string): PrixDuMois | string => {
        if (cfg.prixSource === 'p1') {
            if (!input.p1) return 'paramétrage P1 indisponible';
            const d = input.p1.prixDetail?.(e.item.site.id, mois, cfg.usage);
            if (d) return d;
            const p = input.p1.prix(e.item.site.id, mois, cfg.usage);
            return typeof p === 'string' ? p : { prix: p, base: null, coefficient: null, source: 'p1' };
        }
        if (cfg.unitPrice === null) return `prix unitaire de la prestation (€/${cfg.usage === 'ecs' ? 'm³' : 'MWh'}) non renseigné`;
        const config = e.item.revision;
        const date = config ? revisionInForce(config, `${mois}-01`) : null;
        if (!config || !date) return { prix: cfg.unitPrice, base: cfg.unitPrice, coefficient: 1, source: 'prestation' };
        const r = frozen.get(`${e.item.key}|${date}`) ?? revisionAt(config, date, input.indices ?? [], input.indexValues ?? []);
        if ('error' in r) return r.error;
        revision = r;
        return {
            prix: Math.round(cfg.unitPrice * r.coefficient * 1e6) / 1e6, base: cfg.unitPrice, coefficient: r.coefficient, source: 'prestation',
            indices: r.indices.map(i => ({ terme: i.code, indice: i.code, ponderation: null, valeur: i.value, base: i.base, ratio: i.base ? i.value / i.base : null, periode: i.periods.join(', ') })),
        };
    };
    const coefGestion = (mois: string): number | null | string => {
        if (cfg.coefGestion === 'aucun') return null;
        if (cfg.coefGestion === 'prestation') return cfg.coefficient ?? 'coefficient de gestion de la prestation non renseigné';
        return src.coefContrat?.(mois) ?? `coefficient de gestion du contrat non renseigné en ${mois.slice(5, 7)}/${mois.slice(0, 4)} (paramétrage P1 du contrat)`;
    };
    const r = factureAuCompteur({
        siteId: e.item.site.id, usage: cfg.usage, debut: e.start, fin: e.end, methode: cfg.prorata,
        compteurs: mois => src.meters(e.item.site.id, cfg.meterId, mois, cfg.usage),
        prix, coefGestion,
        ...(src.dju && { dju: (d: string, f: string) => src.dju!(e.item.site.id, d, f) }),
        dejaFacture: new Map([...lastIndex].filter(([k]) => k.startsWith(`${e.item.key}|`)).map(([k, v]) => [k.slice(e.item.key.length + 1), v])),
    });
    if (typeof r === 'string') return r;
    const compteurs = r.detail.flatMap(m => m.compteurs.map(c => ({ meterId: c.meterId, code: c.code, debut: c.debut, fin: c.fin, volume: c.volume })));
    return {
        detail: {
            siteId: r.siteId, mois: r.detail[0]?.mois ?? e.start.slice(0, 7), volume: r.quantite,
            prix: r.quantite ? Math.round((r.montant / r.quantite) * 1e4) / 1e4 : 0, montant: r.montant, compteurs,
            usage: r.usage, unite: r.unite, detail: r.detail,
        },
        ...(revision && { revision }),
    };
}

const eurFr = (x: number) => `${x.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/**
 * MTI au DJU d'une échéance : pour chaque mois, partie chauffée (bornée par l'allumage et l'arrêt de la saison du site),
 * DJU de cette partie (arrondis au centième), montant = arrondi(P1 annuel × C/C0 du mois / DJU contractuels × DJU, 2).
 * Mois hors saison : rien.
 */
export function mtiAuDju(e: Echeance, src: P1DjuSource | undefined): NonNullable<InvoiceLineItem['p1Dju']> | string {
    if (!src) return 'paramétrage P1 indisponible pour ce calcul';
    const siteId = e.item.site.id;
    const base = e.item.annual;
    const djuReference = src.djuReference(siteId, e.start);
    if (typeof djuReference === 'string') return djuReference;
    const saisons = src.saisons(siteId);
    const mois: NonNullable<InvoiceLineItem['p1Dju']>['mois'] = [];
    let cursor = e.start;
    while (cursor <= e.end) {
        const m = cursor.slice(0, 7);
        const finMois = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
        const fin = finMois < e.end ? finMois : e.end;
        const partie = partieChauffee(saisons, cursor, fin);
        if (typeof partie === 'string') return partie;
        if (partie) {
            const d = src.dju(siteId, partie.debut, partie.fin);
            if (typeof d === 'string') return d;
            const c = src.coefficient(siteId, m);
            if (typeof c === 'string') return `C/C0 ${m.slice(5)}/${m.slice(0, 4)} : ${c}`;
            const dju = Math.round(d * 100) / 100;
            const revise = base * c.coefficient;
            mois.push({ mois: m, debut: partie.debut, fin: partie.fin, dju, coefficient: c.coefficient, revise, montant: roundCents((revise / djuReference) * dju), indices: c.indices });
        }
        cursor = addDays(fin, 1);
    }
    return { siteId, base, djuReference, mois, montant: sumCents(mois.map(x => x.montant)) };
}

/**
 * Acompte P1 d'une échéance : pour chaque mois couvert (au prorata des jours du mois), quantité annuelle × part du
 * mois × prix révisé P1 du mois. Montant arrondi au centime par mois.
 */
export function acompteP1(e: Echeance, p1: P1AcompteSource | undefined): { total: number; mois: P1Mois[] } | string {
    if (!p1) return 'paramétrage P1 indisponible pour ce calcul';
    const mois: P1Mois[] = [];
    let cursor = e.start;
    while (cursor <= e.end) {
        const m = cursor.slice(0, 7);
        const [y, mo] = m.split('-').map(Number);
        const monthEnd = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
        const end = monthEnd < e.end ? monthEnd : e.end;
        const share = daysIn(cursor, end) / daysIn(`${m}-01`, monthEnd);
        const usage = e.item.p1Usage ?? 'chauffage';
        const quantiteAn = p1.quantite(e.item.site.id, m, usage);
        if (typeof quantiteAn === 'string') return quantiteAn;
        const repartition = p1.repartition(m, usage);
        if (typeof repartition === 'string') return repartition;
        const prix = p1.prix(e.item.site.id, m, usage);
        if (typeof prix === 'string') return `prix ${m} : ${prix}`;
        const quantite = quantiteAn * (repartition[mo - 1] / 100) * share;
        mois.push({ mois: m, quantite: Math.round(quantite * 1e6) / 1e6, prix, montant: roundCents(quantite * prix) });
        cursor = addDays(end, 1);
    }
    return { total: sumCents(mois.map(m => m.montant)), mois };
}

/** Lignes facturées par un élément (y compris en facturation globale, via `itemKeys`). */
export function lineItemKeys(line: Pick<InvoiceLineItem, 'itemKey' | 'itemKeys'>): string[] {
    return line.itemKey ? [line.itemKey] : line.itemKeys ?? [];
}

// --- Totaux par taux ---

export function vatTotals(lines: InvoiceLineItem[]): { subtotal: number; tax: number; total: number; vatBreakdown: VatBreakdown; taxRate?: number } {
    const byRate = new Map<number, number[]>();
    for (const l of lines) {
        const rate = l.vatRate ?? 0;
        if (!byRate.has(rate)) byRate.set(rate, []);
        byRate.get(rate)!.push(l.total);
    }
    const vatBreakdown: VatBreakdown = [...byRate.entries()].sort(([a], [b]) => b - a).map(([rate, totals]) => {
        const base = sumCents(totals);
        return { rate, base, amount: roundCents(base * rate / 100) };
    });
    const subtotal = sumCents(vatBreakdown.map(v => v.base));
    const tax = sumCents(vatBreakdown.map(v => v.amount));
    return { subtotal, tax, total: sumCents([subtotal, tax]), vatBreakdown, ...(vatBreakdown.length === 1 && { taxRate: vatBreakdown[0].rate / 100 }) };
}

// --- Échéance de paiement ---

export type PaymentTermLike = { code?: string; deadline?: string; days?: number | null; endOfMonth?: boolean | null };

/** Délai d'une condition de paiement : champs structurés, sinon lus dans le libellé (« 45 jours fin de mois »). */
export function paymentTermRule(term: PaymentTermLike): { days: number; endOfMonth: boolean } | null {
    if (typeof term.days === 'number' && term.days >= 0) return { days: term.days, endOfMonth: !!term.endOfMonth };
    const text = normText(`${term.deadline ?? ''} ${term.code ?? ''}`);
    if (/reception|comptant|immediat/.test(text)) return { days: 0, endOfMonth: false };
    const m = /(\d+)\s*(j|jours?)\b/.exec(text);
    return m ? { days: Number(m[1]), endOfMonth: /fin de mois|fdm/.test(text) } : null;
}

/** Délai légal par défaut (sans condition convenue) : 30 jours après la date de facture. */
export const DEFAULT_PAYMENT_DAYS = 30;

/**
 * Date d'échéance : date de facture + délai ; « fin de mois » : fin du mois atteint après le délai.
 * Sans condition de paiement : 30 jours. Une condition illisible bloque (pas d'échéance supposée).
 */
export function dueDateFor(invoiceDay: string, term?: PaymentTermLike | null): string {
    if (!term) return addDays(invoiceDay, DEFAULT_PAYMENT_DAYS);
    const rule = paymentTermRule(term);
    if (!rule) throw new Error(`Condition de paiement « ${term.code ?? term.deadline ?? ''} » illisible : renseignez son délai en jours (paramétrage).`);
    const due = addDays(invoiceDay, rule.days);
    if (!rule.endOfMonth) return due;
    const [y, m] = due.split('-').map(Number);
    return fmt(Date.UTC(y, m, 0));
}
