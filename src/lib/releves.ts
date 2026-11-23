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

/**
 * Plusieurs relevés d'un compteur le même jour, à des index différents : lequel compte ?
 *
 * Un index de compteur est une série croissante et régulière : **l'index retenu est le plus proche du relevé
 * précédent** (retenu) ; en tête de série, du premier index qui suit ; sans voisin, le plus grand. Un relevé qui
 * porte un changement de compteur l'emporte sur les autres du même jour (lui seul porte les index de dépose et de
 * pose). C'est une règle de vraisemblance : elle choisit pour pouvoir calculer, elle ne corrige rien, et elle le dit.
 * Des relevés du même jour au même index ne sont pas une anomalie : le premier est gardé, sans signalement.
 */
export type ReleveDuJour = { id: string; date: string; value: number; changement?: ChangementCompteur | null };
export type Doublon = { date: string; retenu: number; ecartes: number[]; motif: string };

export function resoudreDoublons<T extends ReleveDuJour>(releves: T[]): { retenus: T[]; doublons: Doublon[] } {
    const parJour = new Map<string, T[]>();
    for (const r of [...releves].sort((a, b) => a.date.slice(0, 10).localeCompare(b.date.slice(0, 10)))) {
        const jour = r.date.slice(0, 10);
        if (!parJour.has(jour)) parJour.set(jour, []);
        parJour.get(jour)!.push(r);
    }
    const jours = [...parJour.keys()];
    const retenus: T[] = [];
    const doublons: Doublon[] = [];
    const n = (x: number) => x.toLocaleString('fr-FR', { maximumFractionDigits: 3 });
    let precedent: number | null = null;
    jours.forEach((jour, i) => {
        const groupe = parJour.get(jour)!;
        const distincts = new Set(groupe.map(r => r.value));
        const changements = groupe.filter(r => r.changement);
        let choisi = changements.length === 1 ? changements[0] : groupe[0];
        if (distincts.size > 1) {
            const candidats = changements.length === 1 ? changements : groupe;
            let reference = precedent;
            let motif: string;
            if (changements.length === 1) motif = 'il porte le changement de compteur';
            else {
                // En tête de série : la référence est le premier index qui suit.
                if (reference === null) { const suivant = jours.slice(i + 1).map(j => parJour.get(j)!)[0]; if (suivant) reference = Math.max(...suivant.map(r => r.value)); }
                if (reference === null) { choisi = candidats.reduce((a, b) => (b.value > a.value ? b : a)); motif = 'le plus grand, un index de compteur ne décroît pas'; }
                else { const ref = reference; choisi = candidats.reduce((a, b) => (Math.abs(b.value - ref) < Math.abs(a.value - ref) ? b : a)); motif = `le plus proche du relevé ${precedent === null ? 'suivant' : 'précédent'} (${n(ref)})`; }
            }
            doublons.push({ date: jour, retenu: choisi.value, ecartes: groupe.filter(r => r !== choisi && r.value !== choisi.value).map(r => r.value), motif });
        }
        retenus.push(choisi);
        precedent = choisi.value;
    });
    return { retenus, doublons };
}

/** « Deux relevés le 31/10/2025 : 1 040 et 0. L'index 1 040 est retenu, le plus proche du relevé précédent (1 000). » */
export function texteDoublon(d: Doublon, unite = ''): string {
    const n = (x: number) => x.toLocaleString('fr-FR', { maximumFractionDigits: 3 });
    const u = unite ? ` ${unite}` : '';
    const tous = [d.retenu, ...d.ecartes];
    return `${tous.length === 2 ? 'Deux' : tous.length} relevés le ${d.date.split('-').reverse().join('/')} : ${tous.map(n).join(' et ')}${u}. L'index ${n(d.retenu)} est retenu, ${d.motif}.`;
}
