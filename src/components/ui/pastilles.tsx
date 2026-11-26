import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { familleActivite, type FamilleActivite } from '@/lib/billing/familles-activite';

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

const TON_ACTIVITE: Record<FamilleActivite, string> = {
    P1: 'border-orange-300 bg-orange-50 text-orange-800',      // chauffage, énergie
    P1E: 'border-sky-300 bg-sky-50 text-sky-800',              // eau chaude sanitaire
    P1A: 'border-amber-300 bg-amber-50 text-amber-800',        // abonnement
    EE: 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-800',   // refacturation à l'euro l'euro
    P2: 'border-blue-300 bg-blue-50 text-blue-800',            // conduite et entretien
    P3: 'border-emerald-300 bg-emerald-50 text-emerald-800',   // garantie totale, renouvellement
    autre: 'border-slate-300 bg-slate-50 text-slate-700',
};

export { familleActivite };

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

/** Type de marché : une couleur par famille (comptage, température, combustible et prestation, forfait), public ou privé. */
const TON_MARCHE: Record<string, string> = {
    MC: 'border-sky-300 bg-sky-50 text-sky-800', MCI: 'border-sky-300 bg-sky-50 text-sky-800',
    MT: 'border-violet-300 bg-violet-50 text-violet-800', MTI: 'border-violet-300 bg-violet-50 text-violet-800',
    CP: 'border-teal-300 bg-teal-50 text-teal-800', CPI: 'border-teal-300 bg-teal-50 text-teal-800',
    PF: 'border-rose-300 bg-rose-50 text-rose-800', PFI: 'border-rose-300 bg-rose-50 text-rose-800',
    MF: 'border-lime-300 bg-lime-50 text-lime-800',
    PUBLIC: 'border-indigo-300 bg-indigo-50 text-indigo-800', PRIVE: 'border-amber-300 bg-amber-50 text-amber-800',
};
const cleMarche = (type: string) => {
    const t = type.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
    if (t.includes('PUBLIC')) return 'PUBLIC';
    if (t.includes('PRIVE')) return 'PRIVE';
    return t.split(/\s+/)[0];   // « CP révisé » se colore comme CP
};
export function PastilleMarche({ type, className }: { type?: string | null; className?: string }) {
    if (!type?.trim()) return null;
    return <Badge variant="outline" className={cn('whitespace-nowrap', TON_MARCHE[cleMarche(type)] ?? 'border-slate-300 bg-slate-50 text-slate-700', className)}>{type}</Badge>;
}

const CONTACTS: Record<string, { libelle: string; ton: string }> = {
    principal: { libelle: 'Principal', ton: 'border-blue-300 bg-blue-50 text-blue-800' },
    technique: { libelle: 'Technique', ton: 'border-orange-300 bg-orange-50 text-orange-800' },
    facturation: { libelle: 'Facturation', ton: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
    autre: { libelle: 'Autre', ton: 'border-slate-300 bg-slate-50 text-slate-700' },
};
export function PastilleContact({ type, className }: { type?: string | null; className?: string }) {
    const c = CONTACTS[type ?? ''] ?? { libelle: type || 'Autre', ton: CONTACTS.autre.ton };
    return <Badge variant="outline" className={cn('whitespace-nowrap', c.ton, className)}>{c.libelle}</Badge>;
}
