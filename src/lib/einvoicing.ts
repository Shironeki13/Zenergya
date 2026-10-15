import type {
    Client, Company, Contract, CreditNote, EInvoicingChannel, EInvoicingRegime, EInvoicingState, EInvoicingStatus, Invoice, Typology,
} from '@/lib/types';

/**
 * Réforme de la facturation électronique (RFE) : à partir de la configuration du client, du contrat,
 * de la typologie et de la société émettrice, détermine comment une facture doit être transmise.
 *
 * - B2B France (assujettis) : facture électronique via la plateforme agréée (PA), adressée selon l'annuaire.
 * - B2G (entités publiques) : Chorus Pro.
 * - B2C (particuliers, non-assujettis) et international : pas de facture électronique, mais e-reporting
 *   (données de transaction transmises par la PA).
 *
 * Module sans dépendance serveur : utilisé à l'émission (serveur) et par le tableau de bord (navigateur).
 */

export const REGIME_LABELS: Record<EInvoicingRegime, string> = {
    b2b: 'B2B – entreprise assujettie (France)',
    b2g: 'B2G – entité publique',
    b2c: 'B2C – particulier / non-assujetti',
    international: 'International',
    excluded: 'Hors champ',
};

export const REGIME_SHORT_LABELS: Record<EInvoicingRegime, string> = {
    b2b: 'B2B', b2g: 'B2G', b2c: 'B2C', international: 'International', excluded: 'Hors champ',
};

export const CHANNEL_LABELS: Record<EInvoicingChannel, string> = {
    pa: 'Plateforme agréée',
    chorus: 'Chorus Pro',
    ereporting: 'E-reporting',
    none: 'Aucune transmission',
};

export const STATUS_LABELS: Record<EInvoicingStatus, string> = {
    to_send: 'À transmettre',
    sent: 'Transmise',
    rejected: 'Rejetée',
    not_applicable: 'Non concernée',
};

export const CHANNEL_BY_REGIME: Record<EInvoicingRegime, EInvoicingChannel> = {
    b2b: 'pa',
    b2g: 'chorus',
    b2c: 'ereporting',
    international: 'ereporting',
    excluded: 'none',
};

export type EInvoicingResolution = {
    regime: EInvoicingRegime;
    regimeSource: 'client' | 'clientType' | 'typology' | 'default';
    channel: EInvoicingChannel;
    address?: string;
    addressSource?: 'contract' | 'client' | 'siren';
    /** Faux si la facture est antérieure à l'entrée en vigueur de l'obligation pour la société émettrice. */
    inScope: boolean;
    blocking: string[];
    warnings: string[];
};

type ClientLike = Pick<Client, 'clientType' | 'typologyId' | 'siret' | 'useChorus'> &
    Partial<Pick<Client, 'einvoicingRegime' | 'einvoicingAddress' | 'chorusServiceCode'>>;

/** SIREN (9 chiffres) déduit du SIRET. */
export function sirenOf(siret?: string): string | undefined {
    const digits = (siret || '').replace(/\s/g, '');
    return /^\d{14}$/.test(digits) || /^\d{9}$/.test(digits) ? digits.slice(0, 9) : undefined;
}

/** Clé de Luhn des SIREN / SIRET (détecte la plupart des fautes de frappe). */
export function luhnValid(digits: string): boolean {
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
        let d = Number(digits[digits.length - 1 - i]);
        if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
        sum += d;
    }
    return sum % 10 === 0;
}

export function resolveRegime(client: ClientLike, typology?: Pick<Typology, 'einvoicingRegime'> | null): Pick<EInvoicingResolution, 'regime' | 'regimeSource'> {
    if (client.einvoicingRegime && client.einvoicingRegime !== 'auto') {
        return { regime: client.einvoicingRegime, regimeSource: 'client' };
    }
    if (client.clientType === 'public') return { regime: 'b2g', regimeSource: 'clientType' };
    if (typology?.einvoicingRegime) return { regime: typology.einvoicingRegime, regimeSource: 'typology' };
    return { regime: 'b2b', regimeSource: 'default' };
}

export function resolveEInvoicing(params: {
    client: ClientLike;
    typology?: Pick<Typology, 'einvoicingRegime'> | null;
    contract?: Pick<Contract, 'einvoicingAddress'> | null;
    company?: Pick<Company, 'einvoicingStartDate'> | null;
    /** Date de la facture (ISO). */
    documentDate?: string;
}): EInvoicingResolution {
    const { client, typology, contract, company, documentDate } = params;
    const { regime, regimeSource } = resolveRegime(client, typology);
    const channel = CHANNEL_BY_REGIME[regime];
    const blocking: string[] = [];
    const warnings: string[] = [];
    const siren = sirenOf(client.siret);

    if (client.siret && !luhnValid(client.siret.replace(/\s/g, ''))) {
        warnings.push('SIRET du client invalide (clé de contrôle).');
    }

    let address: string | undefined;
    let addressSource: EInvoicingResolution['addressSource'];

    if (channel === 'pa') {
        const contractAddress = contract?.einvoicingAddress?.trim();
        const clientAddress = client.einvoicingAddress?.trim();
        if (contractAddress) { address = contractAddress; addressSource = 'contract'; }
        else if (clientAddress) { address = clientAddress; addressSource = 'client'; }
        else if (siren) { address = siren; addressSource = 'siren'; }

        if (!address) {
            blocking.push("Adresse électronique de facturation manquante (ni adresse, ni SIRET sur la fiche client).");
        } else if (siren && !address.startsWith(siren)) {
            warnings.push(`L'adresse de facturation (${address}) ne correspond pas au SIREN du client (${siren}).`);
        }
    }

    if (channel === 'chorus') {
        if (!client.siret) blocking.push('SIRET du client public manquant (obligatoire pour Chorus Pro).');
        if (!client.useChorus) warnings.push('Dépôt Chorus non activé sur la fiche client.');
    }

    // Obligation d'émission : B2G toujours concerné (Chorus Pro) ; sinon selon la date propre à la société.
    let inScope = channel === 'pa' || channel === 'chorus';
    if (channel === 'pa') {
        if (!company?.einvoicingStartDate) {
            warnings.push("Date d'entrée en vigueur de l'obligation non paramétrée pour la société émettrice.");
        } else if (documentDate && documentDate.slice(0, 10) < company.einvoicingStartDate.slice(0, 10)) {
            inScope = false;
        }
    }

    return { regime, regimeSource, channel, address, addressSource, inScope, blocking, warnings };
}

