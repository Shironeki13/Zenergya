import 'server-only';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { IMPORT_ENTITIES, type ImportEntityKey } from '@/lib/imports/definitions';
import { parseTable, type CellValue, type ParsedRow } from '@/lib/imports/engine';
import type { Agency, Client, Company, Contact, Contract, Meter, MeterReading, MeterType, Sector, Site, Typology } from '@/lib/types';

/**
 * Imports en masse, côté serveur (Admin SDK) : le fichier est relu et contrôlé ici, quel que soit l'aperçu
 * affiché dans le navigateur. Les codes CLI / SIT / CPT sont attribués comme à la saisie (config/sequences).
 * Une cellule vide conserve la valeur existante. Chaque import est tracé dans la collection `imports`.
 */

export type PlanAction = 'create' | 'update' | 'unchanged' | 'error';

export type PlanItem = {
    line: number;
    action: PlanAction;
    label: string;                 // ce que désigne la ligne (nom, code…)
    targetId?: string;             // élément mis à jour
    messages: string[];
    warnings: string[];
    data?: Record<string, unknown>; // champs à écrire (résolus)
};

export type ImportPlan = {
    entity: ImportEntityKey;
    fileErrors: string[];
    ignoredColumns: string[];
    missingColumns: string[];
    items: PlanItem[];
    counts: Record<PlanAction, number>;
};

type Doc<T> = T & { id: string };
const norm = (s: unknown) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

async function all<T>(collection: string): Promise<Doc<T>[]> {
    const snap = await adminDb.collection(collection).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Doc<T>);
}

type Context = {
    companies: Doc<Company>[]; agencies: Doc<Agency>[]; sectors: Doc<Sector>[]; typologies: Doc<Typology>[];
    meterTypes: Doc<MeterType>[]; clients: Doc<Client>[]; contracts: Doc<Contract>[]; sites: Doc<Site>[];
    contacts: Doc<Contact>[]; meters: Doc<Meter>[];
    /** Relevés existants des compteurs du fichier (imports de relevés), triés par date. */
    readings: Map<string, StoredReading[]>;
    /** Relevés repris dans un intéressement ou une régularisation (index figé). */
    lockedReadings: Map<string, string>;
};

type StoredReading = Doc<MeterReading> & { at: number };

/** Instant d'un relevé, quelle que soit sa forme stockée (horodatage Firestore ou texte ISO). */
export function readingMillis(date: unknown): number {
    if (date instanceof Timestamp) return date.toMillis();
    if (date instanceof Date) return date.getTime();
    return new Date(String(date ?? '')).getTime();
}

async function loadContext(entity: ImportEntityKey): Promise<Context> {
    const need = (e: ImportEntityKey[]) => e.includes(entity);
    const empty = Promise.resolve([]);
    const [companies, agencies, sectors, typologies, meterTypes, clients, contracts, sites, contacts, meters] = await Promise.all([
        need(['clients']) ? all<Company>('companies') : empty,
        need(['clients']) ? all<Agency>('agencies') : empty,
        need(['clients']) ? all<Sector>('sectors') : empty,
        need(['clients']) ? all<Typology>('typologies') : empty,
        need(['meters']) ? all<MeterType>('meterTypes') : empty,
        need(['clients', 'sites', 'contacts']) ? all<Client>('clients') : empty,
        need(['sites', 'readings']) ? all<Contract>('contracts') : empty,
        need(['sites', 'meters', 'readings']) ? all<Site>('sites') : empty,
        need(['contacts']) ? all<Contact>('contacts') : empty,
        need(['meters', 'readings']) ? all<Meter>('meters') : empty,
    ]);
    return { companies, agencies, sectors, typologies, meterTypes, clients, contracts, sites, contacts, meters, readings: new Map(), lockedReadings: new Map() } as Context;
}

