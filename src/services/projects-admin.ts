import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { countedInvoices } from '@/lib/quotes/billing';
import { computeSituation, latestSnapshot, marketLines, situationInvoiceLines, situationIssues } from '@/lib/projects/situations';
import type { Progress, Project, ProjectSituation, SituationSnapshot } from '@/lib/projects/types';
import { budgetAffaire, budgetDevis, type DevisAffaire } from '@/lib/projects/affaire';
import { roundCents } from '@/lib/money';
import { analytiqueAffaire, analytiqueLigneAffaire } from '@/services/analytique-admin';
import type { Quote } from '@/lib/quotes/types';
import type { Invoice } from '@/lib/types';
import { archiveDocumentSafely } from '@/services/document-archive';
import { assertCompanyCode, computeEInvoicingState, getCompany, prepareSeries, reserveNumber } from '@/services/firestore-admin';

/**
 * Affaires de travaux (P5 : facturation directe ; P6 : situations) et situations, côté serveur (seul à écrire
 * `projects` et `projectSituations`). Une affaire par devis accepté ; les devis complémentaires s'y rattachent.
 *
 * Ce qui est déjà facturé se lit dans les factures de situation NON annulées (état cumulé enregistré sur
 * chaque facture) : une situation annulée par avoir ne compte plus et l'avancement se refacture.
 */

const PAYMENT_DELAY_DAYS = 30;
const projects = () => adminDb.collection('projects');
const situations = () => adminDb.collection('projectSituations');
const now = () => new Date().toISOString();
const isoOf = (v: unknown): string => (v instanceof Timestamp ? v.toDate().toISOString() : String(v ?? ''));

async function load<T>(collection: string, id: string, label: string): Promise<T> {
    const snap = await adminDb.collection(collection).doc(id).get();
    if (!snap.exists) throw new Error(`${label} introuvable.`);
    return { id: snap.id, ...snap.data() } as T;
}

/** Devis d'une affaire : identité et budget (vente, déboursé par nature, heures). */
const devisAffaire = (q: Quote, t: string): DevisAffaire => ({
    quoteId: q.id, number: q.number, version: q.version, title: q.title, mode: q.mode, rattacheLe: t,
    ...(q.acceptance?.acceptedAt && { acceptedAt: q.acceptance.acceptedAt }), ...budgetDevis(q),
});

/** Fige l'analytique d'une affaire (code généré et axes), si elle est générable et pas déjà figée. */
export async function figerAnalytiqueAffaire(projectId: string): Promise<void> {
    const p = await load<Project>('projects', projectId, 'Affaire');
    if (p.analyticCode) return;
    const { effective, axes } = await analytiqueAffaire(p);
    if (effective.genere) await projects().doc(projectId).update({ analyticCode: effective.genere, analyticAxes: axes });
}

/** Analytique des lignes de facture d'une affaire (figée si possible) ; null si elle n'a pas de code. */
export async function analytiqueFacture(projectId: string) {
    await figerAnalytiqueAffaire(projectId).catch(() => undefined);
    return analytiqueLigneAffaire(await load<Project>('projects', projectId, 'Affaire'));
}

/**
 * Affaire d'un devis accepté facturé directement (P5 : acompte, solde, totalité) : créée à l'acceptation. Sans effet
 * si le devis a déjà une affaire.
 */
