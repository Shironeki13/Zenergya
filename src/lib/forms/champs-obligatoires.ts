import { z } from 'zod';

/**
 * Un champ est-il obligatoire d'après le schéma de validation ? Chemin RHF (« sites.0.name ») ; les tableaux sont
 * traversés. Obligatoire : ni optionnel, ni nullable, ni valeur par défaut ; texte avec une longueur minimale ≥ 1 ou un
 * message « requis » propre ;
 * nombre, date ou liste de valeurs. Les cases à cocher (booléens) ne sont jamais marquées.
 */
export function champObligatoire(schema: z.ZodTypeAny, chemin: string): boolean {
    // Libellé posé hors d'un champ de formulaire (pas de nom) : rien à déduire du schéma.
    if (typeof chemin !== 'string' || !chemin) return false;
    let t: z.ZodTypeAny | undefined = schema;
    for (const seg of chemin.split('.')) {
        t = deballer(t);
        if (!t) return false;
        if (t instanceof z.ZodArray) {
            t = deballer(t.element);
            if (/^\d+$/.test(seg)) continue;
        }
        if (t instanceof z.ZodObject) { t = (t.shape as Record<string, z.ZodTypeAny>)[seg]; continue; }
        return false;
    }
    return !!t && feuilleObligatoire(t);
}

/** Enlève les enveloppes sans effet sur l'obligation (raffinements, transformations, valeurs paresseuses). */
function deballer(t: z.ZodTypeAny | undefined): z.ZodTypeAny | undefined {
    while (t) {
        if (t instanceof z.ZodEffects) t = t.innerType();
        else if (t instanceof z.ZodLazy) t = t.schema;
        else if (t instanceof z.ZodBranded || t instanceof z.ZodReadonly) t = t.unwrap();
        else if (t instanceof z.ZodPipeline) t = t._def.in;
        else return t;
    }
    return t;
}

function feuilleObligatoire(t0: z.ZodTypeAny): boolean {
    let t = t0;
    while (true) {
        if (t instanceof z.ZodOptional || t instanceof z.ZodNullable || t instanceof z.ZodDefault || t instanceof z.ZodCatch) return false;
        const d = deballer(t);
        if (!d || d === t) break;
        t = d;
    }
    // Texte : longueur minimale, format, ou message « requis » propre (z.string({ required_error })).
    if (t instanceof z.ZodString) return !!t._def.errorMap || t._def.checks.some(c => (c.kind === 'min' && c.value >= 1) || c.kind === 'length' || c.kind === 'email');
    if (t instanceof z.ZodUnion) return (t.options as z.ZodTypeAny[]).every(o => feuilleObligatoire(o) && !(o instanceof z.ZodLiteral && o.value === ''));
    if (t instanceof z.ZodBoolean || t instanceof z.ZodAny || t instanceof z.ZodUnknown || t instanceof z.ZodArray || t instanceof z.ZodObject) return false;
    return t instanceof z.ZodNumber || t instanceof z.ZodDate || t instanceof z.ZodEnum || t instanceof z.ZodNativeEnum || t instanceof z.ZodLiteral;
}
