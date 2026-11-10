/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import type { Client, Company, InvoiceLineItem, InvoiceQuoteLink, VatBreakdown } from '@/lib/types';
import type { SituationSnapshot } from '@/lib/projects/types';
import { afficher, type AnnexeP1 } from '@/lib/billing/p1-annexe';

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
    /** TVA par taux (factures multi-taux). Absente : une seule ligne de TVA. */
    vatBreakdown?: VatBreakdown;
    /** Facture issue d'un devis (acompte, solde, totalité). */
    quote?: InvoiceQuoteLink;
    /** Facture de situation de travaux (affaire P6). */
    situation?: SituationSnapshot;
    /** Annexes P1 (détail du calcul), ajoutées en pages à la suite du document. */
    annexes?: AnnexeP1[];
};

/**
 * Texte compatible avec les polices PDF standard (Helvetica, WinAnsi) : les signes absents sont remplacés
 * (− → -, → → à, ₀ → 0, espaces fines → espace).
 */
export function pdfTexte(t: string): string {
    return t.replace(/\u2212/g, '-').replace(/\s?\u2192\s?/g, ' à ').replace(/\u2080/g, '0').replace(/[\u202f\u00a0\u2009]/g, ' ').replace(/\u2265/g, '>=').replace(/\u2264/g, '<=');
}

/** Désignation d'une ligne sur la facture : le détail du calcul P1 est renvoyé à l'annexe. */
function designation(item: InvoiceLineItem, annexe: boolean): string {
    const detaille = annexe && (item.p1Releve?.detail || item.p1Dju || item.p1Acompte);
    return pdfTexte(detaille ? `${item.description.split(' — ').slice(0, 4).join(' — ')} — détail en annexe` : item.description);
}

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
    // Annexe P1 (paysage)
    aPage: { paddingTop: 28, paddingHorizontal: 28, paddingBottom: 44, fontSize: 7, fontFamily: 'Helvetica', color: '#111827' },
    aEntete: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
    aTitre: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: '#1d4ed8' },
    aFormule: { backgroundColor: '#eff6ff', padding: 6, marginBottom: 8, fontSize: 8 },
    aSousTitre: { fontFamily: 'Helvetica-Bold', fontSize: 8, marginTop: 6, marginBottom: 3 },
    aTh: { flexDirection: 'row', backgroundColor: '#1f3864', color: '#ffffff', fontFamily: 'Helvetica-Bold', paddingVertical: 4, paddingHorizontal: 2, alignItems: 'center' },
    aTr: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 2, borderBottomWidth: 0.5, borderBottomColor: '#e5e7eb' },
    aDetail: { color: '#6b7280' },
    aTotal: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 2, fontFamily: 'Helvetica-Bold', borderTopWidth: 1, borderTopColor: '#111827' },
    aCell: { paddingHorizontal: 2 },
    aFooter: { position: 'absolute', bottom: 20, left: 28, right: 28, fontSize: 7, color: '#6b7280', textAlign: 'center', borderTopWidth: 0.5, borderTopColor: '#e5e7eb', paddingTop: 5 },
});

