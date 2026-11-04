import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { IMPORT_ENTITIES, type ImportEntityKey } from '@/lib/imports/definitions';
import { parseTable, type CellValue, type ParsedRow } from '@/lib/imports/engine';
import type { Agency, Client, Company, Contact, Contract, Meter, MeterType, Sector, Site, Typology } from '@/lib/types';

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
};

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
        need(['sites']) ? all<Contract>('contracts') : empty,
        need(['sites', 'meters']) ? all<Site>('sites') : empty,
        need(['contacts']) ? all<Contact>('contacts') : empty,
        need(['meters']) ? all<Meter>('meters') : empty,
    ]);
    return { companies, agencies, sectors, typologies, meterTypes, clients, contracts, sites, contacts, meters } as Context;
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
    const companyId = v.companyId
        ? ctx.companies.find(c => norm(c.code) === norm(v.companyId) || norm(c.name) === norm(v.companyId))?.id
        : existing?.companyId;
    if (v.companyId && !companyId) item.messages.push(`Société « ${v.companyId} » inconnue.`);
    else if (v.companyId) data.companyId = companyId;
    const agencyId = v.agencyId
        ? ctx.agencies.find(a => a.companyId === companyId && norm(a.name) === norm(v.agencyId))?.id
        : existing?.agencyId;
    if (v.agencyId && !agencyId) item.messages.push(`Agence « ${v.agencyId} » inconnue pour cette société.`);
    else if (v.agencyId) data.agencyId = agencyId;
    if (!v.agencyId && v.companyId && existing && companyId !== existing.companyId) item.messages.push("Changement de société : indiquez aussi l'agence et le secteur.");
    if (v.sectorId) {
        const sectorId = ctx.sectors.find(s => s.agencyId === agencyId && norm(s.name) === norm(v.sectorId))?.id;
        if (!sectorId) item.messages.push(`Secteur « ${v.sectorId} » inconnu pour cette agence.`);
        else data.sectorId = sectorId;
    }
    if (v.typologyId) {
        const typologyId = ctx.typologies.find(t => norm(t.name) === norm(v.typologyId))?.id;
        if (!typologyId) item.messages.push(`Typologie « ${v.typologyId} » inconnue.`);
        else data.typologyId = typologyId;
    }
    if (v.einvoicingAddress && !/^\d{9}(_[A-Za-z0-9.-]+){0,2}$/.test(String(v.einvoicingAddress))) {
        item.messages.push('Adresse de facturation électronique : SIREN, SIREN_SIRET ou SIREN_SIRET_CODE.');
    }

    // État final (existant + ligne) : contrôles de cohérence.
    const final = { ...(existing ?? {}), ...data } as Partial<Client>;
    if (!existing) {
        for (const f of IMPORT_ENTITIES.clients.fields.filter(f => f.required === 'create')) {
            if (final[f.key as keyof Client] === undefined || final[f.key as keyof Client] === null || final[f.key as keyof Client] === '') {
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
    const seen = new Map<string, number>();
    const items = parsed.rows.map(row => {
        switch (entity) {
            case 'clients': return planClient(ctx, row);
            case 'sites': return planSite(ctx, row, seen);
            case 'contacts': return planContact(ctx, row, seen);
            case 'meters': return planMeter(ctx, row, seen);
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
const COLLECTIONS: Record<ImportEntityKey, string> = { clients: 'clients', sites: 'sites', contacts: 'contacts', meters: 'meters' };

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
};

/** Applique un import : lignes valides écrites, lignes en erreur ignorées et rapportées. */
export async function applyImport(entity: ImportEntityKey, table: unknown[][], meta: { fileName?: string; by?: string }): Promise<ImportReport> {
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
    creates.forEach((item, i) => {
        const ref = coll.doc();
        const stamp = entity === 'meters'
            ? { lastModified: now, modifiedBy: meta.by ?? 'import' }
            : entity === 'clients' ? { createdAt: now, ...(meta.by && { createdBy: meta.by }) } : {};
        const doc = { ...item.data, ...stamp, ...(spec && { [spec.field]: codes[i] }) };
        writes.push(b => b.set(ref, doc));
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

    const errors = plan.items.filter(i => i.action === 'error').map(i => ({ line: i.line, messages: i.messages }));
    const log = await adminDb.collection('imports').add({
        entity, fileName: meta.fileName ?? '', at: now, ...(meta.by && { by: meta.by }),
        created: creates.length, updated: updates.length, unchanged: plan.counts.unchanged, rejected: errors.length,
        errors: errors.slice(0, 200),
    });
    return { importId: log.id, created: creates.length, updated: updates.length, unchanged: plan.counts.unchanged, errors };
}
