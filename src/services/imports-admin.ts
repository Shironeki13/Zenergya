import 'server-only';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { IMPORT_ENTITIES, type ImportEntityKey } from '@/lib/imports/definitions';
import { parseTable, type CellValue, type ParsedRow } from '@/lib/imports/engine';
import { chorusNeedsValidator } from '@/lib/einvoicing';
import { scheduleOf, termeOf } from '@/lib/billing/contract-billing';
import { parseAnchor } from '@/lib/billing/revision';
import { periodsOverlap, toDay } from '@/lib/services/site-amounts';
import { recomputeSiteAmounts } from '@/services/site-amounts-admin';
import { ENERGIES, P1_DOC_ID, paramDef, validateParam, type NewVersion, type P1ContractDoc, type P1MeterDoc, type P1Scope, type P1SiteDoc } from '@/lib/p1/stockage';
import { addP1Formule, addP1FormuleVersion, addP1Poste, addP1Version, loadSeries, type P1Target } from '@/services/p1-admin';
import { parseTermes, validateFormule, type FormuleVersion, type PerimetreFormule } from '@/lib/p1/formules';
import type { Energie } from '@/lib/p1/parametrage';
import type {
    Activity, Agency, ChorusFramework, Client, Company, Contact, Contract, ContractChorusSettings, Market, Meter, MeterReading,
    Index, MeterType, PaymentTerm, RevisionRule, Schedule, Sector, Service, ServiceInitialIndexValue, Site, Term, Typology, VatRate,
} from '@/lib/types';

/**
 * Imports en masse, côté serveur (Admin SDK) : le fichier est relu et contrôlé ici, quel que soit l'aperçu
 * affiché dans le navigateur. Les codes CLI / CTN / SIT / CPT sont attribués comme à la saisie (config/sequences).
 * Une cellule vide conserve la valeur existante. Rien n'est jamais supprimé. Chaque import est tracé dans la
 * collection `imports`.
 *
 * Correspondance (mise à jour plutôt que doublon) : code Zenergya, sinon réf. externe, sinon clé métier (SIRET,
 * n° de site, PDL…). Sans aucune clé, un élément très semblable à un existant est un doublon probable : refusé.
 *
 * Liens : le lien contrat ↔ site se fait dans l'import des sites (site.contractId et contract.siteIds tenus
 * ensemble) ; un renommage se reporte sur les noms recopiés (contrats, sites, compteurs).
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
    /** Effets sur les autres éléments, appliqués à l'écriture (retrait d'un ancien contrat, report d'un renommage). */
    effects?: Effects;
};

type Effects = {
    removeFromContract?: string;
    addToContract?: string;
    renameClient?: { clientId: string; from: string; to: string };
    siteDenorm?: { siteId: string; siteName?: string; clientName?: string };
    /** Montants du site à recalculer à partir de ses prestations. */
    recomputeSite?: string;
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
const upper = (s: unknown) => String(s ?? '').trim().toUpperCase();

async function all<T>(collection: string): Promise<Doc<T>[]> {
    const snap = await adminDb.collection(collection).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Doc<T>);
}

type Context = {
    companies: Doc<Company>[]; agencies: Doc<Agency>[]; sectors: Doc<Sector>[]; typologies: Doc<Typology>[];
    meterTypes: Doc<MeterType>[]; activities: Doc<Activity>[]; markets: Doc<Market>[]; schedules: Doc<Schedule>[];
    terms: Doc<Term>[]; vatRates: Doc<VatRate>[]; services: Doc<Service>[]; paymentTerms: Doc<PaymentTerm>[];
    revisionRules: Doc<RevisionRule>[]; indices: Doc<Index>[];
    clients: Doc<Client>[]; contracts: Doc<Contract>[]; sites: Doc<Site>[]; contacts: Doc<Contact>[]; meters: Doc<Meter>[];
    /** Contrats ayant au moins une facture. */
    invoicedContracts: Set<string>;
    /** Relevés existants des compteurs du fichier (imports de relevés), triés par date. */
    readings: Map<string, StoredReading[]>;
    /** Paramétrage P1 (imports P1) : documents par identifiant, codes des stations météo. */
    p1Docs: Map<string, P1SiteDoc | P1MeterDoc | P1ContractDoc>;
    stationCodes: string[];
    /** Codes des indices connus (formules P1). */
    indexCodes: string[];
    /** Réel P1 importé (site_mois → montant) et mois déjà régularisés (site|mois). */
    p1Reel: Map<string, number>;
    p1Regularises: Set<string>;
    /** Relevés repris dans un intéressement ou une régularisation (index figé). */
    lockedReadings: Map<string, string>;
};

type StoredReading = Doc<MeterReading> & { at: number };

/** Instant d'une date stockée, quelle que soit sa forme (horodatage Firestore, Date ou texte ISO). NaN si absente. */
export function dateMillis(date: unknown): number {
    if (date instanceof Timestamp) return date.toMillis();
    if (date instanceof Date) return date.getTime();
    if (date === null || date === undefined || date === '') return NaN;
    return new Date(String(date)).getTime();
}
/** @deprecated nom historique */
export const readingMillis = dateMillis;

async function loadContext(entity: ImportEntityKey): Promise<Context> {
    const need = (e: ImportEntityKey[]) => e.includes(entity);
    const empty = Promise.resolve([]);
    const [companies, agencies, sectors, typologies, meterTypes, activities, markets, schedules, terms, vatRates, services, paymentTerms, revisionRules, indices, clients, contracts, sites, contacts, meters, invoices] = await Promise.all([
        need(['clients', 'contracts']) ? all<Company>('companies') : empty,
        need(['clients']) ? all<Agency>('agencies') : empty,
        need(['clients']) ? all<Sector>('sectors') : empty,
        need(['clients']) ? all<Typology>('typologies') : empty,
        need(['meters']) ? all<MeterType>('meterTypes') : empty,
        need(['contracts', 'services']) ? all<Activity>('activities') : empty,
        need(['contracts']) ? all<Market>('markets') : empty,
        need(['contracts', 'services']) ? all<Schedule>('schedules') : empty,
        need(['services']) ? all<Term>('terms') : empty,
        need(['services']) ? all<VatRate>('vatRates') : empty,
        need(['services']) ? all<Service>('services') : empty,
        need(['clients', 'contracts']) ? all<PaymentTerm>('paymentTerms') : empty,
        need(['services']) ? all<RevisionRule>('revisionRules') : empty,
        need(['services']) ? all<Index>('indices') : empty,
        need(['clients', 'contracts', 'sites', 'contacts']) ? all<Client>('clients') : empty,
        need(['contracts', 'sites', 'services', 'readings', 'p1', 'p1formules']) ? all<Contract>('contracts') : empty,
        need(['sites', 'services', 'meters', 'readings', 'p1', 'p1formules', 'p1reel']) ? all<Site>('sites') : empty,
        need(['contacts']) ? all<Contact>('contacts') : empty,
        need(['meters', 'services', 'readings', 'p1']) ? all<Meter>('meters') : empty,
        need(['contracts']) ? adminDb.collection('invoices').select('contractId').get().then(s => s.docs.map(d => String(d.get('contractId') ?? ''))) : empty,
    ]);
    return {
        companies, agencies, sectors, typologies, meterTypes, activities, markets, schedules, terms, vatRates, services, paymentTerms, revisionRules, indices, clients, contracts, sites, contacts, meters,
        invoicedContracts: new Set(invoices as string[]), readings: new Map(), lockedReadings: new Map(),
        indexCodes: entity === 'p1formules' ? (await loadSeries()).codes : [],
        p1Reel: new Map(), p1Regularises: new Set(),
        p1Docs: entity === 'p1' || entity === 'p1formules' ? new Map((await adminDb.collection('p1Parametrage').get()).docs.map(d => [d.id, d.data() as P1SiteDoc])) : new Map(),
        stationCodes: entity === 'p1' ? (await adminDb.collection('weatherStations').select('code').get()).docs.map(d => String(d.get('code') ?? '')) : [],
    } as Context;
}