export async function createDirectProject(quoteId: string, by?: string): Promise<Project> {
    const q0 = await load<Quote>('quotes', quoteId, 'Devis');
    if (q0.projectId) return load<Project>('projects', q0.projectId, 'Affaire');
    const company = await getCompany(q0.companyId);
    if (!company) throw new Error('Société émettrice introuvable.');
    assertCompanyCode(company);
    const year = new Date().getUTCFullYear();
    const counter = `project_${company.code}_${year}`;
    const quoteRef = adminDb.collection('quotes').doc(quoteId);
    const sequences = adminDb.collection('config').doc('sequences');
    const ref = projects().doc();
    const project = await adminDb.runTransaction(async (tx) => {
        const [qSnap, seq] = await Promise.all([tx.get(quoteRef), tx.get(sequences)]);
        const q = { id: qSnap.id, ...qSnap.data() } as Quote;
        if (q.status !== 'accepte') throw new Error('Seul un devis accepté devient une affaire.');
        if (q.projectId) return null;
        const next = (seq.exists ? seq.get(counter) || 0 : 0) + 1;
        const t = now();
        const devis = devisAffaire(q, t);
        const p: Omit<Project, 'id'> = {
            code: `${company.code}-AFF${year}-${String(next).padStart(4, '0')}`,
            companyId: q.companyId, clientId: q.clientId, clientName: q.clientName,
            ...(q.siteId && { siteId: q.siteId, siteName: q.siteName }), ...(q.contractId && { contractId: q.contractId }),
            ...(q.agencyId && { agencyId: q.agencyId }), ...(q.sectorId && { sectorId: q.sectorId }),
            quoteId, quoteNumber: q.number, quoteVersion: q.version,
            ...(q.acceptance?.purchaseOrderNumber && { purchaseOrderNumber: q.acceptance.purchaseOrderNumber }),
            title: q.title, status: 'en_cours', billing: 'direct', mode: q.mode, lines: marketLines(q),
            totalHT: q.totals.totalHT, totalTTC: q.totals.totalTTC, vat: q.totals.vat, retentionPct: 0,
            quotes: [devis], budget: budgetAffaire([devis]),
            ...(q.authorName && { authorName: q.authorName }),
            createdAt: t, ...(by && { createdBy: by }), updatedAt: t,
        };
        tx.set(sequences, { [counter]: next }, { merge: true });
        tx.set(ref, p);
        tx.update(quoteRef, { projectId: ref.id, projectCode: p.code, projectBilling: 'direct', updatedAt: t });
        return { id: ref.id, ...p };
    });
    if (!project) return load<Project>('projects', (await load<Quote>('quotes', quoteId, 'Devis')).projectId!, 'Affaire');
    await figerAnalytiqueAffaire(project.id).catch(() => undefined);
    return load<Project>('projects', project.id, 'Affaire');
}

/**
 * Rattache un devis complémentaire accepté à une affaire existante du même client : son budget s'ajoute au prévu, ses
 * lignes au marché (à 0 % d'avancement pour une affaire par situations). Le devis garde le code de l'affaire.
 */
export async function attachQuoteToProject(quoteId: string, projectId: string, by?: string): Promise<Project> {
    const quoteRef = adminDb.collection('quotes').doc(quoteId);
    await adminDb.runTransaction(async (tx) => {
        const [qSnap, pSnap, billed] = await Promise.all([tx.get(quoteRef), tx.get(projects().doc(projectId)), tx.get(adminDb.collection('invoices').where('quoteId', '==', quoteId))]);
        if (!qSnap.exists) throw new Error('Devis introuvable.');
        if (!pSnap.exists) throw new Error('Affaire introuvable.');
        const q = { id: qSnap.id, ...qSnap.data() } as Quote;
        const p = { id: pSnap.id, ...pSnap.data() } as Project;
        if (q.status !== 'accepte') throw new Error('Seul un devis accepté se rattache à une affaire.');
        if (q.projectId) throw new Error(`Ce devis est déjà dans l'affaire ${q.projectCode ?? q.projectId}.`);
        if (p.status === 'cloture') throw new Error('Affaire clôturée.');
        if (p.clientId !== q.clientId) throw new Error('Le devis et l\'affaire n\'ont pas le même client.');
        if (p.companyId !== q.companyId) throw new Error('Le devis et l\'affaire n\'ont pas la même société émettrice.');
        const situations = (p.billing ?? 'situations') === 'situations';
        if (situations && countedInvoices(billed.docs.map(d => d.data() as Invoice)).length > 0) {
            throw new Error('Ce devis a déjà des factures : il ne peut plus rejoindre une affaire facturée par situations.');
        }
        const t = now();
        // Affaire antérieure : son premier devis n'a pas de budget enregistré, il est recalculé.
        let quotes = p.quotes ?? [];
        if (quotes.length === 0) {
            const premier = await tx.get(adminDb.collection('quotes').doc(p.quoteId));
            if (premier.exists) quotes = [devisAffaire({ id: premier.id, ...premier.data() } as Quote, p.createdAt)];
        }
        quotes = [...quotes, devisAffaire(q, t)];
        // Lignes du devis ajoutées au marché (identifiants rendus uniques dans l'affaire).
        const pris = new Set(p.lines.map(l => l.id));
        const lignes = marketLines(q).map(l => (pris.has(l.id) ? { ...l, id: `${q.number}:${l.id}` } : l)).map(l => ({ ...l, section: l.section ? `${q.number} — ${l.section}` : q.number }));
        const vat = new Map(p.vat.map(v => [v.rate, { ...v }]));
        for (const v of q.totals.vat) {
            const cur = vat.get(v.rate) ?? { rate: v.rate, base: 0, amount: 0 };
            cur.base = roundCents(cur.base + v.base);
            cur.amount = roundCents(cur.base * v.rate / 100);
            vat.set(v.rate, cur);
        }
        const totalHT = roundCents(p.totalHT + q.totals.totalHT);
        const tva = [...vat.values()].sort((a, b) => b.rate - a.rate);
        tx.update(projects().doc(projectId), {
            quotes, budget: budgetAffaire(quotes), lines: [...p.lines, ...lignes], totalHT, vat: tva,
            totalTTC: roundCents(totalHT + tva.reduce((s, v) => s + v.amount, 0)), updatedAt: t,
        });
        tx.update(quoteRef, { projectId, projectCode: p.code, projectBilling: p.billing ?? 'situations', updatedAt: t, ...(by && { updatedBy: by }) });
    });
    return load<Project>('projects', projectId, 'Affaire');
}

