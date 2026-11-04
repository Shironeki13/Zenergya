import 'server-only';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { IMPORT_ENTITIES } from '@/lib/imports/definitions';
import type { ApiResource } from '@/lib/api/scopes';
import { applyImport, dateMillis } from '@/services/imports-admin';
import { parseDateTime } from '@/lib/imports/engine';
import { ApiError } from '@/services/api-admin';

/**
 * Données de l'API externe : représentation publique (codes Zenergya, jamais d'identifiants internes de
 * rattachement), listes paginées et écriture par lots via le moteur d'import (mêmes contrôles que les fichiers).
 * Les noms de champs sont ceux de la description des imports : ce qui se lit peut se renvoyer tel quel.
 */

const COLLECTIONS: Record<ApiResource, string> = { clients: 'clients', contracts: 'contracts', services: 'services', sites: 'sites', contacts: 'contacts', meters: 'meters', readings: 'meterReadings' };
export const MAX_PAGE = 200;
/** Champs de lecture seule de la représentation : acceptés et ignorés à l'écriture (renvoi tel quel possible). */
export const READ_ONLY: Record<ApiResource, string[]> = {
    clients: [], contracts: ['name', 'validationStatus', 'sites', 'chorusLegalCommitments'],
    services: ['id', 'contract', 'type'], sites: ['amounts', 'amountsSource'], contacts: ['id'], meters: ['unit'], readings: ['id', 'unit', 'source', 'contract'] };
/** Ressources sans code Zenergya : désignées par leur identifiant. */
const BY_ID: ApiResource[] = ['contacts', 'readings', 'services'];
export const MAX_BATCH = 500;

type Lookups = {
    companies: Map<string, string>; agencies: Map<string, string>; sectors: Map<string, string>; typologies: Map<string, string>;
    clients: Map<string, string>; contracts: Map<string, string>; sites: Map<string, string>; meters: Map<string, string>;
    activities: Map<string, string>; markets: Map<string, string>; terms: Map<string, string>; vatRates: Map<string, string>;
};

let cache: { at: number; value: Lookups } | null = null;

/** Correspondances identifiant → code / nom (cache d'une minute par instance). */
async function lookups(): Promise<Lookups> {
    if (cache && Date.now() - cache.at < 60_000) return cache.value;
    const map = async (collection: string, field: (d: FirebaseFirestore.DocumentData) => string) =>
        new Map((await adminDb.collection(collection).get()).docs.map(d => [d.id, field(d.data())]));
    const [companies, agencies, sectors, typologies, clients, contracts, sites, meters, activities, markets, terms, vatRates] = await Promise.all([
        map('companies', d => d.code || d.name), map('agencies', d => d.name), map('sectors', d => d.name),
        map('typologies', d => d.name), map('clients', d => d.externalCode || d.clientNumber || ''),
        map('contracts', d => d.contractNumber || ''), map('sites', d => d.code || ''), map('meters', d => d.code || ''),
        map('activities', d => d.code || d.label), map('markets', d => d.code || d.label),
        map('terms', d => d.name || ''), map('vatRates', d => d.code || ''),
    ]);
    cache = { at: Date.now(), value: { companies, agencies, sectors, typologies, clients, contracts, sites, meters, activities, markets, terms, vatRates } };
    return cache.value;
}

/** Date « AAAA-MM-JJ » (heure de Paris) d'une date stockée ; relue telle quelle à l'écriture. */
const day = (v: unknown) => {
    const ms = dateMillis(v);
    return Number.isNaN(ms) ? undefined : new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
};

/** Supprime les valeurs vides pour une sortie compacte. */
const compact = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