/** Relevés existants des compteurs cités, et relevés figés par un intéressement ou une régularisation. */
async function loadReadings(ctx: Context, meterIds: string[]): Promise<void> {
    const chunks: string[][] = [];
    for (let i = 0; i < meterIds.length; i += 30) chunks.push(meterIds.slice(i, i + 30));
    const snaps = await Promise.all(chunks.map(c => adminDb.collection('meterReadings').where('meterId', 'in', c).get()));
    for (const d of snaps.flatMap(s => s.docs)) {
        const r = { id: d.id, ...d.data(), at: dateMillis(d.get('date')) } as StoredReading;
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

// --- Désignation des éléments : code Zenergya, réf. externe, clé métier ---

const clientCode = (c: Client) => upper(c.externalCode || c.clientNumber);
const byRef = <T extends { externalRef?: string }>(list: T[], ref: unknown) => {
    const r = upper(ref);
    return r ? list.find(x => upper(x.externalRef) === r) : undefined;
};

/** Client désigné par son code (CLI-…), son SIRET ou sa réf. externe. */
function findClient(ctx: Context, ref: CellValue): Doc<Client> | undefined {
    const v = String(ref ?? '').trim();
    const digits = v.replace(/\s/g, '');
    if (/^\d{14}$/.test(digits)) {
        const bySiret = ctx.clients.find(c => (c.siret ?? '').replace(/\s/g, '') === digits);
        if (bySiret) return bySiret;
    }
    return ctx.clients.find(c => clientCode(c) === upper(v)) ?? byRef(ctx.clients, v);
}
const clientNotFound = (ref: CellValue) => `Client « ${ref} » introuvable (code CLI-…, SIRET ou réf. externe).`;

/** Contrat désigné par son n° (CTN-…) ou sa réf. externe. */
const findContract = (ctx: Context, ref: CellValue) =>
    ctx.contracts.find(c => upper(c.contractNumber) === upper(ref)) ?? byRef(ctx.contracts, ref);

/** Site désigné par son code (SIT-…) ou sa réf. externe. */
const findSite = (ctx: Context, ref: CellValue) => ctx.sites.find(s => upper(s.code) === upper(ref)) ?? byRef(ctx.sites, ref);

/** Compteur désigné par son code (CPT-…) ou sa réf. externe. */
const findMeter = (ctx: Context, ref: CellValue) => ctx.meters.find(m => upper(m.code) === upper(ref)) ?? byRef(ctx.meters, ref);

/** Réf. externe déjà portée par un autre élément du même type ? */
function refTakenBy<T extends { id: string; externalRef?: string }>(list: T[], ref: CellValue, selfId?: string): T | undefined {
    const r = upper(ref);
    return r ? list.find(x => x.id !== selfId && upper(x.externalRef) === r) : undefined;
}

/** Valeurs de la ligne (non vides) à écrire telles quelles. */
function plain(values: Record<string, CellValue>, keys: string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of keys) if (values[k] !== null && values[k] !== undefined) out[k] = values[k];
    return out;
}

/** Égalité de valeurs stockées : dates (horodatage ou texte), tableaux et objets comparés par contenu. */
function sameValue(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a instanceof Timestamp || b instanceof Timestamp) return dateMillis(a) === dateMillis(b);
    if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
        const stable = (x: unknown): string => JSON.stringify(x, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v)
            ? Object.fromEntries(Object.entries(v).filter(([, y]) => y !== undefined).sort(([p], [q]) => p.localeCompare(q))) : v));
        return stable(a) === stable(b);
    }
    return false;
}

/** Mise à jour sans effet : toutes les valeurs fournies sont déjà celles de l'élément. */
function sameAs(existing: Record<string, unknown>, data: Record<string, unknown>): boolean {
    return Object.entries(data).every(([k, v]) => sameValue(existing[k], v));
}

const DAY = 86_400_000;
const frDay = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
const frDate = (ms: number) => new Date(ms).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' });
/** Date « AAAA-MM-JJ » (heure de Paris) d'un instant. */
const isoDay = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });

/** Contrat en cours : ni résilié ni terminé, et pas encore échu. */
const contractRunning = (c: Contract) => !['Résilié', 'Terminé'].includes(c.status) && !(dateMillis(c.endDate) < Date.now() - DAY);

/** Conditions de paiement désignées par leur code (ou leur libellé). */
function paymentTermOf(ctx: Context, v: Record<string, CellValue>, data: Record<string, unknown>, item: PlanItem) {
    if (!v.paymentTerm) return;
    const term = ctx.paymentTerms.find(t => norm(t.code) === norm(v.paymentTerm) || norm(t.deadline) === norm(v.paymentTerm));
    if (!term) item.messages.push(`Conditions de paiement « ${v.paymentTerm} » inconnues.`);
    else data.paymentTermId = term.id;
}

// --- Plans par type de données ---