/** Crée l'affaire d'un devis accepté : le marché (lignes chiffrées) est figé à partir du devis. */
export async function createProjectFromQuote(
    quoteId: string, options: { retentionPct: number; retentionBond?: boolean }, by?: string,
): Promise<Project> {
    const pct = Number(options.retentionPct);
    if (!(pct >= 0 && pct <= 10)) throw new Error('Retenue de garantie : entre 0 et 10 % (5 % en général).');
    const q0 = await load<Quote>('quotes', quoteId, 'Devis');
    const company = await getCompany(q0.companyId);
    if (!company) throw new Error('Société émettrice introuvable.');
    assertCompanyCode(company);
    const year = new Date().getUTCFullYear();
    const counter = `project_${company.code}_${year}`;
    const quoteRef = adminDb.collection('quotes').doc(quoteId);
    const sequences = adminDb.collection('config').doc('sequences');
    const ref = projects().doc();

    const cree = await adminDb.runTransaction(async (tx) => {
        const [qSnap, seq, billed] = await Promise.all([
            tx.get(quoteRef), tx.get(sequences), tx.get(adminDb.collection('invoices').where('quoteId', '==', quoteId)),
        ]);
        const q = { id: qSnap.id, ...qSnap.data() } as Quote;
        if (q.status !== 'accepte') throw new Error("Seul un devis accepté devient une affaire.");
        if (q.projectId) throw new Error(`Une affaire existe déjà pour ce devis (${q.projectCode}).`);
        if (countedInvoices(billed.docs.map(d => d.data() as Invoice)).length > 0) {
            throw new Error('Ce devis a déjà des factures (acompte ou totalité) : il ne peut plus être facturé à l\'avancement.');
        }
        const lines = marketLines(q);
        if (lines.length === 0) throw new Error('Le devis ne comporte aucune ligne chiffrée.');
        const next = (seq.exists ? seq.get(counter) || 0 : 0) + 1;
        const t = now();
        const project: Omit<Project, 'id'> = {
            code: `${company.code}-AFF${year}-${String(next).padStart(4, '0')}`,
            companyId: q.companyId, clientId: q.clientId, clientName: q.clientName,
            ...(q.siteId && { siteId: q.siteId, siteName: q.siteName }),
            ...(q.contractId && { contractId: q.contractId }),
            quoteId, quoteNumber: q.number, quoteVersion: q.version,
            ...(q.acceptance?.purchaseOrderNumber && { purchaseOrderNumber: q.acceptance.purchaseOrderNumber }),
            title: q.title, status: 'en_cours', billing: 'situations', mode: q.mode, lines,
            ...(q.agencyId && { agencyId: q.agencyId }), ...(q.sectorId && { sectorId: q.sectorId }),
            quotes: [devisAffaire(q, t)], budget: budgetAffaire([devisAffaire(q, t)]),
            totalHT: q.totals.totalHT, totalTTC: q.totals.totalTTC, vat: q.totals.vat,
            retentionPct: options.retentionBond ? 0 : pct,
            ...(options.retentionBond && { retentionBond: true }),
            ...(q.authorName && { authorName: q.authorName }),
            createdAt: t, ...(by && { createdBy: by }), updatedAt: t,
        };
        tx.set(sequences, { [counter]: next }, { merge: true });
        tx.set(ref, project);
        tx.update(quoteRef, { projectId: ref.id, projectCode: project.code, projectBilling: 'situations', updatedAt: t });
        return { id: ref.id, ...project };
    });
    await figerAnalytiqueAffaire(cree.id).catch(() => undefined);
    return load<Project>('projects', cree.id, 'Affaire');
}

