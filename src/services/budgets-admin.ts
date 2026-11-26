import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { billedUntil, billingItems, echeancesOf, lineItemKeys } from '@/lib/billing/contract-billing';
import type { InvoiceLineItem } from '@/lib/types';
import { derniersCoefficients } from '@/lib/billing/previsionnel';
import { STATUTS_ENGAGES, type Commande } from '@/lib/commandes';
import type { SaisieHeures } from '@/lib/heures';
import {
    NATURES_DEPENSE, NON_AFFECTE, VIDE, activiteEnergie, normaliserLignes, partAnnee, synthese,
    type LigneBudget, type LigneSynthese, type Montants, type NatureDepense,
} from '@/lib/budgets/budget';
import type { BillingInput, BillingService, BillingSite, NamedRef } from '@/lib/billing/contract-billing';
import { achatsEnergieSite } from './energie-marge-admin';
import { getContract, getInvoicesByContract } from './firestore-admin';

/** Budgets des contrats : collection `budgets` (un document par contrat et par année), lue et écrite par le serveur. */

const COL = 'budgets';
const idDe = (contractId: string, annee: number) => `${contractId}_${annee}`;
const c2 = (n: number) => Math.round(n * 100) / 100;
const jour = (v: unknown): string => {
    if (v && typeof v === 'object' && 'toDate' in v) return (v as { toDate: () => Date }).toDate().toISOString().slice(0, 10);
    const s = String(v ?? '');
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
};

