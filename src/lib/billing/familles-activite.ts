/** Famille d'une prestation (couleurs des pastilles à l'écran et sur les factures). Module sans dépendance. */
export type FamilleActivite = 'P1' | 'P1E' | 'P1A' | 'EE' | 'P2' | 'P3' | 'autre';

/** Famille d'une prestation d'après son code (P1C, P1E, P1A, €€, P2, P3R…) ou, à défaut, son type. */
export function familleActivite(code?: string | null, type?: string | null): FamilleActivite {
    const c = String(code ?? '').toUpperCase().trim();
    if (c.includes('€')) return 'EE';
    if (/^P1E/.test(c)) return 'P1E';
    if (/^P1A/.test(c)) return 'P1A';
    for (const f of ['P1', 'P2', 'P3'] as const) if (c.startsWith(f) || (!/^P[123]/.test(c) && type === f)) return f;
    return 'autre';
}
