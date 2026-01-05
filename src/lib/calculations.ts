import { Index, IndexValue } from './types';

export function calculateIndexValue(
    formula: string,
    period: string,
    allIndices: Index[],
    allIndexValues: IndexValue[],
    decimals: number = 4
): number | null {
    if (!formula) return null;

    // Sort indices by code length (descending) to prevent partial replacements
    // e.g. replacing "IDX" inside "IDX2"
    const sortedIndices = [...allIndices].sort((a, b) => b.code.length - a.code.length);

    let expression = formula;
    let missingDependency = false;

    // Identify used indices in the formula
    // We iterate through all known indices and check if their code appears in the formula
    for (const index of sortedIndices) {
        // Escape code for regex (in case it contains special chars like +, *, etc.)
        const escapedCode = index.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Use word boundaries to match exact codes
        // Note: If codes contain non-word characters (like -), \b might behave unexpectedly depending on the position.
        // But for standard codes (alphanumeric, maybe underscores/hyphens), this is usually fine.
        // A safer approach for "A-B" is to ensure it's not surrounded by other identifier chars.
        // But let's stick to \b for now as a reasonable approximation for typical codes.
        const regex = new RegExp(`\\b${escapedCode}\\b`, 'g');

        if (regex.test(expression)) {
            // Find value for this index and period
            const valueObj = allIndexValues.find(iv => iv.indexId === index.id && iv.period === period);

            if (valueObj) {
                // Replace code with value
                // We wrap value in parentheses just in case, though usually not needed for positive numbers
                expression = expression.replace(regex, `(${valueObj.value})`);
            } else {
                // Dependency found in formula but no value available for this period
                missingDependency = true;
                // We can stop here because we can't calculate
                break;
            }
        }
    }

    if (missingDependency) return null;

    try {
        // Sanitize expression: allow digits, operators, parentheses, dots, spaces
        // We removed the codes, so only numbers and operators should remain.
        // If there are still letters, it means there's an unknown identifier or syntax error.
        if (/[a-zA-Z]/.test(expression)) {
            console.warn('Formula contains unresolved identifiers:', expression);
            return null;
        }

        // Evaluate safely
        // eslint-disable-next-line no-new-func
        const result = new Function(`return ${expression}`)();

        if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
            // Round to specified decimals
            const factor = Math.pow(10, decimals);
            return Math.round(result * factor) / factor;
        }
    } catch (e) {
        console.error('Error evaluating formula:', formula, expression, e);
    }

    return null;
}
