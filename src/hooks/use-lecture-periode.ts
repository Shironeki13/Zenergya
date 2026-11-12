'use client';

import { useCallback, useEffect, useState } from 'react';
import { useData } from '@/context/data-context';
import { lireServeur } from '@/services/lecture';
import type { NomLecture } from '@/services/lectures-admin';

/**
 * Listes chargées par période (factures, avoirs) : le serveur ne renvoie que la période demandée — plus, pour les
 * factures, celles qui demandent une action quelle que soit leur date (impayées, proformas). La période choisie est
 * retenue d'un écran à l'autre pendant la session.
 */

export type Periode = { du: string; au: string };
const CLE = 'zenergya.periode';
const estJour = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);

/** Par défaut : l'exercice en cours et le précédent. */
export function periodeParDefaut(aujourdhui = new Date()): Periode {
    const annee = aujourdhui.getFullYear();
    return { du: `${annee - 1}-01-01`, au: `${annee}-12-31` };
}
export const PERIODE_TOUT: Periode = { du: '2000-01-01', au: '2099-12-31' };

function periodeRetenue(): Periode {
    try {
        const p = JSON.parse(sessionStorage.getItem(CLE) ?? 'null');
        if (estJour(p?.du) && estJour(p?.au) && p.du <= p.au) return p;
    } catch { /* stockage indisponible */ }
    return periodeParDefaut();
}

export function usePeriode(): [Periode, (p: Periode) => void] {
    const [periode, set] = useState<Periode>(periodeParDefaut);
    useEffect(() => { set(periodeRetenue()); }, []);
    const changer = useCallback((p: Periode) => {
        if (!estJour(p.du) || !estJour(p.au) || p.du > p.au) return;
        set(p);
        try { sessionStorage.setItem(CLE, JSON.stringify(p)); } catch { /* stockage indisponible */ }
    }, []);
    return [periode, changer];
}

/** Liste lue au serveur pour une période ; `recharger` après un enregistrement. `periode` absente : lecture sans période. */
export function useLecturePeriode<T>(nom: NomLecture, periode?: Periode, options: Record<string, string> = {}): { donnees: T[]; chargement: boolean; recharger: () => Promise<void> } {
    const { currentUser } = useData();
    const [donnees, setDonnees] = useState<T[]>([]);
    const [chargement, setChargement] = useState(true);
    const cle = JSON.stringify([periode?.du, periode?.au, options]);
    const recharger = useCallback(async () => {
        const l = await lireServeur<T[]>(nom, { ...(periode && { du: periode.du, au: periode.au }), ...options }, []).catch(() => [] as T[]);
        setDonnees(l);
        setChargement(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nom, cle]);
    useEffect(() => { if (currentUser) { setChargement(true); recharger(); } }, [recharger, currentUser]);
    return { donnees, chargement, recharger };
}
