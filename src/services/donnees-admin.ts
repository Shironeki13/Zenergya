import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { gardePerimetre } from '@/lib/auth/perimetre-server';
import type { SessionUser } from '@/lib/auth/server';
import { COLLECTIONS_PERIMETRE, type CollectionPerimetre } from '@/lib/perimetre';

/**
 * Lecture des collections à périmètre pour le navigateur : le serveur lit la base et ne renvoie que les objets des
 * sociétés, agences et secteurs de l'utilisateur (lib/perimetre). Le navigateur n'a pas à lire ces collections
 * directement. Les référentiels (sociétés, agences, activités…) ne passent pas par ici : ils sont lisibles par tous.
 */

/** Même forme que les lectures du navigateur : dates Firestore en chaînes ISO, objets simples. */
function convertir(v: unknown): unknown {
    if (v === null || v === undefined) return v;
    if (v instanceof Timestamp) return v.toDate().toISOString();
    if (Array.isArray(v)) return v.map(convertir);
    if (typeof v === 'object' && Object.prototype.toString.call(v) === '[object Object]') return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, convertir(x)]));
    return v;
}

type Doc = { id: string } & Record<string, unknown>;
const lire = async (coll: string): Promise<Doc[]> => (await adminDb.collection(coll).get()).docs.map(d => convertir({ id: d.id, ...d.data() }) as Doc);

export async function chargerDonnees(keys: CollectionPerimetre[], user: SessionUser): Promise<Partial<Record<CollectionPerimetre, Doc[]>>> {
    const demandees = [...new Set(keys)].filter(k => (COLLECTIONS_PERIMETRE as readonly string[]).includes(k));
    const lues = Object.fromEntries(await Promise.all(demandees.map(async k => [k, await lire(k)] as const))) as Partial<Record<CollectionPerimetre, Doc[]>>;
    const garde = gardePerimetre(user);
    if (garde.tout || demandees.length === 0) return lues;

    // Périmètre : chaque objet suit son client (voir lib/perimetre.filtrerPerimetre, même règle).
    const clients = (await garde.clients())!;
    const besoin = (...k: CollectionPerimetre[]) => k.some(x => demandees.includes(x));
    const contrats = besoin('sites', 'services') ? (await garde.ids('contracts'))! : new Set<string>();
    const sites = besoin('sites', 'services', 'meters', 'meterReadings') ? (await garde.ids('sites'))! : new Set<string>();
    let compteurs = new Set<string>();
    if (besoin('meters', 'meterReadings')) {
        const docs = lues.meters ?? (await adminDb.collection('meters').select('siteId').get()).docs.map(d => ({ id: d.id, siteId: d.get('siteId') }) as Doc);
        compteurs = new Set(docs.filter(m => sites.has(String(m.siteId))).map(m => m.id));
    }
    const s = (x: unknown) => String(x ?? '');
    const filtres: Record<CollectionPerimetre, (d: Doc) => boolean> = {
        clients: d => clients.has(d.id),
        contracts: d => clients.has(s(d.clientId)), invoices: d => clients.has(s(d.clientId)), creditNotes: d => clients.has(s(d.clientId)), contacts: d => clients.has(s(d.clientId)),
        sites: d => sites.has(d.id),
        services: d => (d.contractId ? contrats.has(s(d.contractId)) : sites.has(s(d.siteId))),
        meters: d => compteurs.has(d.id), meterReadings: d => compteurs.has(s(d.meterId)),
    };
    return Object.fromEntries(demandees.map(k => [k, (lues[k] ?? []).filter(filtres[k])])) as Partial<Record<CollectionPerimetre, Doc[]>>;
}
