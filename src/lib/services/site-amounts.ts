import { roundCents, sumCents } from '@/lib/money';

/**
 * Montants facturés d'un site, calculés à partir de ses prestations (source unique).
 *
 * La facturation lit `site.amounts` (montant annuel HT par activité) : dès qu'un site a au moins une prestation
 * pour son contrat, ces montants sont la somme des prestations **en vigueur** (actives, date du jour comprise
 * entre leurs dates de début et de fin) et ne se saisissent plus à la main (`amountsSource: 'services'`).
 * Un site sans prestation garde ses montants saisis (transition).
 *
 * Recalcul : à chaque écriture d'une prestation (écran, import, API) et chaque jour (une prestation qui
 * commence ou se termine change les montants sans écriture).
 */

export type ServiceLike = {
    id?: string;
    siteId: string;
    contractId: string;
    activityId: string;
    price?: number | null;
    startDate?: unknown;
    endDate?: unknown;
    isActive?: boolean;
};

export type SiteAmounts = {
    amounts: { activityId: string; amount: number }[];
    activityIds: string[];
    amountsSource: 'services';
};

/** Jour « AAAA-MM-JJ » (heure de Paris) d'une date : texte de jour, texte ISO, Date ou horodatage Firestore. */
export function toDay(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = value instanceof Date ? value
        : typeof (value as { toDate?: () => Date }).toDate === 'function' ? (value as { toDate: () => Date }).toDate()
        : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
}

export const todayInParis = (now = new Date()) => toDay(now)!;

/** Prestation en vigueur un jour donné (fin incluse ; sans fin : sans limite). */
export function inForce(service: ServiceLike, day: string): boolean {
    if (service.isActive === false) return false;
    const start = toDay(service.startDate);
    const end = toDay(service.endDate);
    return (!start || start <= day) && (!end || day <= end);
}

/** Deux périodes [début, fin] (fin incluse, vide = sans fin) se recouvrent-elles ? */
export function periodsOverlap(a: { startDate?: unknown; endDate?: unknown }, b: { startDate?: unknown; endDate?: unknown }): boolean {
    const [as, ae, bs, be] = [toDay(a.startDate) ?? '0000-01-01', toDay(a.endDate) ?? '9999-12-31', toDay(b.startDate) ?? '0000-01-01', toDay(b.endDate) ?? '9999-12-31'];
    return as <= be && bs <= ae;
}

/**
 * Montants d'un site d'après ses prestations ; `null` si le site n'a jamais été piloté par des prestations et
 * n'en a aucune pour son contrat (montants saisis conservés). Un site déjà piloté par ses prestations et
 * rattaché à un nouveau contrat sans prestation n'a plus de montant : les prestations de l'ancien contrat ne
 * sont pas facturées sur le nouveau.
 */
export function computeSiteAmounts(site: { id: string; contractId?: string; amountsSource?: string }, services: ServiceLike[], day: string): SiteAmounts | null {
    const own = services.filter(s => s.siteId === site.id && !!site.contractId && s.contractId === site.contractId);
    if (own.length === 0 && site.amountsSource !== 'services') return null;
    const byActivity = new Map<string, number[]>();
    for (const s of own.filter(s => inForce(s, day))) {
        if (!byActivity.has(s.activityId)) byActivity.set(s.activityId, []);
        byActivity.get(s.activityId)!.push(roundCents(Number(s.price) || 0));
    }
    const activityIds = [...byActivity.keys()].sort();
    return {
        amounts: activityIds.map(activityId => ({ activityId, amount: sumCents(byActivity.get(activityId)!) })),
        activityIds,
        amountsSource: 'services',
    };
}

/** Les montants calculés diffèrent-ils de ceux du site ? */
export function amountsDiffer(site: { amounts?: { activityId: string; amount: number }[]; activityIds?: string[]; amountsSource?: string }, next: SiteAmounts): boolean {
    const key = (a: { activityId: string; amount: number }[] = []) => [...a].sort((x, y) => x.activityId.localeCompare(y.activityId)).map(x => `${x.activityId}=${x.amount}`).join('|');
    return site.amountsSource !== 'services' || key(site.amounts) !== key(next.amounts) || [...(site.activityIds ?? [])].sort().join('|') !== next.activityIds.join('|');
}