/** Relevés existants des compteurs cités, et relevés figés par un intéressement ou une régularisation. */
async function loadReadings(ctx: Context, meterIds: string[]): Promise<void> {
    const chunks: string[][] = [];
    for (let i = 0; i < meterIds.length; i += 30) chunks.push(meterIds.slice(i, i + 30));
    const snaps = await Promise.all(chunks.map(c => adminDb.collection('meterReadings').where('meterId', 'in', c).get()));
    for (const d of snaps.flatMap(s => s.docs)) {
        const r = { id: d.id, ...d.data(), at: readingMillis(d.get('date')) } as StoredReading;
        if (!ctx.readings.has(r.meterId)) ctx.readings.set(r.meterId, []);
        ctx.readings.get(r.meterId)!.push(r);
    }
    for (const list of ctx.readings.values()) list.sort((a, b) => a.at - b.at);
    if (ctx.readings.size === 0) return;
    const [interests, settlements] = await Promise.all([
        all<{ seasonLabel?: string; startReadingId?: string; endReadingId?: string }>('interests'),
        all<{ p1Detail?: { startReadingId?: string; endReadingId?: string }; startDate?: string; endDate?: string }>('service_settlements'),
    ]);
    for (const i of interests) {
        for (const id of [i.startReadingId, i.endReadingId]) if (id) ctx.lockedReadings.set(id, `l'intéressement ${i.seasonLabel ?? i.id}`);
    }
    for (const st of settlements) {
        for (const id of [st.p1Detail?.startReadingId, st.p1Detail?.endReadingId]) if (id) ctx.lockedReadings.set(id, `la régularisation du ${st.startDate ?? ''} au ${st.endDate ?? ''}`.trim());
    }
}

const clientCode = (c: Client) => (c.externalCode || c.clientNumber || '').toUpperCase();

/** Client désigné par son code (CLI-…) ou son SIRET. */
function findClient(ctx: Context, ref: CellValue): Doc<Client> | undefined {
    const v = String(ref ?? '').trim();
    const digits = v.replace(/\s/g, '');
    if (/^\d{14}$/.test(digits)) return ctx.clients.find(c => (c.siret ?? '').replace(/\s/g, '') === digits);
    return ctx.clients.find(c => clientCode(c) === v.toUpperCase());
}

/** Valeurs de la ligne (non vides) à écrire telles quelles. */
function plain(values: Record<string, CellValue>, keys: string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of keys) if (values[k] !== null && values[k] !== undefined) out[k] = values[k];
    return out;
}

/** Mise à jour sans effet : toutes les valeurs fournies sont déjà celles de l'élément. */
function sameAs(existing: Record<string, unknown>, data: Record<string, unknown>): boolean {
    return Object.entries(data).every(([k, v]) => existing[k] === v);
}

// --- Plans par type de données ---