/** Pages d'annexe P1 (paysage) : formule, révision des prix, une ligne par site et par mois, totaux. */
function AnnexePages({ data }: { data: AccountingDocumentData }) {
    const { company, client } = data;
    const doc = `${data.kind === 'creditNote' ? "l'avoir" : data.kind === 'proforma' ? 'la facture proforma' : 'la facture'}${data.number ? ` n° ${data.number}` : ''}`;
    const fr = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
    return (
        <>
            {(data.annexes ?? []).map((a, k) => {
                const total = a.colonnes.reduce((s, c) => s + c.largeur, 0);
                const w = (l: number) => `${(l / total) * 100}%`;
                const droite = (f: string) => f !== 'texte';
                const avantMontants = a.colonnes.findIndex(c => c.cle === 'ht');
                return (
                    <Page key={k} size="A4" orientation="landscape" style={styles.aPage}>
                        <View style={styles.aEntete} fixed>
                            <View>
                                <Text style={styles.aTitre}>{pdfTexte(`ANNEXE ${k + 1}/${data.annexes!.length} — ${a.titre}`)}</Text>
                                <Text>{pdfTexte(`Annexe à ${doc} du ${formatDate(data.date)}${data.periodStartDate && data.periodEndDate ? ` — période du ${formatDate(data.periodStartDate)} au ${formatDate(data.periodEndDate)}` : ''}`)}</Text>
                            </View>
                            <View>
                                <Text style={{ fontFamily: 'Helvetica-Bold', textAlign: 'right' }}>{company.name}</Text>
                                <Text style={{ textAlign: 'right' }}>{client.name}</Text>
                            </View>
                        </View>
                        <Text style={styles.aFormule}>{pdfTexte(`${a.formule}${a.references.length ? `     (${a.references.map(([l, v]) => `${l} : ${v}`).join(' ; ')})` : ''}`)}</Text>

                        {a.revisions.length > 0 && (
                            <View wrap={false}>
                                <Text style={styles.aSousTitre}>Révision des prix : indices du mois (valeur de base) et coefficient C/C0</Text>
                                <View style={styles.aTh}>
                                    <Text style={[styles.aCell, { width: '8%' }]}>Mois</Text>
                                    <Text style={[styles.aCell, { width: '82%' }]}>Indices</Text>
                                    <Text style={[styles.aCell, { width: '10%', textAlign: 'right' }]}>C/C0</Text>
                                </View>
                                {a.revisions.map((r, i) => (
                                    <View key={i} style={styles.aTr}>
                                        <Text style={[styles.aCell, { width: '8%' }]}>{fr(r.mois)}</Text>
                                        <Text style={[styles.aCell, { width: '82%' }]}>{pdfTexte(`${r.sites.length ? `${r.sites.join(', ')} : ` : ''}${r.termes.map(t =>
                                            `${t.indice ?? t.terme} ${t.valeur === null ? '—' : afficher(t.valeur, { format: 'coef', decimales: 4 })} (base ${t.base === null ? '—' : afficher(t.base, { format: 'coef', decimales: 4 })})`).join('   ·   ') || 'prix non révisé'}`)}</Text>
                                        <Text style={[styles.aCell, { width: '10%', textAlign: 'right' }]}>{r.coefficient === null ? '' : afficher(r.coefficient, { format: 'coef', decimales: 5 })}</Text>
                                    </View>
                                ))}
                            </View>
                        )}

                        <Text style={styles.aSousTitre}>Détail</Text>
                        <View style={styles.aTh} fixed>
                            {a.colonnes.map(c => <Text key={c.cle} style={[styles.aCell, { width: w(c.largeur), textAlign: droite(c.format) ? 'right' : 'left' }]}>{pdfTexte(c.libelle)}</Text>)}
                        </View>
                        {a.lignes.map((l, i) => (
                            <View key={i} style={l.detail ? [styles.aTr, styles.aDetail] : styles.aTr} wrap={false}>
                                {a.colonnes.map(c => <Text key={c.cle} style={[styles.aCell, { width: w(c.largeur), textAlign: droite(c.format) ? 'right' : 'left' }]}>{pdfTexte(afficher(l.valeurs[c.cle] ?? null, c))}</Text>)}
                            </View>
                        ))}
                        <View style={styles.aTotal} wrap={false}>
                            <Text style={[styles.aCell, { width: w(a.colonnes.slice(0, avantMontants).reduce((s, c) => s + c.largeur, 0)) }]}>{pdfTexte(`TOTAL — ${a.titre}`)}</Text>
                            {a.colonnes.slice(avantMontants).map(c => (
                                <Text key={c.cle} style={[styles.aCell, { width: w(c.largeur), textAlign: 'right' }]}>
                                    {c.cle === 'ht' ? formatEur(a.totaux.ht) : c.cle === 'tva' ? formatEur(a.totaux.tva) : c.cle === 'ttc' ? formatEur(a.totaux.ttc) : ''}
                                </Text>
                            ))}
                        </View>
                        {a.notes.map((n, i) => <Text key={i} style={[styles.muted, { marginTop: i ? 1 : 6 }]}>{pdfTexte(n)}</Text>)}
                        <Text style={[styles.muted, { marginTop: 2 }]}>TVA indicative par ligne ; la TVA de la facture est calculée sur le total HT par taux.</Text>

                        <Text style={styles.aFooter} fixed render={({ pageNumber, totalPages }) => pdfTexte(`${company.name} — Annexe P1 à ${doc} — Page ${pageNumber}/${totalPages}`)} />
                    </Page>
                );
            })}
        </>
    );
}

