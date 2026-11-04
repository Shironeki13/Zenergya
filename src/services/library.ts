import { db } from '@/lib/firebase';
import { collection, doc, getDocs, query, runTransaction, where, writeBatch } from 'firebase/firestore';
import type { PriceArticle, PriceWork } from '@/lib/library/types';
import type { ImportedArticle, planImport } from '@/lib/library/insert';

/**
 * Bibliothèque de prix (navigateur). Codes uniques par collection ; code vide = attribué automatiquement
 * (ART-00001, OUV-00001) dans la même transaction que l'écriture. On désactive, on ne supprime pas.
 */

const ARTICLES = 'priceArticles';
const WORKS = 'priceWorks';
const sequencesRef = () => doc(db, 'config', 'sequences');
const now = () => new Date().toISOString();

/** Sans `undefined` (refusé par Firestore), y compris dans les tableaux. */
function clean<T>(value: T): T {
    if (Array.isArray(value)) return value.map(clean) as T;
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).map(([k, v]) => [k, clean(v)])) as T;
    }
    return value;
}

export async function getArticles(): Promise<PriceArticle[]> {
    const snap = await getDocs(collection(db, ARTICLES));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as PriceArticle).sort((a, b) => a.code.localeCompare(b.code));
}

export async function getWorks(): Promise<PriceWork[]> {
    const snap = await getDocs(collection(db, WORKS));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as PriceWork).sort((a, b) => a.code.localeCompare(b.code));
}

async function assertUniqueCode(coll: string, code: string, id?: string) {
    const snap = await getDocs(query(collection(db, coll), where('code', '==', code)));
    if (snap.docs.some(d => d.id !== id)) throw new Error(`Le code ${code} est déjà utilisé.`);
}

async function save<T extends { code: string }>(
    coll: string, counter: string, prefix: string, input: T, id: string | undefined, extra: Record<string, unknown>,
): Promise<string> {
    // Champs techniques éventuellement présents (brouillon issu d'un document lu) : jamais recopiés.
    const { id: _id, createdAt: _c, createdBy: _cb, updatedAt: _u, updatedBy: _ub, costUpdatedAt: _cu, ...data } =
        input as T & Record<'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy' | 'costUpdatedAt', unknown>;
    const code = input.code.trim();
    if (code) await assertUniqueCode(coll, code, id);
    const ref = id ? doc(db, coll, id) : doc(collection(db, coll));
    await runTransaction(db, async (tx) => {
        let finalCode = code;
        if (!finalCode) {
            const seq = await tx.get(sequencesRef());
            const next = (seq.exists() ? seq.data()[counter] || 0 : 0) + 1;
            finalCode = `${prefix}-${String(next).padStart(5, '0')}`;
            tx.set(sequencesRef(), { [counter]: next }, { merge: true });
        }
        // Remplacement complet (un champ vidé disparaît) ; les dates de création sont reprises par l'appelant.
        tx.set(ref, clean({ ...data, ...extra, code: finalCode }));
    });
    return ref.id;
}

export type ArticleInput = Omit<PriceArticle, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy' | 'costUpdatedAt'>;

export async function saveArticle(input: ArticleInput, previous: PriceArticle | null, user?: string): Promise<string> {
    const t = now();
    return save(ARTICLES, 'article', 'ART', input, previous?.id, {
        createdAt: previous?.createdAt ?? t, createdBy: previous ? previous.createdBy : user,
        updatedAt: t, ...(user && { updatedBy: user }),
        costUpdatedAt: !previous || previous.unitCost !== input.unitCost ? t : previous.costUpdatedAt,
    });
}

export type WorkInput = Omit<PriceWork, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>;

export async function saveWork(input: WorkInput, previous: PriceWork | null, user?: string): Promise<string> {
    if (input.components.length === 0) throw new Error('Un ouvrage comporte au moins un article.');
    if (input.components.some(c => !(c.quantity > 0))) throw new Error('Quantités des composants : supérieures à 0.');
    const t = now();
    return save(WORKS, 'work', 'OUV', input, previous?.id, {
        createdAt: previous?.createdAt ?? t, createdBy: previous ? previous.createdBy : user,
        updatedAt: t, ...(user && { updatedBy: user }),
    });
}

export async function setActive(kind: 'article' | 'work', id: string, active: boolean, user?: string) {
    const batch = writeBatch(db);
    batch.update(doc(db, kind === 'article' ? ARTICLES : WORKS, id), { active, updatedAt: now(), ...(user && { updatedBy: user }) });
    await batch.commit();
}

/** Applique un import (créations et mises à jour par code), par lots de 400 écritures. */
export async function applyArticleImport(plan: ReturnType<typeof planImport>, user?: string): Promise<{ created: number; updated: number }> {
    const t = now();
    const writes: ((b: ReturnType<typeof writeBatch>) => void)[] = [
        ...plan.creates.map((row: ImportedArticle) => (b: ReturnType<typeof writeBatch>) => b.set(doc(collection(db, ARTICLES)), clean({
            ...row, active: true, createdAt: t, updatedAt: t, costUpdatedAt: t, ...(user && { createdBy: user, updatedBy: user }),
        }))),
        ...plan.updates.map(({ article, row, costChange }) => (b: ReturnType<typeof writeBatch>) => b.update(doc(db, ARTICLES, article.id), clean({
            ...row, active: true, updatedAt: t, ...(user && { updatedBy: user }), ...(costChange && { costUpdatedAt: t }),
        }))),
    ];
    for (let i = 0; i < writes.length; i += 400) {
        const batch = writeBatch(db);
        writes.slice(i, i + 400).forEach(w => w(batch));
        await batch.commit();
    }
    return { created: plan.creates.length, updated: plan.updates.length };
}