function planClient(ctx: Context, row: ParsedRow): PlanItem {
    const v = row.values;
    const item: PlanItem = { line: row.line, action: 'error', label: String(v.name ?? v.code ?? v.siret ?? ''), messages: [...row.errors], warnings: [] };
    const code = v.code ? String(v.code).toUpperCase() : '';
    let existing: Doc<Client> | undefined;
    if (code) {
        existing = ctx.clients.find(c => clientCode(c) === code);
        if (!existing) item.messages.push(`Code client ${code} inconnu (les codes sont attribués par Zenergya : laissez vide pour créer).`);
    } else if (v.siret) {
        existing = ctx.clients.find(c => (c.siret ?? '').replace(/\s/g, '') === v.siret);
        if (existing) item.warnings.push(`Fiche existante retrouvée par son SIRET (${clientCode(existing) || existing.id}).`);
    }

    const data = plain(v, ['name', 'clientType', 'relation', 'siret', 'address', 'postalCode', 'city', 'representedBy', 'useChorus',
        'chorusServiceCode', 'chorusServiceCodeRequired', 'chorusLegalCommitmentNumber', 'chorusLegalCommitmentRequired', 'chorusMarketNumber',
        'einvoicingRegime', 'einvoicingAddress', 'quoteCoefficient', 'quoteLaborRate']);

    // Rattachement : société, puis agence de cette société, puis secteur de cette agence.
    const companyId = v.company
        ? ctx.companies.find(c => norm(c.code) === norm(v.company) || norm(c.name) === norm(v.company))?.id
        : existing?.companyId;
    if (v.company && !companyId) item.messages.push(`Société « ${v.company} » inconnue.`);
    else if (v.company) data.companyId = companyId;
    const agencyId = v.agency
        ? ctx.agencies.find(a => a.companyId === companyId && norm(a.name) === norm(v.agency))?.id
        : existing?.agencyId;
    if (v.agency && !agencyId) item.messages.push(`Agence « ${v.agency} » inconnue pour cette société.`);
    else if (v.agency) data.agencyId = agencyId;
    if (!v.agency && v.company && existing && companyId !== existing.companyId) item.messages.push("Changement de société : indiquez aussi l'agence et le secteur.");
    if (v.sector) {
        const sectorId = ctx.sectors.find(s => s.agencyId === agencyId && norm(s.name) === norm(v.sector))?.id;
        if (!sectorId) item.messages.push(`Secteur « ${v.sector} » inconnu pour cette agence.`);
        else data.sectorId = sectorId;
    }
    if (v.typology) {
        const typologyId = ctx.typologies.find(t => norm(t.name) === norm(v.typology))?.id;
        if (!typologyId) item.messages.push(`Typologie « ${v.typology} » inconnue.`);
        else data.typologyId = typologyId;
    }
    if (v.einvoicingAddress && !/^\d{9}(_[A-Za-z0-9.-]+){0,2}$/.test(String(v.einvoicingAddress))) {
        item.messages.push('Adresse de facturation électronique : SIREN, SIREN_SIRET ou SIREN_SIRET_CODE.');
    }

    // État final (existant + ligne) : contrôles de cohérence.
    const final = { ...(existing ?? {}), ...data } as Partial<Client>;
    if (!existing) {
        const DOC_FIELD: Record<string, keyof Client> = { company: 'companyId', agency: 'agencyId', sector: 'sectorId', typology: 'typologyId' };
        for (const f of IMPORT_ENTITIES.clients.fields.filter(f => f.required === 'create')) {
            const docField = DOC_FIELD[f.key] ?? (f.key as keyof Client);
            if (final[docField] === undefined || final[docField] === null || final[docField] === '') {
                if (!item.messages.some(m => m.startsWith(f.label))) item.messages.push(`${f.label} obligatoire pour créer une fiche.`);
            }
        }
    }
    if (final.clientType === 'public' && !final.siret) item.messages.push('SIRET obligatoire pour un client public.');
    if (final.useChorus && !final.siret) item.messages.push('SIRET obligatoire si le dépôt Chorus est activé.');
    if (final.clientType === 'public' && final.useChorus === false && data.useChorus === false) item.warnings.push('Client public sans dépôt Chorus.');

    if (item.messages.length) return item;
    if (existing) {
        item.targetId = existing.id;
        item.label = `${clientCode(existing) || existing.name} — ${final.name}`;
        item.action = sameAs(existing as unknown as Record<string, unknown>, data) ? 'unchanged' : 'update';
        item.data = data;
    } else {
        item.action = 'create';
        item.data = { isBe: false, useChorus: false, relation: 'client', ...data };
    }
    return item;
}

