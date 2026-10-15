import 'server-only';
import { createHash } from 'crypto';
import { adminBucket, adminDb } from '@/lib/firebase-admin';
import { renderAccountingPdf, type AccountingDocumentData } from '@/lib/pdf/accounting-document';
import type { ArchivedPdf, Client, Company, CreditNote, Invoice } from '@/lib/types';
import { getClient, getCompany, getContract, getCreditNote, getInvoice, getInvoicesByIds, resolveIssuingCompany } from './firestore-admin';

/**
 * Archivage des PDF de factures et d'avoirs (copie conforme, conservation 10 ans).
 *
 * - Le PDF est généré une seule fois, à l'émission, puis stocké dans Cloud Storage :
 *   archives/{société}/invoices|credit-notes/{année}/{numéro}.pdf
 * - Il n'est jamais réécrit (écriture conditionnelle « le fichier ne doit pas exister »).
 * - Son empreinte SHA-256 est enregistrée sur la facture / l'avoir et vérifiée à chaque téléchargement.
 * - Les proformas ne sont pas archivés : leur PDF est généré à la demande.
 */

export type ArchivedKind = 'invoice' | 'creditNote';

const COLLECTIONS: Record<ArchivedKind, string> = { invoice: 'invoices', creditNote: 'creditNotes' };
const FOLDERS: Record<ArchivedKind, string> = { invoice: 'invoices', creditNote: 'credit-notes' };

export class DocumentIntegrityError extends Error {
    constructor(path: string) {
        super(`Le PDF archivé ${path} ne correspond plus à son empreinte : il a été modifié après son émission.`);
        this.name = 'DocumentIntegrityError';
    }
}

export const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

export { renderAccountingPdf };

type Loaded = {
    record: Invoice | CreditNote;
    data: AccountingDocumentData;
    company: Company;
    number?: string;
    archivable: boolean;
};

async function issuingCompany(companyId: string | undefined, contractId: string, client: Client | null): Promise<Company> {
    if (companyId) {
        const company = await getCompany(companyId);
        if (company) return company;
    }
    return resolveIssuingCompany(await getContract(contractId), client);
}

function clientBlock(client: Client | null, fallbackName: string): AccountingDocumentData['client'] {
    return client
        ? { name: client.name, address: client.address, postalCode: client.postalCode, city: client.city, siret: client.siret }
        : { name: fallbackName, address: '', postalCode: '', city: '' };
}

async function load(kind: ArchivedKind, id: string): Promise<Loaded> {
    if (kind === 'invoice') {
        const invoice = await getInvoice(id);
        if (!invoice) throw new Error('Facture introuvable.');
        const client = await getClient(invoice.clientId);
        const company = await issuingCompany(invoice.companyId, invoice.contractId, client);
        const isProforma = invoice.status === 'proforma';
        return {
            record: invoice,
            company,
            number: invoice.invoiceNumber,
            archivable: !isProforma,
            data: {
                kind: isProforma ? 'proforma' : 'invoice',
                number: invoice.invoiceNumber,
                date: invoice.date,
                dueDate: invoice.dueDate,
                periodStartDate: invoice.periodStartDate,
                periodEndDate: invoice.periodEndDate,
                company,
                client: clientBlock(client, invoice.clientName),
                lineItems: invoice.lineItems,
                subtotal: invoice.subtotal,
                tax: invoice.tax,
                total: invoice.total,
                taxRate: invoice.taxRate,
            },
        };
    }

    const creditNote = await getCreditNote(id);
    if (!creditNote) throw new Error('Avoir introuvable.');
    const client = await getClient(creditNote.clientId);
    const company = await issuingCompany(creditNote.companyId, creditNote.contractId, client);
    const originals = await getInvoicesByIds(creditNote.originalInvoiceIds || []);
    return {
        record: creditNote,
        company,
        number: creditNote.creditNoteNumber,
        archivable: true,
        data: {
            kind: 'creditNote',
            number: creditNote.creditNoteNumber,
            date: creditNote.date,
            company,
            client: clientBlock(client, creditNote.clientName),
            lineItems: creditNote.lineItems,
            subtotal: creditNote.subtotal,
            tax: creditNote.tax,
            total: creditNote.total,
            references: originals.map(inv => inv.invoiceNumber || inv.id),
            reason: creditNote.reason,
        },
    };
}