export function AccountingDocumentPdf({ data }: { data: AccountingDocumentData }) {
    const { kind, company, client } = data;
    const logo = supportedLogo(company.logoUrl);
    const title = kind === 'invoice' && data.situation ? `FACTURE DE SITUATION N° ${data.situation.number}`
        : kind === 'invoice' && data.quote?.billingKind === 'acompte' ? "FACTURE D'ACOMPTE" : TITLES[kind];
    const period = (p: string) => `${p.slice(5, 7)}/${p.slice(0, 4)}`;
    const pct = (rate: number) => `${rate.toLocaleString('fr-FR')} %`;

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
        <Document title={`${title} ${data.number ?? ''}`.trim()} author={company.name}>
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
                        {/* Titre long (situation) : plus petit, pour ne pas empiéter sur la colonne société. */}
                        <Text style={title.length > 16 ? [styles.title, { fontSize: 13 }] : styles.title}>{title}</Text>
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
                        {data.situation && (
                            <View style={styles.infoRow}><Text style={styles.infoLabel}>Affaire :</Text><Text>{data.situation.projectCode}</Text></View>
                        )}
                        {data.situation && (
                            <View style={styles.infoRow}><Text style={styles.infoLabel}>Travaux du mois :</Text><Text>{period(data.situation.period)}</Text></View>
                        )}
                        {data.quote && (
                            <View style={styles.infoRow}><Text style={styles.infoLabel}>Devis :</Text>
                                <Text>{`${data.quote.number}${data.quote.version > 1 ? ` V${data.quote.version}` : ''}${data.quote.acceptedAt ? ` accepté le ${formatDate(data.quote.acceptedAt)}` : ''}`}</Text></View>
                        )}
                        {data.quote?.purchaseOrderNumber && (
                            <View style={styles.infoRow}><Text style={styles.infoLabel}>Bon de commande :</Text><Text>{data.quote.purchaseOrderNumber}</Text></View>
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
                                <Text style={styles.colDesc}>{designation(item, !!data.annexes?.length)}</Text>
                                <Text style={styles.colQty}>{String(item.quantity)}</Text>
                                <Text style={styles.colUnit}>{formatEur(item.unitPrice)}</Text>
                                <Text style={styles.colTotal}>{formatEur(item.total)}</Text>
                            </View>
                        ))}
                    </View>
                ))}

                <View style={styles.totals} wrap={false}>
                    <View style={styles.totalRow}><Text>Total HT</Text><Text>{formatEur(data.subtotal)}</Text></View>
                    {data.vatBreakdown && data.vatBreakdown.length > 0
                        ? data.vatBreakdown.map(v => (
                            <View key={v.rate} style={styles.totalRow}><Text>{`TVA ${pct(v.rate)} sur ${formatEur(v.base)}`}</Text><Text>{formatEur(v.amount)}</Text></View>
                        ))
                        : <View style={styles.totalRow}><Text>{`TVA (${formatRate(data.taxRate, data.subtotal, data.tax)})`}</Text><Text>{formatEur(data.tax)}</Text></View>}
                    <View style={styles.grandTotal}><Text>Total TTC</Text><Text>{formatEur(data.total)}</Text></View>
                    {data.situation && data.situation.retention.amount !== 0 && (
                        <>
                            <View style={styles.totalRow}><Text>{`Retenue de garantie (${pct(data.situation.retention.pct)} du TTC)`}</Text><Text>{formatEur(-data.situation.retention.amount)}</Text></View>
                            <View style={styles.grandTotal}><Text>Net à payer</Text><Text>{formatEur(data.situation.netToPay)}</Text></View>
                        </>
                    )}
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
            {data.annexes && data.annexes.length > 0 && <AnnexePages data={data} />}
        </Document>
    );
}

/** Annexe P1 seule (mêmes pages que celles jointes à la facture). */
export function AnnexeDocumentPdf({ data }: { data: AccountingDocumentData }) {
    return (
        <Document title={`Annexe P1 ${data.number ?? ''}`.trim()} author={data.company.name}>
            <AnnexePages data={data} />
        </Document>
    );
}

/** Rendu PDF (Buffer) d'une facture, d'un proforma ou d'un avoir. */
export function renderAccountingPdf(data: AccountingDocumentData): Promise<Buffer> {
    return renderToBuffer(h(AccountingDocumentPdf, { data }) as any);
}

/** Rendu PDF (Buffer) de l'annexe P1 seule ; null si le document n'a pas d'annexe. */
export function renderAnnexePdf(data: AccountingDocumentData): Promise<Buffer> | null {
    return data.annexes?.length ? renderToBuffer(h(AnnexeDocumentPdf, { data }) as any) : null;
}