function planSite(ctx: Context, row: ParsedRow, seen: Map<string, number>): PlanItem {
    const v = row.values;
    const item: PlanItem = { line: row.line, action: 'error', label: String(v.name ?? v.code ?? ''), messages: [...row.errors], warnings: [] };
    const client = v.client ? findClient(ctx, v.client) : undefined;
    if (v.client && !client) item.messages.push(`Client « ${v.client} » introuvable (code CLI-… ou SIRET).`);
    const code = v.code ? String(v.code).toUpperCase() : '';
    let existing: Doc<Site> | undefined;
    if (code) {
        existing = ctx.sites.find(s => (s.code ?? '').toUpperCase() === code);
        if (!existing) item.messages.push(`Code site ${code} inconnu (laissez vide pour créer).`);
    } else if (client && v.siteNumber) {
        existing = ctx.sites.find(s => s.clientId === client.id && norm(s.siteNumber) === norm(v.siteNumber));
        const key = `${client.id}|${norm(v.siteNumber)}`;
        if (seen.has(key)) item.messages.push(`Même client et même n° de site que la ligne ${seen.get(key)}.`);
        else seen.set(key, row.line);
    }
    const clientId = client?.id ?? existing?.clientId;
    const data = plain(v, ['name', 'siteNumber', 'address', 'postalCode', 'city', 'heatingWeatherStation']);
    if (client) Object.assign(data, { clientId: client.id, clientName: client.name });
    if (v.contract) {
        const contract = ctx.contracts.find(c => (c.contractNumber ?? '').toUpperCase() === String(v.contract).toUpperCase());
        if (!contract) item.messages.push(`Contrat ${v.contract} inconnu.`);
        else if (clientId && contract.clientId !== clientId) item.messages.push(`Le contrat ${v.contract} n'appartient pas à ce client.`);
        else data.contractId = contract.id;
    }
    if (!existing) {
        if (!client) item.messages.push('Client obligatoire pour créer un site.');
        if (!v.name) item.messages.push('Nom du site obligatoire pour créer un site.');
        if (!v.address) item.messages.push('Adresse obligatoire pour créer un site.');
    }
    if (item.messages.length) return item;
    if (existing) {
        Object.assign(item, { targetId: existing.id, label: `${existing.code ?? existing.name} — ${data.name ?? existing.name}`, data });
        item.action = sameAs(existing as unknown as Record<string, unknown>, data) ? 'unchanged' : 'update';
    } else {
        Object.assign(item, { action: 'create', data: { contractId: '', ...data } });
    }
    return item;
}

function planContact(ctx: Context, row: ParsedRow, seen: Map<string, number>): PlanItem {
    const v = row.values;
    const item: PlanItem = { line: row.line, action: 'error', label: String(v.name ?? v.email ?? ''), messages: [...row.errors], warnings: [] };
    const client = v.client ? findClient(ctx, v.client) : undefined;
    if (!v.client) item.messages.push('Client obligatoire.');
    else if (!client) item.messages.push(`Client « ${v.client} » introuvable (code CLI-… ou SIRET).`);
    if (item.messages.length || !client) return item;
    const matchKey = v.email ? `${client.id}|@${v.email}` : `${client.id}|${norm(v.name)}`;
    if (seen.has(matchKey)) { item.messages.push(`Même contact que la ligne ${seen.get(matchKey)}.`); return item; }
    seen.set(matchKey, row.line);
    const existing = ctx.contacts.find(c => c.clientId === client.id && (v.email ? norm(c.email) === norm(v.email) : norm(c.name) === norm(v.name)));
    const data = { clientId: client.id, ...plain(v, ['type', 'name', 'email', 'phone', 'role']) };
    if (!existing && (!v.name || !v.type)) { item.messages.push('Nom et type obligatoires pour créer un contact.'); return item; }
    if (existing) {
        Object.assign(item, { targetId: existing.id, label: `${client.name} — ${existing.name}`, data });
        item.action = sameAs(existing as unknown as Record<string, unknown>, data) ? 'unchanged' : 'update';
    } else Object.assign(item, { action: 'create', label: `${client.name} — ${v.name}`, data });
    return item;
}

