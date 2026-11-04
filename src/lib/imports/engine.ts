import Papa from 'papaparse';
import { luhnValid } from '@/lib/einvoicing';
import type { ImportEntity, ImportField } from '@/lib/imports/definitions';

/**
 * Moteur d'import (sans dépendance serveur) : lecture d'un tableau (en-têtes + lignes), reconnaissance des
 * colonnes, contrôle et normalisation des valeurs, doublons dans le fichier, et modèles CSV.
 * Le même code tourne dans le navigateur (aperçu immédiat) et sur le serveur (contrôle avant écriture).
 */

export type CellValue = string | number | boolean | null;   // null : cellule vide (valeur existante conservée)

export type ParsedRow = {
    line: number;                       // n° de ligne dans le fichier (en-tête = 1)
    values: Record<string, CellValue>;
    errors: string[];
};

export type ParsedFile = {
    rows: ParsedRow[];
    /** Problèmes bloquants pour tout le fichier (colonne obligatoire absente…). */
    fileErrors: string[];
    /** En-têtes non reconnus (ignorés). */
    ignoredColumns: string[];
    /**
     * Colonnes obligatoires à la création absentes du fichier : sans elles, aucune ligne ne peut créer
     * d'élément ; elles peuvent seulement mettre à jour des éléments existants (retrouvés par code ou autre clé).
     */
    missingColumns: string[];
};

export const MAX_ROWS = 10000;

export const normalizeHeader = (s: string) =>
    s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\*/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const TRUE = new Set(['oui', 'o', 'yes', 'y', 'true', 'vrai', '1', 'x']);
const FALSE = new Set(['non', 'n', 'no', 'false', 'faux', '0']);

/** Valeur d'une cellule selon le type de la colonne. */
export function parseValue(field: ImportField, raw: unknown): { value: CellValue; error?: string } {
    const text = raw === null || raw === undefined ? '' : String(raw).trim();
    if (text === '') return { value: null };
    switch (field.type) {
        case 'number': {
            const s = text.replace(/[\s  €]/g, '');
            const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
            if (!Number.isFinite(n)) return { value: null, error: `${field.label} : nombre attendu (« ${text} »).` };
            if (n <= 0) return { value: null, error: `${field.label} : doit être supérieur à 0.` };
            return { value: n };
        }
        case 'boolean': {
            const v = normalizeHeader(text);
            if (TRUE.has(v)) return { value: true };
            if (FALSE.has(v)) return { value: false };
            return { value: null, error: `${field.label} : oui ou non attendu (« ${text} »).` };
        }
        case 'enum': {
            const v = normalizeHeader(text);
            const option = field.options?.find(o => [o.value, o.label, ...(o.aliases ?? [])].some(x => normalizeHeader(x) === v));
            if (!option) return { value: null, error: `${field.label} : valeur inconnue « ${text} » (${field.options?.map(o => o.label).join(', ')}).` };
            return { value: option.value };
        }
        case 'siret': {
            const digits = text.replace(/[\s.\- ]/g, '');
            if (!/^\d{14}$/.test(digits)) return { value: null, error: `${field.label} : 14 chiffres attendus (« ${text} »).` };
            if (!luhnValid(digits)) return { value: null, error: `${field.label} : clé de contrôle invalide (« ${text} »).` };
            return { value: digits };
        }
        case 'email': {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return { value: null, error: `${field.label} : adresse email invalide (« ${text} »).` };
            return { value: text.toLowerCase() };
        }
        case 'postalCode': {
            const v = text.replace(/\s/g, '');
            // Excel peut retirer le 0 initial (« 6000 » pour 06000).
            const padded = /^\d{4}$/.test(v) ? `0${v}` : v;
            if (!/^\d{5}$/.test(padded)) return { value: null, error: `${field.label} : 5 chiffres attendus (« ${text} »).` };
            return { value: padded };
        }
        default:
            return { value: text };
    }
}

/** Reconnaît les colonnes du fichier (libellé, clé ou alias, sans accents ni astérisque). */
export function mapHeaders(entity: ImportEntity, headers: string[]): { index: Map<string, number>; ignored: string[]; missing: string[] } {
    const index = new Map<string, number>();
    const ignored: string[] = [];
    headers.forEach((h, i) => {
        const n = normalizeHeader(h);
        if (!n) return;
        const field = entity.fields.find(f => normalizeHeader(f.label) === n)
            ?? entity.fields.find(f => normalizeHeader(f.key) === n || (f.aliases ?? []).some(a => normalizeHeader(a) === n));
        if (field && !index.has(field.key)) index.set(field.key, i);
        else ignored.push(h);
    });
    // Colonnes sans lesquelles aucune ligne ne peut être créée ni retrouvée.
    const missing = entity.fields.filter(f => f.required === 'create' && !index.has(f.key)).map(f => f.label);
    return { index, ignored, missing };
}

