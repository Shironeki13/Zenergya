import 'server-only';
import { createHash } from 'crypto';
import { adminBucket, adminDb } from '@/lib/firebase-admin';
import { renderAccountingPdf, renderAnnexePdf, type AccountingDocumentData } from '@/lib/pdf/accounting-document';
import { annexesP1 } from '@/lib/billing/p1-annexe';
import { creditNoteAmounts } from '@/lib/credit-notes';
import { annexeXlsx } from '@/lib/billing/p1-annexe-xlsx';
import { lieuxExecution, natureOperation, type Adresse } from '@/lib/billing/mentions';
import { adressageClient, adresseEnvoi } from '@/lib/billing/adressage';
import { listerTiers } from './tiers-admin';
import type { ArchivedPdf, Client, Company, Contract, CreditNote, Invoice, Site } from '@/lib/types';
import { getActivities, getClient, getCompany, getContract, getCreditNote, getInvoice, getInvoicesByIds, resolveIssuingCompany, resolvePaymentTerm } from './firestore-admin';

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

/**
 * Bloc « Facturé à » : le client (nom, SIRET, TVA), son représentant et son payeur éventuels. L'adresse est celle du
 * représentant quand elle est connue (syndic d'une copropriété). Résolu à la génération, donc figé dans le PDF archivé.
 */
export async function clientBlock(client: Client | null, fallbackName: string): Promise<AccountingDocumentData['client']> {
    if (!client) return { name: fallbackName, address: '', postalCode: '', city: '' };
    const adressage = client.representedBy?.trim() || client.payer?.trim() ? adressageClient(client, await listerTiers()) : {};
    const envoi = adresseEnvoi(client, adressage);
    return {
        name: client.name, address: envoi.address ?? '', postalCode: envoi.postalCode ?? '', city: envoi.city ?? '', siret: client.siret,
        ...(client.vatNumber && { vatNumber: client.vatNumber.replace(/\s/g, '') }), ...adressage,
    };
}

const MAX_LIEUX = 8;

/**
 * Mentions légales résolues à la génération (donc figées dans le PDF archivé) : nature de l'opération d'après
 * les activités des lignes, lieux d'exécution différents de l'adresse de facturation, références de l'acheteur.
 */
async function mentions(record: Invoice | CreditNote, facturation: Adresse): Promise<Pick<AccountingDocumentData, 'operationNature' | 'places' | 'legalCommitment' | 'marketNumber'>> {
    const lignes = record.lineItems ?? [];
    const siteIds = [...new Set(lignes.map(l => l.siteId).filter((x): x is string => !!x))];
    const [activites, sites] = await Promise.all([
        getActivities(),
        siteIds.length ? adminDb.getAll(...siteIds.map(i => adminDb.collection('sites').doc(i))) : Promise.resolve([]),
    ]);
    const lieux = lieuxExecution(sites.filter(d => d.exists).map(d => d.data() as Site), facturation);
    const chorus = record.einvoicing?.chorus;
    return {
        operationNature: natureOperation(lignes, activites),
        ...(lieux.length > 0 && { places: lieux.length > MAX_LIEUX ? [`${lieux.length} sites, détaillés au contrat`] : lieux }),
        ...(chorus?.legalCommitment && { legalCommitment: chorus.legalCommitment }),
        ...(chorus?.marketNumber && { marketNumber: chorus.marketNumber }),
    };
}

/** Libellé des conditions de paiement du contrat, sinon du client ; absent : délai par défaut. */
async function libellePaiement(contract: Pick<Contract, 'paymentTermId'> | null, client: Client | null): Promise<string | undefined> {
    try { return (await resolvePaymentTerm(contract, client))?.deadline?.trim() || undefined; } catch { return undefined; }
}

async function load(kind: ArchivedKind, id: string): Promise<Loaded> {
    if (kind === 'invoice') {
        const invoice = await getInvoice(id);
        if (!invoice) throw new Error('Facture introuvable.');
        const client = await getClient(invoice.clientId);
        const company = await issuingCompany(invoice.companyId, invoice.contractId, client);
        const paymentTerms = await libellePaiement(invoice.contractId ? await getContract(invoice.contractId) : null, client);
        const isProforma = invoice.status === 'proforma';
        const bloc = await clientBlock(client, invoice.clientName);
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
                client: bloc,
                lineItems: invoice.lineItems,
                subtotal: invoice.subtotal,
                tax: invoice.tax,
                total: invoice.total,
                taxRate: invoice.taxRate,
                ...(invoice.vatBreakdown && { vatBreakdown: invoice.vatBreakdown }),
                ...(invoice.quote && { quote: invoice.quote }),
                ...(invoice.situation && { situation: invoice.situation }),
                ...annexesDe(invoice.lineItems),
                ...(paymentTerms && { paymentTerms }),
                ...(await mentions(invoice, bloc)),
            },
        };
    }

    const creditNote = await getCreditNote(id);
    if (!creditNote) throw new Error('Avoir introuvable.');
    const client = await getClient(creditNote.clientId);
    const company = await issuingCompany(creditNote.companyId, creditNote.contractId, client);
    const originals = await getInvoicesByIds(creditNote.originalInvoiceIds || []);
    const bloc = await clientBlock(client, creditNote.clientName);
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
            client: bloc,
            lineItems: creditNote.lineItems,
            subtotal: creditNote.subtotal,
            tax: creditNote.tax,
            total: creditNote.total,
            references: originals.map(inv => inv.invoiceNumber || inv.id),
            reason: creditNote.reason,
            ...(creditNote.nature === 'interne' && { interne: true }),
            ...(await mentions(creditNote, bloc)),
            ...(creditNote.vatBreakdown && { vatBreakdown: creditNote.vatBreakdown }),
            // Avoir d'annulation : ses lignes reprennent (inversées) celles de la facture, dont l'annexe fait foi ;
            // seules les lignes de décompte ou de régularisation ont une annexe propre à l'avoir.
            ...annexesDe((creditNote.lineItems ?? []).filter(l => l.p1Regul && !(creditNote.originalInvoiceIds ?? []).length)),
        },
    };
}

