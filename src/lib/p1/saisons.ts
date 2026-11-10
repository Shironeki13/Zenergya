/**
 * Saisons de chauffe d'un site : dates d'allumage et d'arrêt, par saison (juillet → juin). Elles bornent les DJU
 * facturés en MTI (première facture de la saison à l'allumage, dernière à l'arrêt), le décompte et l'intéressement.
 */

export type SaisonChauffe = {
    id: string;
    siteId: string;
    /** « 2025-2026 » : de juillet 2025 à juin 2026. */
    saison: string;
    allumage: string;
    /** Vide tant que l'arrêt n'est pas connu. */
    arret: string | null;
    saisiPar?: string;
    saisiLe?: string;
};

/** Saison (juillet → juin) qui contient un jour AAAA-MM-JJ. */
export function saisonDe(jour: string): string {
    const y = Number(jour.slice(0, 4)), m = Number(jour.slice(5, 7));
    return m >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}
export const debutSaison = (saison: string) => `${saison.slice(0, 4)}-07-01`;
export const finSaison = (saison: string) => `${saison.slice(5, 9)}-06-30`;
export const idSaison = (siteId: string, saison: string) => `${siteId}_${saison}`;

/** Contrôle d'une saison saisie ; message d'erreur ou null. */
export function controleSaison(s: Pick<SaisonChauffe, 'saison' | 'allumage' | 'arret'>): string | null {
    if (!/^\d{4}-\d{4}$/.test(s.saison) || Number(s.saison.slice(5)) !== Number(s.saison.slice(0, 4)) + 1) return 'Saison : AAAA-AAAA (ex. 2025-2026).';
    const jour = /^\d{4}-\d{2}-\d{2}$/;
    if (!jour.test(s.allumage)) return 'Date d\'allumage invalide.';
    if (s.arret !== null && !jour.test(s.arret)) return 'Date d\'arrêt invalide.';
    if (saisonDe(s.allumage) !== s.saison) return `L'allumage du ${s.allumage.split('-').reverse().join('/')} n'est pas dans la saison ${s.saison} (juillet à juin).`;
    if (s.arret !== null && s.arret < s.allumage) return 'L\'arrêt précède l\'allumage.';
    if (s.arret !== null && s.arret > finSaison(s.saison)) return `L'arrêt dépasse la fin de la saison (${finSaison(s.saison).split('-').reverse().join('/')}).`;
    return null;
}

/**
 * Partie chauffée d'une période (incluse dans un mois) : bornée par l'allumage et l'arrêt de la saison du site.
 * null : hors saison (avant l'allumage, après l'arrêt, ou mois d'été sans saison saisie) ; message si la saison
 * d'un mois d'hiver (octobre à mai) n'est pas saisie.
 */
export function partieChauffee(saisons: SaisonChauffe[], debut: string, fin: string): { debut: string; fin: string } | null | string {
    const saison = saisonDe(debut);
    const s = saisons.find(x => x.saison === saison);
    if (!s) {
        const m = Number(debut.slice(5, 7));
        return m >= 6 && m <= 9 ? null : `dates d'allumage et d'arrêt de la saison ${saison} non renseignées (paramétrage P1 du site)`;
    }
    if (s.allumage > fin) return null;
    if (s.arret !== null && s.arret < debut) return null;
    return { debut: s.allumage > debut ? s.allumage : debut, fin: s.arret !== null && s.arret < fin ? s.arret : fin };
}
