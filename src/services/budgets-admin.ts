import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { billedUntil, billingItems, echeancesOf } from '@/lib/billing/contract-billing';
import { derniersCoefficients } from '@/lib/billing/previsionnel';
import { STATUTS_ENGAGES, type Commande } from '@/lib/commandes';
import type { SaisieHeures } from '@/lib/heures';
import {
    NATURES_DEPENSE, NON_AFFECTE, VIDE, activiteEnergie, normaliserLignes, partAnnee, synthese,
    type LigneBudget, type LigneSynthese, type Montants, type NatureDepense,
} from '@/lib/budgets/budget';
import { loadBillingInput } from './contract-billing-admin';
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

export async function suiviBudget(contractId: string, annee: number): Promise<SuiviBudget> {
    if (!Number.isInteger(annee) || annee < 2000 || annee > 2100) throw new Error('Année invalide.');
    const contract = await getContract(contractId);
    if (!contract) throw new Error('Contrat introuvable.');
    const avertissements: string[] = [];
    const [budgetSnap, activitesSnap, invoices, avoirsSnap, commandesSnap, heuresSnap] = await Promise.all([
        adminDb.collection(COL).doc(idDe(contractId, annee)).get(),
        adminDb.collection('activities').get(),
        getInvoicesByContract(contractId),
        adminDb.collection('creditNotes').where('contractId', '==', contractId).get(),
        adminDb.collection('commandes').where('status', 'in', [...STATUTS_ENGAGES]).get(),
        adminDb.collection('heures').where('cible.contractId', '==', contractId).get(),
    ]);
    const activitesTout = activitesSnap.docs.map(d => ({ id: d.id, code: String(d.get('code') ?? ''), libelle: String(d.get('label') ?? ''), type: d.get('type') as string | undefined }));
    const activites = activitesTout.filter(a => (contract.activityIds ?? []).includes(a.id)).map(({ code, libelle, type }) => ({ code, libelle, ...(type && { type }) })).sort((a, b) => a.code.localeCompare(b.code));
    const codes = activites.map(a => a.code);
    const affecter = (code?: string) => (code && codes.includes(code) ? code : NON_AFFECTE);
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
    for (const d of commandesSnap.docs) {
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
    let nonEstimees = 0;
    if ((contract.siteIds ?? []).length) {
        try {
            const input = await loadBillingInput(contract);
            const { items, errors } = billingItems(input);
            if (errors.length) avertissements.push(`Échéancier incomplet : ${errors.join(' ')}`);
            const debut = jour(input.contract.startDate);
            const billed = billedUntil(items, invoices);
            const coefs = derniersCoefficients(invoices);
            const fin = `${annee + 1}-12-31`;
            for (const item of items) {
                if (item.refacturation) continue;
                const variable = !!(item.p1Releve || item.p1Dju || item.p1Acompte);
                if (variable && !(item.annual > 0)) { nonEstimees++; continue; }
                const coef = variable ? 1 : coefs.get(item.key) ?? 1;
                const code = affecter(item.activity.code);
                for (const e of echeancesOf(item, debut, null, fin)) caTheorique[code] = c2((caTheorique[code] ?? 0) + partAnnee(e.start, e.end, e.amount * coef, annee));
                for (const e of echeancesOf(item, debut, billed.get(item.key) ?? null, fin)) resteCA[code] = c2((resteCA[code] ?? 0) + partAnnee(e.start, e.end, e.amount * coef, annee));
            }
        } catch (e) {
            avertissements.push(`Échéancier non calculé : ${(e as Error).message}`);
        }
    }

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
    const codes = (await adminDb.getAll(...(contract.activityIds ?? []).map(id => adminDb.collection('activities').doc(id)))).filter(d => d.exists).map(d => String(d.get('code')));
    const propres = normaliserLignes(lignes, codes);
    await adminDb.collection(COL).doc(idDe(contractId, annee)).set({
        contractId, clientId: contract.clientId ?? '', annee, lignes: propres, majLe: new Date().toISOString(), majPar: par,
    }, { merge: true });
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
}

export { NATURES_DEPENSE };
