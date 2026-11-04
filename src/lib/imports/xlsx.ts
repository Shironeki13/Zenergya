import type { ImportEntity, RefList } from '@/lib/imports/definitions';
import { noticeRows } from '@/lib/imports/engine';

/**
 * Fichiers Excel des imports (librairie SheetJS, chargée à la demande).
 *
 * Lecture : seulement avec une version corrigée de SheetJS (≥ 0.19.3). Les versions antérieures, dont la
 * 0.18.5 publiée sur npm, ont des failles à la lecture de fichiers fournis par l'utilisateur
 * (CVE-2023-30533, CVE-2024-22363). L'écriture des modèles n'est pas concernée.
 */

export const MIN_SAFE_XLSX_VERSION = '0.19.3';

/** Compare deux versions « a.b.c ». */
export function versionAtLeast(version: string, min: string): boolean {
    const a = version.split('.').map(n => parseInt(n, 10) || 0);
    const b = min.split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
        if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
    }
    return true;
}

export class UnsafeXlsxError extends Error {
    constructor(version: string) {
        super(`Lecture des fichiers Excel désactivée : la librairie SheetJS installée (${version}) a des failles connues. `
            + `Installez la version corrigée (${MIN_SAFE_XLSX_VERSION} ou plus) ou importez le fichier en CSV.`);
        this.name = 'UnsafeXlsxError';
    }
}

const LIST_TITLES: Record<RefList, string> = {
    companies: 'Sociétés (code)', agencies: 'Agences', sectors: 'Secteurs', typologies: 'Typologies', meterTypes: 'Types de compteur (code)',
};

/** Modèle XLSX : onglets « Données » (en-têtes + exemple), « Notice » et « Listes » (valeurs du paramétrage). */
export async function xlsxTemplate(entity: ImportEntity, lists: Partial<Record<RefList, string[]>>): Promise<ArrayBuffer> {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();

    const data = XLSX.utils.aoa_to_sheet([entity.fields.map(f => f.label), entity.fields.map(f => f.example ?? '')]);
    data['!cols'] = entity.fields.map(f => ({ wch: Math.max(14, f.label.length + 2) }));
    XLSX.utils.book_append_sheet(wb, data, 'Données');

    const notice = XLSX.utils.aoa_to_sheet([
        [`Import : ${entity.label}`],
        [entity.description],
        [`Correspondance : ${entity.matching}`],
        ['Une cellule vide conserve la valeur existante (mise à jour). Supprimez la ligne d\'exemple avant d\'importer.'],
        [],
        ...noticeRows(entity),
    ]);
    notice['!cols'] = [{ wch: 30 }, { wch: 16 }, { wch: 24 }, { wch: 40 }, { wch: 20 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, notice, 'Notice');

    const used = [...new Set(entity.fields.map(f => f.refList).filter(Boolean) as RefList[])];
    if (used.length) {
        const height = Math.max(...used.map(l => lists[l]?.length ?? 0));
        const rows = [used.map(l => LIST_TITLES[l]), ...Array.from({ length: height }, (_, i) => used.map(l => lists[l]?.[i] ?? ''))];
        const sheet = XLSX.utils.aoa_to_sheet(rows);
        sheet['!cols'] = used.map(() => ({ wch: 28 }));
        XLSX.utils.book_append_sheet(wb, sheet, 'Listes');
    }
    return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
}

/** Tableau de l'onglet « Données » (sinon le premier onglet), valeurs affichées en texte. */
export async function readXlsxTable(buffer: ArrayBuffer): Promise<string[][]> {
    const XLSX = await import('xlsx');
    if (!versionAtLeast(XLSX.version, MIN_SAFE_XLSX_VERSION)) throw new UnsafeXlsxError(XLSX.version);
    const wb = XLSX.read(buffer, { type: 'array', cellFormula: false, cellHTML: false, cellStyles: false });
    const name = wb.SheetNames.includes('Données') ? 'Données' : wb.SheetNames[0];
    if (!name) return [];
    // Dates Excel restituées en AAAA-MM-JJ HH:MM (sinon au format américain m/j/aa, ambigu).
    return XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false, dateNF: 'yyyy-mm-dd hh:mm' });
}