/**
 * Aperçu d'une facture avant son émission : même mise en page et mêmes mentions que la facture, sans numéro,
 * marqué « sans valeur comptable ». Rien n'est écrit ni archivé.
 */
export async function apercuPdf(p: { invoice: Omit<Invoice, 'id' | 'invoiceNumber' | 'companyId' | 'issuedAt' | 'pdf' | 'einvoicing'>; client: Client; company: Company; contract: Pick<Contract, 'paymentTermId'> }): Promise<Buffer> {
    const { invoice, client, company } = p;
    const paymentTerms = await libellePaiement(p.contract, client);
    const bloc = await clientBlock(client, invoice.clientName);
    return renderAccountingPdf({
        kind: 'proforma', date: invoice.date, dueDate: invoice.dueDate, periodStartDate: invoice.periodStartDate, periodEndDate: invoice.periodEndDate,
        company, client: bloc, lineItems: invoice.lineItems,
        subtotal: invoice.subtotal, tax: invoice.tax, total: invoice.total, taxRate: invoice.taxRate,
        ...(invoice.vatBreakdown && { vatBreakdown: invoice.vatBreakdown }),
        ...annexesDe(invoice.lineItems),
        ...(paymentTerms && { paymentTerms }),
        ...(await mentions(invoice as Invoice, bloc)),
    });
}

/** Annexes P1 du document (détail figé dans ses lignes) ; rien s'il n'y a pas de P1 détaillé. */
function annexesDe(lineItems: Invoice['lineItems']): Pick<AccountingDocumentData, 'annexes'> {
    const annexes = annexesP1(lineItems ?? []);
    return annexes.length ? { annexes } : {};
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

/**
 * Annexe P1 d'une facture ou d'un avoir, seule : PDF (mêmes pages que celles jointes au document) ou tableur.
 * Recalculée à la demande à partir du détail figé dans les lignes du document.
 */
export async function getDocumentAnnexe(kind: ArchivedKind, id: string, format: 'pdf' | 'xlsx'): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const loaded = await load(kind, id);
    if (!loaded.data.annexes?.length) throw new Error('Annexe introuvable : ce document n\'a pas de détail P1.');
    const nom = `Annexe_P1_${(loaded.number ?? id).replace(/[^A-Za-z0-9._-]/g, '_')}`;
    if (format === 'xlsx') {
        return { buffer: await annexeXlsx(loaded.data), filename: `${nom}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    }
    return { buffer: (await renderAnnexePdf(loaded.data))!, filename: `${nom}.pdf`, contentType: 'application/pdf' };
}

/**
 * Aperçu de l'avoir qui annulerait une facture : même mise en page et mêmes montants que l'avoir, sans numéro,
 * marqué « sans valeur comptable ». Rien n'est écrit ni archivé.
 */
export async function apercuAvoirPdf(invoiceId: string, reason: string, interne: boolean): Promise<Buffer> {
    const invoice = await getInvoice(invoiceId);
    if (!invoice) throw new Error('Facture introuvable.');
    const client = await getClient(invoice.clientId);
    const company = await issuingCompany(invoice.companyId, invoice.contractId, client);
    const bloc = await clientBlock(client, invoice.clientName);
    const montants = creditNoteAmounts([invoice]);
    const fictif = { ...invoice, lineItems: montants.lineItems } as unknown as CreditNote;
    return renderAccountingPdf({
        kind: 'creditNote', apercu: true, date: new Date().toISOString(), company, client: bloc,
        lineItems: montants.lineItems, subtotal: montants.subtotal, tax: montants.tax, total: montants.total,
        ...(montants.vatBreakdown.length > 0 && { vatBreakdown: montants.vatBreakdown }),
        references: [invoice.invoiceNumber || invoice.id], reason, ...(interne && { interne: true }),
        ...(await mentions(fictif, bloc)),
    });
}
