import type { StatutProposition } from '@/lib/contracts/propositions';

/** Couleurs des statuts de proposition (classes écrites en entier : l'outil de style ne garde que celles qu'il lit). */
export const TON_STATUT: Record<StatutProposition, string> = {
    en_lecture: 'border-sky-300 bg-sky-50 text-sky-800', a_revoir: 'border-amber-300 bg-amber-50 text-amber-800', acceptee: 'border-emerald-300 bg-emerald-50 text-emerald-800',
    refusee: 'border-slate-300 bg-slate-50 text-slate-700', echec: 'border-red-300 bg-red-50 text-red-800',
};
