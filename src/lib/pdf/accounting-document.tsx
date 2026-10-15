/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import type { Client, Company, InvoiceLineItem } from '@/lib/types';

/**
 * Modèle PDF des factures, proformas et avoirs (rendu côté serveur par @react-pdf/renderer).
 * Polices standard PDF (Helvetica) : pas de dépendance réseau, rendu identique partout.
 *
 * Attention : Next.js embarque sa propre version de React dans le code serveur, différente de celle
 * qu'utilise @react-pdf/renderer (chargé depuis node_modules, voir serverExternalPackages).
 * Les éléments de ce modèle doivent être créés par CE React-là, d'où le JSX « classique » branché sur
 * le React de node_modules, chargé à l'exécution (hors bundle).
 */
// eslint-disable-next-line no-eval
const runtimeRequire: NodeRequire = eval('require');
const RuntimeReact = runtimeRequire('react') as typeof import('react');
const h = RuntimeReact.createElement;
const Fragment = RuntimeReact.Fragment;

export type AccountingDocumentKind = 'invoice' | 'proforma' | 'creditNote';

export type AccountingDocumentData = {
    kind: AccountingDocumentKind;
    number?: string;
    date: string; // ISO
    dueDate?: string; // ISO
    periodStartDate?: string;
    periodEndDate?: string;
    company: Company;
    client: Pick<Client, 'name' | 'address' | 'postalCode' | 'city'> & { siret?: string };
    lineItems: InvoiceLineItem[];
    subtotal: number;
    tax: number;
    total: number;
    taxRate?: number;
    /** Avoir : numéros des factures annulées et motif. */
    references?: string[];
    reason?: string;
};

const TITLES: Record<AccountingDocumentKind, string> = {
    invoice: 'FACTURE',
    proforma: 'FACTURE PROFORMA',
    creditNote: 'AVOIR',
};