function planMeter(ctx: Context, row: ParsedRow, seen: Map<string, number>): PlanItem {
    const v = row.values;
    const item: PlanItem = { line: row.line, action: 'error', label: String(v.name ?? v.code ?? ''), messages: [...row.errors], warnings: [] };
    const site = v.site ? ctx.sites.find(s => (s.code ?? '').toUpperCase() === String(v.site).toUpperCase()) : undefined;
    if (v.site && !site) item.messages.push(`Site ${v.site} introuvable (code SIT-…).`);
    const code = v.code ? String(v.code).toUpperCase() : '';
    let existing: Doc<Meter> | undefined;
    if (code) {
        existing = ctx.meters.find(m => (m.code ?? '').toUpperCase() === code);
        if (!existing) item.messages.push(`Code compteur ${code} inconnu (laissez vide pour créer).`);
    } else if (site && v.reference) {
        existing = ctx.meters.find(m => m.siteId === site.id && norm(m.reference) === norm(v.reference));
        const key = `${site.id}|${norm(v.reference)}`;
        if (seen.has(key)) item.messages.push(`Même site et même PDL/PCE que la ligne ${seen.get(key)}.`);
        else seen.set(key, row.line);
    }
    const data = plain(v, ['name', 'reference', 'location', 'status']);
    if (site) Object.assign(data, { siteId: site.id, siteName: site.name, ...(site.clientName && { clientName: site.clientName }) });
    if (v.meterType) {
        const type = ctx.meterTypes.find(t => norm(t.code) === norm(v.meterType) || norm(t.label) === norm(v.meterType));
        if (!type) item.messages.push(`Type de compteur « ${v.meterType} » inconnu.`);
        else Object.assign(data, { type: type.label, unit: type.unit });
    }
    if (!existing && (!site || !v.name || !v.meterType)) item.messages.push('Site, nom et type obligatoires pour créer un compteur.');
    if (item.messages.length) return item;
    if (existing) {
        Object.assign(item, { targetId: existing.id, label: `${existing.code} — ${data.name ?? existing.name}`, data });
        item.action = sameAs(existing as unknown as Record<string, unknown>, data) ? 'unchanged' : 'update';
    } else Object.assign(item, { action: 'create', data: { status: 'on', ...data } });
    return item;
}

const frDate = (ms: number) => new Date(ms).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' });

function planReading(ctx: Context, row: ParsedRow, seen: Map<string, number>, pending: Map<string, { at: number; value: number }[]>): PlanItem {
    const v = row.values;
    const item: PlanItem = { line: row.line, action: 'error', label: `${v.meter ?? ''} ${v.date ? String(v.date).slice(0, 10) : ''}`.trim(), messages: [...row.errors], warnings: [] };
    const meter = v.meter ? ctx.meters.find(m => (m.code ?? '').toUpperCase() === String(v.meter).toUpperCase()) : undefined;
    if (!v.meter) item.messages.push('Compteur obligatoire.');
    else if (!meter) item.messages.push(`Compteur ${v.meter} introuvable (code CPT-…).`);
    if (!v.date && !row.errors.some(e => e.startsWith('Date'))) item.messages.push('Date du relevé obligatoire.');
    if (item.messages.length || !meter || !v.date) return item;

    const at = Date.parse(String(v.date));
    if (at > Date.now() + 3600_000) item.messages.push(`Date future (${frDate(at)}).`);
    const key = `${meter.id}|${at}`;
    if (seen.has(key)) item.messages.push(`Même compteur et même date que la ligne ${seen.get(key)}.`);
    else seen.set(key, row.line);

    const history = ctx.readings.get(meter.id) ?? [];
    const existing = history.find(r => r.at === at);
    item.label = `${meter.code} — ${frDate(at)}`;
    const data = plain(v, ['value', 'type', 'comment']);
    if (!existing && v.value === null) item.messages.push('Index obligatoire pour créer un relevé.');
    const locked = existing && ctx.lockedReadings.get(existing.id);
    if (locked && v.value !== null && v.value !== existing.value) {
        item.messages.push(`Relevé repris dans ${locked} : index non modifiable (${existing.value}).`);
    }
    if (meter.status === 'off') item.warnings.push('Compteur hors service.');
    if (item.messages.length) return item;

    // Cohérence avec les relevés voisins (existants et lignes précédentes du fichier) : simple avertissement,
    // un index peut baisser (remplacement ou remise à zéro du compteur, correction).
    const value = (v.value ?? existing?.value) as number;
    const others = [...history.filter(r => r !== existing).map(r => ({ at: r.at, value: r.value })), ...(pending.get(meter.id) ?? [])];
    const before = others.filter(r => r.at < at).sort((a, b) => b.at - a.at)[0];
    const after = others.filter(r => r.at > at).sort((a, b) => a.at - b.at)[0];
    if (before && value < before.value) item.warnings.push(`Index inférieur au relevé précédent (${before.value} le ${frDate(before.at)}).`);
    if (after && value > after.value) item.warnings.push(`Index supérieur au relevé suivant (${after.value} le ${frDate(after.at)}).`);
    if (!pending.has(meter.id)) pending.set(meter.id, []);
    pending.get(meter.id)!.push({ at, value });

    if (existing) {
        Object.assign(item, { targetId: existing.id, data });
        item.action = sameAs(existing as unknown as Record<string, unknown>, data) ? 'unchanged' : 'update';
    } else {
        const site = ctx.sites.find(s => s.id === meter.siteId);
        const contractId = site?.contractId || ctx.contracts.find(c => (c.siteIds ?? []).includes(meter.siteId))?.id;
        Object.assign(item, {
            action: 'create',
            data: { meterId: meter.id, date: new Date(at).toISOString(), type: 'REEL', unit: meter.unit, ...(contractId && { contractId }), ...data },
        });
    }
    return item;
}