function cleanProgress(project: Project, progress: Progress): Progress {
    const out: Progress = {};
    for (const line of project.lines) {
        const v = Number(progress[line.id] ?? 0);
        if (!Number.isFinite(v)) throw new Error(`${line.label} : avancement invalide.`);
        out[line.id] = Math.round(v * 100) / 100;
    }
    return out;
}

/** Crée ou met à jour la situation en préparation (une seule à la fois par affaire). */
export async function saveSituationDraft(projectId: string, input: { period: string; progress: Progress }, by?: string): Promise<ProjectSituation> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) throw new Error('Période : AAAA-MM.');
    return adminDb.runTransaction(async (tx) => {
        const [pSnap, sSnap] = await Promise.all([
            tx.get(projects().doc(projectId)), tx.get(situations().where('projectId', '==', projectId)),
        ]);
        if (!pSnap.exists) throw new Error('Affaire introuvable.');
        const project = { id: pSnap.id, ...pSnap.data() } as Project;
        if (project.status === 'cloture') throw new Error('Affaire clôturée.');
        const all = sSnap.docs.map(d => ({ id: d.id, ...d.data() }) as ProjectSituation);
        const draft = all.find(s => s.status === 'brouillon');
        const progress = cleanProgress(project, input.progress);
        const t = now();
        if (draft) {
            tx.update(situations().doc(draft.id), { period: input.period, progress, updatedAt: t });
            return { ...draft, period: input.period, progress, updatedAt: t };
        }
        const ref = situations().doc();
        const situation: Omit<ProjectSituation, 'id'> = {
            projectId, number: Math.max(0, ...all.map(s => s.number)) + 1, period: input.period, progress,
            status: 'brouillon', createdAt: t, ...(by && { createdBy: by }), updatedAt: t,
        };
        tx.set(ref, situation);
        return { id: ref.id, ...situation };
    });
}

export async function deleteSituationDraft(situationId: string): Promise<void> {
    await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(situations().doc(situationId));
        if (!snap.exists) return;
        if (snap.get('status') !== 'brouillon') throw new Error('Une situation facturée ne se supprime pas : elle s\'annule par un avoir.');
        tx.delete(snap.ref);
    });
}

/**
 * Facture la situation en préparation : contrôles (avancement cumulé croissant), calcul par différence
 * avec la dernière situation facturée non annulée, numéro légal, facture et état cumulé, dans une transaction.
 */
