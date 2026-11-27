/**
 * Date de publication des valeurs d'indices. Les sources ne la donnent pas toujours valeur par valeur :
 * - INSEE : la date de dernière mise à jour de la série (`LAST_UPDATE`) est celle où sa dernière valeur a paru ;
 * - les autres (CEE, PEG) : aucune ; on retient le jour où la synchronisation voit la valeur pour la première fois
 *   (exact à un jour près si la synchronisation passe chaque jour).
 * Une valeur ancienne découverte en même temps qu'une plus récente (première reprise d'historique) n'a pas de date
 * de publication connue. Module sans dépendance serveur.
 */

export type OrigineDate = 'source' | 'detection';
export type Publication = { publicationDate: string; origine: OrigineDate } | null;

const jour = (s?: string | null) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

/**
 * Date de publication d'une valeur nouvelle : seule la plus récente période reçue a une date (celle de la source si elle
 * est connue et pas dans le futur, sinon le jour même) ; les périodes plus anciennes : inconnue.
 */
export function datePublication(period: string, plusRecente: string, publiee: string | null | undefined, aujourdhui: string): Publication {
    if (period !== plusRecente) return null;
    const p = jour(publiee);
    return p && p <= aujourdhui ? { publicationDate: p, origine: 'source' } : { publicationDate: aujourdhui, origine: 'detection' };
}

/** Statut INSEE d'une observation : « DEF » définitive ; autre (« P », « SD »…) : provisoire, susceptible d'être révisée. */
export const estProvisoire = (qualite?: string | null) => !!qualite && qualite.toUpperCase() !== 'DEF';

export const LIBELLE_ORIGINE: Record<OrigineDate, string> = {
    source: 'date de mise à jour donnée par la source',
    detection: 'jour où la synchronisation a vu la valeur pour la première fois',
};
