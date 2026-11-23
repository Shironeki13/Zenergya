/**
 * Changement de compteur porté par un relevé (logique pure).
 *
 * Le jour du changement, le relevé porte l'index de **dépose** de l'ancien compteur et l'index de **pose** du nouveau ;
 * son index est celui du nouveau compteur à cette date. Consommation entre le relevé précédent P et ce relevé C :
 * (dépose − P) + (C − pose), soit C − P + (dépose − pose). Les deux index sont saisis, jamais supposés.
 * Entre deux relevés quelconques, chaque changement situé après le premier et jusqu'au second ajoute (dépose − pose).
 */

export type ChangementCompteur = { depose: number; pose: number };

const nombre = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** Changement lu d'un relevé enregistré (null : relevé ordinaire, ou donnée incomplète). */
export function lireChangement(x: unknown): ChangementCompteur | null {
    if (!x || typeof x !== 'object') return null;
    const depose = nombre((x as ChangementCompteur).depose), pose = nombre((x as ChangementCompteur).pose);
    return depose === null || pose === null ? null : { depose, pose };
}

/** Contrôle d'un changement saisi avec l'index du relevé ; message d'erreur ou null. */
export function controleChangement(c: { depose?: unknown; pose?: unknown } | null | undefined, index: number): string | null {
    if (!c) return null;
    const depose = nombre(c.depose), pose = nombre(c.pose);
    if (depose === null || depose < 0) return 'Changement de compteur : index de dépose de l\'ancien compteur obligatoire (nombre positif ou nul).';
    if (pose === null || pose < 0) return 'Changement de compteur : index de pose du nouveau compteur obligatoire (nombre positif ou nul).';
    if (index < pose) return 'Changement de compteur : l\'index relevé (nouveau compteur) ne peut pas être inférieur à son index de pose.';
    return null;
}

type AvecChangement = { date: string; changement?: ChangementCompteur | null };

/** Changements situés après une date et jusqu'à une autre incluse (jours AAAA-MM-JJ), du plus ancien au plus récent. */
export function changementsEntre<T extends AvecChangement>(releves: T[], apres: string, jusqua: string): (T & { changement: ChangementCompteur })[] {
    return releves.filter((r): r is T & { changement: ChangementCompteur } => !!r.changement && r.date.slice(0, 10) > apres.slice(0, 10) && r.date.slice(0, 10) <= jusqua.slice(0, 10))
        .sort((a, b) => a.date.localeCompare(b.date));
}

/** Ce que les changements de compteur ajoutent à « index de fin − index de début » : Σ (dépose − pose). */
export const correctionChangements = (releves: AvecChangement[], apres: string, jusqua: string): number =>
    changementsEntre(releves, apres, jusqua).reduce((s, r) => s + r.changement.depose - r.changement.pose, 0);
