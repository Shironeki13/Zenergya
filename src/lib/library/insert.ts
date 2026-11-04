import Papa from 'papaparse';
import { newLineId } from '@/lib/quotes/pricing';
import type { ComponentKind, QuoteLine, QuoteLineComponent } from '@/lib/quotes/types';
import { ARTICLE_KINDS, type PriceArticle, type PriceWork } from '@/lib/library/types';

/**
 * Bibliothèque de prix → lignes de devis (recopie), et import des tarifs (CSV). Sans dépendance serveur.
 */

/** Ligne de devis recopiée d'un article. */
export function articleToLine(a: PriceArticle, options: { quantity: number; vatRate: number }): QuoteLine {
    return {
        id: newLineId(),
        kind: a.kind,
        label: a.label,
        ...(a.description && { description: a.description }),
        ...(a.unit && { unit: a.unit }),
        quantity: options.quantity,
        // Main-d'œuvre sans déboursé : le coût horaire du devis s'applique.
        ...(a.unitCost !== null && { unitCost: a.unitCost }),
        vatRate: options.vatRate,
        source: { type: 'article', id: a.id, code: a.code },
    };
}

/** Composants recopiés d'un ouvrage ; erreur explicite si un article manque. */
export function workComponents(w: PriceWork, articles: Map<string, PriceArticle>): QuoteLineComponent[] {
    const missing = w.components.filter(c => !articles.has(c.articleId));
    if (missing.length) throw new Error(`Ouvrage ${w.code} : ${missing.length} article(s) introuvable(s) dans la bibliothèque.`);
    return w.components.map(c => {
        const a = articles.get(c.articleId)!;
        return {
            articleId: a.id, code: a.code, kind: a.kind, label: a.label, ...(a.unit && { unit: a.unit }),
            quantity: c.quantity, ...(a.unitCost !== null && { unitCost: a.unitCost }),
        };
    });
}

/** Ligne de devis « ouvrage » recopiée (une ligne pour le client, composition interne). */
export function workToLine(w: PriceWork, articles: Map<string, PriceArticle>, options: { quantity: number; vatRate: number }): QuoteLine {
    return {
        id: newLineId(),
        kind: 'OUVRAGE',
        label: w.label,
        ...(w.description && { description: w.description }),
        unit: w.unit,
        quantity: options.quantity,
        vatRate: options.vatRate,
        components: workComponents(w, articles),
        source: { type: 'work', id: w.id, code: w.code },
    };
}

// --- Import CSV ---

export type ImportedArticle = Pick<PriceArticle, 'code' | 'label' | 'kind' | 'unit' | 'unitCost'>
    & Partial<Pick<PriceArticle, 'family' | 'supplier' | 'supplierRef' | 'description'>>;

export type ImportResult = { rows: ImportedArticle[]; errors: { line: number; message: string }[] };

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** En-têtes reconnus (sans accents, minuscules). */
const HEADERS: Record<keyof ImportedArticle, string[]> = {
    code: ['code', 'reference', 'ref', 'code article'],
    label: ['libelle', 'designation', 'nom', 'article'],
    kind: ['nature', 'type'],
    unit: ['unite', 'u'],
    unitCost: ['debourse', 'cout', 'cout unitaire', 'prix achat', 'prix d achat', 'prix', 'pu ht', 'prix unitaire'],
    family: ['famille', 'categorie'],
    supplier: ['fournisseur'],
    supplierRef: ['ref fournisseur', 'reference fournisseur'],
    description: ['description', 'commentaire'],
};

const KINDS: Record<string, ComponentKind> = {
    fourniture: 'FOURNITURE', f: 'FOURNITURE', materiel: 'FOURNITURE',
    'main d oeuvre': 'MAIN_OEUVRE', mo: 'MAIN_OEUVRE', 'main d œuvre': 'MAIN_OEUVRE',
    'sous traitance': 'SOUS_TRAITANCE', st: 'SOUS_TRAITANCE',
    divers: 'DIVERS', d: 'DIVERS',
};

/** Nombre écrit à la française ou à l'anglaise (« 1 234,50 », « 1234.5 », « 12,30 € »). */
export function parseAmount(raw: string): number | null {
    const s = raw.replace(/[€\s  ]/g, '');
    if (!s) return null;
    const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : NaN;
}