/** État initial figé sur une facture à l'émission. */
export function initialEInvoicingState(resolution: EInvoicingResolution, now = new Date()): EInvoicingState {
    const transmissible = (resolution.channel === 'pa' || resolution.channel === 'chorus') && resolution.inScope;
    return {
        regime: resolution.regime,
        channel: resolution.channel,
        ...(resolution.address && { address: resolution.address }),
        ...(resolution.addressSource && { addressSource: resolution.addressSource }),
        status: transmissible ? 'to_send' : 'not_applicable',
        ...(resolution.blocking.length > 0 && { blocking: resolution.blocking }),
        ...(resolution.warnings.length > 0 && { warnings: resolution.warnings }),
        computedAt: now.toISOString(),
    };
}

/** Transitions de statut autorisées (le statut « Non concernée » est fixé par le calcul, pas manuellement). */
export const ALLOWED_TRANSITIONS: Record<EInvoicingStatus, EInvoicingStatus[]> = {
    to_send: ['sent', 'rejected'],
    rejected: ['to_send', 'sent'],
    sent: ['rejected'],
    not_applicable: [],
};

export function canTransition(from: EInvoicingStatus, to: EInvoicingStatus): boolean {
    return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Recalcul possible (adressage corrigé) tant que le document n'a pas été transmis. */
export function canRecompute(state?: EInvoicingState): boolean {
    return !state || state.status !== 'sent';
}

// --- Tableau de bord ---

export type EInvoicingRow = {
    key: string;
    kind: 'invoice' | 'creditNote';
    id: string;
    number: string;
    date: string;
    clientId: string;
    clientName: string;
    clientSiren?: string;
    companyId?: string;
    subtotal: number;
    tax: number;
    total: number;
    state: EInvoicingState;
    /** Faux : document antérieur à la RFE, état calculé à l'affichage (figé au premier recalcul ou changement de statut). */
    frozen: boolean;
    /** À transmettre mais adressage incomplet. */
    blocked: boolean;
};

/**
 * Lignes du tableau de bord : factures émises (hors proformas) et avoirs, avec leur état de transmission
 * (figé à l'émission, ou calculé à la volée pour les documents antérieurs).
 */
export function buildEInvoicingRows(input: {
    invoices: Invoice[];
    creditNotes: CreditNote[];
    clients: Client[];
    contracts: Contract[];
    typologies: Typology[];
    companies: Company[];
}): EInvoicingRow[] {
    const clients = new Map(input.clients.map(c => [c.id, c]));
    const contracts = new Map(input.contracts.map(c => [c.id, c]));
    const typologies = new Map(input.typologies.map(t => [t.id, t]));
    const companies = new Map(input.companies.map(c => [c.id, c]));

    const stateFor = (doc: Invoice | CreditNote): { state: EInvoicingState; frozen: boolean } | null => {
        if (doc.einvoicing) return { state: doc.einvoicing, frozen: true };
        const client = clients.get(doc.clientId);
        if (!client) return null;
        const contract = contracts.get(doc.contractId);
        const company = companies.get(doc.companyId || contract?.companyId || client.companyId);
        const resolution = resolveEInvoicing({ client, typology: typologies.get(client.typologyId), contract, company, documentDate: doc.date });
        return { state: initialEInvoicingState(resolution), frozen: false };
    };

    const rows: EInvoicingRow[] = [];
    const push = (kind: EInvoicingRow['kind'], doc: Invoice | CreditNote, number: string | undefined) => {
        const computed = stateFor(doc);
        if (!computed || !number) return;
        const client = clients.get(doc.clientId);
        rows.push({
            key: `${kind}:${doc.id}`,
            kind,
            id: doc.id,
            number,
            date: doc.date,
            clientId: doc.clientId,
            clientName: client?.name || doc.clientName,
            clientSiren: sirenOf(client?.siret),
            companyId: doc.companyId || contracts.get(doc.contractId)?.companyId || client?.companyId,
            subtotal: doc.subtotal,
            tax: doc.tax,
            total: doc.total,
            state: computed.state,
            frozen: computed.frozen,
            blocked: computed.state.status === 'to_send' && (computed.state.blocking?.length ?? 0) > 0,
        });
    };

    for (const invoice of input.invoices) {
        if (invoice.status !== 'proforma') push('invoice', invoice, invoice.invoiceNumber);
    }
    for (const creditNote of input.creditNotes) push('creditNote', creditNote, creditNote.creditNoteNumber);

    return rows.sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
}
