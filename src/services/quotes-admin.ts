import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminBucket, adminDb } from '@/lib/firebase-admin';
import { renderQuotePdf } from '@/lib/pdf/quote-document';
import { addDays, computeQuoteTotals, quoteIssues } from '@/lib/quotes/pricing';
import { availableActions, effectiveStatus, type QuoteAction } from '@/lib/quotes/lifecycle';
import type { Quote, QuoteAcceptance, QuoteVersionRecord } from '@/lib/quotes/types';
import type { ArchivedPdf, Client, Company, Site } from '@/lib/types';
import { DocumentIntegrityError, sha256 } from '@/services/document-archive';

/**
 * Cycle de vie des devis, côté serveur (Admin SDK) : seules ces fonctions font changer un devis de statut
 * (les règles Firestore n'autorisent au navigateur que la modification d'un brouillon).
 *
 * Envoyer fige la version : PDF généré une fois, archivé sans écrasement, empreinte SHA-256,
 * copie complète du devis dans `quoteVersions/{id}_v{version}`.
 */

const QUOTES = 'quotes';
const VERSIONS = 'quoteVersions';
const today = () => new Date().toISOString().slice(0, 10);
const quoteRef = (id: string) => adminDb.collection(QUOTES).doc(id);
const versionId = (id: string, version: number) => `${id}_v${version}`;

async function loadQuote(id: string): Promise<Quote> {
    const snap = await quoteRef(id).get();
    if (!snap.exists) throw new Error('Devis introuvable.');
    return { id: snap.id, ...snap.data() } as Quote;
}

function requireAction(q: Quote, action: QuoteAction, day = today()) {
    if (!availableActions(q, day).includes(action)) {
        throw new Error(`Action impossible sur un devis au statut « ${effectiveStatus(q, day)} ».`);
    }
}

// --- PDF ---

async function documentData(q: Omit<Quote, 'id'>, preview = false) {
    const [companySnap, clientSnap, siteSnap] = await Promise.all([
        adminDb.collection('companies').doc(q.companyId).get(),
        adminDb.collection('clients').doc(q.clientId).get(),
        q.siteId ? adminDb.collection('sites').doc(q.siteId).get() : Promise.resolve(null),
    ]);
    if (!companySnap.exists) throw new Error('Société émettrice introuvable.');
    const company = { id: companySnap.id, ...companySnap.data() } as Company;
    const client = clientSnap.exists ? clientSnap.data() as Client : undefined;
    const site = siteSnap?.exists ? siteSnap.data() as Site : undefined;
    const place = site
        ? [site.name, site.address, [site.postalCode, site.city].filter(Boolean).join(' ')]
        : [q.interventionAddress?.address, [q.interventionAddress?.postalCode, q.interventionAddress?.city].filter(Boolean).join(' ')];
    return {
        quote: q,
        company,
        client: client
            ? { name: client.name, address: client.address, postalCode: client.postalCode, city: client.city, siret: client.siret }
            : { name: q.clientName },
        location: place.filter(Boolean).join(', ') || undefined,
        preview,
    };
}

function archivePath(q: Pick<Quote, 'companyId' | 'number' | 'version' | 'date'>): string {
    const year = Number(q.date.slice(0, 4)) || new Date().getUTCFullYear();
    return `archives/${q.companyId}/quotes/${year}/${q.number.replace(/[^A-Za-z0-9._-]/g, '_')}-V${q.version}.pdf`;
}

/**
 * Archive la version envoyée en cours (PDF + copie du devis). Idempotent : sans effet si déjà fait.
 */
export async function archiveQuoteVersion(id: string): Promise<QuoteVersionRecord> {
    const q = await loadQuote(id);
    if (!q.sentAt) throw new Error("Ce devis n'a pas été envoyé : rien à archiver.");
    const vRef = adminDb.collection(VERSIONS).doc(versionId(id, q.version));
    const existing = await vRef.get();
    if (existing.exists) return { id: vRef.id, ...existing.data() } as QuoteVersionRecord;

    const { id: _id, ...snapshot } = q;
    const path = archivePath(q);
    const file = adminBucket().file(path);
    let buffer = await renderQuotePdf(await documentData(snapshot));
    try {
        await file.save(buffer, {
            resumable: false,
            contentType: 'application/pdf',
            preconditionOpts: { ifGenerationMatch: 0 }, // jamais réécrit
            metadata: { cacheControl: 'private, max-age=0', metadata: { quoteId: id, number: q.number, version: String(q.version), sha256: sha256(buffer) } },
        });
    } catch (error: any) {
        if (error?.code !== 412) throw error;
        [buffer] = await file.download();   // déjà archivé (appel concurrent) : on garde l'existant
    }
    const pdf: ArchivedPdf = { path, sha256: sha256(buffer), size: buffer.length, generatedAt: new Date().toISOString() };

    return adminDb.runTransaction(async (tx) => {
        const [v, current] = await Promise.all([tx.get(vRef), tx.get(quoteRef(id))]);
        if (v.exists) return { id: vRef.id, ...v.data() } as QuoteVersionRecord;
        const record: Omit<QuoteVersionRecord, 'id'> = {
            quoteId: id, number: q.number, version: q.version, sentAt: q.sentAt!, ...(q.sentBy && { sentBy: q.sentBy }),
            totalHT: q.totals.totalHT, totalTTC: q.totals.totalTTC, pdf, snapshot: { ...snapshot, pdf },
        };
        tx.set(vRef, record);
        if (current.get('version') === q.version) tx.update(quoteRef(id), { pdf });
        return { id: vRef.id, ...record };
    });
}

