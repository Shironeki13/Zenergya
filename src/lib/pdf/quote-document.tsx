/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { formatDate, formatEur } from '@/lib/pdf/accounting-document';
import { computeLines, isPriced } from '@/lib/quotes/pricing';
import type { Quote } from '@/lib/quotes/types';
import type { Company } from '@/lib/types';

/**
 * Modèle PDF des devis (rendu serveur, même principe que accounting-document.tsx : React de node_modules
 * chargé à l'exécution). Ne montre au client que les prix : ni déboursé, ni coefficient, ni marge.
 */
// eslint-disable-next-line no-eval
const runtimeRequire: NodeRequire = eval('require');
const RuntimeReact = runtimeRequire('react') as typeof import('react');
const h = RuntimeReact.createElement;
const Fragment = RuntimeReact.Fragment;

export type QuoteDocumentData = {
    quote: Omit<Quote, 'id'>;
    company: Company;
    client: { name: string; address?: string; postalCode?: string; city?: string; siret?: string };
    /** Lieu d'intervention lisible (site ou adresse). */
    location?: string;
    /** Aperçu d'un brouillon : marqué comme tel, jamais archivé. */
    preview?: boolean;
};

const pct = (rate: number) => `${rate.toLocaleString('fr-FR')} %`;
const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ','));

function supportedLogo(url?: string): string | undefined {
    return url && /^data:image\/(png|jpe?g);base64,/i.test(url) ? url : undefined;
}

const styles = StyleSheet.create({
    page: { padding: 40, paddingBottom: 60, fontSize: 9, fontFamily: 'Helvetica', color: '#111827' },
    header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
    logo: { height: 40, maxWidth: 160, objectFit: 'contain', marginBottom: 8 },
    bold: { fontFamily: 'Helvetica-Bold' },
    companyName: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
    muted: { color: '#6b7280' },
    title: { fontSize: 18, fontFamily: 'Helvetica-Bold', textAlign: 'right', color: '#1d4ed8' },
    right: { textAlign: 'right' },
    preview: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#b91c1c', textAlign: 'right', marginTop: 4 },
    parties: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
    box: { width: '48%' },
    label: { fontSize: 7, color: '#6b7280', fontFamily: 'Helvetica-Bold', marginBottom: 3, letterSpacing: 0.5 },
    infoRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 2 },
    infoLabel: { fontFamily: 'Helvetica-Bold', marginRight: 4 },
    object: { marginBottom: 12, padding: 6, backgroundColor: '#f9fafb' },
    tableHeader: { flexDirection: 'row', backgroundColor: '#f3f4f6', paddingVertical: 5, paddingHorizontal: 4, fontFamily: 'Helvetica-Bold' },
    row: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: '#e5e7eb' },
    titleRow: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 4, backgroundColor: '#f9fafb', fontFamily: 'Helvetica-Bold', marginTop: 3 },
    subtotalRow: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 4, fontFamily: 'Helvetica-Bold' },
    textRow: { paddingVertical: 3, paddingHorizontal: 4, fontStyle: 'italic', color: '#374151' },
    colDesc: { width: '46%' },
    colQty: { width: '9%', textAlign: 'right' },
    colUnit: { width: '8%', textAlign: 'center' },
    colPrice: { width: '14%', textAlign: 'right' },
    colVat: { width: '8%', textAlign: 'right' },
    colTotal: { width: '15%', textAlign: 'right' },
    totals: { marginTop: 10, marginLeft: 'auto', width: '45%' },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
    grandTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderTopWidth: 1, borderTopColor: '#111827', marginTop: 3, fontFamily: 'Helvetica-Bold', fontSize: 11 },
    section: { marginTop: 14 },
    sectionTitle: { fontSize: 8, fontFamily: 'Helvetica-Bold', marginBottom: 3, color: '#374151' },
    signature: { marginTop: 16, flexDirection: 'row', justifyContent: 'space-between' },
    signBox: { width: '48%', borderWidth: 0.5, borderColor: '#9ca3af', padding: 6, minHeight: 80 },
    footer: { position: 'absolute', bottom: 24, left: 40, right: 40, fontSize: 7, color: '#6b7280', textAlign: 'center', borderTopWidth: 0.5, borderTopColor: '#e5e7eb', paddingTop: 6 },
});

