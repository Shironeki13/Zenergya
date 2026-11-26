/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import { Document, Font, Page, View, Text, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer';

// Pas de coupure de mots en fin de ligne (« règle-ment ») : les libellés se lisent d'un bloc.
Font.registerHyphenationCallback(mot => [mot]);
import type { Client, Company, InvoiceLineItem, InvoiceQuoteLink, VatBreakdown } from '@/lib/types';
import type { SituationSnapshot } from '@/lib/projects/types';
import { afficher, etapesFormule, syntheseAnnexe, type AnnexeP1 } from '@/lib/billing/p1-annexe';
import { libellePartie, type Adressage } from '@/lib/billing/adressage';
import { familleActivite, type FamilleActivite } from '@/lib/billing/familles-activite';
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
    /** Références imprimées : contrat (numéro et libellé) et code client. */
    contractRef?: string;
    clientCode?: string;
    /** Avoir interne (facture d'origine rejetée par la plateforme) : non transmis. */
    interne?: boolean;
    /** Aperçu avant émission : sans numéro, sans valeur comptable. */
    apercu?: boolean;
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

/** Couleurs de la facture (mêmes repères que l'annexe P1 et l'application). */
const C = { nuit: '#0f2747', bleu: '#1d4ed8', bleuClair: '#93c5fd', ardoise: '#64748b', trait: '#e2e8f0', fond: '#f1f5f9', fondLeger: '#f8fafc', texte: '#0f172a' };
const FAMILLE_PDF: Record<FamilleActivite, { fond: string; texte: string; trait: string }> = {
    P1: { fond: '#fff7ed', texte: '#c2410c', trait: '#fdba74' },
    P1E: { fond: '#f0f9ff', texte: '#0369a1', trait: '#7dd3fc' },
    P1A: { fond: '#fffbeb', texte: '#b45309', trait: '#fcd34d' },
    EE: { fond: '#fdf4ff', texte: '#a21caf', trait: '#f0abfc' },
    P2: { fond: '#eff6ff', texte: '#1d4ed8', trait: '#93c5fd' },
    P3: { fond: '#ecfdf5', texte: '#047857', trait: '#6ee7b7' },
    autre: { fond: '#f8fafc', texte: '#334155', trait: '#cbd5e1' },
};

const f = StyleSheet.create({
    page: { paddingTop: 0, paddingHorizontal: 36, paddingBottom: 60, fontSize: 8.5, fontFamily: 'Helvetica', color: C.texte },
    bandeau: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', backgroundColor: C.nuit, marginHorizontal: -36, paddingHorizontal: 36, paddingTop: 22, paddingBottom: 18, marginBottom: 16 },
    logoCadre: { backgroundColor: '#ffffff', borderRadius: 4, padding: 4, marginBottom: 7, alignSelf: 'flex-start' },
    logo: { height: 32, maxWidth: 140, objectFit: 'contain' },
    societe: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: '#ffffff' },
    societeLigne: { fontSize: 7.5, color: '#cbd5e1', marginTop: 1.5 },
    droiteBandeau: { alignItems: 'flex-end', maxWidth: '45%' },
    surTitre: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.bleuClair, letterSpacing: 1.2, marginBottom: 3 },
    titre: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: '#ffffff', textAlign: 'right' },
    numero: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: '#ffffff', backgroundColor: C.bleu, borderRadius: 3, paddingVertical: 3, paddingHorizontal: 7, marginTop: 6 },
    alerte: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#92400e', backgroundColor: '#fef3c7', borderRadius: 3, paddingVertical: 2.5, paddingHorizontal: 6, marginTop: 6 },
    tuiles: { flexDirection: 'row', marginBottom: 12 },
    tuile: { flex: 1, backgroundColor: C.fond, borderRadius: 4, paddingVertical: 7, paddingHorizontal: 9, marginRight: 6 },
    tuileForte: { flex: 1.25, backgroundColor: C.bleu, borderRadius: 4, paddingVertical: 7, paddingHorizontal: 9, marginRight: 6 },
    tuileLibelle: { fontSize: 6.5, color: C.ardoise, marginBottom: 3, letterSpacing: 0.4 },
    tuileValeur: { fontSize: 11.5, fontFamily: 'Helvetica-Bold' },
    tuileDetail: { fontSize: 6.5, color: C.ardoise, marginTop: 2 },
    cartes: { flexDirection: 'row', marginBottom: 14 },
    carte: { flex: 1, borderWidth: 0.75, borderColor: C.trait, borderRadius: 4, paddingVertical: 9, paddingHorizontal: 10 },
    carteAccent: { borderTopWidth: 2.5, borderTopColor: C.bleu },
    section: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: C.ardoise, letterSpacing: 1, marginBottom: 5 },
    client: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
    attenue: { color: C.ardoise },
    petit: { fontSize: 7.5 },
    refLigne: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: '#f1f5f9' },
    refLibelle: { color: C.ardoise, marginRight: 8 },
    refValeur: { fontFamily: 'Helvetica-Bold', textAlign: 'right', maxWidth: '65%' },
    th: { flexDirection: 'row', backgroundColor: C.nuit, color: '#ffffff', fontFamily: 'Helvetica-Bold', fontSize: 7.5, paddingVertical: 5, paddingHorizontal: 6, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
    groupe: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 6, marginTop: 5, borderLeftWidth: 2.5 },
    pastille: { fontSize: 7, fontFamily: 'Helvetica-Bold', borderWidth: 0.75, borderRadius: 3, paddingVertical: 1.5, paddingHorizontal: 5, marginRight: 6 },
    groupeLibelle: { flex: 1, fontSize: 7.5, color: C.ardoise },
    groupeTotal: { fontFamily: 'Helvetica-Bold', fontSize: 8 },
    ligne: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: '#eef2f7' },
    lignePaire: { backgroundColor: C.fondLeger },
    principal: { fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
    detail: { fontSize: 7.5, color: C.ardoise, marginTop: 1.5 },
    colDesc: { width: '58%', paddingRight: 8 },
    colQty: { width: '8%', textAlign: 'right' },
    colUnit: { width: '17%', textAlign: 'right' },
    colTotal: { width: '17%', textAlign: 'right' },
    bas: { flexDirection: 'row', marginTop: 14, alignItems: 'flex-start' },
    reglement: { width: '52%', marginRight: '4%', backgroundColor: C.fondLeger, borderRadius: 4, borderLeftWidth: 2.5, borderLeftColor: C.bleu, paddingVertical: 9, paddingHorizontal: 10 },
    reglementFort: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginBottom: 3 },
    totaux: { width: '44%' },
    totalLigne: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, paddingHorizontal: 8 },
    totalFort: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.nuit, color: '#ffffff', borderRadius: 4, paddingVertical: 8, paddingHorizontal: 8, marginTop: 4 },
    totalFortLibelle: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
    totalFortValeur: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
    netAPayer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.bleu, color: '#ffffff', borderRadius: 4, paddingVertical: 7, paddingHorizontal: 8, marginTop: 4 },
    mentions: { marginTop: 18, borderTopWidth: 0.75, borderTopColor: C.trait, paddingTop: 8, fontSize: 7, color: '#475569', lineHeight: 1.4 },
    pied: { position: 'absolute', bottom: 22, left: 36, right: 36, flexDirection: 'row', justifyContent: 'space-between', fontSize: 6.5, color: C.ardoise, borderTopWidth: 1.5, borderTopColor: C.nuit, paddingTop: 6 },
});

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
        : kind === 'invoice' && data.quote?.billingKind === 'acompte' ? "FACTURE D'ACOMPTE" : kind === 'creditNote' && data.interne ? 'AVOIR INTERNE' : TITLES[kind];
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

    // Désignation : l'objet en gras, puis le détail (site, période, prorata…) en plus discret.
    const decoupe = (item: InvoiceLineItem) => {
        // Avoir d'une seule facture : le rappel « Avoir sur facture … : » de chaque ligne est dans l'en-tête.
        const brut = designation(item, !!data.annexes?.length);
        const t = kind === 'creditNote' && data.references?.length === 1 ? brut.replace(/^Avoir sur facture [^:]+:\s*/, '') : brut;
        const k = t.indexOf(' — ');
        if (k >= 0) return { principal: t.slice(0, k), detail: t.slice(k + 3) };
        // Ligne de travaux « Poste : avancement… » : le poste en gras, l'avancement en détail.
        const c = t.indexOf(' : ');
        return c > 0 && c <= 90 ? { principal: t.slice(0, c), detail: t.slice(c + 3) } : { principal: t, detail: '' };
    };
    const montantFort = data.situation && data.situation.retention.amount !== 0 ? data.situation.netToPay : data.total;
    const libelleFort = kind === 'creditNote' ? "Montant de l'avoir" : data.situation && data.situation.retention.amount !== 0 ? 'Net à payer' : 'Montant TTC';
    const references: [string, string][] = ([
        ['Contrat', data.contractRef],
        ['Code client', data.clientCode],
        ['Facture(s) d\'origine', data.references?.join(', ')],
        ['Affaire', data.situation?.projectCode],
        ['Travaux du mois', data.situation ? period(data.situation.period) : undefined],
        ['Devis', data.quote ? `${data.quote.number}${data.quote.version > 1 ? ` V${data.quote.version}` : ''}${data.quote.acceptedAt ? ` du ${formatDate(data.quote.acceptedAt)}` : ''}` : undefined],
        ['Bon de commande', data.quote?.purchaseOrderNumber],
        ['Engagement juridique', data.legalCommitment],
        ['N° de marché', data.marketNumber],
    ] as [string, string | undefined][]).filter((r): r is [string, string] => !!r[1]);

    return (
        <Document title={`${title} ${data.number ?? ''}`.trim()} author={company.name}>
            <Page size="A4" style={f.page}>
                <View style={f.bandeau}>
                    <View style={{ maxWidth: '55%' }}>
                        {/* eslint-disable-next-line jsx-a11y/alt-text */}
                        {logo && <View style={f.logoCadre}><Image src={logo} style={f.logo} /></View>}
                        <Text style={f.societe}>{company.name}</Text>
                        {company.address && <Text style={f.societeLigne}>{company.address}</Text>}
                        {(company.postalCode || company.city) && <Text style={f.societeLigne}>{`${company.postalCode ?? ''} ${company.city ?? ''}`.trim()}</Text>}
                        {identite && <Text style={f.societeLigne}>{identite}</Text>}
                        {legalIds && <Text style={f.societeLigne}>{legalIds}</Text>}
                    </View>
                    <View style={f.droiteBandeau}>
                        <Text style={f.surTitre}>{kind === 'creditNote' ? 'DOCUMENT D\'ANNULATION' : kind === 'proforma' ? 'DOCUMENT PROVISOIRE' : 'DOCUMENT COMPTABLE'}</Text>
                        {/* Titre long (situation, acompte) : plus petit, pour tenir sur une ligne. */}
                        <Text style={title.length > 22 ? [f.titre, { fontSize: 13 }] : title.length > 16 ? [f.titre, { fontSize: 15 }] : f.titre}>{title}</Text>
                        {data.number && <Text style={f.numero}>{`N° ${data.number}`}</Text>}
                        {(kind === 'proforma' || data.apercu) && <Text style={f.alerte}>SANS VALEUR COMPTABLE</Text>}
                        {kind === 'creditNote' && data.interne && <Text style={f.alerte}>NON TRANSMIS</Text>}
                    </View>
                </View>

                <View style={f.tuiles} wrap={false}>
                    <View style={f.tuileForte}>
                        <Text style={[f.tuileLibelle, { color: '#dbeafe' }]}>{libelleFort.toUpperCase()}</Text>
                        <Text style={[f.tuileValeur, { color: '#ffffff', fontSize: 14 }]}>{formatEur(montantFort)}</Text>
                    </View>
                    {kind !== 'creditNote' && data.dueDate && (
                        <View style={f.tuile}>
                            <Text style={f.tuileLibelle}>À RÉGLER AVANT LE</Text>
                            <Text style={f.tuileValeur}>{formatDate(data.dueDate)}</Text>
                        </View>
                    )}
                    {data.periodStartDate && data.periodEndDate && (
                        <View style={f.tuile}>
                            <Text style={f.tuileLibelle}>PÉRIODE</Text>
                            <Text style={[f.tuileValeur, { fontSize: 9.5 }]}>{`${formatDate(data.periodStartDate)} - ${formatDate(data.periodEndDate)}`}</Text>
                        </View>
                    )}
                    <View style={[f.tuile, { marginRight: 0 }]}>
                        <Text style={f.tuileLibelle}>{kind === 'creditNote' ? 'ÉMIS LE' : 'ÉMISE LE'}</Text>
                        <Text style={f.tuileValeur}>{formatDate(data.date)}</Text>
                    </View>
                </View>

                <View style={f.cartes} wrap={false}>
                    <View style={[f.carte, f.carteAccent, { marginRight: 8 }]}>
                        <Text style={f.section}>{kind === 'creditNote' ? 'AVOIR ÉMIS AU NOM DE' : 'FACTURÉ À'}</Text>
                        <Text style={f.client}>{client.name}</Text>
                        {client.representative && <Text style={{ marginBottom: 1 }}>{pdfTexte(`Représenté par ${libellePartie(client.representative)}`)}</Text>}
                        {client.address && <Text>{client.address}</Text>}
                        <Text>{`${client.postalCode ?? ''} ${client.city ?? ''}`.trim()}</Text>
                        {(client.siret || client.vatNumber) && (
                            <Text style={[f.attenue, f.petit, { marginTop: 3 }]}>{[client.siret && `SIRET ${client.siret}`, client.vatNumber && `TVA ${client.vatNumber}`].filter(Boolean).join(' · ')}</Text>
                        )}
                        {client.payer && (
                            <View style={{ marginTop: 6, paddingTop: 5, borderTopWidth: 0.5, borderTopColor: C.trait }}>
                                <Text style={f.section}>PAYEUR</Text>
                                <Text style={{ fontFamily: 'Helvetica-Bold' }}>{pdfTexte(libellePartie(client.payer))}</Text>
                                {client.payer.address && <Text style={[f.attenue, f.petit]}>{pdfTexte(`${client.payer.address}, ${`${client.payer.postalCode ?? ''} ${client.payer.city ?? ''}`.trim()}`)}</Text>}
                                {client.payer.siret && <Text style={[f.attenue, f.petit]}>SIRET {client.payer.siret}</Text>}
                            </View>
                        )}
                    </View>
                    <View style={f.carte}>
                        <Text style={f.section}>RÉFÉRENCES</Text>
                        {references.map(([l, v]) => (
                            <View key={l} style={f.refLigne}><Text style={f.refLibelle}>{l}</Text><Text style={f.refValeur}>{pdfTexte(v)}</Text></View>
                        ))}
                    </View>
                </View>

                <View style={f.th} fixed>
                    <Text style={f.colDesc}>Désignation</Text>
                    <Text style={f.colQty}>Qté</Text>
                    <Text style={f.colUnit}>P.U. HT</Text>
                    <Text style={f.colTotal}>Total HT</Text>
                </View>
                {Object.entries(groups).map(([activityCode, items]) => {
                    const ton = FAMILLE_PDF[familleActivite(activityCode)];
                    return (
                        <View key={activityCode}>
                            <View style={[f.groupe, { backgroundColor: ton.fond, borderLeftColor: ton.texte }]} wrap={false}>
                                <Text style={[f.pastille, { color: ton.texte, borderColor: ton.trait, backgroundColor: '#ffffff' }]}>{pdfTexte(activityCode)}</Text>
                                <Text style={f.groupeLibelle}>{items.length > 1 ? `${items.length} lignes` : '1 ligne'}</Text>
                                <Text style={[f.groupeTotal, { color: ton.texte }]}>{formatEur(items.reduce((t, x) => t + x.total, 0))}</Text>
                            </View>
                            {items.map((item, index) => {
                                const d = decoupe(item);
                                return (
                                    <View key={index} style={index % 2 ? [f.ligne, f.lignePaire] : f.ligne} wrap={false}>
                                        <View style={f.colDesc}>
                                            <Text style={f.principal}>{d.principal}</Text>
                                            {d.detail && <Text style={f.detail}>{d.detail}</Text>}
                                        </View>
                                        <Text style={f.colQty}>{String(item.quantity)}</Text>
                                        <Text style={f.colUnit}>{formatEur(item.unitPrice)}</Text>
                                        <Text style={[f.colTotal, { fontFamily: 'Helvetica-Bold' }]}>{formatEur(item.total)}</Text>
                                    </View>
                                );
                            })}
                        </View>
                    );
                })}

                <View style={f.bas} wrap={false}>
                    <View style={f.reglement}>
                        {kind === 'creditNote' ? (
                            <>
                                <Text style={f.section}>MOTIF</Text>
                                <Text style={{ fontFamily: 'Helvetica-Bold' }}>{pdfTexte(data.reason || 'Annulation')}</Text>
                                {data.references && data.references.length > 0 && <Text style={[f.attenue, { marginTop: 3 }]}>{`Annule ${data.references.length > 1 ? 'les factures' : 'la facture'} n° ${data.references.join(', ')}.`}</Text>}
                            </>
                        ) : (
                            <>
                                <Text style={f.section}>RÈGLEMENT</Text>
                                {data.dueDate && <Text style={f.reglementFort}>{`${formatEur(montantFort)} avant le ${formatDate(data.dueDate)}`}</Text>}
                                {data.number && <Text style={[f.attenue, { marginTop: 3 }]}>{`Merci de rappeler la référence ${data.number} avec votre règlement.`}</Text>}
                            </>
                        )}
                    </View>
                    <View style={f.totaux}>
                        <View style={f.totalLigne}><Text>Total HT</Text><Text>{formatEur(data.subtotal)}</Text></View>
                        {data.vatBreakdown && data.vatBreakdown.length > 0
                            ? data.vatBreakdown.map(v => (
                                <View key={v.rate} style={f.totalLigne}><Text style={f.attenue}>{`TVA ${pct(v.rate)} sur ${formatEur(v.base)}`}</Text><Text>{formatEur(v.amount)}</Text></View>
                            ))
                            : <View style={f.totalLigne}><Text style={f.attenue}>{`TVA (${formatRate(data.taxRate, data.subtotal, data.tax)})`}</Text><Text>{formatEur(data.tax)}</Text></View>}
                        <View style={f.totalFort}><Text style={f.totalFortLibelle}>Total TTC</Text><Text style={f.totalFortValeur}>{formatEur(data.total)}</Text></View>
                        {data.situation && data.situation.retention.amount !== 0 && (
                            <>
                                <View style={[f.totalLigne, { marginTop: 3 }]}><Text style={f.attenue}>{`Retenue de garantie (${pct(data.situation.retention.pct)} du TTC)`}</Text><Text>{formatEur(-data.situation.retention.amount)}</Text></View>
                                <View style={f.netAPayer}><Text style={f.totalFortLibelle}>Net à payer</Text><Text style={f.totalFortValeur}>{formatEur(data.situation.netToPay)}</Text></View>
                            </>
                        )}
                    </View>
                </View>

                <View style={f.mentions} wrap={false}>
                    {kind === 'creditNote' && data.interne && <Text>{pdfTexte("Avoir interne : il annule une facture rejetée par la plateforme de facturation électronique, que le client n'a pas reçue ; il n'est pas transmis.")}</Text>}
                    {data.apercu && <Text>{pdfTexte('Aperçu avant émission : document sans numéro et sans valeur comptable.')}</Text>}
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

                <View style={f.pied} fixed>
                    <Text style={{ maxWidth: '80%' }}>{`${company.name}${identite ? ` · ${identite}` : ''}${legalIds ? ` · ${legalIds}` : ''}`}</Text>
                    <Text render={({ pageNumber, totalPages }) => `${data.number ? `${data.number} · ` : ''}Page ${pageNumber}/${totalPages}`} />
                </View>
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