/**
 * Lit un tableau (1re ligne = en-têtes). Une colonne obligatoire absente ne bloque pas le fichier (il peut ne
 * servir qu'à des mises à jour) : elle est signalée, et chaque ligne qui devrait créer un élément est refusée.
 */
export function parseTable(entity: ImportEntity, table: unknown[][]): ParsedFile {
    const [headerRow, ...body] = table;
    if (!headerRow) return { rows: [], fileErrors: ['Fichier vide.'], ignoredColumns: [], missingColumns: [] };
    const { index, ignored, missing } = mapHeaders(entity, headerRow.map(h => String(h ?? '')));
    const fileErrors: string[] = [];
    if (index.size === 0) fileErrors.push("Aucune colonne reconnue : utilisez le modèle d'import.");
    if (body.length > MAX_ROWS) fileErrors.push(`Fichier trop long : ${body.length} lignes (au plus ${MAX_ROWS} par import).`);
    if (fileErrors.length) return { rows: [], fileErrors, ignoredColumns: ignored, missingColumns: missing };

    const rows: ParsedRow[] = [];
    body.forEach((cells, i) => {
        if (!cells || cells.every(c => String(c ?? '').trim() === '')) return;   // ligne vide
        const values: Record<string, CellValue> = {};
        const errors: string[] = [];
        for (const field of entity.fields) {
            const col = index.get(field.key);
            if (col === undefined) continue;
            const { value, error } = parseValue(field, cells[col]);
            values[field.key] = value;
            if (error) errors.push(error);
        }
        rows.push({ line: i + 2, values, errors });
    });

    // Doublons dans le fichier : un même code (ou SIRET de client) sur deux lignes.
    const dupKeys = ['code', ...(entity.key === 'clients' ? ['siret'] : [])];
    for (const key of dupKeys) {
        const seen = new Map<string, number>();
        for (const row of rows) {
            const v = row.values[key];
            if (v === null || v === undefined || v === '') continue;
            const k = String(v).toUpperCase();
            const first = seen.get(k);
            if (first !== undefined) row.errors.push(`${entity.fields.find(f => f.key === key)!.label} ${v} déjà présent ligne ${first}.`);
            else seen.set(k, row.line);
        }
    }
    return { rows, fileErrors, ignoredColumns: ignored, missingColumns: missing };
}

/** Tableau d'un fichier CSV (séparateur détecté, BOM retiré). */
export function csvToTable(text: string): string[][] {
    return Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' }).data;
}

/** Modèle CSV : en-têtes + ligne d'exemple, séparateur « ; », BOM UTF-8 (lisible tel quel par Excel). */
export function csvTemplate(entity: ImportEntity): string {
    const quote = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const header = entity.fields.map(f => quote(f.label)).join(';');
    const example = entity.fields.map(f => quote(f.example ?? '')).join(';');
    return `﻿${header}\r\n${example}\r\n`;
}

/** Lignes de la notice (onglet « Notice » du modèle XLSX, et documentation). */
export function noticeRows(entity: ImportEntity): string[][] {
    return [
        ['Colonne', 'Obligatoire', 'Format', 'Valeurs possibles', 'Exemple', 'Aide'],
        ...entity.fields.map(f => [
            f.label,
            f.required === 'create' ? 'Oui (création)' : 'Non',
            ({ text: 'Texte', number: 'Nombre (virgule ou point)', boolean: 'oui / non', enum: 'Liste', siret: 'SIRET (14 chiffres)', email: 'Email', postalCode: 'Code postal (5 chiffres)' } as const)[f.type],
            f.options ? f.options.map(o => o.label).join(', ') : f.refList ? 'Voir l\'onglet Listes' : '',
            f.example ?? '',
            f.help ?? '',
        ]),
    ];
}

/** Erreurs d'un aperçu ou d'un rapport, en CSV (téléchargement). */
export function errorsCsv(items: { line: number; messages: string[] }[]): string {
    const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
    return `﻿Ligne;Erreurs\r\n${items.map(i => `${i.line};${quote(i.messages.join(' | '))}`).join('\r\n')}\r\n`;
}
