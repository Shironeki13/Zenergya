import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Couleurs des pastilles : une couleur par type de document de contrat, par famille de prestation et par énergie, la
 * même partout dans le logiciel. (Les classes sont écrites en entier : l'outil de style ne garde que celles qu'il lit.)
 */

export type TypeDocument = 'contrat' | 'avenant' | 'os' | 'reconduction' | 'resiliation' | 'syndic' | 'be';

/** Type de document : pastille (fond clair, texte, bordure), point plein, couleur de texte. */
export const TON_DOCUMENT: Record<TypeDocument, { pastille: string; point: string; texte: string }> = {
    contrat: { pastille: 'border-blue-300 bg-blue-50 text-blue-800', point: 'bg-blue-500', texte: 'text-blue-700' },
    avenant: { pastille: 'border-violet-300 bg-violet-50 text-violet-800', point: 'bg-violet-500', texte: 'text-violet-700' },
    os: { pastille: 'border-cyan-300 bg-cyan-50 text-cyan-800', point: 'bg-cyan-500', texte: 'text-cyan-700' },
    reconduction: { pastille: 'border-emerald-300 bg-emerald-50 text-emerald-800', point: 'bg-emerald-500', texte: 'text-emerald-700' },
    resiliation: { pastille: 'border-red-300 bg-red-50 text-red-800', point: 'bg-red-500', texte: 'text-red-700' },
    syndic: { pastille: 'border-amber-300 bg-amber-50 text-amber-800', point: 'bg-amber-500', texte: 'text-amber-700' },
    be: { pastille: 'border-orange-300 bg-orange-50 text-orange-800', point: 'bg-orange-500', texte: 'text-orange-700' },
};
export const tonDocument = (type?: string | null) => (type && type in TON_DOCUMENT ? TON_DOCUMENT[type as TypeDocument] : null);

/** Point de couleur d'un type de document (onglets, filtres, frise). */
export function PointDocument({ type, className }: { type?: string | null; className?: string }) {
    const t = tonDocument(type);
    return t ? <span aria-hidden className={cn('inline-block h-2 w-2 shrink-0 rounded-full', t.point, className)} /> : null;
}

type FamilleActivite = 'P1' | 'P1E' | 'P1A' | 'EE' | 'P2' | 'P3' | 'autre';
const TON_ACTIVITE: Record<FamilleActivite, string> = {
    P1: 'border-orange-300 bg-orange-50 text-orange-800',      // chauffage, énergie
    P1E: 'border-sky-300 bg-sky-50 text-sky-800',              // eau chaude sanitaire
    P1A: 'border-amber-300 bg-amber-50 text-amber-800',        // abonnement
    EE: 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-800',   // refacturation à l'euro l'euro
    P2: 'border-blue-300 bg-blue-50 text-blue-800',            // conduite et entretien
    P3: 'border-emerald-300 bg-emerald-50 text-emerald-800',   // garantie totale, renouvellement
    autre: 'border-slate-300 bg-slate-50 text-slate-700',
};

/** Famille d'une prestation d'après son code (P1C, P1E, P1A, €€, P2, P3R…) ou, à défaut, son type. */
export function familleActivite(code?: string | null, type?: string | null): FamilleActivite {
    const c = String(code ?? '').toUpperCase().trim();
    if (c.includes('€')) return 'EE';
    if (/^P1E/.test(c)) return 'P1E';
    if (/^P1A/.test(c)) return 'P1A';
    for (const f of ['P1', 'P2', 'P3'] as const) if (c.startsWith(f) || (!/^P[123]/.test(c) && type === f)) return f;
    return 'autre';
}

/** Pastille d'une prestation : son code (ou son type), à la couleur de sa famille. */
export function PastilleActivite({ code, type, className }: { code?: string | null; type?: string | null; className?: string }) {
    return <Badge variant="outline" className={cn('whitespace-nowrap', TON_ACTIVITE[familleActivite(code, type)], className)}>{code || type || '—'}</Badge>;
}

const TON_ENERGIE: Record<string, string> = {
    GAZ: 'border-amber-300 bg-amber-50 text-amber-800', ELEC: 'border-indigo-300 bg-indigo-50 text-indigo-800', RCU: 'border-rose-300 bg-rose-50 text-rose-800',
    EAU: 'border-sky-300 bg-sky-50 text-sky-800', PROPANE: 'border-orange-300 bg-orange-50 text-orange-800',
};
export function PastilleEnergie({ energie, libelle, className }: { energie: string; libelle?: string; className?: string }) {
    return <Badge variant="outline" className={cn('whitespace-nowrap', TON_ENERGIE[energie] ?? 'border-slate-300 bg-slate-50 text-slate-700', className)}>{libelle ?? energie}</Badge>;
}

/** État favorable (en vigueur, complet, en service) : pastille verte. */
export const TON_POSITIF = 'border-emerald-300 bg-emerald-50 text-emerald-800';