/** Plan d'import : ce que deviendrait chaque ligne, sans rien écrire. */
export async function planImport(entity: ImportEntityKey, table: unknown[][]): Promise<ImportPlan> {
    const def = IMPORT_ENTITIES[entity];
    if (!def) throw new Error('Type de données inconnu.');
    const parsed = parseTable(def, table);
    const counts: Record<PlanAction, number> = { create: 0, update: 0, unchanged: 0, error: 0 };
    if (parsed.fileErrors.length) {
        return { entity, fileErrors: parsed.fileErrors, ignoredColumns: parsed.ignoredColumns, missingColumns: parsed.missingColumns, items: [], counts };
    }
    const ctx = await loadContext(entity);
    if (entity === 'readings') {
        const codes = new Set(parsed.rows.map(r => String(r.values.meter ?? '').toUpperCase()));
        await loadReadings(ctx, ctx.meters.filter(m => codes.has((m.code ?? '').toUpperCase())).map(m => m.id));
    }
    const seen = new Map<string, number>();
    const pending = new Map<string, { at: number; value: number }[]>();
    const items = parsed.rows.map(row => {
        switch (entity) {
            case 'clients': return planClient(ctx, row);
            case 'sites': return planSite(ctx, row, seen);
            case 'contacts': return planContact(ctx, row, seen);
            case 'meters': return planMeter(ctx, row, seen);
            case 'readings': return planReading(ctx, row, seen, pending);
        }
    });
    for (const i of items) counts[i.action]++;
    return { entity, fileErrors: [], ignoredColumns: parsed.ignoredColumns, missingColumns: parsed.missingColumns, items, counts };
}

// --- Écriture ---

const CODES: Partial<Record<ImportEntityKey, { counter: string; prefix: string; field: string; collection: string }>> = {
    clients: { counter: 'client', prefix: 'CLI', field: 'externalCode', collection: 'clients' },
    sites: { counter: 'site', prefix: 'SIT', field: 'code', collection: 'sites' },
    meters: { counter: 'meter', prefix: 'CPT', field: 'code', collection: 'meters' },
};
const COLLECTIONS: Record<ImportEntityKey, string> = { clients: 'clients', sites: 'sites', contacts: 'contacts', meters: 'meters', readings: 'meterReadings' };

/** Réserve `n` numéros au-delà du compteur et du plus grand code existant (pas de doublon possible). */
async function reserveCodes(entity: ImportEntityKey, n: number): Promise<string[]> {
    const spec = CODES[entity];
    if (!spec || n === 0) return [];
    const existing = await adminDb.collection(spec.collection).select(spec.field).get();
    const re = new RegExp(`^${spec.prefix}-(\\d+)$`);
    const maxExisting = Math.max(0, ...existing.docs.map(d => Number(re.exec(String(d.get(spec.field) ?? ''))?.[1] ?? 0)));
    const sequences = adminDb.collection('config').doc('sequences');
    const first = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(sequences);
        const current = Math.max(snap.exists ? snap.get(spec.counter) || 0 : 0, maxExisting);
        tx.set(sequences, { [spec.counter]: current + n }, { merge: true });
        return current + 1;
    });
    return Array.from({ length: n }, (_, i) => `${spec.prefix}-${String(first + i).padStart(5, '0')}`);
}

