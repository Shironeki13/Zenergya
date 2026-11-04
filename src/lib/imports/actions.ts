'use server';

import { requireAdmin } from '@/lib/auth/server';
import type { ImportEntityKey } from '@/lib/imports/definitions';
import { applyImport, planImport, type ImportPlan, type ImportReport } from '@/services/imports-admin';

/**
 * Imports en masse : réservés aux administrateurs. Le fichier (tableau de cellules) est relu et contrôlé par
 * le serveur ; l'aperçu du navigateur n'est jamais pris pour acquis.
 */

type Result<T> = { success: true; data: T } | { success: false; error: string };

const MAX_CELLS = 400_000;

function checkTable(table: unknown): unknown[][] {
    if (!Array.isArray(table) || !table.every(Array.isArray)) throw new Error('Fichier illisible.');
    const cells = (table as unknown[][]).reduce((n, r) => n + r.length, 0);
    if (cells > MAX_CELLS) throw new Error('Fichier trop volumineux : découpez-le en plusieurs imports.');
    return table as unknown[][];
}

export async function previewImportAction(entity: ImportEntityKey, table: unknown[][]): Promise<Result<Omit<ImportPlan, 'items'> & { items: Omit<ImportPlan['items'][number], 'data'>[] }>> {
    try {
        await requireAdmin();
        const plan = await planImport(entity, checkTable(table));
        // Les données résolues (identifiants internes) ne repartent pas vers le navigateur.
        return { success: true, data: { ...plan, items: plan.items.map(({ data: _d, ...rest }) => rest) } };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Aperçu impossible.' };
    }
}

export async function applyImportAction(entity: ImportEntityKey, table: unknown[][], fileName: string): Promise<Result<ImportReport>> {
    try {
        const user = await requireAdmin();
        return { success: true, data: await applyImport(entity, checkTable(table), { fileName, by: user.email }) };
    } catch (error) {
        console.error('Import :', error);
        return { success: false, error: error instanceof Error ? error.message : 'Import impossible.' };
    }
}
