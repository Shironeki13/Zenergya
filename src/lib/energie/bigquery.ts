/**
 * Factures des fournisseurs d'énergie lues dans BigQuery (flux Esker et historique) : la requête qui réunit les vues
 * en un seul format, et la lecture de ses lignes. Rien n'est écrit dans BigQuery. Module sans dépendance serveur.
 *
 * - Une ligne = une facture du fournisseur sur un point de livraison (une facture multi-sites a plusieurs lignes).
 * - Une facture présente dans plusieurs vues (même énergie, fournisseur, numéro, point) n'est gardée qu'une fois :
 *   la version Esker d'abord, sinon la plus récente.
 * - Les vues historiques sont en texte (dates JJ/MM/AAAA, nombres) : converties sans faire échouer la requête.
 * - Une colonne absente ou renommée dans une vue donne une valeur vide, pas une erreur.
 */

export type VuesEnergie = { gazEsker?: string; elecEsker?: string; rcuEsker?: string; gazHistorique?: string; elecHistorique?: string };

export const VUES_DEFAUT: Required<VuesEnergie> = {
    gazEsker: 'fr-sde-ved-venf-dev.FrnEnergies_501_dataviz.vcli_factures_gaz',
    elecEsker: 'fr-sde-ved-venf-dev.FrnEnergies_501_dataviz.vcli_factures_elec',
    rcuEsker: 'fr-sde-ved-venf-dev.FrnEnergies_501_dataviz.vcli_factures_rcu',
    gazHistorique: 'gbl-ist-vigs-energie.facturesEnergie_503_dataviz.vcli_facturesGazVENF',
    elecHistorique: 'gbl-ist-vigs-energie.facturesEnergie_503_dataviz.vcli_facturesElecVENF',
};

/** Nom complet d'une vue (projet.jeu.vue) : lettres, chiffres, tirets, soulignés et points seulement. */
export const vueValide = (v: string) => /^[A-Za-z0-9_-]+\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/.test(v);

/** Vues à lire : celles de l'environnement (`ENERGIE_BQ_VUE_…`, vide pour en retirer une), sinon celles par défaut. */
export function vuesDe(env: Record<string, string | undefined>): VuesEnergie {
    const lire = (cle: string, defaut: string) => { const v = env[cle]; return v === undefined ? defaut : v.trim(); };
    const v = {
        gazEsker: lire('ENERGIE_BQ_VUE_GAZ_ESKER', VUES_DEFAUT.gazEsker), elecEsker: lire('ENERGIE_BQ_VUE_ELEC_ESKER', VUES_DEFAUT.elecEsker), rcuEsker: lire('ENERGIE_BQ_VUE_RCU_ESKER', VUES_DEFAUT.rcuEsker),
        gazHistorique: lire('ENERGIE_BQ_VUE_GAZ_HISTORIQUE', VUES_DEFAUT.gazHistorique), elecHistorique: lire('ENERGIE_BQ_VUE_ELEC_HISTORIQUE', VUES_DEFAUT.elecHistorique),
    };
    for (const [k, x] of Object.entries(v)) if (x && !vueValide(x)) throw new Error(`Nom de vue BigQuery invalide (${k}) : « ${x} ».`);
    return Object.fromEntries(Object.entries(v).filter(([, x]) => x)) as VuesEnergie;
}

// Chaque vue est lue ligne par ligne en JSON : une colonne absente ou renommée dans une vue donne une valeur vide au
// lieu de faire échouer toute la requête (les vues évoluent, et leur description n'est pas toujours à jour).
const col = (nom: string) => `JSON_VALUE(j, '$.${nom}')`;
const num = (nom: string) => `SAFE_CAST(REPLACE(REPLACE(${col(nom)}, ' ', ''), ',', '.') AS FLOAT64)`;
/** Date écrite AAAA-MM-JJ (vues typées) ou JJ/MM/AAAA (vues en texte). */
const jour = (nom: string) => `COALESCE(SAFE.PARSE_DATE('%d/%m/%Y', ${col(nom)}), SAFE_CAST(SUBSTR(${col(nom)}, 1, 10) AS DATE))`;
const plus = (...noms: string[]) => noms.map(n => `IFNULL(${num(n)}, 0)`).join(' + ');
const lignes = (vue: string) => `(SELECT TO_JSON(t) j FROM \`${vue}\` t)`;

