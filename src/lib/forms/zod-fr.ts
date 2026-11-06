import { z } from 'zod';

/**
 * Messages de validation en français pour les cas sans message propre (sinon « Required », « Expected string… »).
 * Les messages écrits dans les schémas restent prioritaires.
 */
const messagesFr: z.ZodErrorMap = (issue, ctx) => {
    switch (issue.code) {
        case z.ZodIssueCode.invalid_type:
            if (issue.received === 'undefined' || issue.received === 'null') return { message: 'Champ obligatoire.' };
            if (issue.expected === 'number') return { message: 'Nombre attendu.' };
            if (issue.expected === 'date') return { message: 'Date attendue.' };
            return { message: 'Valeur invalide.' };
        case z.ZodIssueCode.too_small:
            if (issue.type === 'string') return { message: Number(issue.minimum) <= 1 ? 'Champ obligatoire.' : `${issue.minimum} caractères au moins.` };
            if (issue.type === 'array') return { message: Number(issue.minimum) <= 1 ? 'Au moins un élément.' : `Au moins ${issue.minimum} éléments.` };
            return { message: `Valeur minimale : ${issue.minimum}.` };
        case z.ZodIssueCode.too_big:
            if (issue.type === 'string') return { message: `${issue.maximum} caractères au plus.` };
            return { message: `Valeur maximale : ${issue.maximum}.` };
        case z.ZodIssueCode.invalid_string:
            if (issue.validation === 'email') return { message: 'Adresse e-mail invalide.' };
            return { message: 'Format invalide.' };
        case z.ZodIssueCode.invalid_enum_value:
            return { message: 'Choisissez une valeur dans la liste.' };
        case z.ZodIssueCode.invalid_date:
            return { message: 'Date invalide.' };
        default:
            return { message: ctx.defaultError };
    }
};

z.setErrorMap(messagesFr);
