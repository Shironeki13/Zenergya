import type { TypeValidation } from '@/lib/validations';

/** Couleur de chaque type de document : pastille de la liste (fond clair, texte et bordure) et point des onglets. */
export const TON_VALIDATION: Record<TypeValidation, { pastille: string; point: string }> = {
    contrat: { pastille: 'border-blue-300 bg-blue-50 text-blue-800', point: 'bg-blue-500' },
    avenant: { pastille: 'border-violet-300 bg-violet-50 text-violet-800', point: 'bg-violet-500' },
    os: { pastille: 'border-cyan-300 bg-cyan-50 text-cyan-800', point: 'bg-cyan-500' },
    reconduction: { pastille: 'border-emerald-300 bg-emerald-50 text-emerald-800', point: 'bg-emerald-500' },
    resiliation: { pastille: 'border-red-300 bg-red-50 text-red-800', point: 'bg-red-500' },
    syndic: { pastille: 'border-amber-300 bg-amber-50 text-amber-800', point: 'bg-amber-500' },
    be: { pastille: 'border-orange-300 bg-orange-50 text-orange-800', point: 'bg-orange-500' },
};