/**
 * Requête unifiée : `@pdls` (tableau de PCE / PDL, sans zéros de tête ; absent avec `tousLesPoints`) et `@depuis`
 * (date d'émission minimale).
 * Colonnes : energie, source, fournisseur, numero, pdl, date, debut, fin, mwh, ht, consommation (molécule),
 * acheminement, taxes, abonnement, ttc, pdf, contrat, type.
 */
export function requeteFactures(vues: VuesEnergie, opts: { tousLesPoints?: boolean } = {}): string {
    const blocs: string[] = [];
    const gaz = (vue: string, source: string) => `SELECT 'GAZ' energie, IFNULL(${col('Source')}, '${source}') source, ${col('FOURNISSEUR')} fournisseur, ${col('NUMERO_DE_FACTURE')} numero, ${col('PCE')} pdl, ${jour('DATE_EMISSION_FACTURE')} date,
  ${jour('DATE_DEBUT_PERIODE_DE_CONSOMMATION')} debut, ${jour('DATE_FIN_PERIODE_DE_CONSOMMATION')} fin, ${num('QUANTITE_CONSOMMEE__en_MWh_PCS_')} mwh, ${num('MONTANT_FACTURE_HTVA')} ht, ${num('MONTANT_CONSOMMATIONS')} consommation,
  ${plus('MONTANT_ATRD__TERME_VARIABLE_DE_DISTRIBUTION_', 'MONTANT_ATRD__TERME_FIXE_DE_DISTRIBUTION_', 'MONTANT_ATRT__TERME_FIXE_DE_TRANSPORT_', 'MONTANT_ATRT__TERME_FIXE_DE_STOCKAGE_', 'MONTANT_STOCKAGE_CAPACITE_TDN')} acheminement,
  ${plus('MONTANT_CEE', 'MONTANT_TICGN', 'MONTANT_CTA')} taxes, ${num('MONTANT_Po_ABONNEMENT')} abonnement, ${num('MONTANT_FACTURE_TTC')} ttc, ${col('lien_pdf')} pdf, ${col('REFERENCE_CONTRAT')} contrat,
  ${col('TYPE_DOCUMENT')} type FROM ${lignes(vue)}`;
    const elec = (vue: string, source: string) => `SELECT 'ELEC' energie, IFNULL(${col('Source')}, '${source}') source, ${col('FOURNISSEUR')} fournisseur, ${col('NUMERO_DE_FACTURE')} numero, ${col('PDL')} pdl, ${jour('DATE_COMPTABLE')} date,
  ${jour('DATE_DEBUT_PERIODE_DE_CONSOMMATION')} debut, ${jour('DATE_FIN_PERIODE_DE_CONSOMMATION')} fin, ${num('TOTAL_CONSO_KWH')} / 1000 mwh, ${num('MONTANT_FACTURE_HTVA')} ht, ${num('MONTANT_CONSOMMATIONS')} consommation,
  ${plus('MONTANT_ACHEMINEMENT_VARIABLE_', 'MONTANT_DEPASSEMENT')} acheminement, ${plus('MONTANT_CSPE', 'MONTANT_TCFE', 'MONTANT_CTA')} taxes, ${plus('MONTANT_ABONNEMENT', 'MONTANT_ABONNEMENT_FIXE')} abonnement,
  ${num('MONTANT_FACTURE_TTC')} ttc, ${col('lien_pdf')} pdf, ${col('REFERENCE_CONTRAT')} contrat, ${col('TYPE_DOCUMENT')} type FROM ${lignes(vue)}`;
    if (vues.gazEsker) blocs.push(gaz(vues.gazEsker, 'Esker'));
    if (vues.elecEsker) blocs.push(elec(vues.elecEsker, 'Esker'));
    // Réseau de chaleur : une ligne par poste de facture, regroupées par facture et point de livraison.
    if (vues.rcuEsker) blocs.push(`SELECT 'RCU' energie, IFNULL(ANY_VALUE(${col('Source')}), 'Esker') source, ${col('FOURNISSEUR')} fournisseur, ${col('NUMERO_DE_FACTURE')} numero, ${col('POINT_LIVRAISON')} pdl, MAX(${jour('DATE_EDITION')}) date,
  MIN(${jour('DATE_DEBUT_PERIODE_DE_CONSOMMATION')}) debut, MAX(${jour('DATE_FIN_PERIODE_DE_CONSOMMATION')}) fin, SUM(IF(UPPER(${col('CONSOMMATION_UNITE')}) = 'MWH', ${num('CONSOMMATION')}, NULL)) mwh,
  SUM(${num('MONTANT_HT')}) ht, CAST(NULL AS FLOAT64) consommation, 0.0 acheminement, 0.0 taxes, CAST(NULL AS FLOAT64) abonnement, MAX(${num('MONTANT_TOTAL_TTC_FACTURE')}) ttc,
  ANY_VALUE(${col('lien_pdf')}) pdf, ANY_VALUE(${col('CODE_CONTRAT')}) contrat, ANY_VALUE(${col('TYPE_FACTURE')}) type FROM ${lignes(vues.rcuEsker)} GROUP BY fournisseur, numero, pdl`);
    if (vues.gazHistorique) blocs.push(gaz(vues.gazHistorique, 'Historique'));
    if (vues.elecHistorique) blocs.push(elec(vues.elecHistorique, 'Historique'));
    if (!blocs.length) throw new Error("Aucune vue BigQuery de factures d'énergie n'est configurée.");
    return `WITH toutes AS (
${blocs.join('\nUNION ALL\n')}
), propres AS (
  SELECT *, UPPER(TRIM(REPLACE(fournisseur, '_', ' '))) fournisseur_norme, LTRIM(REPLACE(pdl, ' ', ''), '0') pdl_norme FROM toutes WHERE numero IS NOT NULL AND pdl IS NOT NULL AND TRIM(pdl) != ''
)
SELECT * EXCEPT (rang) FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY energie, fournisseur_norme, numero, pdl_norme ORDER BY IF(source = 'Historique', 1, 0), date DESC) rang FROM propres
) WHERE rang = 1${opts.tousLesPoints ? '' : ' AND UPPER(pdl_norme) IN UNNEST(@pdls)'} AND (date IS NULL OR date >= @depuis)
ORDER BY date DESC, numero`;
}

