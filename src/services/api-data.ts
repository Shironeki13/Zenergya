import 'server-only';
import { FieldPath } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { IMPORT_ENTITIES } from '@/lib/imports/definitions';
import type { ApiResource } from '@/lib/api/scopes';
import { applyImport } from '@/services/imports-admin';
import { ApiError } from '@/services/api-admin';

/**
 * Données de l'API externe : représentation publique (codes Zenergya, jamais d'identifiants internes de
 * rattachement), listes paginées et écriture par lots via le moteur d'import (mêmes contrôles que les fichiers).
 * Les noms de champs sont ceux de la description des imports : ce qui se lit peut se renvoyer tel quel.
 */

const COLLECTIONS: Record<ApiResource, string> = { clients: 'clients', sites: 'sites', contacts: 'contacts', meters: 'meters' };
export const MAX_PAGE = 200;
/** Champs de lecture seule de la représentation : acceptés et ignorés à l'écriture (renvoi tel quel possible). */
export const READ_ONLY: Record<ApiResource, string[]> = { clients: [], sites: [], contacts: ['id'], meters: ['unit'] };
export const MAX_BATCH = 500;

type Lookups = {
    companies: Map<string, string>; agencies: Map<string, string>; sectors: Map<string, string>; typologies: Map<string, string>;
    clients: Map<string, string>; contracts: Map<string, string>; sites: Map<string, string>;
};

let cache: { at: number; value: Lookups } | null = null;

/** Correspondances identifiant → code / nom (cache d'une minute par instance). */
async function lookups(): Promise<Lookups> {
    if (cache && Date.now() - cache.at < 60_000) return cache.value;
    const map = async (collection: string, field: (d: FirebaseFirestore.DocumentData) => string) =>
        new Map((await adminDb.collection(collection).get()).docs.map(d => [d.id, field(d.data())]));
    const [companies, agencies, sectors, typologies, clients, contracts, sites] = await Promise.all([
        map('companies', d => d.code || d.name), map('agencies', d => d.name), map('sectors', d => d.name),
        map('typologies', d => d.name), map('clients', d => d.externalCode || d.clientNumber || ''),
        map('contracts', d => d.contractNumber || ''), map('sites', d => d.code || ''),
    ]);
    cache = { at: Date.now(), value: { companies, agencies, sectors, typologies, clients, contracts, sites } };
    return cache.value;
}

/** Supprime les valeurs vides pour une sortie compacte. */
const compact = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

function serialize(resource: ApiResource, id: string, d: FirebaseFirestore.DocumentData, l: Lookups): Record<string, unknown> {
    switch (resource) {
        case 'clients': return compact({
            code: d.externalCode || d.clientNumber, name: d.name, clientType: d.clientType, relation: d.relation ?? 'client', siret: d.siret,
            address: d.address, postalCode: d.postalCode, city: d.city,
            company: l.companies.get(d.companyId), agency: l.agencies.get(d.agencyId), sector: l.sectors.get(d.sectorId), typology: l.typologies.get(d.typologyId),
            representedBy: d.representedBy, useChorus: d.useChorus, chorusServiceCode: d.chorusServiceCode, chorusServiceCodeRequired: d.chorusServiceCodeRequired,
            chorusLegalCommitmentNumber: d.chorusLegalCommitmentNumber, chorusLegalCommitmentRequired: d.chorusLegalCommitmentRequired,
            chorusMarketNumber: d.chorusMarketNumber, einvoicingRegime: d.einvoicingRegime, einvoicingAddress: d.einvoicingAddress,
            quoteCoefficient: d.quoteCoefficient, quoteLaborRate: d.quoteLaborRate,
        });
        case 'sites': return compact({
            code: d.code, client: l.clients.get(d.clientId), contract: d.contractId ? l.contracts.get(d.contractId) : undefined, name: d.name,
            siteNumber: d.siteNumber, address: d.address, postalCode: d.postalCode, city: d.city, heatingWeatherStation: d.heatingWeatherStation,
        });
        case 'contacts': return compact({ id, client: l.clients.get(d.clientId), type: d.type, name: d.name, email: d.email, phone: d.phone, role: d.role });
        case 'meters': return compact({
            code: d.code, site: l.sites.get(d.siteId), name: d.name, meterType: d.type, unit: d.unit, reference: d.reference,
            location: d.location, status: d.status,
        });
    }
}

/** Filtres de liste acceptés par ressource (paramètres de requête). */
export const LIST_FILTERS: Record<ApiResource, string[]> = {
    clients: ['siret', 'relation'], sites: ['client'], contacts: ['client'], meters: ['site'],
};