/** PDF d'un devis : version envoyée (archivée, empreinte vérifiée) ou aperçu d'un brouillon. */
export async function getQuotePdf(id: string, version?: number): Promise<{ buffer: Buffer; filename: string; sha256?: string }> {
    const q = await loadQuote(id);
    const wanted = version ?? q.version;
    if (wanted === q.version && !q.sentAt) {
        const { id: _id, ...snapshot } = q;
        return { buffer: await renderQuotePdf(await documentData(snapshot, true)), filename: `Apercu_${q.number}-V${q.version}.pdf` };
    }
    let record = (await adminDb.collection(VERSIONS).doc(versionId(id, wanted)).get()).data() as QuoteVersionRecord | undefined;
    if (!record && wanted === q.version) record = await archiveQuoteVersion(id);
    if (!record) throw new Error(`Version ${wanted} introuvable.`);
    const [buffer] = await adminBucket().file(record.pdf.path).download();
    if (sha256(buffer) !== record.pdf.sha256) throw new DocumentIntegrityError(record.pdf.path);
    return { buffer, filename: `Devis_${q.number}-V${wanted}.pdf`, sha256: record.pdf.sha256 };
}

// --- Transitions ---

/** Envoie le brouillon : contrôle, date d'envoi, statut « envoyé », puis PDF archivé et version figée. */
export async function sendQuote(id: string, by?: string): Promise<Quote> {
    const sent = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(quoteRef(id));
        if (!snap.exists) throw new Error('Devis introuvable.');
        const q = { id: snap.id, ...snap.data() } as Quote;
        requireAction(q, 'send');
        const issues = quoteIssues(q.lines, q.pricing);
        if (issues.length) throw new Error(`Devis incomplet : ${issues.join(' ')}`);
        if (!q.title?.trim()) throw new Error("Devis sans objet.");
        // La date du devis est celle de son envoi ; la validité court à partir de là.
        const date = today();
        const update = {
            status: 'envoye' as const, date, validUntil: addDays(date, q.validityDays),
            totals: computeQuoteTotals(q.lines, q.pricing), sentAt: new Date().toISOString(),
            ...(by && { sentBy: by }), updatedAt: new Date().toISOString(), ...(by && { updatedBy: by }),
        };
        tx.update(quoteRef(id), update);
        return { ...q, ...update };
    });
    try {
        await archiveQuoteVersion(id);
    } catch (error) {
        // Le devis est envoyé ; le PDF sera archivé au premier téléchargement.
        console.error(`Archivage du devis ${id} impossible :`, error);
    }
    return loadQuote(id).catch(() => sent);
}

export type AcceptInput = {
    acceptedAt: string;
    signatoryName: string;
    signatoryRole?: string;
    purchaseOrderNumber?: string;
    comment?: string;
    /** Créer le site à partir de l'adresse d'intervention (devis sans site). */
    createSite?: boolean;
    /** Accepter malgré la fin de validité dépassée. */
    confirmExpired?: boolean;
};

/**
 * Enregistre l'accord du client. Effets, dans la même transaction : le prospect devient client ;
 * sur demande, le site est créé depuis l'adresse d'intervention (code SIT attribué).
 */
