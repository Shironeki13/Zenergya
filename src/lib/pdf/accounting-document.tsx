/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import type { Client, Company, InvoiceLineItem, InvoiceQuoteLink, VatBreakdown } from '@/lib/types';
import type { SituationSnapshot } from '@/lib/projects/types';
import { afficher, etapesFormule, syntheseAnnexe, type AnnexeP1 } from '@/lib/billing/p1-annexe';
import { libellePartie, type Adressage } from '@/lib/billing/adressage';
import { conditionsPaiement, identiteLegale, mentionEscompte, mentionPenalites, MENTION_DEBITS } from '@/lib/billing/mentions';

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
    /** Facturé. Avec un représentant dont l'adresse est connue, `address`, `postalCode` et `city` sont les siens. */
    client: Pick<Client, 'name' | 'address' | 'postalCode' | 'city'> & { siret?: string; vatNumber?: string } & Adressage;
    /** Mentions légales résolues à la génération : conditions de paiement, nature, lieux, références de l'acheteur. */
    paymentTerms?: string;
    operationNature?: string;
    places?: string[];
    legalCommitment?: string;
    marketNumber?: string;
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
    // Annexe P1 (paysage) : bandeau, chiffres clés, formule en étapes, graphique mensuel, détail par site
    aPage: { paddingTop: 0, paddingHorizontal: 28, paddingBottom: 44, fontSize: 7, fontFamily: 'Helvetica', color: '#0f172a' },
    aBandeau: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0f2747', color: '#ffffff', marginHorizontal: -28, paddingHorizontal: 28, paddingVertical: 12, marginBottom: 12 },
    aPastille: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#93c5fd', letterSpacing: 1, marginBottom: 2 },
    aTitre: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: '#ffffff' },
    aSousBandeau: { fontSize: 7.5, color: '#cbd5e1', marginTop: 2 },
    aHaut: { flexDirection: 'row', marginBottom: 6 },
    aGauche: { width: '60%', paddingRight: 10 },
    aDroite: { width: '40%' },
    aSection: { fontFamily: 'Helvetica-Bold', fontSize: 7, color: '#64748b', letterSpacing: 0.8, marginBottom: 4, marginTop: 2 },
    aTuiles: { flexDirection: 'row', marginBottom: 8 },
    aTuile: { flex: 1, backgroundColor: '#f1f5f9', borderRadius: 4, paddingVertical: 6, paddingHorizontal: 7, marginRight: 5 },
    aTuileForte: { flex: 1, backgroundColor: '#1d4ed8', color: '#ffffff', borderRadius: 4, paddingVertical: 6, paddingHorizontal: 7, marginRight: 5 },
    aTuileLibelle: { fontSize: 6.5, color: '#64748b', marginBottom: 2 },
    aTuileValeur: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
    aFormule: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', backgroundColor: '#eff6ff', borderRadius: 4, borderLeftWidth: 3, borderLeftColor: '#1d4ed8', paddingVertical: 5, paddingHorizontal: 7, marginBottom: 4 },
    aResultat: { fontFamily: 'Helvetica-Bold', fontSize: 8.5, color: '#1d4ed8', marginRight: 4 },
    aTerme: { backgroundColor: '#ffffff', borderWidth: 0.5, borderColor: '#bfdbfe', borderRadius: 3, paddingVertical: 2, paddingHorizontal: 5, fontSize: 7.5, marginVertical: 1 },
    aOperateur: { fontFamily: 'Helvetica-Bold', fontSize: 9, color: '#1d4ed8', marginHorizontal: 4 },
    aReference: { fontSize: 6.5, color: '#64748b', marginBottom: 6 },
    aRevision: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0', paddingVertical: 3 },
    aIndice: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderRadius: 3, paddingVertical: 2, paddingHorizontal: 5, marginRight: 5 },
    aGraphique: { flexDirection: 'row', alignItems: 'flex-end', height: 62, borderBottomWidth: 0.5, borderBottomColor: '#94a3b8', paddingHorizontal: 2 },
    aBarre: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', marginHorizontal: 3 },
    aSousTitre: { fontFamily: 'Helvetica-Bold', fontSize: 7, color: '#64748b', letterSpacing: 0.8, marginTop: 8, marginBottom: 3 },
    aTh: { flexDirection: 'row', backgroundColor: '#e2e8f0', color: '#334155', fontFamily: 'Helvetica-Bold', fontSize: 6.5, paddingVertical: 4, paddingHorizontal: 2, alignItems: 'center', borderTopLeftRadius: 3, borderTopRightRadius: 3 },
    aSite: { flexDirection: 'row', backgroundColor: '#f1f5f9', paddingVertical: 3, paddingHorizontal: 4, marginTop: 2, fontFamily: 'Helvetica-Bold', fontSize: 7.5, color: '#0f2747', borderLeftWidth: 2, borderLeftColor: '#1d4ed8' },
    aTr: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 2, borderBottomWidth: 0.5, borderBottomColor: '#eef2f7' },
    aPair: { backgroundColor: '#fafbfc' },
    aDetail: { color: '#94a3b8' },
    aMontant: { fontFamily: 'Helvetica-Bold' },
    aTotal: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 2, marginTop: 3, fontFamily: 'Helvetica-Bold', fontSize: 8, backgroundColor: '#0f2747', color: '#ffffff', borderRadius: 3 },
    aCell: { paddingHorizontal: 2 },
    aFooter: { position: 'absolute', bottom: 20, left: 28, right: 28, fontSize: 7, color: '#6b7280', textAlign: 'center', borderTopWidth: 0.5, borderTopColor: '#e5e7eb', paddingTop: 5 },
});