export async function listResource(resource: ApiResource, params: URLSearchParams) {
    const limit = Math.min(Math.max(Number(params.get('limit')) || 50, 1), MAX_PAGE);
    let q: FirebaseFirestore.Query = adminDb.collection(COLLECTIONS[resource]);
    const l = await lookups();
    const reverse = (map: Map<string, string>, value: string) => [...map.entries()].find(([, v]) => v.toUpperCase() === value.toUpperCase())?.[0];
    for (const f of LIST_FILTERS[resource]) {
        const value = params.get(f)?.trim();
        if (!value) continue;
        if (f === 'client') q = q.where('clientId', '==', reverse(l.clients, value) ?? '__aucun__');
        else if (f === 'site') q = q.where('siteId', '==', reverse(l.sites, value) ?? '__aucun__');
        else q = q.where(f, '==', value);
    }
    const unknown = [...params.keys()].filter(k => !['limit', 'cursor', ...LIST_FILTERS[resource]].includes(k));
    if (unknown.length) throw new ApiError(400, 'invalid_parameter', `Paramètre(s) inconnu(s) : ${unknown.join(', ')}.`, { allowed: ['limit', 'cursor', ...LIST_FILTERS[resource]] });
    q = q.orderBy(FieldPath.documentId()).limit(limit + 1);
    const cursor = params.get('cursor');
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    const docs = snap.docs.slice(0, limit);
    return {
        data: docs.map(d => serialize(resource, d.id, d.data(), l)),
        nextCursor: snap.docs.length > limit ? docs[docs.length - 1].id : null,
    };
}

/** Détail par code Zenergya (CLI, SIT, CPT), ou par identifiant pour un contact. */
export async function getResource(resource: ApiResource, ref: string) {
    const coll = adminDb.collection(COLLECTIONS[resource]);
    let doc: FirebaseFirestore.DocumentSnapshot | undefined;
    if (resource === 'contacts') {
        doc = await coll.doc(ref).get();
    } else {
        const field = resource === 'clients' ? 'externalCode' : 'code';
        doc = (await coll.where(field, '==', ref.toUpperCase()).limit(1).get()).docs[0];
    }
    if (!doc?.exists) throw new ApiError(404, 'not_found', `${IMPORT_ENTITIES[resource].label} : « ${ref} » introuvable.`);
    return { data: serialize(resource, doc.id, doc.data()!, await lookups()) };
}

/**
 * Création / mise à jour par lot : les objets reçus sont convertis en tableau et passent par le moteur
 * d'import. Un champ absent ou vide conserve la valeur existante. Résultat élément par élément.
 */
export async function upsertResource(resource: ApiResource, body: unknown, caller: { name: string }) {
    const items = Array.isArray(body) ? body : (body as { data?: unknown })?.data;
    if (!Array.isArray(items) || items.length === 0) throw new ApiError(400, 'invalid_body', 'Corps attendu : un tableau d\'objets (ou { "data": [...] }).');
    if (items.length > MAX_BATCH) throw new ApiError(413, 'too_many_items', `Au plus ${MAX_BATCH} éléments par appel.`);
    const allowed = new Set(IMPORT_ENTITIES[resource].fields.map(f => f.key));
    const keys: string[] = [];
    items.forEach((item, i) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ApiError(400, 'invalid_body', `Élément ${i} : objet attendu.`);
        for (const k of Object.keys(item)) {
            if (READ_ONLY[resource].includes(k)) continue;
            if (!allowed.has(k)) throw new ApiError(400, 'unknown_field', `Élément ${i} : champ inconnu « ${k} ».`, { allowed: [...allowed] });
            if (!keys.includes(k)) keys.push(k);
        }
    });
    const cell = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'oui' : 'non') : String(v));
    const table = [keys, ...items.map(item => keys.map(k => cell((item as Record<string, unknown>)[k])))];
    const report = await applyImport(resource, table, { fileName: `API — ${caller.name}`, by: `api:${caller.name}`, source: 'api' });

    // Ligne n du tableau = élément n − 2.
    const byLine = new Map<number, { status: string; code?: string; id?: string; errors?: string[] }>();
    for (const r of report.results) byLine.set(r.line, { status: r.action === 'create' ? 'created' : r.action === 'update' ? 'updated' : 'unchanged', ...(r.code && { code: r.code }), id: r.id });
    for (const e of report.errors) byLine.set(e.line, { status: 'error', errors: e.messages });
    const results = items.map((_, i) => {
        const r = byLine.get(i + 2) ?? { status: 'ignored', errors: ['Élément vide.'] };
        // L'identifiant interne n'est exposé que pour les contacts (sans code).
        const { id, ...rest } = r;
        return { index: i, ...rest, ...(resource === 'contacts' && id && { id }) };
    });
    cache = null;   // codes nouvellement attribués
    return {
        summary: { created: report.created, updated: report.updated, unchanged: report.unchanged, errors: report.errors.length },
        results,
    };
}