function serialize(resource: ApiResource, id: string, d: FirebaseFirestore.DocumentData, l: Lookups): Record<string, unknown> {
    switch (resource) {
        case 'clients': return compact({
            code: d.externalCode || d.clientNumber, externalRef: d.externalRef, name: d.name, clientType: d.clientType, relation: d.relation ?? 'client', siret: d.siret,
            address: d.address, postalCode: d.postalCode, city: d.city,
            company: l.companies.get(d.companyId), agency: l.agencies.get(d.agencyId), sector: l.sectors.get(d.sectorId), typology: l.typologies.get(d.typologyId),
            representedBy: d.representedBy, useChorus: d.useChorus, chorusServiceCode: d.chorusServiceCode, chorusServiceCodeRequired: d.chorusServiceCodeRequired,
            chorusLegalCommitmentNumber: d.chorusLegalCommitmentNumber, chorusLegalCommitmentRequired: d.chorusLegalCommitmentRequired,
            chorusMarketNumber: d.chorusMarketNumber, einvoicingRegime: d.einvoicingRegime, einvoicingAddress: d.einvoicingAddress,
            quoteCoefficient: d.quoteCoefficient, quoteLaborRate: d.quoteLaborRate,
        });
        case 'contracts': return compact({
            code: d.contractNumber, externalRef: d.externalRef, client: l.clients.get(d.clientId), label: d.label, name: d.name,
            company: d.companyId ? l.companies.get(d.companyId) : undefined,
            startDate: day(d.startDate), endDate: day(d.endDate), status: d.status, terminationDate: day(d.terminationDate),
            validationStatus: d.validationStatus, marketType: d.marketType, market: d.marketId ? l.markets.get(d.marketId) : undefined,
            activities: (d.activityIds ?? []).map((id: string) => l.activities.get(id) ?? id).join('; ') || undefined,
            baseAmountP1: d.baseAmountP1, baseAmountP2: d.baseAmountP2, baseAmountP3: d.baseAmountP3, baseAmountP3R: d.baseAmountP3R,
            billingSchedule: d.billingSchedule, invoicingType: d.invoicingType, renewal: d.renewal, tacitRenewal: d.tacitRenewal,
            renewalDuration: d.renewalDuration, noticePeriod: d.noticePeriod, signedByCompany: d.signedByCompany, signedByClient: d.signedByClient,
            chorusFramework: d.chorus?.framework, chorusValidatorSiret: d.chorus?.validatorSiret, chorusServiceCode: d.chorus?.serviceCode,
            chorusMarketNumber: d.chorus?.marketNumber, chorusLegalCommitments: d.chorus?.legalCommitments?.length ? d.chorus.legalCommitments : undefined,
            einvoicingAddress: d.einvoicingAddress,
            sites: (d.siteIds ?? []).map((id: string) => l.sites.get(id)).filter(Boolean),
        });
        case 'services': return compact({
            id, externalRef: d.externalRef, site: l.sites.get(d.siteId), contract: l.contracts.get(d.contractId),
            activity: l.activities.get(d.activityId), type: d.type, label: d.label, startDate: day(d.startDate), endDate: day(d.endDate),
            price: d.price, billingTerm: d.billingTermId ? l.terms.get(d.billingTermId) : undefined,
            vatRate: d.vatRateId ? l.vatRates.get(d.vatRateId) : undefined, meter: d.meterId ? l.meters.get(d.meterId) : undefined,
            p1Type: d.p1Type, energyType: d.energyType, unitPrice: d.unitPrice, unit: d.unit, isActive: d.isActive, comment: d.comment,
        });
        case 'sites': return compact({
            code: d.code, externalRef: d.externalRef, client: l.clients.get(d.clientId), contract: d.contractId ? l.contracts.get(d.contractId) : undefined, name: d.name,
            siteNumber: d.siteNumber, address: d.address, postalCode: d.postalCode, city: d.city, heatingWeatherStation: d.heatingWeatherStation,
            amounts: d.amounts?.length ? Object.fromEntries(d.amounts.map((a: { activityId: string; amount: number }) => [l.activities.get(a.activityId) ?? a.activityId, a.amount])) : undefined,
            amountsSource: d.amountsSource ?? (d.amounts?.length ? 'manual' : undefined),
        });
        case 'contacts': return compact({ id, client: l.clients.get(d.clientId), type: d.type, name: d.name, email: d.email, phone: d.phone, role: d.role });
        case 'meters': return compact({
            code: d.code, externalRef: d.externalRef, site: l.sites.get(d.siteId), name: d.name, meterType: d.type, unit: d.unit, reference: d.reference,
            location: d.location, status: d.status,
        });
        case 'readings': return compact({
            id, meter: l.meters.get(d.meterId), date: new Date(dateMillis(d.date)).toISOString(), value: d.value, unit: d.unit,
            type: d.type, source: d.source, comment: d.comment, contract: d.contractId ? l.contracts.get(d.contractId) : undefined,
        });
    }
}

/** Filtres de liste acceptés par ressource (paramètres de requête). */
export const LIST_FILTERS: Record<ApiResource, string[]> = {
    clients: ['siret', 'relation'], contracts: ['client', 'status'], services: ['site', 'contract', 'activity'], sites: ['client'], contacts: ['client'], meters: ['site'], readings: ['meter', 'site', 'from', 'to'],
};

const reverse = (map: Map<string, string>, value: string) => [...map.entries()].find(([, v]) => v.toUpperCase() === value.toUpperCase())?.[0];

function checkParams(resource: ApiResource, params: URLSearchParams) {
    const allowed = ['limit', 'cursor', ...LIST_FILTERS[resource]];
    const unknown = [...params.keys()].filter(k => !allowed.includes(k));
    if (unknown.length) throw new ApiError(400, 'invalid_parameter', `Paramètre(s) inconnu(s) : ${unknown.join(', ')}.`, { allowed });
}

/** Curseur opaque des relevés : position (date, identifiant) du dernier élément rendu. */
const encodeCursor = (date: unknown, id: string) =>
    Buffer.from(JSON.stringify(date instanceof Timestamp ? { t: date.toMillis(), id } : { s: String(date), id })).toString('base64url');