/** Lit un CSV d'articles (séparateur détecté). Code, libellé et unité obligatoires. */
export function parseArticlesCsv(text: string): ImportResult {
    const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
    const [header, ...data] = parsed.data;
    const errors: ImportResult['errors'] = [];
    if (!header) return { rows: [], errors: [{ line: 1, message: 'Fichier vide.' }] };

    const index = {} as Record<keyof ImportedArticle, number>;
    (Object.keys(HEADERS) as (keyof ImportedArticle)[]).forEach(key => {
        // Correspondance exacte d'abord (« ref fournisseur » ne doit pas être pris pour « ref »).
        const i = header.findIndex(h => HEADERS[key].includes(norm(h)));
        index[key] = i;
    });
    for (const required of ['code', 'label', 'unit'] as const) {
        if (index[required] < 0) errors.push({ line: 1, message: `Colonne « ${required === 'label' ? 'libellé' : required === 'unit' ? 'unité' : 'code'} » introuvable.` });
    }
    if (errors.length) return { rows: [], errors };

    const rows: ImportedArticle[] = [];
    const seen = new Set<string>();
    data.forEach((cells, i) => {
        const line = i + 2;
        const cell = (key: keyof ImportedArticle) => (index[key] >= 0 ? (cells[index[key]] ?? '').trim() : '');
        const code = cell('code');
        const label = cell('label');
        const unit = cell('unit');
        if (!code || !label || !unit) { errors.push({ line, message: 'Code, libellé et unité sont obligatoires.' }); return; }
        if (seen.has(code)) { errors.push({ line, message: `Code ${code} en double dans le fichier.` }); return; }
        const kindRaw = norm(cell('kind'));
        const kind = kindRaw ? KINDS[kindRaw] ?? (ARTICLE_KINDS.includes(cell('kind').toUpperCase() as ComponentKind) ? cell('kind').toUpperCase() as ComponentKind : undefined) : 'FOURNITURE';
        if (!kind) { errors.push({ line, message: `Nature inconnue : « ${cell('kind')} » (fourniture, main-d'œuvre, sous-traitance, divers).` }); return; }
        const cost = parseAmount(cell('unitCost'));
        if (Number.isNaN(cost) || (cost !== null && cost < 0)) { errors.push({ line, message: `Déboursé invalide : « ${cell('unitCost')} ».` }); return; }
        if (cost === null && kind !== 'MAIN_OEUVRE') { errors.push({ line, message: 'Déboursé obligatoire (sauf main-d\'œuvre).' }); return; }
        seen.add(code);
        rows.push({
            code, label, kind, unit, unitCost: cost,
            ...(cell('family') && { family: cell('family') }),
            ...(cell('supplier') && { supplier: cell('supplier') }),
            ...(cell('supplierRef') && { supplierRef: cell('supplierRef') }),
            ...(cell('description') && { description: cell('description') }),
        });
    });
    return { rows, errors };
}

/**
 * Ce que fera l'import : articles créés, mis à jour (par code), inchangés. Une colonne facultative vide
 * (famille, fournisseur…) ne remplace pas la valeur existante.
 */
export function planImport(rows: ImportedArticle[], existing: PriceArticle[]) {
    const byCode = new Map(existing.map(a => [a.code, a]));
    const creates: ImportedArticle[] = [];
    const updates: { article: PriceArticle; row: ImportedArticle; costChange: boolean }[] = [];
    let unchanged = 0;
    for (const row of rows) {
        const a = byCode.get(row.code);
        if (!a) { creates.push(row); continue; }
        // Colonne facultative vide dans le fichier : la valeur existante est conservée, donc non comparée.
        const optional = (['family', 'supplier', 'supplierRef', 'description'] as const)
            .every(k => row[k] === undefined || (a[k] ?? '') === row[k]);
        const same = a.label === row.label && a.kind === row.kind && a.unit === row.unit && a.unitCost === row.unitCost && optional;
        if (same && a.active) unchanged++;
        else updates.push({ article: a, row, costChange: a.unitCost !== row.unitCost });
    }
    return { creates, updates, unchanged };
}