export async function invoiceSituation(situationId: string, by?: string): Promise<{ invoiceId: string; invoiceNumber: string }> {
    const s0 = await load<ProjectSituation>('projectSituations', situationId, 'Situation');
    const p0 = await load<Project>('projects', s0.projectId, 'Affaire');
    const company = await getCompany(p0.companyId);
    if (!company) throw new Error('Société émettrice introuvable.');
    assertCompanyCode(company);
    const issuedAt = new Date();
    const date = issuedAt.toISOString().slice(0, 10);
    const series = await prepareSeries('invoice', company.code, issuedAt);
    const einvoicing = await computeEInvoicingState({
        clientId: p0.clientId, contractId: p0.contractId, company, documentDate: date, purchaseOrderNumber: p0.purchaseOrderNumber,
    });
    const invoiceRef = adminDb.collection('invoices').doc();
    const analytique = await analytiqueFacture(p0.id);

    const invoiceNumber = await adminDb.runTransaction(async (tx) => {
        const [sSnap, pSnap, billed] = await Promise.all([
            tx.get(situations().doc(situationId)), tx.get(projects().doc(s0.projectId)),
            tx.get(adminDb.collection('invoices').where('projectId', '==', s0.projectId)),
        ]);
        const situation = { id: sSnap.id, ...sSnap.data() } as ProjectSituation;
        const project = { id: pSnap.id, ...pSnap.data() } as Project;
        if (situation.status !== 'brouillon') throw new Error('Cette situation est déjà facturée.');
        if (project.status === 'cloture') throw new Error('Affaire clôturée.');
        const previous = latestSnapshot(billed.docs.map(d => d.data() as Invoice));
        const issues = situationIssues(project, situation.progress, previous);
        if (issues.length) throw new Error(issues.join(' '));
        const computed = computeSituation(project, situation.progress, previous);
        const reserved = await reserveNumber(tx, series);

        const snapshot: SituationSnapshot = {
            projectId: project.id, projectCode: project.code, situationId, number: situation.number, period: situation.period,
            progress: situation.progress, cumulative: computed.cumulative, retention: computed.retention, netToPay: computed.netToPay,
        };
        const dueDate = new Date(`${date}T00:00:00Z`);
        dueDate.setUTCDate(dueDate.getUTCDate() + PAYMENT_DELAY_DAYS);
        reserved.commit();
        tx.set(invoiceRef, {
            contractId: project.contractId ?? '',
            clientId: project.clientId,
            clientName: project.clientName,
            date: new Date(`${date}T00:00:00Z`),
            dueDate,
            status: 'due',
            lineItems: situationInvoiceLines(computed).map(l => (analytique ? { ...l, analytique } : l)),
            subtotal: computed.subtotal,
            tax: computed.tax,
            total: computed.total,
            vatBreakdown: computed.vatBreakdown,
            ...(computed.vatBreakdown.length === 1 && { taxRate: computed.vatBreakdown[0].rate / 100 }),
            projectId: project.id,
            situation: snapshot,
            companyId: company.id,
            invoiceNumber: reserved.number,
            issuedAt,
            einvoicing,
        });
        tx.update(situations().doc(situationId), { status: 'facturee', invoiceId: invoiceRef.id, invoiceNumber: reserved.number, updatedAt: now() });
        tx.update(projects().doc(project.id), { updatedAt: now() });
        return reserved.number;
    });

    await archiveDocumentSafely('invoice', invoiceRef.id);
    return { invoiceId: invoiceRef.id, invoiceNumber };
}

/** Jalons de l'affaire : réception des travaux, libération de la retenue, clôture. */
export async function setProjectMilestone(projectId: string, milestone: 'completed' | 'retentionReleased' | 'closed', date: string): Promise<Project> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date invalide.');
    return adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(projects().doc(projectId));
        if (!snap.exists) throw new Error('Affaire introuvable.');
        const project = { id: snap.id, ...snap.data() } as Project;
        if (project.status === 'cloture') throw new Error('Affaire clôturée.');
        const draft = await tx.get(situations().where('projectId', '==', projectId).where('status', '==', 'brouillon'));
        const update: Partial<Project> = { updatedAt: now() };
        if (milestone === 'completed') Object.assign(update, { status: 'termine', completedAt: date });
        if (milestone === 'retentionReleased') {
            if (!project.completedAt) throw new Error('La retenue se libère après la réception des travaux.');
            update.retentionReleasedAt = date;
        }
        if (milestone === 'closed') {
            if (!draft.empty) throw new Error('Une situation est en préparation : facturez-la ou supprimez-la avant de clôturer.');
            Object.assign(update, { status: 'cloture', closedAt: date });
        }
        tx.update(snap.ref, update);
        return { ...project, ...update } as Project;
    });
}