/** 1234.5 → « 1 234,50 € » (espaces simples : les espaces fines insécables ne sont pas dans les polices PDF standard). */
export function formatEur(value: number): string {
    const sign = value < 0 ? '-' : '';
    const [int, dec] = Math.abs(value).toFixed(2).split('.');
    return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${dec} €`;
}

/** ISO → JJ/MM/AAAA (en UTC : les dates sont stockées à minuit UTC). */
export function formatDate(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

function formatRate(taxRate: number | undefined, subtotal: number, tax: number): string {
    const rate = taxRate ?? (subtotal !== 0 ? tax / subtotal : 0);
    return `${(Math.round(rate * 1000) / 10).toString().replace('.', ',')} %`;
}

/** Logo stocké en data URL : seuls PNG et JPEG sont pris en charge par le moteur PDF. */
function supportedLogo(url?: string): string | undefined {
    return url && /^data:image\/(png|jpe?g);base64,/i.test(url) ? url : undefined;
}

const styles = StyleSheet.create({
    page: { padding: 40, fontSize: 9, fontFamily: 'Helvetica', color: '#111827' },
    header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
    logo: { height: 40, maxWidth: 160, objectFit: 'contain', marginBottom: 8 },
    companyName: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
    muted: { color: '#6b7280' },
    title: { fontSize: 18, fontFamily: 'Helvetica-Bold', textAlign: 'right', color: '#1d4ed8' },
    number: { fontSize: 10, textAlign: 'right', marginTop: 2 },
    parties: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
    box: { width: '48%' },
    label: { fontSize: 7, color: '#6b7280', fontFamily: 'Helvetica-Bold', marginBottom: 3, letterSpacing: 0.5 },
    clientName: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
    infoRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 2 },
    infoLabel: { fontFamily: 'Helvetica-Bold', marginRight: 4 },
    tableHeader: { flexDirection: 'row', backgroundColor: '#f3f4f6', paddingVertical: 5, paddingHorizontal: 4, fontFamily: 'Helvetica-Bold' },
    groupRow: { backgroundColor: '#f9fafb', paddingVertical: 4, paddingHorizontal: 4, fontFamily: 'Helvetica-Bold', marginTop: 4 },
    row: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: '#e5e7eb' },
    colDesc: { width: '58%' },
    colQty: { width: '10%', textAlign: 'right' },
    colUnit: { width: '16%', textAlign: 'right' },
    colTotal: { width: '16%', textAlign: 'right' },
    totals: { marginTop: 12, marginLeft: 'auto', width: '45%' },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
    grandTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderTopWidth: 1, borderTopColor: '#111827', marginTop: 3, fontFamily: 'Helvetica-Bold', fontSize: 11 },
    notes: { marginTop: 20 },
    footer: { position: 'absolute', bottom: 24, left: 40, right: 40, fontSize: 7, color: '#6b7280', textAlign: 'center', borderTopWidth: 0.5, borderTopColor: '#e5e7eb', paddingTop: 6 },
});

export function AccountingDocumentPdf({ data }: { data: AccountingDocumentData }) {
    const { kind, company, client } = data;
    const logo = supportedLogo(company.logoUrl);

    const groups = data.lineItems.reduce<Record<string, InvoiceLineItem[]>>((acc, item) => {
        const key = item.activityCode || 'Autres';
        (acc[key] ||= []).push(item);
        return acc;
    }, {});

    const legalIds = [
        company.siret ? `SIRET ${company.siret}` : company.siren ? `SIREN ${company.siren}` : undefined,
        company.vatNumber ? `TVA intracommunautaire ${company.vatNumber}` : undefined,
    ].filter(Boolean).join(' · ');

    return (
        <Document title={`${TITLES[kind]} ${data.number ?? ''}`.trim()} author={company.name}>
            <Page size="A4" style={styles.page}>
                <View style={styles.header}>
                    <View>
                        {/* eslint-disable-next-line jsx-a11y/alt-text */}
                        {logo && <Image src={logo} style={styles.logo} />}
                        <Text style={styles.companyName}>{company.name}</Text>
                        {company.address && <Text style={styles.muted}>{company.address}</Text>}
                        {(company.postalCode || company.city) && <Text style={styles.muted}>{`${company.postalCode ?? ''} ${company.city ?? ''}`.trim()}</Text>}
                        {legalIds && <Text style={styles.muted}>{legalIds}</Text>}
                    </View>
                    <View>
                        <Text style={styles.title}>{TITLES[kind]}</Text>
                        {data.number && <Text style={styles.number}>N° {data.number}</Text>}
                    </View>
                </View>

                <View style={styles.parties}>
                    <View style={styles.box}>
                        <Text style={styles.label}>{kind === 'creditNote' ? 'AVOIR ÉMIS AU NOM DE' : 'FACTURÉ À'}</Text>
                        <Text style={styles.clientName}>{client.name}</Text>
                        {client.address && <Text>{client.address}</Text>}
                        <Text>{`${client.postalCode ?? ''} ${client.city ?? ''}`.trim()}</Text>
                        {client.siret && <Text style={styles.muted}>SIRET {client.siret}</Text>}
                    </View>
                    <View style={styles.box}>
                        <View style={styles.infoRow}><Text style={styles.infoLabel}>Date d'émission :</Text><Text>{formatDate(data.date)}</Text></View>
                        {kind === 'invoice' && data.dueDate && (
                            <View style={styles.infoRow}><Text style={styles.infoLabel}>Date d'échéance :</Text><Text>{formatDate(data.dueDate)}</Text></View>
                        )}
                        {data.periodStartDate && data.periodEndDate && (
                            <View style={styles.infoRow}><Text style={styles.infoLabel}>Période :</Text><Text>{`du ${formatDate(data.periodStartDate)} au ${formatDate(data.periodEndDate)}`}</Text></View>
                        )}
                        {data.references && data.references.length > 0 && (
                            <View style={styles.infoRow}><Text style={styles.infoLabel}>Facture(s) d'origine :</Text><Text>{data.references.join(', ')}</Text></View>
                        )}
                    </View>
                </View>

                <View style={styles.tableHeader} fixed>
                    <Text style={styles.colDesc}>Désignation</Text>
                    <Text style={styles.colQty}>Qté</Text>
                    <Text style={styles.colUnit}>P.U. HT</Text>
                    <Text style={styles.colTotal}>Total HT</Text>
                </View>
                {Object.entries(groups).map(([activityCode, items]) => (
                    <View key={activityCode}>
                        <Text style={styles.groupRow}>Prestations {activityCode}</Text>
                        {items.map((item, index) => (
                            <View key={index} style={styles.row} wrap={false}>
                                <Text style={styles.colDesc}>{item.description}</Text>
                                <Text style={styles.colQty}>{String(item.quantity)}</Text>
                                <Text style={styles.colUnit}>{formatEur(item.unitPrice)}</Text>
                                <Text style={styles.colTotal}>{formatEur(item.total)}</Text>
                            </View>
                        ))}
                    </View>
                ))}

                <View style={styles.totals} wrap={false}>
                    <View style={styles.totalRow}><Text>Total HT</Text><Text>{formatEur(data.subtotal)}</Text></View>
                    <View style={styles.totalRow}><Text>{`TVA (${formatRate(data.taxRate, data.subtotal, data.tax)})`}</Text><Text>{formatEur(data.tax)}</Text></View>
                    <View style={styles.grandTotal}><Text>Total TTC</Text><Text>{formatEur(data.total)}</Text></View>
                </View>

                <View style={styles.notes} wrap={false}>
                    {kind === 'creditNote' && data.reason && <Text>Motif : {data.reason}</Text>}
                    {kind === 'invoice' && (
                        <>
                            <Text>Paiement à réception, au plus tard à la date d'échéance. Pas d'escompte pour paiement anticipé.</Text>
                            <Text>Tout retard de paiement entraîne des pénalités de 1,5 % par mois ainsi qu'une indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 du Code de commerce).</Text>
                        </>
                    )}
                    {kind === 'proforma' && <Text>Document sans valeur comptable : ne constitue pas une facture.</Text>}
                </View>

                <Text style={styles.footer} fixed render={({ pageNumber, totalPages }) =>
                    `${company.name}${legalIds ? ` · ${legalIds}` : ''} — Page ${pageNumber}/${totalPages}`
                } />
            </Page>
        </Document>
    );
}

/** Rendu PDF (Buffer) d'une facture, d'un proforma ou d'un avoir. */
export function renderAccountingPdf(data: AccountingDocumentData): Promise<Buffer> {
    return renderToBuffer(h(AccountingDocumentPdf, { data }) as any);
}