function decodeCursor(cursor: string): [unknown, string] {
    try {
        const c = JSON.parse(Buffer.from(cursor, 'base64url').toString());
        if (typeof c.id !== 'string') throw new Error();
        return [typeof c.t === 'number' ? Timestamp.fromMillis(c.t) : String(c.s), c.id];
    } catch {
        throw new ApiError(400, 'invalid_parameter', 'Curseur invalide.');
    }
}

/**
 * Relevés, du plus ancien au plus récent : par compteur ou par site, sur une période (from inclus, to exclu).
 * Index composite requis : meterReadings (meterId, date) — voir firestore.indexes.json.
 */
async function listReadings(params: URLSearchParams, limit: number) {
    checkParams('readings', params);
    const l = await lookups();
    let q: FirebaseFirestore.Query = adminDb.collection('meterReadings');
    const meter = params.get('meter')?.trim();
    const site = params.get('site')?.trim();
    if (meter) {
        q = q.where('meterId', '==', reverse(l.meters, meter) ?? '__aucun__');
    } else if (site) {
        const siteId = reverse(l.sites, site);
        const ids = siteId ? (await adminDb.collection('meters').where('siteId', '==', siteId).select().get()).docs.map(d => d.id) : [];
        if (ids.length > 30) throw new ApiError(400, 'invalid_parameter', 'Site de plus de 30 compteurs : filtrez par compteur (meter).');
        q = q.where('meterId', 'in', ids.length ? ids : ['__aucun__']);
    }
    for (const [name, op] of [['from', '>='], ['to', '<']] as const) {
        const raw = params.get(name)?.trim();
        if (!raw) continue;
        const iso = parseDateTime(raw);
        if (!iso) throw new ApiError(400, 'invalid_parameter', `${name} : date invalide (AAAA-MM-JJ ou ISO 8601).`);
        q = q.where('date', op, Timestamp.fromDate(new Date(iso)));
    }
    q = q.orderBy('date').orderBy(FieldPath.documentId()).limit(limit + 1);
    const cursor = params.get('cursor');
    if (cursor) q = q.startAfter(...decodeCursor(cursor));
    const snap = await q.get();
    const docs = snap.docs.slice(0, limit);
    const last = docs[docs.length - 1];
    return {
        data: docs.map(d => serialize('readings', d.id, d.data(), l)),
        nextCursor: snap.docs.length > limit ? encodeCursor(last.get('date'), last.id) : null,
    };
}

export async function listResource(resource: ApiResource, params: URLSearchParams) {
    const limit = Math.min(Math.max(Number(params.get('limit')) || 50, 1), MAX_PAGE);
    if (resource === 'readings') return listReadings(params, limit);
    let q: FirebaseFirestore.Query = adminDb.collection(COLLECTIONS[resource]);
    const l = await lookups();
    for (const f of LIST_FILTERS[resource]) {
        const value = params.get(f)?.trim();
        if (!value) continue;
        if (f === 'client') q = q.where('clientId', '==', reverse(l.clients, value) ?? '__aucun__');
        else if (f === 'site') q = q.where('siteId', '==', reverse(l.sites, value) ?? '__aucun__');
        else if (f === 'contract') q = q.where('contractId', '==', reverse(l.contracts, value) ?? '__aucun__');
        else if (f === 'activity') q = q.where('activityId', '==', reverse(l.activities, value) ?? '__aucun__');
        else q = q.where(f, '==', value);
    }
    checkParams(resource, params);
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

/** Détail par code Zenergya (CLI, SIT, CPT), ou par identifiant (contact, relevé). */
export async function getResource(resource: ApiResource, ref: string) {
    const coll = adminDb.collection(COLLECTIONS[resource]);
    let doc: FirebaseFirestore.DocumentSnapshot | undefined;
    if (BY_ID.includes(resource)) {
        doc = /^[A-Za-z0-9]{1,128}$/.test(ref) ? await coll.doc(ref).get() : undefined;
    } else {
        const field = resource === 'clients' ? 'externalCode' : resource === 'contracts' ? 'contractNumber' : 'code';
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
    const byLine = new Map<number, { status: string; code?: string; id?: string; errors?: string[]; warnings?: string[] }>();
    for (const r of report.results) {
        byLine.set(r.line, {
            status: r.action === 'create' ? 'created' : r.action === 'update' ? 'updated' : 'unchanged',
            ...(r.code && { code: r.code }), id: r.id, ...(r.warnings && { warnings: r.warnings }),
        });
    }
    for (const e of report.errors) byLine.set(e.line, { status: 'error', errors: e.messages });
    const results = items.map((_, i) => {
        const r = byLine.get(i + 2) ?? { status: 'ignored', errors: ['Élément vide.'] };
        // L'identifiant interne n'est exposé que pour les éléments sans code (contacts, relevés).
        const { id, ...rest } = r;
        return { index: i, ...rest, ...(BY_ID.includes(resource) && id && { id }) };
    });
    cache = null;   // codes nouvellement attribués
    return {
        summary: { created: report.created, updated: report.updated, unchanged: report.unchanged, errors: report.errors.length },
        results,
    };
}