/** Factures de situation d'une affaire (dates en ISO). */
export async function getProjectInvoices(projectId: string): Promise<Invoice[]> {
    const snap = await adminDb.collection('invoices').where('projectId', '==', projectId).get();
    return snap.docs.map(d => ({ ...(d.data() as Invoice), id: d.id, date: isoOf(d.get('date')) }));
}

// --- Reprise de l'existant ---

export type RepriseAffaires = { affairesCreees: number; affairesCompletees: number; factures: number; lignes: number; nonGenerables: string[] };

/**
 * Reprise : crée l'affaire des devis acceptés qui n'en ont pas (P5, facturation directe), complète les affaires
 * antérieures (devis, budget, mode, analytique) et pose l'analytique de l'affaire sur les lignes de leurs factures déjà
 * émises. Simulation par défaut ; `apply` écrit. Montants, numéros et PDF archivés ne sont pas touchés.
 */
export async function repriseAffaires(apply: boolean, by = 'reprise'): Promise<RepriseAffaires> {
    const out: RepriseAffaires = { affairesCreees: 0, affairesCompletees: 0, factures: 0, lignes: 0, nonGenerables: [] };
    const devis = await adminDb.collection('quotes').where('status', '==', 'accepte').get();
    for (const d of devis.docs) {
        if (d.get('projectId') || d.get('mode') !== 'P5') continue;
        out.affairesCreees++;
        if (apply) await createDirectProject(d.id, by);
    }
    const affaires = await projects().get();
    for (const d of affaires.docs) {
        const p = { id: d.id, ...d.data() } as Project;
        const maj: Record<string, unknown> = {};
        if (!p.quotes?.length) {
            const q = await adminDb.collection('quotes').doc(p.quoteId).get();
            if (q.exists) {
                const dv = devisAffaire({ id: q.id, ...q.data() } as Quote, p.createdAt);
                Object.assign(maj, { quotes: [dv], budget: budgetAffaire([dv]), mode: p.mode ?? dv.mode, billing: p.billing ?? 'situations' });
                if (apply) await q.ref.update({ projectBilling: p.billing ?? 'situations' });
            }
        }
        if (Object.keys(maj).length) { out.affairesCompletees++; if (apply) await d.ref.update(maj); }
        if (apply) await figerAnalytiqueAffaire(p.id).catch(() => undefined);
        // Affaire sans code (référentiel incomplet, client disparu) : signalée, la reprise continue.
        const a = await analytiqueLigneAffaire({ ...p, ...(apply ? (await d.ref.get()).data() : {}), id: p.id } as Project).catch(() => null);
        if (!a) { out.nonGenerables.push(p.code); continue; }
        // Factures de l'affaire : situations (projectId) et factures directes de ses devis (quoteId).
        const ids = [p.quoteId, ...(p.quotes ?? []).map(x => x.quoteId)].filter((x, i, l) => x && l.indexOf(x) === i);
        const factures = [
            ...(await adminDb.collection('invoices').where('projectId', '==', p.id).get()).docs,
            ...(await Promise.all(ids.map(id => adminDb.collection('invoices').where('quoteId', '==', id).get()))).flatMap(x => x.docs),
        ].filter((x, i, l) => l.findIndex(y => y.id === x.id) === i);
        for (const f of factures) {
            if (f.get('status') === 'proforma') continue;
            const lignes = (f.get('lineItems') ?? []) as Invoice['lineItems'];
            const n = lignes.filter(l => !l.analytique).length;
            if (!n && f.get('projectId')) continue;
            out.factures++;
            out.lignes += n;
            if (apply) await f.ref.update({ lineItems: lignes.map(l => (l.analytique ? l : { ...l, analytique: a })), projectId: p.id });
        }
    }
    return out;
}
