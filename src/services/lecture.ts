import type { NomLecture } from '@/services/lectures-admin';

/**
 * Lecture d'une fiche ou des éléments d'un objet par le serveur (navigateur) : le serveur contrôle le périmètre de
 * l'utilisateur. Un objet hors périmètre renvoie `vide` (null pour une fiche, [] pour une liste) et signale le refus à
 * l'application, qui affiche « Hors de votre périmètre » à la place de l'écran (voir le layout).
 */
export const EVENEMENT_HORS_PERIMETRE = 'zenergya:hors-perimetre';

export async function lireServeur<T>(nom: NomLecture, args: Record<string, string>, vide: T): Promise<T> {
    const res = await fetch('/api/lecture', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nom, args }) });
    if (res.status === 403) {
        const corps = await res.json().catch(() => ({}));
        if (corps?.horsPerimetre && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENEMENT_HORS_PERIMETRE, { detail: { chemin: window.location.pathname } }));
        return vide;
    }
    if (!res.ok) throw new Error(`Lecture refusée (${res.status}).`);
    return ((await res.json()).data ?? vide) as T;
}