const jourSuivant = (j: string) => new Date(Date.parse(`${j}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const unAnAvant = (j: string) => `${Number(j.slice(0, 4)) - 1}${j.slice(4)}`.replace(/-02-29$/, '-02-28');

/**
 * Facturé d'une prestation sur la même période un an plus tôt ([debut, fin] décalés d'un an), au prorata des jours ;
 * null s'il n'y a aucune facture de la prestation sur cette période (pas d'historique).
 */
function factureMemePeriode(invoices: { status?: string; cancelledByCreditNoteId?: string; invoiceNumber?: string; lineItems?: InvoiceLineItem[] }[], cle: string, debut: string, fin: string): number | null {
    const [d, f] = [unAnAvant(debut), unAnAvant(fin)];
    let total = 0, trouve = false;
    for (const inv of invoices) {
        if (inv.status === 'proforma' || inv.status === 'cancelled' || inv.cancelledByCreditNoteId || !inv.invoiceNumber) continue;
        for (const l of inv.lineItems ?? []) {
            if (!lineItemKeys(l).includes(cle)) continue;
            const a = jour(l.periodStartDate), b = jour(l.periodEndDate);
            if (!a || !b || b < d || a > f) continue;
            trouve = true;
            const jours = (x: string, y: string) => (Date.parse(`${y}T00:00:00Z`) - Date.parse(`${x}T00:00:00Z`)) / 86_400_000 + 1;
            total += (Number(l.total) || 0) * jours(a > d ? a : d, b < f ? b : f) / jours(a, b);
        }
    }
    return trouve ? c2(total) : null;
}

export type DocBudget = {
    contractId: string; annee: number; lignes: LigneBudget[];
    initial?: { lignes: LigneBudget[]; figeLe: string; figePar: string } | null;
    majLe?: string; majPar?: string;
};

export type SuiviBudget = {
    contrat: { id: string; numero: string; libelle: string; client: string; debut: string; fin: string };
    annee: number;
    activites: { code: string; libelle: string; type?: string }[];
    /** Activité qui porte l'énergie P1 (null : pas de P1). */
    activiteEnergie: string | null;
    budget: DocBudget | null;
    /** Chiffre d'affaires de l'échéancier sur l'année, par activité : proposition pour le budget. */
    caTheorique: Record<string, number>;
    nonEstimees: number;
    lignes: LigneSynthese[];
    total: LigneSynthese;
    avertissements: string[];
};

type Ligne = { activityCode?: string; total?: number; periodStartDate?: unknown; periodEndDate?: unknown };

function ajouter(cible: Record<string, Montants>, activite: string, nature: keyof Montants, montant: number) {
    if (!montant) return;
    const m = (cible[activite] ||= { ...VIDE });
    m[nature] = c2(m[nature] + montant);
}

/** Lignes d'un document comptées dans l'année : au prorata de leur période, sinon à la date du document. */
function versAnnee(l: Ligne, dateDoc: string, annee: number, signe: 1 | -1): number {
    const d = jour(l.periodStartDate), f = jour(l.periodEndDate);
    const montant = signe === 1 ? Number(l.total) || 0 : -Math.abs(Number(l.total) || 0);
    if (d && f) return partAnnee(d, f, montant, annee);
    return dateDoc.slice(0, 4) === String(annee) ? montant : 0;
}

/** Lectures communes à plusieurs contrats (pilotage, fiche client) : activités et commandes engagées. */
export type ContexteBudgets = {
    activites: FirebaseFirestore.QueryDocumentSnapshot[]; commandes: FirebaseFirestore.QueryDocumentSnapshot[];
    /** Référentiels de l'échéancier (sans indices ni relevés : le budget n'en a pas besoin). */
    refs: Pick<BillingInput, 'activities' | 'vatRates' | 'schedules' | 'terms' | 'revisionRules'>;
};
const docs = <T,>(s: FirebaseFirestore.QuerySnapshot) => s.docs.map(d => ({ id: d.id, ...d.data() }) as T);
export async function contexteBudgets(): Promise<ContexteBudgets> {
    const [a, c, vatRates, schedules, terms, revisionRules] = await Promise.all([
        adminDb.collection('activities').get(), adminDb.collection('commandes').where('status', 'in', [...STATUTS_ENGAGES]).get(),
        adminDb.collection('vatRates').get(), adminDb.collection('schedules').get(), adminDb.collection('terms').get(), adminDb.collection('revisionRules').get(),
    ]);
    return {
        activites: a.docs, commandes: c.docs,
        refs: { activities: docs(a), vatRates: docs(vatRates), schedules: docs<NamedRef>(schedules), terms: docs<NamedRef>(terms), revisionRules: docs(revisionRules) },
    };
}

/** Entrée allégée de l'échéancier d'un contrat : sites et prestations, référentiels partagés. */
async function entreeEcheancier(contract: { id: string; siteIds?: string[]; activityIds?: string[]; invoicingType?: unknown; startDate?: unknown; endDate?: unknown; billingSchedule?: string }, refs: ContexteBudgets['refs']): Promise<BillingInput> {
    const siteIds = contract.siteIds ?? [];
    const [sites, services] = await Promise.all([
        Promise.all(Array.from({ length: Math.ceil(siteIds.length / 300) }, (_, i) => adminDb.getAll(...siteIds.slice(i * 300, i * 300 + 300).map(id => adminDb.collection('sites').doc(id)))))
            .then(l => l.flat().filter(d => d.exists).map(d => ({ id: d.id, ...d.data() }) as BillingSite)),
        adminDb.collection('services').where('contractId', '==', contract.id).get().then(s => docs<BillingService>(s)),
    ]);
    return {
        contract: { id: contract.id, siteIds, activityIds: contract.activityIds ?? [], invoicingType: contract.invoicingType as never, startDate: contract.startDate, endDate: contract.endDate, billingSchedule: contract.billingSchedule },
        sites, services, ...refs,
    } as BillingInput;
}

export async function suiviBudget(contractId: string, annee: number, ctx?: ContexteBudgets): Promise<SuiviBudget> {
    if (!Number.isInteger(annee) || annee < 2000 || annee > 2100) throw new Error('Année invalide.');
    const contract = await getContract(contractId);
    if (!contract) throw new Error('Contrat introuvable.');
    const avertissements: string[] = [];
    const [budgetSnap, partage, invoices, avoirsSnap, heuresSnap] = await Promise.all([
        adminDb.collection(COL).doc(idDe(contractId, annee)).get(),
        ctx ?? contexteBudgets(),
        getInvoicesByContract(contractId),
        adminDb.collection('creditNotes').where('contractId', '==', contractId).get(),
        adminDb.collection('heures').where('cible.contractId', '==', contractId).get(),
    ]);
    const activitesTout = partage.activites.map(d => ({ id: d.id, code: String(d.get('code') ?? ''), libelle: String(d.get('label') ?? ''), type: d.get('type') as string | undefined }));
    const activites = activitesTout.filter(a => (contract.activityIds ?? []).includes(a.id)).map(({ code, libelle, type }) => ({ code, libelle, ...(type && { type }) })).sort((a, b) => a.code.localeCompare(b.code));
    const codes = activites.map(a => a.code);
    // Une ligne garde son activité même absente de la liste du contrat : P1A, €€, ou travaux P5 / P6 facturés sur le
    // contrat (codes hors référentiel). « Non affecté » : sans aucun code.
    const connues = new Map(activitesTout.map(a => [a.code, a]));
    const affecter = (code?: string) => {
        const c = code?.trim();
        if (!c) return NON_AFFECTE;
        if (!codes.includes(c)) {
            const a = connues.get(c);
            codes.push(c); activites.push({ code: c, libelle: a?.libelle ?? (/^P[56]$/.test(c) ? `Travaux ${c}` : c), ...(a?.type && { type: a.type }) });
        }
        return c;
    };
    const realise: Record<string, Montants> = {};

    // Ventes : factures émises moins avoirs ; une facture annulée et son avoir d'annulation s'écartent ensemble.
    const annulations = new Set<string>();
    for (const inv of invoices) {
        if (inv.cancelledByCreditNoteId) annulations.add(inv.cancelledByCreditNoteId);
        if (inv.status === 'proforma' || inv.status === 'cancelled' || inv.cancelledByCreditNoteId || !inv.invoiceNumber) continue;
        for (const l of inv.lineItems ?? []) ajouter(realise, affecter(l.activityCode), 'ca', versAnnee(l, jour(inv.date), annee, 1));
    }
    for (const d of avoirsSnap.docs) {
        if (annulations.has(d.id)) continue;
        for (const l of (d.get('lineItems') ?? []) as Ligne[]) ajouter(realise, affecter(l.activityCode), 'ca', versAnnee(l, jour(d.get('date')), annee, -1));
    }

    // Achats : lignes des commandes engagées affectées au contrat, à la date de la commande.
    for (const d of partage.commandes) {
        const c = d.data() as Commande;
        if (String(c.date ?? '').slice(0, 4) !== String(annee)) continue;
        for (const l of c.lines ?? []) {
            if (l.cible?.type !== 'contrat' || l.cible.contractId !== contractId) continue;
            const nature: NatureDepense = l.nature === 'SOUS_TRAITANCE' ? 'sousTraitance' : 'achats';
            ajouter(realise, affecter(l.cible.activityCode), nature, Number(l.total) || 0);
        }
    }
    // Main-d'œuvre : heures validées (ou antérieures à la validation), à leur coût figé.
    for (const d of heuresSnap.docs) {
        const h = d.data() as SaisieHeures;
        if (h.cible?.type !== 'contrat' || (h.statut && h.statut !== 'validee') || String(h.date ?? '').slice(0, 4) !== String(annee)) continue;
        ajouter(realise, affecter(h.cible.activityCode), 'mainOeuvre', Number(h.cost) || 0);
    }
    // Énergie : factures des fournisseurs des sites du contrat, au prorata de leur période, sur l'activité P1.
    const energie = activiteEnergie(activites);
    let energieTotale = 0;
    for (const siteId of contract.siteIds ?? []) {
        try {
            for (const a of await achatsEnergieSite(siteId)) {
                const d = jour(a.debut) || a.date, f = jour(a.fin) || a.date;
                energieTotale += partAnnee(d, f, a.montantHT, annee);
            }
        } catch (e) {
            avertissements.push(`Achats d'énergie d'un site non lus : ${(e as Error).message}`);
        }
    }
    if (energieTotale) {
        if (energie) ajouter(realise, energie, 'energie', energieTotale);
        else { ajouter(realise, NON_AFFECTE, 'energie', energieTotale); avertissements.push('Achats d\'énergie sur un contrat sans activité P1 : comptés en « non affecté ».'); }
    }

    // Échéancier : chiffre d'affaires de l'année (proposition) et reste à facturer (atterrissage).
    const caTheorique: Record<string, number> = {}, resteCA: Record<string, number> = {};
    let nonEstimees = 0, estimesN1 = 0;
    if ((contract.siteIds ?? []).length) {
        try {
            const input = await entreeEcheancier(contract, partage.refs);
            const { items, errors } = billingItems(input);
            if (errors.length) avertissements.push(`Échéancier incomplet : ${errors.join(' ')}`);
            const debut = jour(input.contract.startDate);
            const billed = billedUntil(items, invoices);
            const coefs = derniersCoefficients(invoices);
            const fin = `${annee + 1}-12-31`;
            for (const item of items) {
                if (item.refacturation) continue;
                const variable = !!(item.p1Releve || item.p1Dju || item.p1Acompte);
                if (variable && !(item.annual > 0)) {
                    // P1 au compteur, au DJU ou en acompte sans montant annuel : ce qui reste de l'année est estimé par ce
                    // qui a été facturé sur la même période l'an dernier (la saison de chauffe est respectée).
                    const code = affecter(item.activity.code);
                    const dernier = billed.get(item.key) ?? null;
                    const depuis = dernier && dernier >= `${annee}-01-01` ? jourSuivant(dernier) : `${annee}-01-01`;
                    const estime = depuis <= `${annee}-12-31` ? factureMemePeriode(invoices, item.key, depuis, `${annee}-12-31`) : 0;
                    const annuelN1 = factureMemePeriode(invoices, item.key, `${annee}-01-01`, `${annee}-12-31`);
                    if (estime === null || annuelN1 === null) { nonEstimees++; continue; }
                    resteCA[code] = c2((resteCA[code] ?? 0) + estime);
                    caTheorique[code] = c2((caTheorique[code] ?? 0) + annuelN1);
                    estimesN1++;
                    continue;
                }
                const coef = variable ? 1 : coefs.get(item.key) ?? 1;
                const code = affecter(item.activity.code);
                for (const e of echeancesOf(item, debut, null, fin)) caTheorique[code] = c2((caTheorique[code] ?? 0) + partAnnee(e.start, e.end, e.amount * coef, annee));
                for (const e of echeancesOf(item, debut, billed.get(item.key) ?? null, fin)) resteCA[code] = c2((resteCA[code] ?? 0) + partAnnee(e.start, e.end, e.amount * coef, annee));
            }
        } catch (e) {
            avertissements.push(`Échéancier non calculé : ${(e as Error).message}`);
        }
    }

    activites.sort((a, b) => a.code.localeCompare(b.code));
    if (estimesN1) avertissements.push(`${estimesN1} prestation(s) P1 variable(s) : reste à facturer estimé sur le facturé de la même période l'an dernier.`);
    const budget = budgetSnap.exists ? (budgetSnap.data() as DocBudget) : null;
    const s = synthese({ activites: codes, budget: budget?.lignes ?? [], initial: budget?.initial?.lignes ?? null, realise, resteCA });
    return {
        contrat: { id: contract.id, numero: contract.contractNumber ?? '', libelle: contract.label ?? contract.name ?? '', client: contract.clientName ?? '', debut: jour(contract.startDate), fin: jour(contract.endDate) },
        annee, activites, activiteEnergie: energie, budget, caTheorique, nonEstimees, lignes: s.lignes, total: s.total, avertissements,
    };
}

/** Enregistre le budget révisé (avant gel : le budget en préparation). */
export async function enregistrerBudget(contractId: string, annee: number, lignes: unknown, par: string): Promise<void> {
    const contract = await getContract(contractId);
    if (!contract) throw new Error('Contrat introuvable.');
    // Activités budgétables : celles du suivi de l'année (contrat, plus celles rencontrées sur ses factures et dépenses).
    const codes = (await suiviBudget(contractId, annee)).activites.map(a => a.code);
    const propres = normaliserLignes(lignes, codes);
    await adminDb.collection(COL).doc(idDe(contractId, annee)).set({
        contractId, clientId: contract.clientId ?? '', annee, lignes: propres, majLe: new Date().toISOString(), majPar: par,
    }, { merge: true });
    oublierPilotage();
}

/** Gèle le budget initial (une fois) : les révisions suivantes se comparent à lui. */
export async function figerBudget(contractId: string, annee: number, par: string): Promise<void> {
    const ref = adminDb.collection(COL).doc(idDe(contractId, annee));
    await adminDb.runTransaction(async tx => {
        const d = await tx.get(ref);
        const lignes = (d.get('lignes') ?? []) as LigneBudget[];
        if (!d.exists || lignes.length === 0) throw new Error('Aucun budget saisi pour cette année.');
        if (d.get('initial')) throw new Error('Le budget initial est déjà figé.');
        tx.update(ref, { initial: { lignes, figeLe: new Date().toISOString(), figePar: par } });
    });
    oublierPilotage();
}

// --- Pilotage : plusieurs contrats ---

export type BudgetDeContrat = {
    contractId: string; numero: string; libelle: string; clientId: string; client: string; agence: string;
    aBudget: boolean; fige: boolean; lignes: LigneSynthese[]; total: LigneSynthese; avertissements: string[];
};

/** Calcule plusieurs contrats, quelques-uns à la fois (lectures de factures, d'heures et d'énergie par contrat). */
async function parLots<T, R>(items: T[], f: (t: T) => Promise<R>, taille = 10): Promise<R[]> {
    const out: R[] = [];
    for (let i = 0; i < items.length; i += taille) out.push(...await Promise.all(items.slice(i, i + taille).map(f)));
    return out;
}

async function budgetsDe(contractIds: string[], annee: number): Promise<BudgetDeContrat[]> {
    if (!contractIds.length) return [];
    const ctx = await contexteBudgets();
    const contrats = new Map<string, FirebaseFirestore.DocumentSnapshot>();
    for (let i = 0; i < contractIds.length; i += 300) for (const d of await adminDb.getAll(...contractIds.slice(i, i + 300).map(id => adminDb.collection('contracts').doc(id)))) if (d.exists) contrats.set(d.id, d);
    const clientIds = [...new Set([...contrats.values()].map(d => String(d.get('clientId') ?? '')).filter(Boolean))];
    const agenceDe = new Map<string, string>();
    const agences = new Map((await adminDb.collection('agencies').get()).docs.map(d => [d.id, String(d.get('name') ?? d.id)]));
    for (let i = 0; i < clientIds.length; i += 300) for (const d of await adminDb.getAll(...clientIds.slice(i, i + 300).map(id => adminDb.collection('clients').doc(id)))) agenceDe.set(d.id, agences.get(String(d.get('agencyId') ?? '')) ?? 'Sans agence');
    const resultats = await parLots([...contrats.keys()], async id => {
        try {
            const s = await suiviBudget(id, annee, ctx);
            const clientId = String(contrats.get(id)!.get('clientId') ?? '');
            return {
                contractId: id, numero: s.contrat.numero, libelle: s.contrat.libelle, clientId, client: s.contrat.client, agence: agenceDe.get(clientId) ?? 'Sans agence',
                aBudget: !!s.budget?.lignes?.length, fige: !!s.budget?.initial, lignes: s.lignes, total: s.total, avertissements: s.avertissements,
            } as BudgetDeContrat;
        } catch (e) {
            console.error('[budgets] contrat non calculé', id, e);
            return null;
        }
    });
    return resultats.filter((r): r is BudgetDeContrat => !!r);
}

export type PilotageBudgets = {
    annee: number;
    contrats: BudgetDeContrat[];
    /** Contrats actifs du périmètre sans budget pour l'année. */
    sansBudget: { contractId: string; numero: string; libelle: string; client: string }[];
};

/** Contrats budgétés de l'année (dans le périmètre), et contrats actifs sans budget. `visibles` : null = tous. */
const CACHE = new Map<string, { le: number; valeur: Promise<PilotageBudgets> }>();
const FRAIS_MS = 5 * 60_000;

/** Pilotage, gardé en mémoire 5 minutes par année et périmètre (calcul de tous les contrats) ; `forcer` le refait. */
export async function pilotageBudgets(annee: number, visibles: Set<string> | null, forcer = false): Promise<PilotageBudgets> {
    if (!Number.isInteger(annee) || annee < 2000 || annee > 2100) throw new Error('Année invalide.');
    const cle = `${annee}|${visibles ? [...visibles].sort().join(',') : '*'}`;
    const c = CACHE.get(cle);
    if (!forcer && c && Date.now() - c.le < FRAIS_MS) return c.valeur;
    const valeur = calculerPilotage(annee, visibles);
    CACHE.set(cle, { le: Date.now(), valeur });
    valeur.catch(() => CACHE.delete(cle));
    return valeur;
}

/** Un budget modifié : le pilotage en mémoire est refait à la prochaine lecture. */
export const oublierPilotage = () => CACHE.clear();

async function calculerPilotage(annee: number, visibles: Set<string> | null): Promise<PilotageBudgets> {
    const [budgets, actifs] = await Promise.all([
        adminDb.collection(COL).where('annee', '==', annee).get(),
        adminDb.collection('contracts').where('status', '==', 'Actif').select('contractNumber', 'label', 'name', 'clientName').get(),
    ]);
    const budgetes = new Set(budgets.docs.filter(d => ((d.get('lignes') ?? []) as unknown[]).length > 0).map(d => String(d.get('contractId'))).filter(id => !visibles || visibles.has(id)));
    const sansBudget = actifs.docs.filter(d => !budgetes.has(d.id) && (!visibles || visibles.has(d.id)))
        .map(d => ({ contractId: d.id, numero: String(d.get('contractNumber') ?? ''), libelle: String(d.get('label') ?? d.get('name') ?? ''), client: String(d.get('clientName') ?? '') }))
        .sort((a, b) => a.client.localeCompare(b.client, 'fr') || a.numero.localeCompare(b.numero));
    return { annee, contrats: await budgetsDe([...budgetes], annee), sansBudget };
}

/** Budget d'un client : ses contrats (dans le périmètre), budgétés ou non (le réalisé compte même sans budget). */
export async function budgetClient(clientId: string, annee: number, visibles: Set<string> | null): Promise<{ annee: number; contrats: BudgetDeContrat[] }> {
    if (!Number.isInteger(annee) || annee < 2000 || annee > 2100) throw new Error('Année invalide.');
    const ids = (await adminDb.collection('contracts').where('clientId', '==', clientId).select().get()).docs.map(d => d.id).filter(id => !visibles || visibles.has(id));
    return { annee, contrats: (await budgetsDe(ids, annee)).sort((a, b) => a.numero.localeCompare(b.numero)) };
}