/**
 * Pages d'annexe P1 (paysage), pensées pour le client : bandeau, chiffres clés, formule en étapes, montant par mois,
 * révision des prix (indice du mois, base, variation), puis le détail regroupé par site et le total.
 */
function AnnexePages({ data }: { data: AccountingDocumentData }) {
    const { company, client } = data;
    const doc = `${data.kind === 'creditNote' ? "l'avoir" : data.kind === 'proforma' ? 'la facture proforma' : 'la facture'}${data.number ? ` n° ${data.number}` : ''}`;
    const fr = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
    const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
    const moisCourt = (m: string) => `${MOIS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
    const nombre = (v: number, d: number) => afficher(v, { format: 'nombre', decimales: d });
    const logo = supportedLogo(company.logoUrl);
    return (
        <>
            {(data.annexes ?? []).map((a, k) => {
                const synthese = syntheseAnnexe(a);
                const etapes = etapesFormule(a.formule);
                // Détail regroupé par site : la colonne « Site » devient un bandeau par site.
                const parSite = a.colonnes[0]?.cle === 'site' && synthese.sites > 0;
                const colonnes = parSite ? a.colonnes.slice(1) : a.colonnes;
                const total = colonnes.reduce((s, c) => s + c.largeur, 0);
                const w = (l: number) => `${(l / total) * 100}%`;
                const droite = (f: string) => f !== 'texte';
                const avantMontants = colonnes.findIndex(c => c.cle === 'ht');
                const maxMois = Math.max(1, ...synthese.parMois.map(m => Math.abs(m.ht)));
                // Lignes d'un même site rassemblées, dans l'ordre d'apparition des sites (les lignes restent dans leur ordre).
                const ordreSites = [...new Set(a.lignes.map(l => String(l.valeurs.site ?? '')))];
                const lignes = parSite ? ordreSites.flatMap(site => a.lignes.filter(l => String(l.valeurs.site ?? '') === site)) : a.lignes;
                let sitePrecedent: string | null = null, rang = 0;
                return (
                    <Page key={k} size="A4" orientation="landscape" style={styles.aPage}>
                        <View style={styles.aBandeau} fixed>
                            <View>
                                <Text style={styles.aPastille}>{pdfTexte(`ANNEXE ${k + 1}/${data.annexes!.length}  ·  LE DÉTAIL DE VOTRE FACTURE`)}</Text>
                                <Text style={styles.aTitre}>{pdfTexte(a.titre)}</Text>
                                <Text style={styles.aSousBandeau}>{pdfTexte(`Annexe à ${doc} du ${formatDate(data.date)}${data.periodStartDate && data.periodEndDate ? `  ·  période du ${formatDate(data.periodStartDate)} au ${formatDate(data.periodEndDate)}` : ''}`)}</Text>
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                                {logo && <Image src={logo} style={{ height: 22, maxWidth: 110, objectFit: 'contain', marginBottom: 3 }} />}
                                <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 9 }}>{pdfTexte(company.name)}</Text>
                                <Text style={styles.aSousBandeau}>{pdfTexte(`pour ${client.name}`)}</Text>
                            </View>
                        </View>

                        <View style={styles.aHaut} wrap={false}>
                            <View style={styles.aGauche}>
                                <Text style={styles.aSection}>COMMENT CE MONTANT EST CALCULÉ</Text>
                                {etapes.map((e, i) => (
                                    <View key={i} style={styles.aFormule}>
                                        {e.resultat !== '' && <Text style={styles.aResultat}>{pdfTexte(`${e.resultat}  =`)}</Text>}
                                        {e.termes.map((t, j) => (
                                            <View key={j} style={{ flexDirection: 'row', alignItems: 'center' }}>
                                                {t.operateur && <Text style={styles.aOperateur}>{pdfTexte(t.operateur)}</Text>}
                                                <Text style={styles.aTerme}>{pdfTexte(t.texte)}</Text>
                                            </View>
                                        ))}
                                    </View>
                                ))}
                                {a.references.length > 0 && <Text style={styles.aReference}>{pdfTexte(a.references.map(([l, v]) => `${l} : ${v}`).join('   ·   '))}</Text>}

                                {a.revisions.length > 0 && (
                                    <View>
                                        <Text style={styles.aSection}>RÉVISION DES PRIX : INDICES DU MOIS, COMPARÉS À LEUR VALEUR DE BASE</Text>
                                        {a.revisions.map((r, i) => (
                                            <View key={i} style={styles.aRevision}>
                                                <Text style={{ width: 44, fontFamily: 'Helvetica-Bold' }}>{fr(r.mois)}</Text>
                                                <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
                                                    {r.sites.length > 0 && <Text style={[styles.muted, { marginRight: 5 }]}>{pdfTexte(`${r.sites.join(', ')} :`)}</Text>}
                                                    {r.termes.length === 0 && <Text style={styles.muted}>prix non révisé</Text>}
                                                    {r.termes.map((t, j) => {
                                                        const variation = t.valeur !== null && t.base ? (t.valeur / t.base - 1) * 100 : null;
                                                        return (
                                                            <View key={j} style={styles.aIndice}>
                                                                <Text style={{ fontFamily: 'Helvetica-Bold' }}>{pdfTexte(`${t.indice ?? t.terme} `)}</Text>
                                                                <Text>{t.valeur === null ? '—' : afficher(t.valeur, { format: 'coef', decimales: 4 })}</Text>
                                                                <Text style={styles.muted}>{`  base ${t.base === null ? '—' : afficher(t.base, { format: 'coef', decimales: 4 })}`}</Text>
                                                                {variation !== null && <Text style={{ color: variation > 0 ? '#b45309' : variation < 0 ? '#047857' : '#64748b', fontFamily: 'Helvetica-Bold' }}>{`  ${variation > 0 ? '+' : variation < 0 ? '-' : ''}${nombre(Math.abs(variation), 1)} %`}</Text>}
                                                            </View>
                                                        );
                                                    })}
                                                </View>
                                                <Text style={[styles.muted, { marginRight: 4 }]}>coefficient</Text>
                                                <Text style={{ width: 46, textAlign: 'right', fontFamily: 'Helvetica-Bold', fontSize: 8.5, color: '#1d4ed8' }}>{r.coefficient === null ? '—' : afficher(r.coefficient, { format: 'coef', decimales: 5 })}</Text>
                                            </View>
                                        ))}
                                    </View>
                                )}
                            </View>

                            <View style={styles.aDroite}>
                                <Text style={styles.aSection}>EN BREF</Text>
                                <View style={styles.aTuiles}>
                                    <View style={styles.aTuileForte}>
                                        <Text style={[styles.aTuileLibelle, { color: '#bfdbfe' }]}>Montant HT</Text>
                                        <Text style={styles.aTuileValeur}>{formatEur(a.totaux.ht)}</Text>
                                    </View>
                                    {synthese.quantite && (
                                        <View style={styles.aTuile}>
                                            <Text style={styles.aTuileLibelle}>{pdfTexte(`Quantité facturée (${synthese.quantite.unite})`)}</Text>
                                            <Text style={styles.aTuileValeur}>{nombre(synthese.quantite.valeur, 3)}</Text>
                                        </View>
                                    )}
                                    {synthese.prixMoyen !== null && synthese.quantite ? (
                                        <View style={[styles.aTuile, { marginRight: 0 }]}>
                                            <Text style={styles.aTuileLibelle}>{pdfTexte(`Prix moyen HT par ${synthese.quantite.unite}`)}</Text>
                                            <Text style={styles.aTuileValeur}>{formatEur(Math.round(synthese.prixMoyen * 100) / 100)}</Text>
                                        </View>
                                    ) : (
                                        <View style={[styles.aTuile, { marginRight: 0 }]}>
                                            <Text style={styles.aTuileLibelle}>Montant TTC</Text>
                                            <Text style={styles.aTuileValeur}>{formatEur(a.totaux.ttc)}</Text>
                                        </View>
                                    )}
                                </View>
                                {synthese.parMois.length > 1 && (
                                    <View>
                                        <Text style={styles.aSection}>MONTANT HT MOIS PAR MOIS</Text>
                                        <View style={styles.aGraphique}>
                                            {synthese.parMois.map(m => (
                                                <View key={m.mois} style={styles.aBarre}>
                                                    <Text style={{ fontSize: 6, marginBottom: 1 }}>{formatEur(Math.round(m.ht)).replace(',00', '')}</Text>
                                                    <View style={{ width: '100%', maxWidth: 34, height: Math.max(1, (Math.abs(m.ht) / maxMois) * 46), backgroundColor: m.ht < 0 ? '#f59e0b' : '#1d4ed8', borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
                                                </View>
                                            ))}
                                        </View>
                                        <View style={{ flexDirection: 'row', paddingHorizontal: 2, marginTop: 2 }}>
                                            {synthese.parMois.map(m => (
                                                <View key={m.mois} style={{ flex: 1, alignItems: 'center', marginHorizontal: 3 }}>
                                                    <Text style={{ fontSize: 6.5 }}>{moisCourt(m.mois)}</Text>
                                                    {m.quantite !== null && synthese.quantite && <Text style={[styles.muted, { fontSize: 6 }]}>{pdfTexte(`${nombre(m.quantite, 1)} ${synthese.quantite.unite}`)}</Text>}
                                                </View>
                                            ))}
                                        </View>
                                    </View>
                                )}
                            </View>
                        </View>

                        <Text style={styles.aSousTitre}>{parSite && synthese.sites > 1 ? `LE DÉTAIL, SITE PAR SITE (${synthese.sites} SITES)` : 'LE DÉTAIL'}</Text>
                        <View style={styles.aTh} fixed>
                            {colonnes.map(c => <Text key={c.cle} style={[styles.aCell, { width: w(c.largeur), textAlign: droite(c.format) ? 'right' : 'left' }]}>{pdfTexte(c.libelle.trim())}</Text>)}
                        </View>
                        {lignes.map((l, i) => {
                            const site = parSite ? String(l.valeurs.site ?? '') : null;
                            const nouveau = site !== null && site !== sitePrecedent;
                            if (nouveau) { sitePrecedent = site; rang = 0; }
                            const pair = !l.detail && rang++ % 2 === 1;
                            return (
                                <View key={i} wrap={false}>
                                    {nouveau && <View style={styles.aSite}><Text>{pdfTexte(site || 'Site non précisé')}</Text></View>}
                                    <View style={[styles.aTr, ...(pair ? [styles.aPair] : []), ...(l.detail ? [styles.aDetail] : [])]}>
                                        {colonnes.map(c => <Text key={c.cle} style={[styles.aCell, { width: w(c.largeur), textAlign: droite(c.format) ? 'right' : 'left' }, ...(c.cle === 'ht' ? [styles.aMontant] : [])]}>{pdfTexte(afficher(l.valeurs[c.cle] ?? null, c))}</Text>)}
                                    </View>
                                </View>
                            );
                        })}
                        <View style={styles.aTotal} wrap={false}>
                            <Text style={[styles.aCell, { width: w(colonnes.slice(0, avantMontants).reduce((s, c) => s + c.largeur, 0)), paddingLeft: 5 }]}>{pdfTexte(`Total  ${a.titre}`)}</Text>
                            {colonnes.slice(avantMontants).map(c => (
                                <Text key={c.cle} style={[styles.aCell, { width: w(c.largeur), textAlign: 'right' }]}>
                                    {c.cle === 'ht' ? formatEur(a.totaux.ht) : c.cle === 'tva' ? formatEur(a.totaux.tva) : c.cle === 'ttc' ? formatEur(a.totaux.ttc) : ''}
                                </Text>
                            ))}
                        </View>
                        {a.notes.map((n, i) => <Text key={i} style={[styles.muted, { marginTop: i ? 1 : 6 }]}>{pdfTexte(n)}</Text>)}
                        <Text style={[styles.muted, { marginTop: 3, fontSize: 6.5 }]}>TVA indicative par ligne ; la TVA de la facture est calculée sur le total HT par taux.</Text>

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
    const identite = identiteLegale(company);

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
                        {identite && <Text style={styles.muted}>{identite}</Text>}
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
                        {client.representative && <Text>{pdfTexte(`Représentant : ${libellePartie(client.representative)}`)}</Text>}
                        {client.address && <Text>{client.address}</Text>}
                        <Text>{`${client.postalCode ?? ''} ${client.city ?? ''}`.trim()}</Text>
                        {client.siret && <Text style={styles.muted}>SIRET {client.siret}</Text>}
                        {client.vatNumber && <Text style={styles.muted}>TVA intracommunautaire {client.vatNumber}</Text>}
                        {client.payer && (
                            <View style={{ marginTop: 5 }}>
                                <Text style={styles.label}>PAYEUR</Text>
                                <Text>{pdfTexte(libellePartie(client.payer))}</Text>
                                {client.payer.address && <Text style={styles.muted}>{pdfTexte(`${client.payer.address}, ${`${client.payer.postalCode ?? ''} ${client.payer.city ?? ''}`.trim()}`)}</Text>}
                                {client.payer.siret && <Text style={styles.muted}>SIRET {client.payer.siret}</Text>}
                            </View>
                        )}
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
                        {data.legalCommitment && (
                            <View style={styles.infoRow}><Text style={styles.infoLabel}>Engagement :</Text><Text>{data.legalCommitment}</Text></View>
                        )}
                        {data.marketNumber && (
                            <View style={styles.infoRow}><Text style={styles.infoLabel}>Marché :</Text><Text>{data.marketNumber}</Text></View>
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
                    {data.operationNature && <Text>Nature de l'opération : {data.operationNature}.</Text>}
                    {data.places && data.places.length > 0 && (
                        <Text>{`${data.places.length > 1 ? "Lieux d'exécution" : "Lieu d'exécution"} : ${data.places.join(' ; ')}.`}</Text>
                    )}
                    {company.vatOnDebits && <Text>{MENTION_DEBITS}</Text>}
                    {kind !== 'creditNote' && (
                        <>
                            <Text>{`${conditionsPaiement(data.paymentTerms ? { deadline: data.paymentTerms } : null)} ${mentionEscompte(company)}`}</Text>
                            <Text>{mentionPenalites(company)}</Text>
                        </>
                    )}
                    {kind === 'proforma' && <Text>Document sans valeur comptable : ne constitue pas une facture.</Text>}
                </View>

                <Text style={styles.footer} fixed render={({ pageNumber, totalPages }) =>
                    `${company.name}${identite ? ` · ${identite}` : ''}${legalIds ? ` · ${legalIds}` : ''} — Page ${pageNumber}/${totalPages}`
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