export type ImportReport = {
    importId: string;
    created: number;
    updated: number;
    unchanged: number;
    errors: { line: number; messages: string[] }[];
    /** Résultat par ligne valide : élément créé, mis à jour ou inchangé (identifiant et code). */
    results: { line: number; action: 'create' | 'update' | 'unchanged'; id: string; code?: string; warnings?: string[] }[];
};

/** Applique un import : lignes valides écrites, lignes en erreur ignorées et rapportées. */
export async function applyImport(entity: ImportEntityKey, table: unknown[][], meta: { fileName?: string; by?: string; source?: 'file' | 'api' }): Promise<ImportReport> {
    const plan = await planImport(entity, table);
    if (plan.fileErrors.length) throw new Error(plan.fileErrors.join(' '));
    const creates = plan.items.filter(i => i.action === 'create');
    const updates = plan.items.filter(i => i.action === 'update');
    const codes = await reserveCodes(entity, creates.length);
    const now = new Date().toISOString();
    const coll = adminDb.collection(COLLECTIONS[entity]);
    const spec = CODES[entity];

    type Write = (b: FirebaseFirestore.WriteBatch) => void;
    const writes: Write[] = [];
    const results: ImportReport['results'] = [];
    creates.forEach((item, i) => {
        const ref = coll.doc();
        const stamp = entity === 'meters'
            ? { lastModified: now, modifiedBy: meta.by ?? 'import' }
            : entity === 'clients' ? { createdAt: now, ...(meta.by && { createdBy: meta.by }) } : {};
        const doc: Record<string, unknown> = { ...item.data, ...stamp, ...(spec && { [spec.field]: codes[i] }) };
        // Relevés : date en horodatage (comme à la saisie), origine de la donnée.
        if (entity === 'readings') Object.assign(doc, { date: Timestamp.fromDate(new Date(String(doc.date))), source: meta.source === 'api' ? 'API' : 'IMPORT' });
        writes.push(b => b.set(ref, doc));
        results.push({ line: item.line, action: 'create', id: ref.id, ...(spec && { code: codes[i] }), ...(item.warnings.length && { warnings: item.warnings }) });
        // Le contrat d'un site créé le compte parmi ses sites.
        if (entity === 'sites' && item.data?.contractId) {
            const contractRef = adminDb.collection('contracts').doc(String(item.data.contractId));
            writes.push(b => b.update(contractRef, { siteIds: FieldValue.arrayUnion(ref.id) }));
        }
    });
    for (const item of updates) {
        const ref = coll.doc(item.targetId!);
        const stamp = entity === 'meters' ? { lastModified: now, modifiedBy: meta.by ?? 'import' } : {};
        writes.push(b => b.update(ref, { ...item.data, ...stamp }));
        results.push({ line: item.line, action: 'update', id: ref.id, ...(item.warnings.length && { warnings: item.warnings }) });
        if (entity === 'sites' && item.data?.contractId) {
            const contractRef = adminDb.collection('contracts').doc(String(item.data.contractId));
            writes.push(b => b.update(contractRef, { siteIds: FieldValue.arrayUnion(ref.id) }));
        }
    }
    for (let i = 0; i < writes.length; i += 400) {
        const batch = adminDb.batch();
        writes.slice(i, i + 400).forEach(w => w(batch));
        await batch.commit();
    }

    for (const item of plan.items.filter(i => i.action === 'unchanged')) results.push({ line: item.line, action: 'unchanged', id: item.targetId!, ...(item.warnings.length && { warnings: item.warnings }) });
    results.sort((a, b) => a.line - b.line);
    const errors = plan.items.filter(i => i.action === 'error').map(i => ({ line: i.line, messages: i.messages }));
    const log = await adminDb.collection('imports').add({
        entity, fileName: meta.fileName ?? '', at: now, ...(meta.by && { by: meta.by }), source: meta.source ?? 'file',
        created: creates.length, updated: updates.length, unchanged: plan.counts.unchanged, rejected: errors.length,
        errors: errors.slice(0, 200),
    });
    return { importId: log.id, created: creates.length, updated: updates.length, unchanged: plan.counts.unchanged, errors, results };
}
