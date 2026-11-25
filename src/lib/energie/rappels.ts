/**
 * Rappel des fournitures d'énergie à renouveler : un seul mail récapitulatif, le jour où au moins un point de
 * livraison franchit un seuil (180, 90, 30 jours avant la fin de sa couverture, sans contrat pour la suite). Il liste
 * tous les points à renouveler, du plus urgent au moins urgent. Module sans dépendance serveur.
 */
import { palierAtteint } from '@/lib/notifications/rappels';
import type { PointEnergieMail } from '@/lib/notifications/balises';

export const PALIERS_ENERGIE = [180, 90, 30];
export type PointSuivi = PointEnergieMail & { statut: string };

const ecart = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Points à lister dans le rappel du jour ; null : rien de nouveau depuis le dernier passage. */
export function rappelEnergie(points: PointSuivi[], aujourdhui: string, dernierPassage: string | null, paliers = PALIERS_ENERGIE): PointEnergieMail[] | null {
    const aRenouveler = points.filter(p => p.statut === 'a_renouveler').sort((a, b) => a.fin.localeCompare(b.fin) || a.client.localeCompare(b.client, 'fr') || a.site.localeCompare(b.site, 'fr'));
    if (!aRenouveler.length) return null;
    const depuis = dernierPassage && dernierPassage < aujourdhui ? ecart(dernierPassage, aujourdhui) : dernierPassage === aujourdhui ? 0 : null;
    // Nouveau : jamais passé, ou un point a changé de palier depuis le dernier passage.
    const nouveau = depuis === null || aRenouveler.some(p => palierAtteint(p.jours, paliers) !== palierAtteint(p.jours + depuis, paliers));
    return nouveau ? aRenouveler.map(({ statut: _s, ...l }) => l) : null;
}