function LineRow({ label, quantity, unit, unitPrice, vatRate, total, level = 0 }: {
    label: string; quantity: number; unit?: string; unitPrice: number | null; vatRate: number; total: number; level?: number;
}) {
    return (
        <View style={styles.row} wrap={false}>
            <Text style={[styles.colDesc, { paddingLeft: level * 8 }]}>{label}</Text>
            <Text style={styles.colQty}>{qty(quantity)}</Text>
            <Text style={styles.colUnit}>{unit ?? ''}</Text>
            <Text style={styles.colPrice}>{unitPrice === null ? '—' : formatEur(unitPrice)}</Text>
            <Text style={styles.colVat}>{pct(vatRate)}</Text>
            <Text style={styles.colTotal}>{formatEur(total)}</Text>
        </View>
    );
}

export function QuoteDocumentPdf({ data }: { data: QuoteDocumentData }) {
    const { quote: q, company, client } = data;
    const logo = supportedLogo(company.logoUrl);
    const lines = computeLines(q.lines, q.pricing);
    const options = lines.filter(l => isPriced(l) && l.optional);
    const t = q.totals;
    let titleLevel = 0;

    const legalIds = [
        company.siret ? `SIRET ${company.siret}` : company.siren ? `SIREN ${company.siren}` : undefined,
        company.vatNumber ? `TVA intracommunautaire ${company.vatNumber}` : undefined,
    ].filter(Boolean).join(' · ');

    return (
        <Document title={`DEVIS ${q.number}${q.version > 1 ? ` V${q.version}` : ''}`} author={company.name}>
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
                        <Text style={styles.title}>DEVIS</Text>
                        <Text style={styles.right}>{`N° ${q.number}${q.version > 1 ? ` — version ${q.version}` : ''}`}</Text>
                        {data.preview && <Text style={styles.preview}>APERÇU — DEVIS NON ENVOYÉ</Text>}
                    </View>
                </View>

                <View style={styles.parties}>
                    <View style={styles.box}>
                        <Text style={styles.label}>CLIENT</Text>
                        <Text style={styles.bold}>{client.name}</Text>
                        {client.address && <Text>{client.address}</Text>}
                        <Text>{`${client.postalCode ?? ''} ${client.city ?? ''}`.trim()}</Text>
                        {client.siret && <Text style={styles.muted}>SIRET {client.siret}</Text>}
                        {q.contactName && <Text style={{ marginTop: 4 }}>{`À l'attention de ${q.contactName}`}</Text>}
                    </View>
                    <View style={styles.box}>
                        <View style={styles.infoRow}><Text style={styles.infoLabel}>Date :</Text><Text>{formatDate(q.date)}</Text></View>
                        <View style={styles.infoRow}><Text style={styles.infoLabel}>Valable jusqu'au :</Text><Text>{formatDate(q.validUntil)}</Text></View>
                        {q.clientReference && <View style={styles.infoRow}><Text style={styles.infoLabel}>Votre référence :</Text><Text>{q.clientReference}</Text></View>}
                        {q.requestDate && <View style={styles.infoRow}><Text style={styles.infoLabel}>Votre demande du :</Text><Text>{formatDate(q.requestDate)}</Text></View>}
                        {q.authorName && <View style={styles.infoRow}><Text style={styles.infoLabel}>Affaire suivie par :</Text><Text>{q.authorName}</Text></View>}
                        {q.authorEmail && <View style={styles.infoRow}><Text>{q.authorEmail}</Text></View>}
                    </View>
                </View>

                <View style={styles.object}>
                    <Text><Text style={styles.bold}>Objet : </Text>{q.title}</Text>
                    {data.location && <Text><Text style={styles.bold}>Lieu d'intervention : </Text>{data.location}</Text>}
                </View>

                <View style={styles.tableHeader} fixed>
                    <Text style={styles.colDesc}>Désignation</Text>
                    <Text style={styles.colQty}>Qté</Text>
                    <Text style={styles.colUnit}>Unité</Text>
                    <Text style={styles.colPrice}>P.U. HT</Text>
                    <Text style={styles.colVat}>TVA</Text>
                    <Text style={styles.colTotal}>Total HT</Text>
                </View>
                {lines.map(l => {
                    if (l.kind === 'TITRE') {
                        titleLevel = (l.level ?? 0) + 1;
                        return (
                            <View key={l.id} style={[styles.titleRow, { paddingLeft: 4 + (l.level ?? 0) * 8 }]} wrap={false}>
                                <Text style={{ width: '85%' }}>{l.label}</Text>
                                <Text style={styles.colTotal}>{formatEur(l.groupHT ?? 0)}</Text>
                            </View>
                        );
                    }
                    if (l.kind === 'SOUS_TOTAL') {
                        return (
                            <View key={l.id} style={styles.subtotalRow} wrap={false}>
                                <Text style={{ width: '85%', textAlign: 'right' }}>{l.label || 'Sous-total'}</Text>
                                <Text style={styles.colTotal}>{formatEur(l.groupHT ?? 0)}</Text>
                            </View>
                        );
                    }
                    if (l.kind === 'TEXTE') return <Text key={l.id} style={styles.textRow}>{l.label}</Text>;
                    if (l.optional) return null;
                    return (
                        <View key={l.id}>
                            <LineRow label={l.discountPct ? `${l.label} (remise ${pct(l.discountPct)})` : l.label}
                                quantity={l.quantity} unit={l.unit} unitPrice={l.unitPrice} vatRate={l.vatRate} total={l.totalHT} level={titleLevel} />
                            {l.description && <Text style={[styles.textRow, { paddingLeft: 4 + titleLevel * 8 }]}>{l.description}</Text>}
                        </View>
                    );
                })}

                <View style={styles.totals} wrap={false}>
                    <View style={styles.totalRow}><Text>Total HT</Text><Text>{formatEur(t.totalHT)}</Text></View>
                    {t.vat.map(v => (
                        <View key={v.rate} style={styles.totalRow}><Text>{`TVA ${pct(v.rate)} sur ${formatEur(v.base)}`}</Text><Text>{formatEur(v.amount)}</Text></View>
                    ))}
                    <View style={styles.grandTotal}><Text>Total TTC</Text><Text>{formatEur(t.totalTTC)}</Text></View>
                </View>

                {options.length > 0 && (
                    <View style={styles.section} wrap={false}>
                        <Text style={styles.sectionTitle}>OPTIONS (non comprises dans le total ci-dessus)</Text>
                        {options.map(l => (
                            <LineRow key={l.id} label={l.label} quantity={l.quantity} unit={l.unit} unitPrice={l.unitPrice} vatRate={l.vatRate} total={l.totalHT} />
                        ))}
                    </View>
                )}

                <View style={styles.section} wrap={false}>
                    <Text style={styles.sectionTitle}>CONDITIONS</Text>
                    {q.estimatedStart && <Text>{`Début prévisionnel des travaux : ${formatDate(q.estimatedStart)}`}</Text>}
                    {q.estimatedDuration && <Text>{`Durée estimée : ${q.estimatedDuration}`}</Text>}
                    {q.paymentTerms && <Text>{`Conditions de paiement : ${q.paymentTerms}`}</Text>}
                    <Text>{`Devis gratuit, valable jusqu'au ${formatDate(q.validUntil)}.`}</Text>
                    {q.notes && <Text style={{ marginTop: 3 }}>{q.notes}</Text>}
                    {company.insurer && (
                        <Text style={{ marginTop: 3 }}>
                            {`Assurance professionnelle : ${company.insurer}${company.insurancePolicy ? `, contrat n° ${company.insurancePolicy}` : ''}${company.insuranceCoverage ? ` — couverture : ${company.insuranceCoverage}` : ''}.`}
                        </Text>
                    )}
                    {company.quoteFooterText && <Text style={{ marginTop: 3 }}>{company.quoteFooterText}</Text>}
                </View>

                <View style={styles.signature} wrap={false}>
                    <View style={styles.signBox}>
                        <Text style={styles.bold}>Pour l'entreprise</Text>
                        <Text style={styles.muted}>{company.name}</Text>
                    </View>
                    <View style={styles.signBox}>
                        <Text style={styles.bold}>Bon pour accord du client</Text>
                        <Text style={styles.muted}>Devis reçu avant l'exécution des travaux.</Text>
                        <Text style={styles.muted}>Date, nom, qualité, signature et cachet :</Text>
                    </View>
                </View>

                <Text style={styles.footer} fixed render={({ pageNumber, totalPages }) =>
                    `${company.name}${legalIds ? ` · ${legalIds}` : ''} — Devis ${q.number}${q.version > 1 ? ` V${q.version}` : ''} — Page ${pageNumber}/${totalPages}`
                } />
            </Page>
        </Document>
    );
}

export function renderQuotePdf(data: QuoteDocumentData): Promise<Buffer> {
    return renderToBuffer(h(QuoteDocumentPdf, { data }) as any);
}