export async function acceptQuote(id: string, input: AcceptInput, by?: string): Promise<Quote> {
    if (!input.signatoryName?.trim()) throw new Error('Signataire requis.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.acceptedAt)) throw new Error("Date d'accord invalide.");
    return adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(quoteRef(id));
        if (!snap.exists) throw new Error('Devis introuvable.');
        const q = { id: snap.id, ...snap.data() } as Quote;
        requireAction(q, 'accept');
        const expired = q.validUntil < input.acceptedAt;
        if (expired && !input.confirmExpired) {
            throw new Error(`Le devis n'était plus valable le ${input.acceptedAt} (fin de validité : ${q.validUntil}). Confirmez pour l'accepter quand même.`);
        }
        const clientRef = adminDb.collection('clients').doc(q.clientId);
        const clientSnap = await tx.get(clientRef);
        const sequences = adminDb.collection('config').doc('sequences');
        const wantSite = input.createSite && !q.siteId && !!q.interventionAddress?.address;
        const seqSnap = wantSite ? await tx.get(sequences) : null;

        // --- écritures (après toutes les lectures) ---
        const acceptance: QuoteAcceptance = {
            acceptedAt: input.acceptedAt,
            signatoryName: input.signatoryName.trim(),
            ...(input.signatoryRole?.trim() && { signatoryRole: input.signatoryRole.trim() }),
            ...(input.purchaseOrderNumber?.trim() && { purchaseOrderNumber: input.purchaseOrderNumber.trim() }),
            ...(input.comment?.trim() && { comment: input.comment.trim() }),
            ...(expired && { acceptedExpired: true }),
            recordedAt: new Date().toISOString(),
            ...(by && { recordedBy: by }),
        };
        if (clientSnap.exists && clientSnap.get('relation') === 'prospect') {
            tx.update(clientRef, { relation: 'client' });
            acceptance.clientConverted = true;
        }
        const update: Partial<Quote> = { status: 'accepte', acceptance, updatedAt: acceptance.recordedAt, ...(by && { updatedBy: by }) };
        if (wantSite && q.interventionAddress) {
            const next = (seqSnap?.exists ? seqSnap.get('site') || 0 : 0) + 1;
            const siteRef = adminDb.collection('sites').doc();
            const name = q.interventionAddress.city ? `${q.clientName} – ${q.interventionAddress.city}` : q.clientName;
            tx.set(sequences, { site: next }, { merge: true });
            tx.set(siteRef, {
                code: `SIT-${String(next).padStart(5, '0')}`, name,
                address: q.interventionAddress.address, postalCode: q.interventionAddress.postalCode ?? '', city: q.interventionAddress.city ?? '',
                clientId: q.clientId, clientName: q.clientName, contractId: q.contractId ?? '',
            });
            acceptance.createdSiteId = siteRef.id;
            Object.assign(update, { siteId: siteRef.id, siteName: name });
        }
        tx.update(quoteRef(id), update);
        return { ...q, ...update } as Quote;
    });
}

export async function refuseQuote(id: string, input: { refusedAt: string; reason: string }, by?: string): Promise<Quote> {
    if (!input.reason?.trim()) throw new Error('Motif du refus requis.');
    return adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(quoteRef(id));
        if (!snap.exists) throw new Error('Devis introuvable.');
        const q = { id: snap.id, ...snap.data() } as Quote;
        requireAction(q, 'refuse');
        const now = new Date().toISOString();
        const update = {
            status: 'refuse' as const,
            refusal: { refusedAt: input.refusedAt || today(), reason: input.reason.trim(), recordedAt: now, ...(by && { recordedBy: by }) },
            updatedAt: now, ...(by && { updatedBy: by }),
        };
        tx.update(quoteRef(id), update);
        return { ...q, ...update };
    });
}

export async function cancelQuote(id: string, reason: string, by?: string): Promise<Quote> {
    if (!reason?.trim()) throw new Error("Motif de l'annulation requis.");
    return adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(quoteRef(id));
        if (!snap.exists) throw new Error('Devis introuvable.');
        const q = { id: snap.id, ...snap.data() } as Quote;
        requireAction(q, 'cancel');
        const now = new Date().toISOString();
        const update = {
            status: 'annule' as const,
            cancellation: { cancelledAt: now, reason: reason.trim(), previousStatus: q.status, ...(by && { recordedBy: by }) },
            updatedAt: now, ...(by && { updatedBy: by }),
        };
        tx.update(quoteRef(id), update);
        return { ...q, ...update };
    });
}

/**
 * Nouvelle version d'un devis envoyé, expiré ou refusé : la version envoyée reste archivée telle quelle,
 * le devis redevient un brouillon (même numéro, version + 1) modifiable.
 */
export async function newQuoteVersion(id: string, by?: string): Promise<Quote> {
    return adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(quoteRef(id));
        if (!snap.exists) throw new Error('Devis introuvable.');
        const q = { id: snap.id, ...snap.data() } as Quote;
        requireAction(q, 'newVersion');
        const vRef = adminDb.collection(VERSIONS).doc(versionId(id, q.version));
        const vSnap = await tx.get(vRef);
        const now = new Date().toISOString();
        if (vSnap.exists) tx.update(vRef, { supersededAt: now });
        const update = {
            status: 'brouillon', version: q.version + 1, updatedAt: now, ...(by && { updatedBy: by }),
            sentAt: FieldValue.delete(), sentBy: FieldValue.delete(), pdf: FieldValue.delete(),
            refusal: FieldValue.delete(), acceptance: FieldValue.delete(),
        };
        tx.update(quoteRef(id), update);
        const { sentAt: _s, sentBy: _b, pdf: _p, refusal: _r, acceptance: _a, ...rest } = q;
        return { ...rest, status: 'brouillon', version: q.version + 1, updatedAt: now } as Quote;
    });
}

export async function getQuoteVersions(id: string): Promise<QuoteVersionRecord[]> {
    const snap = await adminDb.collection(VERSIONS).where('quoteId', '==', id).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as QuoteVersionRecord).sort((a, b) => a.version - b.version);
}