function planClient(ctx: Context, row: ParsedRow, seen: Map<string, number>): PlanItem {
    const v = row.values;
    const item: PlanItem = { line: row.line, action: 'error', label: String(v.name ?? v.code ?? v.siret ?? ''), messages: [...row.errors], warnings: [] };
    const code = v.code ? upper(v.code) : '';
    let existing: Doc<Client> | undefined;
    if (code) {
        existing = ctx.clients.find(c => clientCode(c) === code);
        if (!existing) item.messages.push(`Code client ${code} inconnu (les codes sont attribués par Zenergya : laissez vide pour créer).`);
    } else if (v.externalRef) {
        existing = byRef(ctx.clients, v.externalRef);
    }
    if (!existing && !code && v.siret) {
        existing = ctx.clients.find(c => (c.siret ?? '').replace(/\s/g, '') === v.siret);
        if (existing) item.warnings.push(`Fiche existante retrouvée par son SIRET (${clientCode(existing) || existing.id}).`);
    }
    const taken = refTakenBy(ctx.clients, v.externalRef, existing?.id);
    if (taken) item.messages.push(`Réf. externe ${v.externalRef} déjà portée par le client ${clientCode(taken) || taken.name}.`);

    // Doublon probable : aucune clé (code, réf. externe, SIRET) et une fiche de même nom au même code postal.
    if (!existing && !code && !v.externalRef && !v.siret && v.name) {
        const key = `${norm(v.name)}|${norm(v.postalCode)}`;
        const twin = ctx.clients.find(c => norm(c.name) === norm(v.name) && norm(c.postalCode) === norm(v.postalCode));
        if (twin) {
            item.messages.push(`Doublon probable de ${clientCode(twin) || twin.name} (même nom, même code postal) : indiquez son code pour le mettre à jour, `
                + 'ou un SIRET ou une réf. externe pour créer une autre fiche.');
        } else if (seen.has(key)) {
            item.messages.push(`Même nom et même code postal que la ligne ${seen.get(key)}, sans SIRET ni réf. externe.`);
        } else seen.set(key, row.line);
    }

    const data = plain(v, ['externalRef', 'name', 'clientType', 'relation', 'siret', 'address', 'postalCode', 'city', 'representedBy', 'useChorus',
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
    paymentTermOf(ctx, v, data, item);
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
        if (data.name && data.name !== existing.name) {
            item.effects = { renameClient: { clientId: existing.id, from: existing.name, to: String(data.name) } };
            item.warnings.push('Nouveau nom reporté sur les contrats, sites et compteurs du client.');
        }
    } else {
        item.action = 'create';
        item.data = { isBe: false, useChorus: false, relation: 'client', ...data };
    }
    return item;
}

function planContract(ctx: Context, row: ParsedRow, seen: Map<string, number>): PlanItem {
    const v = row.values;
    const item: PlanItem = { line: row.line, action: 'error', label: String(v.label ?? v.code ?? v.externalRef ?? ''), messages: [...row.errors], warnings: [] };
    const client = v.client ? findClient(ctx, v.client) : undefined;
    if (v.client && !client) item.messages.push(clientNotFound(v.client));

    const code = v.code ? upper(v.code) : '';
    let existing: Doc<Contract> | undefined;
    if (code) {
        existing = ctx.contracts.find(c => upper(c.contractNumber) === code);
        if (!existing) item.messages.push(`N° de contrat ${code} inconnu (attribué par Zenergya : laissez vide pour créer).`);
    } else if (v.externalRef) {
        existing = byRef(ctx.contracts, v.externalRef);
    }
    const taken = refTakenBy(ctx.contracts, v.externalRef, existing?.id);
    if (taken) item.messages.push(`Réf. externe ${v.externalRef} déjà portée par le contrat ${taken.contractNumber ?? taken.id}.`);

    const data = plain(v, ['externalRef', 'label', 'status', 'marketType', 'baseAmountP1', 'baseAmountP2', 'baseAmountP3', 'baseAmountP3R',
        'invoicingType', 'renewal', 'tacitRenewal', 'renewalDuration', 'noticePeriod', 'signedByCompany', 'signedByClient', 'einvoicingAddress']);

    if (v.company) {
        const companyId = ctx.companies.find(c => norm(c.code) === norm(v.company) || norm(c.name) === norm(v.company))?.id;
        if (!companyId) item.messages.push(`Société « ${v.company} » inconnue.`);
        else data.companyId = companyId;
    }
    if (v.market) {
        const market = ctx.markets.find(m => norm(m.code) === norm(v.market) || norm(m.label) === norm(v.market));
        if (!market) item.messages.push(`Marché « ${v.market} » inconnu.`);
        else data.marketId = market.id;
    }
    if (v.activities) {
        const ids: string[] = [];
        for (const token of String(v.activities).split(/[;,]/).map(t => t.trim()).filter(Boolean)) {
            const activity = ctx.activities.find(a => norm(a.code) === norm(token) || norm(a.label) === norm(token));
            if (!activity) item.messages.push(`Activité « ${token} » inconnue.`);
            else if (!ids.includes(activity.id)) ids.push(activity.id);
        }
        data.activityIds = ids;
    }
    paymentTermOf(ctx, v, data, item);
    if (v.billingSchedule) {
        const schedule = ctx.schedules.find(s => norm(s.name) === norm(v.billingSchedule));
        if (!schedule) item.messages.push(`Échéancier « ${v.billingSchedule} » inconnu.`);
        else data.billingSchedule = schedule.name;
    }
    if (v.einvoicingAddress && !/^\d{9}(_[A-Za-z0-9.-]+){0,2}$/.test(String(v.einvoicingAddress))) {
        item.messages.push('Adresse de facturation électronique : SIREN, SIREN_SIRET ou SIREN_SIRET_CODE.');
    }

    // Dates : seules celles qui changent sont écrites (une date stockée peut être un horodatage ou un texte).
    for (const f of ['startDate', 'endDate', 'terminationDate'] as const) {
        if (v[f] && !(existing && dateMillis(existing[f]) === Date.parse(String(v[f])))) data[f] = v[f];
    }
    const start = dateMillis(data.startDate ?? existing?.startDate);
    const end = dateMillis(data.endDate ?? existing?.endDate);
    if (!Number.isNaN(start) && !Number.isNaN(end) && end <= start) item.messages.push('La date de fin doit être postérieure à la date de début.');
    const status = (data.status ?? existing?.status ?? 'Actif') as Contract['status'];
    if (status === 'Résilié' && Number.isNaN(dateMillis(data.terminationDate ?? existing?.terminationDate))) {
        item.messages.push('Date de résiliation obligatoire pour un contrat résilié.');
    }

    // Client : un contrat qui a des sites ou des factures ne change pas de client (ils appartiennent à l'ancien).
    if (existing && client && client.id !== existing.clientId) {
        if ((existing.siteIds ?? []).length || ctx.invoicedContracts.has(existing.id)) {
            item.messages.push('Changement de client refusé : le contrat a déjà des sites ou des factures.');
        } else Object.assign(data, { clientId: client.id, clientName: client.name });
    }
    const owner = client ?? ctx.clients.find(c => c.id === existing?.clientId);
    if (existing && (data.startDate || data.endDate) && ctx.invoicedContracts.has(existing.id)) {
        item.warnings.push('Contrat déjà facturé : vérifiez les périodes facturées après ce changement de dates.');
    }

    // Chorus Pro : cadre, valideur, code service, n° de marché ; engagement ajouté s'il est nouveau.
    if (v.chorusFramework || v.chorusValidatorSiret || v.chorusServiceCode || v.chorusMarketNumber || v.chorusLegalCommitment) {
        const chorus: ContractChorusSettings = { ...(existing?.chorus ?? {}) };
        if (v.chorusFramework) chorus.framework = v.chorusFramework as ChorusFramework;
        if (v.chorusValidatorSiret) chorus.validatorSiret = String(v.chorusValidatorSiret);
        if (v.chorusServiceCode) chorus.serviceCode = String(v.chorusServiceCode);
        if (v.chorusMarketNumber) chorus.marketNumber = String(v.chorusMarketNumber);
        if (v.chorusLegalCommitment && !(chorus.legalCommitments ?? []).some(c => upper(c.number) === upper(v.chorusLegalCommitment))) {
            chorus.legalCommitments = [...(chorus.legalCommitments ?? []), {
                number: String(v.chorusLegalCommitment),
                startDate: Number.isNaN(start) ? isoDay(Date.now()) : isoDay(start),
                ...(!Number.isNaN(end) && { endDate: isoDay(end) }),
            }];
        }
        if (chorus.framework && chorusNeedsValidator(chorus.framework) && !chorus.validatorSiret) {
            item.messages.push(`Cadre Chorus ${chorus.framework} : SIRET du valideur obligatoire.`);
        }
        data.chorus = chorus;
    }

    // Doublon probable : sans n° ni réf. externe, un contrat du même client, de même libellé, sur une période qui se recouvre.
    if (!existing && !code && !v.externalRef && client && v.label && !Number.isNaN(start) && !Number.isNaN(end)) {
        const twin = ctx.contracts.find(c => c.clientId === client.id && norm(c.label) === norm(v.label)
            && dateMillis(c.startDate) <= end && start <= dateMillis(c.endDate));
        const key = `${client.id}|${norm(v.label)}`;
        if (twin) {
            item.messages.push(`Doublon probable du contrat ${twin.contractNumber ?? twin.id} (même client, même libellé, périodes qui se recouvrent) : `
                + 'indiquez son n° pour le mettre à jour, ou une réf. externe pour créer un autre contrat.');
        } else if (seen.has(key)) {
            item.messages.push(`Même client et même libellé que la ligne ${seen.get(key)}, sans réf. externe.`);
        } else seen.set(key, row.line);
    }

    if (!existing) {
        if (!client) { if (!v.client) item.messages.push('Client obligatoire pour créer un contrat.'); }
        if (!v.label) item.messages.push('Libellé obligatoire pour créer un contrat.');
        if (!v.startDate || !v.endDate) item.messages.push('Dates de début et de fin obligatoires pour créer un contrat.');
    }
    if (data.label && owner) data.name = `${owner.name} - ${data.label}`;
    if (item.messages.length) return item;

    if (existing) {
        Object.assign(item, { targetId: existing.id, label: `${existing.contractNumber ?? existing.id} — ${data.label ?? existing.label ?? ''}`, data });
        item.action = sameAs(existing as unknown as Record<string, unknown>, data) ? 'unchanged' : 'update';
    } else {
        item.label = `${owner!.name} — ${v.label}`;
        Object.assign(item, {
            action: 'create',
            data: {
                clientId: owner!.id, clientName: owner!.name, siteIds: [], activityIds: [], status: 'Actif', invoicingType: 'multi-site',
                renewal: false, tacitRenewal: false, ...data,
            },
        });
    }
    return item;
}

function planSite(ctx: Context, row: ParsedRow, seen: Map<string, number>): PlanItem {
    const v = row.values;
    const item: PlanItem = { line: row.line, action: 'error', label: String(v.name ?? v.code ?? ''), messages: [...row.errors], warnings: [] };
    const client = v.client ? findClient(ctx, v.client) : undefined;
    if (v.client && !client) item.messages.push(clientNotFound(v.client));
    const code = v.code ? upper(v.code) : '';
    let existing: Doc<Site> | undefined;
    if (code) {
        existing = ctx.sites.find(s => upper(s.code) === code);
        if (!existing) item.messages.push(`Code site ${code} inconnu (laissez vide pour créer).`);
    } else if (v.externalRef) {
        existing = byRef(ctx.sites, v.externalRef);
    }
    if (!existing && !code && client && v.siteNumber) {
        existing = ctx.sites.find(s => s.clientId === client.id && norm(s.siteNumber) === norm(v.siteNumber));
        const key = `${client.id}|${norm(v.siteNumber)}`;
        if (seen.has(key)) item.messages.push(`Même client et même n° de site que la ligne ${seen.get(key)}.`);
        else seen.set(key, row.line);
    }
    const taken = refTakenBy(ctx.sites, v.externalRef, existing?.id);
    if (taken) item.messages.push(`Réf. externe ${v.externalRef} déjà portée par le site ${taken.code ?? taken.name}.`);

    // Doublon probable : aucune clé et un site du même client à la même adresse.
    if (!existing && !code && !v.externalRef && !v.siteNumber && client && v.address) {
        const key = `@${client.id}|${norm(v.address)}|${norm(v.postalCode)}`;
        const twin = ctx.sites.find(s => s.clientId === client.id && norm(s.address) === norm(v.address) && norm(s.postalCode) === norm(v.postalCode));
        if (twin) {
            item.messages.push(`Doublon probable du site ${twin.code ?? twin.name} (même client, même adresse) : indiquez son code pour le mettre à jour, `
                + 'ou un n° de site ou une réf. externe pour créer un autre site.');
        } else if (seen.has(key)) {
            item.messages.push(`Même client et même adresse que la ligne ${seen.get(key)}, sans n° de site ni réf. externe.`);
        } else seen.set(key, row.line);
    }

    const clientId = client?.id ?? existing?.clientId;
    const data = plain(v, ['externalRef', 'name', 'siteNumber', 'address', 'postalCode', 'city', 'heatingWeatherStation']);
    if (client) Object.assign(data, { clientId: client.id, clientName: client.name });

    // Contrat : désigné par n° ou réf. externe, et du même client. Seul endroit où se fait le lien contrat ↔ site.
    let contract: Doc<Contract> | undefined;
    if (v.contract) {
        contract = findContract(ctx, v.contract);
        if (!contract) item.messages.push(`Contrat ${v.contract} inconnu (n° CTN-… ou réf. externe).`);
        else if (clientId && contract.clientId !== clientId) item.messages.push(`Le contrat ${contract.contractNumber ?? v.contract} n'appartient pas à ce client.`);
        else data.contractId = contract.id;
    } else if (existing?.contractId && client && client.id !== existing.clientId) {
        const current = ctx.contracts.find(c => c.id === existing!.contractId);
        if (current && current.clientId !== client.id) {
            item.messages.push(`Changement de client : le site est rattaché au contrat ${current.contractNumber ?? current.id} de l'ancien client ; indiquez un contrat du nouveau client.`);
        }
    }
    if (!existing) {
        if (!client && !v.client) item.messages.push('Client obligatoire pour créer un site.');
        if (!v.name) item.messages.push('Nom du site obligatoire pour créer un site.');
        if (!v.address) item.messages.push('Adresse obligatoire pour créer un site.');
    }
    if (item.messages.length) return item;

    const effects: Effects = {};
    if (contract) {
        if (!(contract.siteIds ?? []).includes(existing?.id ?? '')) effects.addToContract = contract.id;
        const previous = existing?.contractId && existing.contractId !== contract.id ? ctx.contracts.find(c => c.id === existing!.contractId) : undefined;
        if (previous) {
            if (contractRunning(previous)) {
                effects.removeFromContract = previous.id;
                item.warnings.push(`Site retiré du contrat ${previous.contractNumber ?? previous.id}, encore en cours : il n'y sera plus facturé.`);
            } else {
                item.warnings.push(`Ancien contrat ${previous.contractNumber ?? previous.id} terminé : le site y reste pour l'historique.`);
            }
        }
    }
    if (existing && ((data.name && data.name !== existing.name) || (data.clientName && data.clientName !== existing.clientName))) {
        effects.siteDenorm = {
            siteId: existing.id, ...(data.name ? { siteName: String(data.name) } : {}), ...(data.clientName ? { clientName: String(data.clientName) } : {}),
        };
    }
    if (existing && effects.addToContract) effects.recomputeSite = existing.id;
    if (Object.keys(effects).length) item.effects = effects;

    if (existing) {
        Object.assign(item, { targetId: existing.id, label: `${existing.code ?? existing.name} — ${data.name ?? existing.name}`, data });
        item.action = sameAs(existing as unknown as Record<string, unknown>, data) && !effects.addToContract ? 'unchanged' : 'update';
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
    else if (!client) item.messages.push(clientNotFound(v.client));
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
    const site = v.site ? findSite(ctx, v.site) : undefined;
    if (v.site && !site) item.messages.push(`Site ${v.site} introuvable (code SIT-… ou réf. externe).`);
    const code = v.code ? upper(v.code) : '';
    let existing: Doc<Meter> | undefined;
    if (code) {
        existing = ctx.meters.find(m => upper(m.code) === code);
        if (!existing) item.messages.push(`Code compteur ${code} inconnu (laissez vide pour créer).`);
    } else if (v.externalRef) {
        existing = byRef(ctx.meters, v.externalRef);
    }
    if (!existing && !code && site && v.reference) {
        existing = ctx.meters.find(m => m.siteId === site.id && norm(m.reference) === norm(v.reference));
        const key = `${site.id}|${norm(v.reference)}`;
        if (seen.has(key)) item.messages.push(`Même site et même PDL/PCE que la ligne ${seen.get(key)}.`);
        else seen.set(key, row.line);
    }
    const taken = refTakenBy(ctx.meters, v.externalRef, existing?.id);
    if (taken) item.messages.push(`Réf. externe ${v.externalRef} déjà portée par le compteur ${taken.code ?? taken.name}.`);

    // Doublon probable : aucune clé et un compteur du même site de même nom.
    if (!existing && !code && !v.externalRef && !v.reference && site && v.name) {
        const key = `@${site.id}|${norm(v.name)}`;
        const twin = ctx.meters.find(m => m.siteId === site.id && norm(m.name) === norm(v.name));
        if (twin) {
            item.messages.push(`Doublon probable du compteur ${twin.code ?? twin.name} (même site, même nom) : indiquez son code pour le mettre à jour, `
                + 'ou un PDL/PCE ou une réf. externe pour créer un autre compteur.');
        } else if (seen.has(key)) {
            item.messages.push(`Même site et même nom que la ligne ${seen.get(key)}, sans PDL/PCE ni réf. externe.`);
        } else seen.set(key, row.line);
    }

    const data = plain(v, ['externalRef', 'name', 'reference', 'location', 'status']);
    if (site) Object.assign(data, { siteId: site.id, siteName: site.name, ...(site.clientName && { clientName: site.clientName }) });
    if (v.meterType) {
        const type = ctx.meterTypes.find(t => norm(t.code) === norm(v.meterType) || norm(t.label) === norm(v.meterType));
        if (!type) item.messages.push(`Type de compteur « ${v.meterType} » inconnu.`);
        else Object.assign(data, { type: type.label, unit: type.unit });
    }
    if (existing && site && site.id !== existing.siteId) item.warnings.push(`Compteur déplacé vers le site ${site.code ?? site.name}.`);
    if (!existing && (!site || !v.name || !v.meterType)) item.messages.push('Site, nom et type obligatoires pour créer un compteur.');
    if (item.messages.length) return item;
    if (existing) {
        Object.assign(item, { targetId: existing.id, label: `${existing.code} — ${data.name ?? existing.name}`, data });
        item.action = sameAs(existing as unknown as Record<string, unknown>, data) ? 'unchanged' : 'update';
    } else Object.assign(item, { action: 'create', data: { status: 'on', ...data } });
    return item;
}

function planReading(ctx: Context, row: ParsedRow, seen: Map<string, number>, pending: Map<string, { at: number; value: number }[]>): PlanItem {
    const v = row.values;
    const item: PlanItem = { line: row.line, action: 'error', label: `${v.meter ?? ''} ${v.date ? String(v.date).slice(0, 10) : ''}`.trim(), messages: [...row.errors], warnings: [] };
    const meter = v.meter ? findMeter(ctx, v.meter) : undefined;
    if (!v.meter) item.messages.push('Compteur obligatoire.');
    else if (!meter) item.messages.push(`Compteur ${v.meter} introuvable (code CPT-… ou réf. externe).`);
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

/** Indices de base « CODE=valeur@AAAA-MM; … » lus ; erreurs explicites. */
export function parseBaseIndices(text: string, indices: { id: string; code: string }[]): { values: ServiceInitialIndexValue[]; errors: string[] } {
    const values: ServiceInitialIndexValue[] = [];
    const errors: string[] = [];
    for (const part of text.split(';').map(p => p.trim()).filter(Boolean)) {
        const m = /^([^=]+)=\s*([\d\s.,]+)\s*@\s*(\d{4})-(\d{2})$/.exec(part);
        const index = m ? indices.find(i => norm(i.code) === norm(m[1])) : undefined;
        const value = m ? Number(m[2].replace(/\s/g, '').replace(',', '.')) : NaN;
        if (!m) errors.push(`Indice de base « ${part} » : CODE=valeur@AAAA-MM attendu.`);
        else if (!index) errors.push(`Indice « ${m[1].trim()} » inconnu.`);
        else if (!(value > 0)) errors.push(`Indice ${index.code} : valeur de base positive attendue.`);
        else if (Number(m[4]) < 1 || Number(m[4]) > 12) errors.push(`Indice ${index.code} : mois ${m[3]}-${m[4]} invalide.`);
        else if (values.some(v => v.indexId === index.id)) errors.push(`Indice ${index.code} en double.`);
        else values.push({ indexId: index.id, value, period: `${m[3]}-${m[4]}` });
    }
    return { values, errors };
}

/** Révision de la prestation : règle, indices de base (un par indice de la règle), calendrier. */
function planRevision(ctx: Context, v: Record<string, CellValue>, data: Record<string, unknown>, existing: Doc<Service> | undefined, item: PlanItem) {
    let rule = existing?.revisionRuleId ? ctx.revisionRules.find(r => r.id === existing.revisionRuleId) : undefined;
    if (v.revisionRule) {
        rule = ctx.revisionRules.find(r => norm(r.code) === norm(v.revisionRule) || norm(r.name) === norm(v.revisionRule));
        if (!rule) { item.messages.push(`Règle de révision « ${v.revisionRule} » inconnue.`); return; }
        data.revisionRuleId = rule.id;
    }
    let base = existing?.initialIndexValues ?? [];
    if (v.baseIndices) {
        const parsed = parseBaseIndices(String(v.baseIndices), ctx.indices);
        item.messages.push(...parsed.errors);
        base = parsed.values;
        data.initialIndexValues = parsed.values;
    }
    if (v.revisionMonths !== null && v.revisionMonths !== undefined) {
        if (![1, 3, 6, 12].includes(Number(v.revisionMonths))) item.messages.push('Révision tous les : 1, 3, 6 ou 12 mois.');
        else data.revisionMonths = Number(v.revisionMonths);
    }
    if (v.revisionAnchor) {
        const anchor = parseAnchor(String(v.revisionAnchor));
        if (!anchor) item.messages.push(`Date anniversaire de révision « ${v.revisionAnchor} » invalide (JJ/MM).`);
        else data.revisionAnchor = anchor;
    }
    if (v.revisionFromStart !== null && v.revisionFromStart !== undefined) data.revisionFromStart = v.revisionFromStart;
    if (rule && rule.type !== 'FIXE' && (v.revisionRule || v.baseIndices)) {
        const missing = rule.indices.filter(ri => !base.some(b => b.indexId === ri.indexId))
            .map(ri => ctx.indices.find(i => i.id === ri.indexId)?.code ?? ri.indexId);
        if (missing.length) item.messages.push(`Indices de base manquants pour la règle ${rule.code} : ${missing.join(', ')}.`);
    }
    if (!rule && (v.baseIndices || v.revisionMonths || v.revisionAnchor)) item.warnings.push('Calendrier ou indices de révision sans règle de révision : prix ferme.');
}

function planService(ctx: Context, row: ParsedRow, pending: Map<string, { line: number; startDate: string; endDate: string }[]>): PlanItem {
    const v = row.values;
    const item: PlanItem = { line: row.line, action: 'error', label: `${v.site ?? ''} ${v.activity ?? ''}`.trim(), messages: [...row.errors], warnings: [] };

    let existing = v.externalRef ? byRef(ctx.services, v.externalRef) : undefined;
    const site = v.site ? findSite(ctx, v.site) : existing ? ctx.sites.find(s => s.id === existing!.siteId) : undefined;
    if (v.site && !site) item.messages.push(`Site ${v.site} introuvable (code SIT-… ou réf. externe).`);
    if (existing && site && existing.siteId !== site.id) item.messages.push(`La réf. externe ${v.externalRef} désigne une prestation d'un autre site.`);
    const contract = site?.contractId ? ctx.contracts.find(c => c.id === site.contractId) : undefined;
    if (site && !contract) item.messages.push(`Site ${site.code ?? site.name} sans contrat : rattachez-le d'abord à un contrat (import des sites, colonne Contrat).`);
    const activity = v.activity
        ? ctx.activities.find(a => norm(a.code) === norm(v.activity) || norm(a.label) === norm(v.activity))
        : existing ? ctx.activities.find(a => a.id === existing!.activityId) : undefined;
    if (v.activity && !activity) item.messages.push(`Activité « ${v.activity} » inconnue.`);
    if (activity && contract && !(contract.activityIds ?? []).includes(activity.id)) {
        item.messages.push(`Activité ${activity.code} absente du contrat ${contract.contractNumber ?? contract.id} : ajoutez-la au contrat (import des contrats, colonne Activités), sinon elle ne serait pas facturée.`);
    }
    if (!existing && (!site || !activity)) {
        if (!v.site) item.messages.push('Site obligatoire.');
        if (!v.activity) item.messages.push('Activité obligatoire.');
    }
    if (item.messages.length || !site || !contract || !activity) return item;

    const startDay = v.startDate ? isoDay(Date.parse(String(v.startDate))) : undefined;
    const endDay = v.endDate ? isoDay(Date.parse(String(v.endDate))) : undefined;
    if (!existing && startDay) {
        existing = ctx.services.find(s => s.siteId === site.id && s.activityId === activity.id && s.contractId === contract.id && toDay(s.startDate) === startDay);
    }
    const taken = refTakenBy(ctx.services, v.externalRef, existing?.id);
    if (taken) item.messages.push(`Réf. externe ${v.externalRef} déjà portée par une autre prestation.`);

    const data = plain(v, ['externalRef', 'label', 'price', 'p1Type', 'energyType', 'unitPrice', 'unit', 'isActive', 'comment']);
    if (startDay && startDay !== toDay(existing?.startDate)) data.startDate = startDay;
    if (endDay && endDay !== toDay(existing?.endDate)) data.endDate = endDay;
    if (existing && v.activity && activity.id !== existing.activityId) Object.assign(data, { activityId: activity.id, type: activity.type });
    if (v.schedule) {
        const schedule = ctx.schedules.find(t => norm(t.name) === norm(v.schedule));
        if (!schedule) item.messages.push(`Périodicité « ${v.schedule} » inconnue.`);
        else if (!scheduleOf(schedule.name)) item.messages.push(`Périodicité « ${schedule.name} » non facturable (mensuel, trimestriel, semestriel ou annuel).`);
        else data.scheduleId = schedule.id;
    }
    if (v.term) {
        const term = ctx.terms.find(t => norm(t.name) === norm(v.term));
        if (!term) item.messages.push(`Terme « ${v.term} » inconnu.`);
        else if (!termeOf(term.name)) item.messages.push(`Terme « ${term.name} » illisible (à échoir ou échu).`);
        else data.billingTermId = term.id;
    }
    if (v.vatRate) {
        const vat = ctx.vatRates.find(t => norm(t.code) === norm(v.vatRate));
        if (!vat) item.messages.push(`TVA « ${v.vatRate} » inconnue.`);
        else data.vatRateId = vat.id;
    }
    if (v.meter) {
        const meter = findMeter(ctx, v.meter);
        if (!meter) item.messages.push(`Compteur ${v.meter} introuvable (code CPT-… ou réf. externe).`);
        else if (meter.siteId !== site.id) item.messages.push(`Le compteur ${meter.code ?? v.meter} n'est pas sur ce site.`);
        else if (activity.type !== 'P1') item.messages.push('Un compteur ne se rattache qu\'à une prestation P1.');
        else data.meterId = meter.id;
    }
    planRevision(ctx, v, data, existing, item);
    if (!existing && v.price === null) item.messages.push('Montant annuel HT obligatoire pour créer une prestation.');
    if (!existing && !startDay) item.messages.push('Date de début obligatoire pour créer une prestation.');

    // Période finale : fin par défaut = fin du contrat.
    const start = (data.startDate ?? toDay(existing?.startDate)) as string | undefined;
    const end = (data.endDate ?? toDay(existing?.endDate) ?? (existing ? undefined : toDay(contract.endDate))) as string | undefined;
    if (start && end && end < start) item.messages.push('La date de fin doit être postérieure ou égale à la date de début.');
    const cStart = toDay(contract.startDate);
    const cEnd = toDay(contract.endDate);
    if (start && ((cStart && start < cStart) || (cEnd && end && end > cEnd))) {
        item.warnings.push(`Période hors de celle du contrat ${contract.contractNumber ?? ''} (${cStart ?? '?'} → ${cEnd ?? '?'}) : rien n'est facturé hors contrat.`);
    }

    // Recouvrement : deux prestations actives du même site et de la même activité seraient facturées deux fois.
    const active = (data.isActive ?? existing?.isActive) !== false;
    if (active && start && item.messages.length === 0) {
        const period = { startDate: start, endDate: end };
        const clash = ctx.services.find(s => s.id !== existing?.id && s.siteId === site.id && s.activityId === activity.id
            && s.contractId === contract.id && s.isActive !== false && periodsOverlap(s, period));
        if (clash) {
            item.messages.push(`Recouvre la prestation ${activity.code} du ${toDay(clash.startDate) ?? '?'} au ${toDay(clash.endDate) ?? 'sans fin'} `
                + '(facturée deux fois) : terminez-la avant, ou désignez-la (réf. externe, ou même date de début) pour la modifier.');
        }
        const key = `${site.id}|${activity.id}`;
        const twin = (pending.get(key) ?? []).find(p => periodsOverlap(p, period));
        if (twin) item.messages.push(`Recouvre la prestation de la ligne ${twin.line}.`);
        if (!pending.has(key)) pending.set(key, []);
        pending.get(key)!.push({ line: row.line, startDate: start, endDate: end ?? '' });
    }
    if (item.messages.length) return item;

    item.label = `${site.code ?? site.name} — ${activity.code}${start ? ` dès le ${start}` : ''}`;
    if (existing) {
        Object.assign(item, { targetId: existing.id, data });
        item.action = sameAs(existing as unknown as Record<string, unknown>, data) ? 'unchanged' : 'update';
    } else {
        Object.assign(item, {
            action: 'create',
            data: {
                contractId: contract.id, siteId: site.id, activityId: activity.id, type: activity.type, isActive: true,
                ...(end && { endDate: end }), ...data,
            },
        });
    }
    item.effects = { ...(item.effects ?? {}), recomputeSite: site.id };
    return item;
}

/** Paramétrage P1 : une ligne = une version (jamais d'écrasement : une autre valeur à la même date est refusée). */
function planP1(ctx: Context, row: ParsedRow, seen: Map<string, number>): PlanItem {
    const v = row.values;
    const item: PlanItem = { line: row.line, action: 'error', label: `${v.element ?? ''} ${v.parametre ?? ''}`.trim(), messages: [...row.errors], warnings: [] };
    if (!v.element || !v.parametre || v.valeur === null || !v.motif) {
        if (!v.element) item.messages.push('Élément obligatoire.');
        if (!v.parametre && !row.errors.some(e => e.startsWith('Paramètre'))) item.messages.push('Paramètre obligatoire.');
        if (v.valeur === null) item.messages.push('Valeur obligatoire (une valeur inconnue ne se saisit pas).');
        if (!v.motif) item.messages.push('Motif obligatoire.');
        return item;
    }
    if (item.messages.length) return item;
    const [scope, key] = String(v.parametre).split('.') as [P1Scope, string];
    let id: string | undefined;
    let elementLabel = String(v.element);
    if (scope === 'site' || scope === 'poste') {
        const site = findSite(ctx, v.element);
        id = site?.id; if (site) elementLabel = site.code ?? site.name;
    } else if (scope === 'meter') {
        const meter = findMeter(ctx, v.element);
        id = meter?.id; if (meter) elementLabel = meter.code;
    } else {
        const contract = findContract(ctx, v.element);
        id = contract?.id; if (contract) elementLabel = contract.contractNumber ?? contract.id;
    }
    if (!id) { item.messages.push(`Élément « ${v.element} » introuvable pour un paramètre de ${({ site: 'site', poste: 'poste (site)', meter: 'compteur', contract: 'contrat' })[scope]}.`); return item; }
    if (scope === 'poste' && !v.poste) { item.messages.push('Poste obligatoire pour ce paramètre (désignation du poste de consommation).'); return item; }

    const dateEffet = v.dateEffet ? isoDay(Date.parse(String(v.dateEffet))) : null;
    const siteId = scope === 'site' || scope === 'poste' ? id : undefined;
    const checked = validateParam(scope, key, String(v.valeur), {
        stationCodes: ctx.stationCodes,
        ...(siteId && { siteMeterCodes: ctx.meters.filter(m => m.siteId === siteId).map(m => m.code) }),
    });
    if ('error' in checked) { item.messages.push(checked.error); return item; }

    const docId = scope === 'meter' ? P1_DOC_ID.meter(id) : scope === 'contract' ? P1_DOC_ID.contract(id) : P1_DOC_ID.site(id);
    const doc = ctx.p1Docs.get(docId);
    const poste = scope === 'poste' ? Object.values((doc as P1SiteDoc | undefined)?.postes ?? {}).find(p => !p.retireLe && norm(p.designation) === norm(v.poste)) : undefined;
    const versions = (scope === 'poste' ? poste?.params[key] : doc?.params[key]) ?? [];
    const dupKey = `${docId}|${key}|${norm(v.poste)}|${dateEffet ?? ''}`;
    if (seen.has(dupKey)) { item.messages.push(`Même paramètre et même date d'effet que la ligne ${seen.get(dupKey)}.`); return item; }
    seen.set(dupKey, row.line);

    item.label = `${elementLabel}${scope === 'poste' ? ` / ${v.poste}` : ''} — ${paramDef(scope, key)!.label} ${dateEffet ? `au ${dateEffet.split('-').reverse().join('/')}` : '(origine)'}`;
    const active = versions.find(x => !x.retireLe && (x.dateEffet ?? null) === dateEffet);
    if (active) {
        if (sameValue(active.valeur, checked.value)) { Object.assign(item, { action: 'unchanged', targetId: docId }); return item; }
        item.messages.push(`Une autre valeur est déjà en vigueur ${dateEffet ? 'à cette date' : 'comme valeur d\'origine'} : retirez cette version à l'écran (avec son motif) pour la remplacer.`);
        return item;
    }
    if (scope === 'poste' && !poste) item.warnings.push(`Poste « ${v.poste} » créé.`);
    Object.assign(item, {
        action: 'create',
        data: {
            target: { scope, id, ...(scope === 'poste' && { posteDesignation: String(v.poste).trim(), posteId: poste?.id }) }, key,
            version: { valeur: checked.value, dateEffet, motif: String(v.motif), document: v.document ? String(v.document) : null },
        },
    });
    return item;
}

/** « contrat », « énergies : gaz, fioul », « sites : SIT-1, SIT-2 » → périmètre ; message sinon. */
function parsePerimetre(ctx: Context, text: string): PerimetreFormule | string {
    const t = String(text).trim();
    if (/^contrat$/i.test(t) || t === '') return { type: 'contrat' };
    const m = /^(energies|énergies|sites)\s*:\s*(.+)$/i.exec(t);
    if (!m) return `périmètre « ${t} » : « contrat », « énergies : gaz, fioul » ou « sites : SIT-00001, SIT-00002 ».`;
    const items = m[2].split(',').map(x => x.trim()).filter(Boolean);
    if (/^sites$/i.test(m[1])) {
        const ids: string[] = [];
        for (const code of items) { const site = findSite(ctx, code); if (!site) return `site ${code} introuvable.`; ids.push(site.id); }
        return { type: 'sites', siteIds: ids };
    }
    const energies = items.map(e => norm(e).replace(/\s+/g, '_')) as Energie[];
    const bad = energies.filter(e => !ENERGIES.includes(e));
    return bad.length ? `énergie(s) inconnue(s) : ${bad.join(', ')} (${ENERGIES.join(', ')}).` : { type: 'energies', energies };
}

/** Formules P1 : une ligne = une version ; la formule est créée si besoin. */
function planP1Formule(ctx: Context, row: ParsedRow, seen: Map<string, number>): PlanItem {
    const v = row.values;
    const item: PlanItem = { line: row.line, action: 'error', label: `${v.contrat ?? ''} — ${v.nom ?? ''}`, messages: [...row.errors], warnings: [] };
    const contract = v.contrat ? findContract(ctx, v.contrat) : undefined;
    if (!v.contrat) item.messages.push('Contrat obligatoire.');
    else if (!contract) item.messages.push(`Contrat ${v.contrat} introuvable (n° CTN-… ou réf. externe).`);
    for (const [k, label] of [['nom', 'Formule'], ['motif', 'Motif'], ['termes', 'Termes'], ['forme', 'Forme'], ['periodicite', 'Périodicité']] as const) {
        if (v[k] === null || v[k] === undefined) { if (!row.errors.some(e => e.startsWith(label))) item.messages.push(`${label} obligatoire.`); }
    }
    if (item.messages.length || !contract) return item;
    const termes = parseTermes(String(v.termes));
    if (typeof termes === 'string') { item.messages.push(`Termes : ${termes}`); return item; }
    // Mois M0 : AAAA-MM, une date (Excel : « 2025-01-01 00:00 ») ou MM/AAAA.
    const m0Text = v.dateM0 ? String(v.dateM0).trim() : '';
    const m0Fr = /^(\d{1,2})\/(\d{4})$/.exec(m0Text);
    const dateM0 = !m0Text ? null : m0Fr ? `${m0Fr[2]}-${m0Fr[1].padStart(2, '0')}` : /^\d{4}-\d{2}/.test(m0Text) ? m0Text.slice(0, 7) : m0Text;
    if (dateM0 && !/^\d{4}-\d{2}$/.test(dateM0)) { item.messages.push('Mois M0 : AAAA-MM.'); return item; }
    const version: FormuleVersion = {
        forme: v.forme as 'A' | 'B', mode: (v.mode as FormuleVersion['mode']) ?? 'standard', baseEnergetique: (v.baseEnergetique as 'PCS' | 'PCI') ?? 'PCS',
        unitePrix: (v.unitePrix as FormuleVersion['unitePrix']) ?? 'EUR/MWh', dateM0, m0Manquante: v.m0Manquante ? String(v.m0Manquante) : null,
        regimeKmol: (v.regimeKmol as 'variable' | 'fixe') ?? 'variable', prixMoleculeNegocie: typeof v.prixMolecule === 'number' ? v.prixMolecule : null,
        prixFixe: v.prixFixe === true, periodicite: v.periodicite as FormuleVersion['periodicite'], termes,
    };
    const check = validateFormule(version, ctx.indexCodes);
    item.messages.push(...check.errors);
    item.warnings.push(...check.warnings);
    const doc = ctx.p1Docs.get(P1_DOC_ID.contract(contract.id)) as P1ContractDoc | undefined;
    const formule = Object.values(doc?.formules ?? {}).find(f => !f.retireLe && norm(f.nom) === norm(v.nom));
    let creation: { usage: 'chauffage' | 'ecs'; perimetre: PerimetreFormule } | undefined;
    if (!formule) {
        if (!v.usage) item.messages.push('Usage obligatoire pour créer la formule.');
        const perimetre = parsePerimetre(ctx, String(v.perimetre ?? ''));
        if (typeof perimetre === 'string') item.messages.push(`Périmètre : ${perimetre}`);
        else if (v.usage) creation = { usage: v.usage as 'chauffage' | 'ecs', perimetre };
        item.warnings.push(`Formule « ${v.nom} » créée.`);
    }
    const dateEffet = v.dateEffet ? isoDay(Date.parse(String(v.dateEffet))) : null;
    const dupKey = `${contract.id}|${norm(v.nom)}|${dateEffet ?? ''}`;
    if (seen.has(dupKey)) item.messages.push(`Même formule et même date d'effet que la ligne ${seen.get(dupKey)}.`);
    else seen.set(dupKey, row.line);
    if (item.messages.length) return item;
    item.label = `${contract.contractNumber ?? contract.id} — ${v.nom} ${dateEffet ? `au ${dateEffet.split('-').reverse().join('/')}` : '(origine)'}`;
    const active = formule?.versions.find(x => !x.retireLe && (x.dateEffet ?? null) === dateEffet);
    if (active) {
        if (sameValue(active.valeur, version)) { Object.assign(item, { action: 'unchanged', targetId: formule!.id }); return item; }
        item.messages.push('Une autre version de cette formule est déjà en vigueur à cette date : retirez-la à l\'écran (avec son motif) pour la remplacer.');
        return item;
    }
    Object.assign(item, {
        action: 'create',
        data: { contractId: contract.id, formuleId: formule?.id, nom: String(v.nom).trim(), creation, version, meta: { dateEffet, motif: String(v.motif), document: v.document ? String(v.document) : null } },
    });
    return item;
}

/** Réel P1 déjà importé des sites du fichier, et mois déjà régularisés (factures et avoirs de leurs contrats). */
async function loadP1Reel(ctx: Context, refs: CellValue[]): Promise<void> {
    const sites = [...new Set(refs.map(r => findSite(ctx, r)).filter((s): s is Doc<Site> => !!s))];
    const ids = sites.map(s => s.id);
    const contracts = [...new Set(sites.map(s => s.contractId).filter(Boolean))];
    const chunk = <T>(l: T[]) => Array.from({ length: Math.ceil(l.length / 30) }, (_, i) => l.slice(i * 30, i * 30 + 30));
    const [reel, invoices, creditNotes] = await Promise.all([
        Promise.all(chunk(ids).map(c => adminDb.collection('p1Reel').where('siteId', 'in', c).get())).then(s => s.flatMap(x => x.docs)),
        Promise.all(chunk(contracts).map(c => adminDb.collection('invoices').where('contractId', 'in', c).get())).then(s => s.flatMap(x => x.docs)),
        Promise.all(chunk(contracts).map(c => adminDb.collection('creditNotes').where('contractId', 'in', c).get())).then(s => s.flatMap(x => x.docs)),
    ]);
    for (const d of reel) ctx.p1Reel.set(d.id, Number(d.get('montantHt')));
    for (const d of [...invoices, ...creditNotes]) {
        if (d.get('status') === 'cancelled' || d.get('status') === 'proforma' || d.get('cancelledByCreditNoteId')) continue;
        for (const l of (d.get('lineItems') ?? []) as { p1Regul?: { siteId: string; mois?: string[] } }[]) {
            for (const m of l.p1Regul?.mois ?? []) ctx.p1Regularises.add(`${l.p1Regul!.siteId}|${m}`);
        }
    }
}

/** Mois « AAAA-MM » lu d'un texte (AAAA-MM, MM/AAAA, date) ; null sinon. */
function moisOf(v: CellValue): string | null {
    const t = String(v ?? '').trim();
    const fr = /^(\d{1,2})\/(\d{4})$/.exec(t);
    if (fr && +fr[1] >= 1 && +fr[1] <= 12) return `${fr[2]}-${fr[1].padStart(2, '0')}`;
    const iso = /^(\d{4})-(\d{2})/.exec(t);
    if (iso && +iso[2] >= 1 && +iso[2] <= 12) return `${iso[1]}-${iso[2]}`;
    const day = /^\d{1,2}\/(\d{1,2})\/(\d{4})/.exec(t);
    return day && +day[1] >= 1 && +day[1] <= 12 ? `${day[2]}-${day[1].padStart(2, '0')}` : null;
}

/** Réel P1 du moteur : site + mois ; un montant d'un mois déjà régularisé ne change plus. */
function planP1Reel(ctx: Context, row: ParsedRow, seen: Map<string, number>): PlanItem {
    const v = row.values;
    const item: PlanItem = { line: row.line, action: 'error', label: `${v.site ?? ''} ${v.mois ?? ''}`.trim(), messages: [...row.errors], warnings: [] };
    const site = v.site ? findSite(ctx, v.site) : undefined;
    if (!v.site) item.messages.push('Site obligatoire.');
    else if (!site) item.messages.push(`Site ${v.site} introuvable (code SIT-… ou réf. externe).`);
    const mois = v.mois ? moisOf(v.mois) : null;
    if (!v.mois) item.messages.push('Mois obligatoire.');
    else if (!mois) item.messages.push(`Mois « ${v.mois} » illisible (AAAA-MM).`);
    if (v.montant === null && !row.errors.some(e => e.startsWith('Montant'))) item.messages.push('Montant P1 HT obligatoire.');
    if (item.messages.length || !site || !mois || v.montant === null) return item;
    const usage = (v.usage as 'total' | 'chauffage' | 'ecs' | null) ?? 'total';
    // Identifiant : « site_mois » pour le total (antérieur aux usages), « site_mois_usage » sinon.
    const id = usage === 'total' ? `${site.id}_${mois}` : `${site.id}_${mois}_${usage}`;
    if (seen.has(id)) { item.messages.push(`Même site, même mois et même usage que la ligne ${seen.get(id)}.`); return item; }
    seen.set(id, row.line);
    item.label = `${site.code ?? site.name} — ${mois}${usage === 'total' ? '' : ` (${usage === 'ecs' ? 'ECS' : 'chauffage'})`}`;
    const montant = Number(v.montant);
    const current = ctx.p1Reel.get(id);
    if (current !== undefined && current === montant) { Object.assign(item, { action: 'unchanged', targetId: id }); return item; }
    if (ctx.p1Regularises.has(`${site.id}|${mois}`)) {
        item.messages.push(`Mois déjà régularisé (réel ${current ?? '?'} €) : un nouveau montant ne s'applique plus (corriger par une facture ou un avoir).`);
        return item;
    }
    Object.assign(item, {
        action: current === undefined ? 'create' : 'update', targetId: id,
        data: { siteId: site.id, codeSite: site.code ?? null, contractId: site.contractId || null, mois, usage, montantHt: montant },
    });
    if (current !== undefined) item.warnings.push(`Remplace ${current} €.`);
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
        const refs = new Set(parsed.rows.map(r => upper(r.values.meter)));
        await loadReadings(ctx, ctx.meters.filter(m => refs.has(upper(m.code)) || (m.externalRef && refs.has(upper(m.externalRef)))).map(m => m.id));
    }
    if (entity === 'p1reel') await loadP1Reel(ctx, parsed.rows.map(r => r.values.site));
    const seen = new Map<string, number>();
    const pending = new Map<string, { at: number; value: number }[]>();
    const pendingServices = new Map<string, { line: number; startDate: string; endDate: string }[]>();
    const items = parsed.rows.map(row => {
        switch (entity) {
            case 'clients': return planClient(ctx, row, seen);
            case 'contracts': return planContract(ctx, row, seen);
            case 'sites': return planSite(ctx, row, seen);
            case 'services': return planService(ctx, row, pendingServices);
            case 'contacts': return planContact(ctx, row, seen);
            case 'meters': return planMeter(ctx, row, seen);
            case 'readings': return planReading(ctx, row, seen, pending);
            case 'p1': return planP1(ctx, row, seen);
            case 'p1formules': return planP1Formule(ctx, row, seen);
            case 'p1reel': return planP1Reel(ctx, row, seen);
        }
    });
    for (const i of items) counts[i.action]++;
    return { entity, fileErrors: [], ignoredColumns: parsed.ignoredColumns, missingColumns: parsed.missingColumns, items, counts };
}

// --- Écriture ---

const CODES: Partial<Record<ImportEntityKey, { counter: string; prefix: string; field: string; collection: string }>> = {
    clients: { counter: 'client', prefix: 'CLI', field: 'externalCode', collection: 'clients' },
    contracts: { counter: 'contract', prefix: 'CTN', field: 'contractNumber', collection: 'contracts' },
    sites: { counter: 'site', prefix: 'SIT', field: 'code', collection: 'sites' },
    meters: { counter: 'meter', prefix: 'CPT', field: 'code', collection: 'meters' },
};
const COLLECTIONS: Record<ImportEntityKey, string> = {
    clients: 'clients', contracts: 'contracts', sites: 'sites', services: 'services', contacts: 'contacts', meters: 'meters', readings: 'meterReadings', p1: 'p1Parametrage', p1formules: 'p1Parametrage', p1reel: 'p1Reel',
};

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

/** Dates des contrats et relevés : en horodatage, comme à la saisie. */
function toStored(entity: ImportEntityKey, doc: Record<string, unknown>): Record<string, unknown> {
    const fields = entity === 'contracts' ? ['startDate', 'endDate', 'terminationDate'] : entity === 'readings' ? ['date'] : [];
    const out = { ...doc };
    for (const f of fields) if (typeof out[f] === 'string') out[f] = Timestamp.fromDate(new Date(String(out[f])));
    return out;
}

type Write = (b: FirebaseFirestore.WriteBatch) => void;

/** Report d'un renommage de client sur les noms recopiés : contrats, sites, compteurs. */
async function renameClientWrites(r: NonNullable<Effects['renameClient']>): Promise<Write[]> {
    const writes: Write[] = [];
    const [contracts, sites] = await Promise.all([
        adminDb.collection('contracts').where('clientId', '==', r.clientId).get(),
        adminDb.collection('sites').where('clientId', '==', r.clientId).get(),
    ]);
    for (const c of contracts.docs) {
        const name = String(c.get('name') ?? '');
        const label = c.get('label');
        writes.push(b => b.update(c.ref, {
            clientName: r.to,
            ...(label ? { name: `${r.to} - ${label}` } : name.startsWith(r.from) ? { name: r.to + name.slice(r.from.length) } : {}),
        }));
    }
    for (const s of sites.docs) writes.push(b => b.update(s.ref, { clientName: r.to }));
    const siteIds = sites.docs.map(s => s.id);
    for (let i = 0; i < siteIds.length; i += 30) {
        const meters = await adminDb.collection('meters').where('siteId', 'in', siteIds.slice(i, i + 30)).get();
        for (const m of meters.docs) writes.push(b => b.update(m.ref, { clientName: r.to }));
    }
    return writes;
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
    if (entity === 'p1') return applyP1(plan, meta);
    if (entity === 'p1formules') return applyP1Formules(plan, meta);
    if (entity === 'p1reel') return applyP1Reel(plan, meta);
    const creates = plan.items.filter(i => i.action === 'create');
    const updates = plan.items.filter(i => i.action === 'update');
    const codes = await reserveCodes(entity, creates.length);
    const now = new Date().toISOString();
    const coll = adminDb.collection(COLLECTIONS[entity]);
    const spec = CODES[entity];
    const warn = (item: PlanItem) => (item.warnings.length ? { warnings: item.warnings } : {});

    const writes: Write[] = [];
    const results: ImportReport['results'] = [];
    const contractLink = (item: PlanItem, siteId: string) => {
        if (item.effects?.addToContract) {
            const ref = adminDb.collection('contracts').doc(item.effects.addToContract);
            writes.push(b => b.update(ref, { siteIds: FieldValue.arrayUnion(siteId) }));
        }
        if (item.effects?.removeFromContract) {
            const ref = adminDb.collection('contracts').doc(item.effects.removeFromContract);
            writes.push(b => b.update(ref, { siteIds: FieldValue.arrayRemove(siteId) }));
        }
    };

    creates.forEach((item, i) => {
        const ref = coll.doc();
        const stamp = entity === 'meters'
            ? { lastModified: now, modifiedBy: meta.by ?? 'import' }
            : entity === 'clients' ? { createdAt: now, ...(meta.by && { createdBy: meta.by }) }
            : entity === 'contracts' ? {
                createdAt: now, createdBy: meta.by ?? 'import', validationStatus: 'validated', validatedAt: now,
                validatedBy: meta.source === 'api' ? `API (${meta.by ?? ''})` : 'import',
            }
            : entity === 'readings' ? { source: meta.source === 'api' ? 'API' : 'IMPORT' } : {};
        const doc = toStored(entity, { ...item.data, ...stamp, ...(spec && { [spec.field]: codes[i] }) });
        writes.push(b => b.set(ref, doc));
        results.push({ line: item.line, action: 'create', id: ref.id, ...(spec && { code: codes[i] }), ...warn(item) });
        if (entity === 'sites') contractLink(item, ref.id);
    });
    const followUps: Promise<Write[]>[] = [];
    for (const item of updates) {
        const ref = coll.doc(item.targetId!);
        const stamp = entity === 'meters' ? { lastModified: now, modifiedBy: meta.by ?? 'import' } : {};
        writes.push(b => b.update(ref, toStored(entity, { ...item.data, ...stamp }) as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>));
        results.push({ line: item.line, action: 'update', id: ref.id, ...warn(item) });
        if (entity === 'sites') contractLink(item, ref.id);
        if (item.effects?.renameClient) followUps.push(renameClientWrites(item.effects.renameClient));
        const denorm = item.effects?.siteDenorm;
        if (denorm) {
            followUps.push(adminDb.collection('meters').where('siteId', '==', denorm.siteId).get().then(s => s.docs.map(m => (b: FirebaseFirestore.WriteBatch) =>
                b.update(m.ref, { ...(denorm.siteName && { siteName: denorm.siteName }), ...(denorm.clientName && { clientName: denorm.clientName }) }))));
        }
    }
    writes.push(...(await Promise.all(followUps)).flat());
    for (let i = 0; i < writes.length; i += 400) {
        const batch = adminDb.batch();
        writes.slice(i, i + 400).forEach(w => w(batch));
        await batch.commit();
    }

    // Montants des sites dont les prestations (ou le contrat) ont changé.
    const toRecompute = [...creates, ...updates].map(i => i.effects?.recomputeSite).filter((id): id is string => !!id);
    if (toRecompute.length) await recomputeSiteAmounts(toRecompute);

    for (const item of plan.items.filter(i => i.action === 'unchanged')) results.push({ line: item.line, action: 'unchanged', id: item.targetId!, ...warn(item) });
    results.sort((a, b) => a.line - b.line);
    const errors = plan.items.filter(i => i.action === 'error').map(i => ({ line: i.line, messages: i.messages }));
    const log = await adminDb.collection('imports').add({
        entity, fileName: meta.fileName ?? '', at: now, ...(meta.by && { by: meta.by }), source: meta.source ?? 'file',
        created: creates.length, updated: updates.length, unchanged: plan.counts.unchanged, rejected: errors.length,
        errors: errors.slice(0, 200),
    });
    return { importId: log.id, created: creates.length, updated: updates.length, unchanged: plan.counts.unchanged, errors, results };
}

/** Écriture d'un import P1 : versions ajoutées une à une (transactions du paramétrage P1), postes créés au besoin. */
async function applyP1(plan: ImportPlan, meta: { fileName?: string; by?: string; source?: 'file' | 'api' }): Promise<ImportReport> {
    const by = meta.by ?? 'import';
    const now = new Date().toISOString();
    const results: ImportReport['results'] = [];
    const errors = plan.items.filter(i => i.action === 'error').map(i => ({ line: i.line, messages: i.messages }));
    const postes = new Map<string, string>();
    let created = 0;
    for (const item of plan.items.filter(i => i.action === 'create')) {
        const { target, key, version } = item.data as { target: P1Target & { posteDesignation?: string }; key: string; version: NewVersion };
        try {
            if (target.scope === 'poste' && !target.posteId) {
                const k = `${target.id}|${norm(target.posteDesignation)}`;
                target.posteId = postes.get(k) ?? await addP1Poste(target.id, target.posteDesignation!, by);
                postes.set(k, target.posteId);
            }
            const v = await addP1Version({ scope: target.scope, id: target.id, ...(target.posteId && { posteId: target.posteId }) }, key, version, by);
            results.push({ line: item.line, action: 'create', id: v.id, ...(item.warnings.length && { warnings: item.warnings }) });
            created++;
        } catch (e) {
            errors.push({ line: item.line, messages: [(e as Error).message] });
        }
    }
    for (const item of plan.items.filter(i => i.action === 'unchanged')) results.push({ line: item.line, action: 'unchanged', id: item.targetId! });
    results.sort((a, b) => a.line - b.line);
    errors.sort((a, b) => a.line - b.line);
    const log = await adminDb.collection('imports').add({
        entity: 'p1', fileName: meta.fileName ?? '', at: now, by, source: meta.source ?? 'file',
        created, updated: 0, unchanged: plan.counts.unchanged, rejected: errors.length, errors: errors.slice(0, 200),
    });
    return { importId: log.id, created, updated: 0, unchanged: plan.counts.unchanged, errors, results };
}

/** Écriture d'un import de formules P1 : formules créées au besoin, versions ajoutées une à une. */
async function applyP1Formules(plan: ImportPlan, meta: { fileName?: string; by?: string; source?: 'file' | 'api' }): Promise<ImportReport> {
    const by = meta.by ?? 'import';
    const results: ImportReport['results'] = [];
    const errors = plan.items.filter(i => i.action === 'error').map(i => ({ line: i.line, messages: i.messages }));
    const created = new Map<string, string>();
    let count = 0;
    for (const item of plan.items.filter(i => i.action === 'create')) {
        const d = item.data as { contractId: string; formuleId?: string; nom: string; creation?: { usage: 'chauffage' | 'ecs'; perimetre: PerimetreFormule }; version: FormuleVersion; meta: { dateEffet: string | null; motif: string; document: string | null } };
        try {
            const key = `${d.contractId}|${norm(d.nom)}`;
            const formuleId = d.formuleId ?? created.get(key) ?? await addP1Formule(d.contractId, { nom: d.nom, ...d.creation! }, by);
            created.set(key, formuleId);
            await addP1FormuleVersion(d.contractId, formuleId, d.version, d.meta, by);
            results.push({ line: item.line, action: 'create', id: formuleId, ...(item.warnings.length && { warnings: item.warnings }) });
            count++;
        } catch (e) {
            errors.push({ line: item.line, messages: [(e as Error).message] });
        }
    }
    for (const item of plan.items.filter(i => i.action === 'unchanged')) results.push({ line: item.line, action: 'unchanged', id: item.targetId! });
    results.sort((a, b) => a.line - b.line);
    errors.sort((a, b) => a.line - b.line);
    const log = await adminDb.collection('imports').add({
        entity: 'p1formules', fileName: meta.fileName ?? '', at: new Date().toISOString(), by, source: meta.source ?? 'file',
        created: count, updated: 0, unchanged: plan.counts.unchanged, rejected: errors.length, errors: errors.slice(0, 200),
    });
    return { importId: log.id, created: count, updated: 0, unchanged: plan.counts.unchanged, errors, results };
}

/** Écriture du réel P1 : un document par site et par mois (identifiant « site_mois »). */
async function applyP1Reel(plan: ImportPlan, meta: { fileName?: string; by?: string; source?: 'file' | 'api' }): Promise<ImportReport> {
    const now = new Date().toISOString();
    const writes = plan.items.filter(i => i.action === 'create' || i.action === 'update');
    for (let i = 0; i < writes.length; i += 400) {
        const batch = adminDb.batch();
        for (const item of writes.slice(i, i + 400)) {
            batch.set(adminDb.collection('p1Reel').doc(item.targetId!), { ...item.data, importedAt: now, by: meta.by ?? 'import', fileName: meta.fileName ?? '' });
        }
        await batch.commit();
    }
    const results: ImportReport['results'] = plan.items.filter(i => i.action !== 'error')
        .map(i => ({ line: i.line, action: i.action as 'create' | 'update' | 'unchanged', id: i.targetId!, ...(i.warnings.length && { warnings: i.warnings }) }));
    const errors = plan.items.filter(i => i.action === 'error').map(i => ({ line: i.line, messages: i.messages }));
    const log = await adminDb.collection('imports').add({
        entity: 'p1reel', fileName: meta.fileName ?? '', at: now, by: meta.by ?? 'import', source: meta.source ?? 'file',
        created: plan.counts.create, updated: plan.counts.update, unchanged: plan.counts.unchanged, rejected: errors.length, errors: errors.slice(0, 200),
    });
    return { importId: log.id, created: plan.counts.create, updated: plan.counts.update, unchanged: plan.counts.unchanged, errors, results };
}