export type FactureBigQuery = {
    id: string; energie: string; source: string; fournisseur: string; numero: string; pdl: string;
    date: string; debut: string | null; fin: string | null;
    montantHT: number; quantite: number | null;
    /** Composantes HT : molécule (consommations), acheminement, taxes, abonnement ; null quand la vue ne la donne pas. */
    consommation: number | null; acheminement: number | null; taxes: number | null; abonnement: number | null;
    ttc: number | null; pdf: string | null; contrat: string | null; type: string | null;
};

/** PCE / PDL tel qu'on le compare : sans espaces ni zéros de tête. */
export const pdlNorme = (p: string | null | undefined) => String(p ?? '').replace(/\s/g, '').replace(/^0+/, '').toUpperCase();

/** Lignes de la réponse BigQuery (noms de colonnes → valeurs texte) lues en factures. */
export function lireLignes(lignes: Record<string, string | null>[]): FactureBigQuery[] {
    const n = (v: string | null | undefined) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10000) / 10000);
    const c = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
    return lignes.filter(l => l.numero && l.pdl && n(l.ht) !== null).map(l => {
        const fournisseur = String(l.fournisseur ?? '').replace(/_/g, ' ').trim();
        return {
            id: `bq:${l.energie}|${String(l.fournisseur_norme ?? fournisseur.toUpperCase())}|${l.numero}|${pdlNorme(l.pdl)}`,
            energie: String(l.energie), source: String(l.source ?? ''), fournisseur, numero: String(l.numero), pdl: pdlNorme(l.pdl),
            date: String(l.date ?? l.fin ?? l.debut ?? ''), debut: l.debut || null, fin: l.fin || null,
            montantHT: c(n(l.ht))!, quantite: n(l.mwh) && n(l.mwh)! > 0 ? n(l.mwh) : null,
            consommation: c(n(l.consommation)), acheminement: c(n(l.acheminement)), taxes: c(n(l.taxes)), abonnement: c(n(l.abonnement)), ttc: c(n(l.ttc)),
            pdf: l.pdf || null, contrat: l.contrat || null, type: l.type || null,
        };
    });
}
