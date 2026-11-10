import 'server-only';
import { FieldPath } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import {
    billingItems, billedUntil, dueDateFor, dueInvoiceLines, echeancesOf, frDay, vatTotals,
    type BillingInput, type BillingService, type BillingSite, type DueResult, type NamedRef,
} from '@/lib/billing/contract-billing';
import { toDay } from '@/lib/services/site-amounts';
import {
    getActivities, getClient, getContract, getIndexValues, getIndices, getInvoicesByContract, resolveIssuingCompany, resolvePaymentTerm,
} from '@/services/firestore-admin';
import type { Activity, Client, Company, Contract, Invoice, RevisionRule, VatRate } from '@/lib/types';
import { P1_DOC_ID, formuleAu, valeurAu, type P1ContractDoc, type P1MeterDoc, type P1SiteDoc } from '@/lib/p1/stockage';
import { coefficientRevision, prixRevise, type SerieValues } from '@/lib/p1/formules';
import type { SaisonChauffe } from '@/lib/p1/saisons';
import type { Energie, TermeNc } from '@/lib/p1/parametrage';
import { loadSeries } from '@/services/p1-admin';
import { analytiqueContrat, avecAnalytique, figerAnalytique } from '@/services/analytique-admin';
import type { P1AcompteSource, P1DjuSource, P1ReleveSource, ReleveReading } from '@/lib/billing/contract-billing';
import type { CompteurFacture, UsageCompteur } from '@/lib/billing/p1-compteur';

/**
 * Facture d'un contrat à une date : toutes les échéances facturables de ses prestations (et montants de sites sans
 * prestation) jusqu'à cette date, d'après l'échéancier (lib/billing/contract-billing). Rien n'est écrit ici.
 */

export type PreparedInvoice = {
    contract: Contract;
    client: Client;
    company: Company;
    due: DueResult;
    /** Verrou optimiste : version de facturation du contrat lue, vérifiée à l'écriture de la facture. */
    billingVersion: number;
    invoice: Omit<Invoice, 'id' | 'invoiceNumber' | 'companyId' | 'issuedAt' | 'pdf' | 'einvoicing'>;
};

const docs = <T>(snap: FirebaseFirestore.QuerySnapshot) => snap.docs.map(d => ({ id: d.id, ...d.data() }) as T);

/** Données de facturation d'un contrat (sites, prestations, paramétrage). */
export async function loadBillingInput(contract: Contract): Promise<BillingInput> {
    const siteIds = contract.siteIds ?? [];
    const chunks: string[][] = [];
    for (let i = 0; i < siteIds.length; i += 30) chunks.push(siteIds.slice(i, i + 30));
    const [sites, services, activities, vatRates, schedules, terms, revisionRules, indices, indexValues] = await Promise.all([
        Promise.all(chunks.map(c => adminDb.collection('sites').where(FieldPath.documentId(), 'in', c).get())).then(s => s.flatMap(x => docs<BillingSite>(x))),
        adminDb.collection('services').where('contractId', '==', contract.id).get().then(s => docs<BillingService>(s)),
        getActivities(),
        adminDb.collection('vatRates').get().then(s => docs<VatRate>(s)),
        adminDb.collection('schedules').get().then(s => docs<NamedRef>(s)),
        adminDb.collection('terms').get().then(s => docs<NamedRef>(s)),
        adminDb.collection('revisionRules').get().then(s => docs<RevisionRule>(s)),
        getIndices(),
        getIndexValues(),
    ]);
    const auDju = services.some(s => s.p1Mode === 'dju');
    const p1 = services.some(s => s.p1Mode === 'acompte' || s.p1Mode === 'releve' || s.p1Mode === 'dju') ? await p1Source(contract.id, siteIds) : undefined;
    const releves = services.some(s => s.p1Mode === 'releve') || auDju ? await releveSource(siteIds, contract.id) : undefined;
    let p1Dju: P1DjuSource | undefined;
    if (auDju && p1 && releves?.dju) {
        const saisons = (await Promise.all(Array.from({ length: Math.ceil(siteIds.length / 30) }, (_, i) =>
            adminDb.collection('saisonsChauffe').where('siteId', 'in', siteIds.slice(i * 30, i * 30 + 30)).get()))).flatMap(x => x.docs.map(d => ({ id: d.id, ...d.data() }) as SaisonChauffe));
        p1Dju = { coefficient: p1.coefficient!, djuReference: p1.djuReference!, dju: releves.dju, saisons: siteId => saisons.filter(x => x.siteId === siteId) };
    }
    return {
        contract: {
            id: contract.id, siteIds, activityIds: contract.activityIds ?? [], invoicingType: contract.invoicingType,
            startDate: contract.startDate, endDate: contract.endDate, billingSchedule: contract.billingSchedule,
        },
        sites, services, activities: activities as Activity[], vatRates, schedules, terms, revisionRules, indices, indexValues, ...(p1 && { p1 }), ...(releves && { releves }), ...(p1Dju && { p1Dju }),
    };
}