function archivePath(kind: ArchivedKind, companyId: string, number: string, date: string): string {
    const year = new Date(date).getUTCFullYear() || new Date().getUTCFullYear();
    const safeNumber = number.replace(/[^A-Za-z0-9._-]/g, '_');
    return `archives/${companyId}/${FOLDERS[kind]}/${year}/${safeNumber}.pdf`;
}

/**
 * Génère et archive le PDF d'une facture émise ou d'un avoir (sans effet s'il est déjà archivé).
 */
export async function archiveDocument(kind: ArchivedKind, id: string): Promise<ArchivedPdf> {
    const loaded = await load(kind, id);
    if (loaded.record.pdf) return loaded.record.pdf;
    if (!loaded.archivable) throw new Error("Un proforma n'est pas archivé.");
    if (!loaded.number) throw new Error('Document sans numéro : archivage impossible.');

    const path = archivePath(kind, loaded.company.id, loaded.number, loaded.record.date);
    const file = adminBucket().file(path);

    let buffer = await renderAccountingPdf(loaded.data);
    try {
        await file.save(buffer, {
            resumable: false,
            contentType: 'application/pdf',
            preconditionOpts: { ifGenerationMatch: 0 }, // n'écrase jamais un PDF déjà archivé
            metadata: {
                cacheControl: 'private, max-age=0',
                metadata: { documentId: id, documentNumber: loaded.number, sha256: sha256(buffer) },
            },
        });
    } catch (error: any) {
        if (error?.code !== 412) throw error;
        // Déjà archivé (appel concurrent ou enregistrement interrompu) : on garde le fichier existant.
        [buffer] = await file.download();
    }

    const pdf: ArchivedPdf = { path, sha256: sha256(buffer), size: buffer.length, generatedAt: new Date().toISOString() };
    const ref = adminDb.collection(COLLECTIONS[kind]).doc(id);
    return adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const existing = snap.get('pdf') as ArchivedPdf | undefined;
        if (existing) return existing;
        tx.update(ref, { pdf });
        return pdf;
    });
}

/**
 * Archive sans faire échouer l'appelant : la facture ou l'avoir est déjà enregistré,
 * le PDF sera de toute façon archivé au premier téléchargement en cas d'échec ici.
 */
export async function archiveDocumentSafely(kind: ArchivedKind, id: string): Promise<void> {
    try {
        await archiveDocument(kind, id);
    } catch (error) {
        console.error(`Archivage du PDF impossible (${kind} ${id}) :`, error);
    }
}

/**
 * PDF à télécharger : copie archivée (vérifiée par son empreinte) ou, pour un proforma, rendu à la demande.
 */
export async function getDocumentPdf(kind: ArchivedKind, id: string): Promise<{ buffer: Buffer; filename: string; sha256?: string }> {
    const loaded = await load(kind, id);
    const label = kind === 'creditNote' ? 'Avoir' : loaded.archivable ? 'Facture' : 'Proforma';

    if (!loaded.archivable) {
        return { buffer: await renderAccountingPdf(loaded.data), filename: `${label}_${id}.pdf` };
    }

    const pdf = loaded.record.pdf ?? await archiveDocument(kind, id);
    const [buffer] = await adminBucket().file(pdf.path).download();
    if (sha256(buffer) !== pdf.sha256) throw new DocumentIntegrityError(pdf.path);
    return { buffer, filename: `${label}_${loaded.number}.pdf`, sha256: pdf.sha256 };
}