/**
 * P1 au compteur : compteurs d'une prestation et leurs relevés (date au jour, heure de Paris), avec leur signe et leur
 * QE ; coefficient de gestion du contrat ; DJU de la station météo du site (paramétrage P1 daté).
 * Compteurs d'un mois : celui de la prestation ; sinon, en chauffage, les compteurs signés de la formule de NC des postes
 * du site (à défaut, ceux d'usage « vente », sinon « entrant ») ; en ECS, ceux d'usage ECS.
 */
export async function releveSource(siteIds: string[], contractId?: string): Promise<P1ReleveSource> {
    const chunk = <T>(l: T[]) => Array.from({ length: Math.ceil(l.length / 30) }, (_, i) => l.slice(i * 30, i * 30 + 30));
    const meters = (await Promise.all(chunk(siteIds).map(c => adminDb.collection('meters').where('siteId', 'in', c).get()))).flatMap(s => s.docs);
    const ids = [...meters.map(m => P1_DOC_ID.meter(m.id)), ...siteIds.map(P1_DOC_ID.site), ...(contractId ? [P1_DOC_ID.contract(contractId)] : [])];
    const p1Docs = ids.length ? new Map((await adminDb.getAll(...ids.map(id => adminDb.collection('p1Parametrage').doc(id)))).filter(d => d.exists).map(d => [d.id, d.data()])) : new Map();
    const readings = (await Promise.all(chunk(meters.map(m => m.id)).map(c => adminDb.collection('meterReadings').where('meterId', 'in', c).get()))).flatMap(s => s.docs);
    const byMeter = new Map<string, ReleveReading[]>();
    for (const r of readings) {
        const meterId = String(r.get('meterId'));
        if (!byMeter.has(meterId)) byMeter.set(meterId, []);
        byMeter.get(meterId)!.push({ id: r.id, date: toDay(r.get('date'))!, value: Number(r.get('value')), type: r.get('type') ?? undefined });
    }
    const meterDoc = (id: string) => p1Docs.get(P1_DOC_ID.meter(id)) as P1MeterDoc | undefined;
    const siteDoc = (id: string) => p1Docs.get(P1_DOC_ID.site(id)) as P1SiteDoc | undefined;
    const view = (m: FirebaseFirestore.QueryDocumentSnapshot, signe: 1 | -1, jour: string): CompteurFacture => ({
        id: m.id, code: String(m.get('code') ?? m.id), unit: m.get('unit') as string | undefined, signe,
        // Compteur d'ECS (m³) déduit d'une formule de NC : qECS (MWh PCS / m³), à défaut son QE.
        qe: (valeurAu<string>(meterDoc(m.id)?.params, 'usage', jour) === 'ecs' ? valeurAu<number>(meterDoc(m.id)?.params, 'qecs', jour) : null)
            ?? valeurAu<number>(meterDoc(m.id)?.params, 'qe', jour),
        readings: byMeter.get(m.id) ?? [],
    });

    // DJU des stations des sites (journaliers), chargés une fois.
    const stations = [...new Set(siteIds.flatMap(id => Object.values(siteDoc(id)?.params?.stationMeteo ?? []).map(v => (v as { valeur?: unknown }).valeur).filter((v): v is string => typeof v === 'string' && !!v)))];
    const djuParStation = new Map<string, Map<string, number>>();
    if (stations.length) {
        for (const part of chunk(stations)) {
            for (const d of (await adminDb.collection('djus').where('stationCode', 'in', part).get()).docs) {
                const code = String(d.get('stationCode'));
                if (!djuParStation.has(code)) djuParStation.set(code, new Map());
                djuParStation.get(code)!.set(String(d.get('date')).slice(0, 10), Number(d.get('value')) || 0);
            }
        }
    }
    const contractDoc = contractId ? p1Docs.get(P1_DOC_ID.contract(contractId)) as P1ContractDoc | undefined : undefined;
    return {
        meters: (siteId, serviceMeterId, mois, usage: UsageCompteur = 'ecs') => {
            const jour = `${mois}-01`;
            if (serviceMeterId) {
                const m = meters.find(x => x.id === serviceMeterId);
                return m ? [view(m, 1, jour)] : 'compteur de la prestation introuvable';
            }
            const duSite = meters.filter(m => m.get('siteId') === siteId);
            if (usage === 'chauffage') {
                const termes = Object.values(siteDoc(siteId)?.postes ?? {}).filter(p => !p.retireLe)
                    .flatMap(p => valeurAu<TermeNc[]>(p.params, 'formuleNc', jour) ?? []);
                if (termes.length) {
                    const out: CompteurFacture[] = [];
                    for (const t of termes) {
                        const m = duSite.find(x => String(x.get('code')) === t.codeCompteur);
                        if (!m) return `compteur ${t.codeCompteur} de la formule de NC introuvable sur le site`;
                        out.push(view(m, t.signe, jour));
                    }
                    return out;
                }
            }
            const usageDe = (m: FirebaseFirestore.QueryDocumentSnapshot) => valeurAu<string>(meterDoc(m.id)?.params, 'usage', jour);
            // Chauffage sans formule de NC : compteurs de vente, à défaut d'énergie entrante.
            const parUsage = usage === 'ecs' ? duSite.filter(m => usageDe(m) === 'ecs')
                : (duSite.filter(m => usageDe(m) === 'vente').length ? duSite.filter(m => usageDe(m) === 'vente') : duSite.filter(m => usageDe(m) === 'entrant'));
            return parUsage.length ? parUsage.map(m => view(m, 1, jour))
                : usage === 'ecs'
                    ? 'aucun compteur ECS : choisissez le compteur de la prestation, ou l\'usage « ECS » des compteurs dans le paramétrage P1'
                    : 'aucun compteur de chauffage : choisissez le compteur de la prestation, la formule de NC du site, ou l\'usage « vente » / « entrant » des compteurs';
        },
        coefContrat: mois => valeurAu<number>(contractDoc?.params, 'coefficientGestion', `${mois}-01`),
        dju: (siteId, debut, fin) => {
            const station = valeurAu<string>(siteDoc(siteId)?.params, 'stationMeteo', debut);
            if (!station) return 'station météo du site non renseignée (paramétrage P1) : DJU indisponibles pour le prorata';
            const serie = djuParStation.get(station);
            if (!serie) return `aucun DJU pour la station ${station}`;
            let total = 0, n = 0;
            for (let d = debut; d <= fin; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
                const v = serie.get(d);
                if (v !== undefined) { total += v; n++; }
            }
            const attendus = Math.round((Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${debut}T00:00:00Z`)) / 86_400_000) + 1;
            if (n < attendus) return `DJU de la station ${station} incomplets du ${debut.split('-').reverse().join('/')} au ${fin.split('-').reverse().join('/')} (${n}/${attendus} jours)`;
            return Math.round(total * 10) / 10;
        },
    };
}

/**
 * Source des acomptes P1 d'un contrat, à partir du paramétrage P1 daté, par usage :
 * - chauffage : quantité annuelle du site (sinon somme des cibles NB de ses postes, en MWh), répartition du contrat,
 *   prix de base du site × formule chauffage ;
 * - ECS : volume annuel ECS du site (m³), répartition ECS du contrat, prix de base ECS du site × formule ECS.
 */
export async function p1Source(contractId: string, siteIds: string[], series?: SerieValues): Promise<P1AcompteSource> {
    const meters = siteIds.length ? (await Promise.all(Array.from({ length: Math.ceil(siteIds.length / 30) }, (_, i) =>
        adminDb.collection('meters').where('siteId', 'in', siteIds.slice(i * 30, i * 30 + 30)).select('siteId').get()))).flatMap(s => s.docs) : [];
    const ids = [P1_DOC_ID.contract(contractId), ...siteIds.map(P1_DOC_ID.site), ...meters.map(m => P1_DOC_ID.meter(m.id))];
    const snaps = ids.length ? await adminDb.getAll(...ids.map(id => adminDb.collection('p1Parametrage').doc(id))) : [];
    const docs = new Map(snaps.filter(d => d.exists).map(d => [d.id, d.data()]));
    const contractDoc = (docs.get(P1_DOC_ID.contract(contractId)) ?? null) as P1ContractDoc | null;
    const seriesValues = series ?? (await loadSeries()).series;
    const day = (mois: string) => `${mois}-01`;
    const energiesOf = (siteId: string, date: string) => [...new Set(meters.filter(m => m.get('siteId') === siteId)
        .map(m => valeurAu<Energie>((docs.get(P1_DOC_ID.meter(m.id)) as P1MeterDoc | undefined)?.params, 'energie', date))
        .filter((e): e is Energie => !!e))];
    return {
        quantite: (siteId, mois, usage) => {
            const site = docs.get(P1_DOC_ID.site(siteId)) as P1SiteDoc | undefined;
            if (usage === 'ecs') return valeurAu<number>(site?.params, 'quantiteAcompteEcs', day(mois)) ?? 'volume annuel des acomptes ECS (site) non renseigné';
            const propre = valeurAu<number>(site?.params, 'quantiteAcompte', day(mois));
            if (propre) return propre;
            const postes = Object.values(site?.postes ?? {}).filter(p => !p.retireLe && valeurAu<TermeNc[]>(p.params, 'formuleNc', day(mois)));
            if (postes.length === 0) return 'quantité annuelle des acomptes (site) non renseignée, et aucun poste de consommation';
            let total = 0;
            for (const p of postes) {
                const nb = valeurAu<number>(p.params, 'cibleNb', day(mois));
                const unite = valeurAu<string>(p.params, 'cibleNbUnite', day(mois));
                if (!nb || unite !== 'MWh') return `quantité annuelle des acomptes (site) non renseignée, et cible NB du poste « ${p.designation} » ${!nb ? 'absente' : `en ${unite}`}`;
                total += nb;
            }
            return total;
        },
        repartition: (mois, usage) => valeurAu<number[]>(contractDoc?.params, usage === 'ecs' ? 'repartitionAcomptesEcs' : 'repartitionAcomptes', day(mois))
            ?? `répartition des acomptes ${usage === 'ecs' ? 'ECS' : 'P1'} du contrat non renseignée`,
        prixDetail: (siteId, mois, usage) => {
            const site = docs.get(P1_DOC_ID.site(siteId)) as P1SiteDoc | undefined;
            const f = formuleAu(contractDoc, siteId, energiesOf(siteId, day(mois)), usage, day(mois));
            if (!f) return `aucune formule de révision P1 ${usage === 'ecs' ? 'ECS' : 'chauffage'} en vigueur`;
            const base = valeurAu<number>(site?.params, usage === 'ecs' ? 'prixBaseEcs' : 'prixBase', day(mois));
            if (base === null) return `prix de base ${usage === 'ecs' ? 'ECS ' : ''}du site non renseigné`;
            const r = prixRevise(f.version, base, mois, seriesValues);
            if ('causes' in r) return r.causes.join(' ; ');
            return {
                prix: Math.round(r.prix * 1e6) / 1e6, base, coefficient: Math.round(r.coefficient * 1e6) / 1e6, source: 'p1', provisoire: r.provisoire,
                indices: r.lignes.map(l => ({ terme: l.terme, indice: l.indice, ponderation: l.ponderation, valeur: l.valeurMois, base: l.valeurBase, ratio: l.ratio, periode: l.periode })),
            };
        },
        coefficient: (siteId, mois) => {
            const f = formuleAu(contractDoc, siteId, energiesOf(siteId, day(mois)), 'chauffage', day(mois));
            if (!f) return 'aucune formule de révision P1 chauffage en vigueur';
            if (f.version.prixFixe) return { coefficient: 1, indices: [] };
            const c = coefficientRevision(f.version, mois, seriesValues);
            if ('causes' in c) return c.causes.join(' ; ');
            return { coefficient: c.coefficient, indices: c.lignes.map(l => ({ terme: l.terme, indice: l.indice, ponderation: l.ponderation, valeur: l.valeurMois, base: l.valeurBase, ratio: l.ratio, periode: l.periode })) };
        },
        djuReference: (siteId, jour) => {
            const site = docs.get(P1_DOC_ID.site(siteId)) as P1SiteDoc | undefined;
            const valeurs = Object.values(site?.postes ?? {}).filter(p => !p.retireLe).map(p => valeurAu<number>(p.params, 'djuReference', jour)).filter((v): v is number => !!v);
            return valeurs[0] ?? 'DJU de référence (contractuels) non renseignés sur le poste de consommation du site';
        },
        prix: (siteId, mois, usage) => {
            const site = docs.get(P1_DOC_ID.site(siteId)) as P1SiteDoc | undefined;
            const f = formuleAu(contractDoc, siteId, energiesOf(siteId, day(mois)), usage, day(mois));
            if (!f) return `aucune formule de révision P1 ${usage === 'ecs' ? 'ECS' : 'chauffage'} en vigueur`;
            const base = valeurAu<number>(site?.params, usage === 'ecs' ? 'prixBaseEcs' : 'prixBase', day(mois));
            if (usage === 'ecs' && base === null) return 'prix de base ECS du site non renseigné';
            const r = prixRevise(f.version, base, mois, seriesValues);
            return 'causes' in r ? r.causes.join(' ; ') : r.prix;
        },
    };
}

/** Prochaine date à laquelle une échéance deviendra facturable (pour un message utile). */
function nextBillableOn(input: BillingInput, invoices: Invoice[]): string | null {
    const { items } = billingItems(input);
    const billed = billedUntil(items, invoices);
    const start = toDay(input.contract.startDate)!;
    const next = items.map(i => echeancesOf(i, start, billed.get(i.key) ?? null, '9999-12-31', 1)[0]?.billableOn).filter(Boolean).sort();
    return next[0] ?? null;
}

export async function prepareContractInvoice(contractId: string, invoiceDate: string, opts: { isProforma: boolean; until?: string }): Promise<PreparedInvoice> {
    const [contract, versionSnap] = await Promise.all([getContract(contractId), adminDb.collection('contracts').doc(contractId).get()]);
    if (!contract) throw new Error('Contrat non trouvé.');
    const client = await getClient(contract.clientId);
    if (!client) throw new Error('Client non trouvé.');
    const company = await resolveIssuingCompany(contract, client);
    if ((contract.siteIds ?? []).length === 0) throw new Error("Aucun site n'est associé à ce contrat.");

    const [input, invoices, term] = await Promise.all([loadBillingInput(contract), getInvoicesByContract(contract.id), resolvePaymentTerm(contract, client)]);
    const day = toDay(invoiceDate) ?? toDay(new Date())!;
    const until = toDay(opts.until) ?? day;
    const due = dueInvoiceLines(input, invoices, until);
    if (due.errors.length) throw new Error(`Facture impossible : ${due.errors.join(' ')}`);
    if (due.lines.length === 0) {
        const next = nextBillableOn(input, invoices);
        throw new Error(`Rien à facturer au ${frDay(until)}${next ? ` : prochaine échéance facturable le ${frDay(next)}` : ' : tout est facturé'}.`);
    }
    // Analytique de chaque ligne : figée (codes enregistrés) à l'émission d'une facture, calculée pour un proforma.
    const analytique = opts.isProforma ? await analytiqueContrat(contract.id) : await figerAnalytique(contract.id);
    due.lines = avecAnalytique(analytique, due.lines);
    const starts = due.lines.map(l => l.periodStartDate!).sort();
    const ends = due.lines.map(l => l.periodEndDate!).sort();
    return {
        contract, client, company, due,
        billingVersion: Number(versionSnap.get('billingVersion') ?? 0),
        invoice: {
            contractId: contract.id,
            clientId: contract.clientId,
            clientName: contract.clientName,
            date: day,
            dueDate: dueDateFor(day, term),
            periodStartDate: starts[0],
            periodEndDate: ends[ends.length - 1],
            status: opts.isProforma ? 'proforma' : 'due',
            lineItems: due.lines,
            ...vatTotals(due.lines),
        },
    };
}

export type BatchRow = {
    contractId: string; contractNumber: string; clientName: string; periodStart: string; periodEnd: string;
    echeances: number; subtotal: number; tax: number; warnings: string[]; error?: string;
};

/** Aperçu de la facturation groupée : pour chaque contrat actif, ce que sa facture contiendrait à la date (même calcul). */
export async function previewBatchBilling(until: string): Promise<BatchRow[]> {
    const day = toDay(until)!;
    const snap = await adminDb.collection('contracts').where('status', '==', 'Actif').get();
    const rows: BatchRow[] = [];
    for (const c of snap.docs) {
        const contract = await getContract(c.id);
        if (!contract) continue;
        const base = { contractId: contract.id, contractNumber: contract.contractNumber ?? contract.id, clientName: contract.clientName };
        try {
            const [input, invoices] = await Promise.all([loadBillingInput(contract), getInvoicesByContract(contract.id)]);
            const due = dueInvoiceLines(input, invoices, day);
            if (!due.errors.length && due.lines.length === 0) continue;
            const totals = vatTotals(due.lines);
            const starts = due.lines.map(l => l.periodStartDate!).sort();
            const ends = due.lines.map(l => l.periodEndDate!).sort();
            rows.push({
                ...base, periodStart: starts[0] ?? '', periodEnd: ends[ends.length - 1] ?? '', echeances: due.lines.length,
                subtotal: totals.subtotal, tax: totals.tax, warnings: due.warnings, ...(due.errors.length && { error: due.errors.join(' ') }),
            });
        } catch (e) {
            rows.push({ ...base, periodStart: '', periodEnd: '', echeances: 0, subtotal: 0, tax: 0, warnings: [], error: (e as Error).message });
        }
    }
    return rows.sort((a, b) => a.clientName.localeCompare(b.clientName));
}
