/**
 * Répertoire des entreprises (API Recherche d'entreprises de l'État, données Sirene / RNE) :
 * types et lecture des réponses. Module sans dépendance serveur (testable, utilisable à l'écran).
 *
 * API publique, sans clé : https://recherche-entreprises.api.gouv.fr
 * États : entreprise A (active) / C (cessée) ; établissement A (actif) / F (fermé).
 *
 * Seules les données utiles à la fiche client sont gardées : ni dirigeants, ni élus, ni finances.
 */

/** Une entreprise et l'établissement retenu (celui du SIRET cherché, sinon le siège). */
export type EntrepriseResult = {
    siren: string;
    nom: string;
    sigle?: string;
    entrepriseActive: boolean;
    dateCessation?: string;
    natureJuridique?: string;
    /** Personne morale de droit public, administration ou collectivité : facturation via Chorus Pro. */
    estPublic: boolean;
    /** Niveau de la collectivité territoriale (Commune, Département, Région…). */
    collectivite?: string;
    activitePrincipale?: string;
    etablissement: {
        siret: string;
        actif: boolean;
        dateFermeture?: string;
        estSiege: boolean;
        adresse?: string;
        codePostal?: string;
        commune?: string;
    };
    nombreEtablissementsOuverts?: number;
};

export type EntrepriseSearchParams = {
    /** Nom, SIREN ou SIRET. */
    q: string;
    codePostal?: string;
    departement?: string;
    /** Inclure les entreprises cessées (par défaut : actives seulement). */
    inclureCessees?: boolean;
    page?: number;
};

export type EntrepriseSearchResponse = {
    results: EntrepriseResult[];
    total: number;
    page: number;
    totalPages: number;
};

/** Contrôle d'un SIRET enregistré sur une fiche client. */
export type SireneCheck = {
    checkedAt: string;
    siret: string;
    found: boolean;
    nom?: string;
    entrepriseActive?: boolean;
    etablissementActif?: boolean;
    dateFermeture?: string;
    estPublic?: boolean;
};

export const PER_PAGE = 20;

export const digitsOnly = (v: string) => v.replace(/[\s.-]/g, '');
export const isSiretQuery = (q: string) => /^\d{14}$/.test(digitsOnly(q));
export const isSirenQuery = (q: string) => /^\d{9}$/.test(digitsOnly(q));

/** Paramètres de l'appel à l'API. Les filtres de lieu portent sur les établissements. */
export function buildSearchQuery(p: EntrepriseSearchParams): URLSearchParams {
    const q = p.q.trim();
    const params = new URLSearchParams({
        q: isSiretQuery(q) || isSirenQuery(q) ? digitsOnly(q) : q,
        minimal: 'true',
        include: 'siege,matching_etablissements,complements',
        per_page: String(PER_PAGE),
        page: String(Math.max(1, Math.floor(p.page ?? 1))),
    });
    if (p.codePostal?.trim()) params.set('code_postal', p.codePostal.trim());
    if (p.departement?.trim()) params.set('departement', p.departement.trim());
    if (!p.inclureCessees) params.set('etat_administratif', 'A');
    return params;
}

/** Validation des paramètres reçus par la route : rend un message d'erreur, ou null. */
export function invalidSearch(p: EntrepriseSearchParams): string | null {
    const q = p.q.trim();
    if (q.length < 3) return 'Saisissez au moins 3 caractères (nom, SIREN ou SIRET).';
    if (q.length > 120) return 'Recherche trop longue.';
    if (p.codePostal && !/^\d{5}$/.test(p.codePostal.trim())) return 'Code postal : 5 chiffres.';
    if (p.departement && !/^(\d{2,3}|2[AB])$/i.test(p.departement.trim())) return 'Département : 2 ou 3 caractères (ex. 69, 2A, 974).';
    return null;
}

/** Catégorie juridique 7xxx : personne morale de droit public (INSEE). */
export const isPublicLegalForm = (natureJuridique?: string) => !!natureJuridique && natureJuridique.startsWith('7');

type ApiEtablissement = {
    siret?: string; etat_administratif?: string; date_fermeture?: string | null; est_siege?: boolean;
    adresse?: string; code_postal?: string; libelle_commune?: string;
};
type ApiResult = {
    siren?: string; nom_complet?: string; nom_raison_sociale?: string; sigle?: string | null;
    etat_administratif?: string; date_fermeture?: string | null; nature_juridique?: string; activite_principale?: string;
    nombre_etablissements_ouverts?: number;
    siege?: ApiEtablissement;
    matching_etablissements?: ApiEtablissement[];
    complements?: { est_administration?: boolean | null; collectivite_territoriale?: { niveau?: string } | null } | null;
};

/** Lecture d'un résultat de l'API. `siret` : établissement à retenir s'il figure dans la réponse. */
export function mapResult(r: ApiResult, siret?: string): EntrepriseResult {
    const wanted = siret ? digitsOnly(siret) : undefined;
    const etab = (wanted && [r.siege, ...(r.matching_etablissements ?? [])].find(e => e?.siret === wanted)) || r.siege || {};
    const collectivite = r.complements?.collectivite_territoriale?.niveau || undefined;
    return {
        siren: r.siren ?? '',
        nom: r.nom_complet || r.nom_raison_sociale || '',
        ...(r.sigle && { sigle: r.sigle }),
        entrepriseActive: r.etat_administratif !== 'C',
        ...(r.date_fermeture && { dateCessation: r.date_fermeture }),
        ...(r.nature_juridique && { natureJuridique: r.nature_juridique }),
        estPublic: isPublicLegalForm(r.nature_juridique) || r.complements?.est_administration === true || !!collectivite,
        ...(collectivite && { collectivite }),
        ...(r.activite_principale && { activitePrincipale: r.activite_principale }),
        etablissement: {
            siret: etab.siret ?? '',
            actif: etab.etat_administratif !== 'F',
            ...(etab.date_fermeture && { dateFermeture: etab.date_fermeture }),
            estSiege: etab.est_siege === true,
            ...(etab.adresse && { adresse: etab.adresse }),
            ...(etab.code_postal && { codePostal: etab.code_postal }),
            ...(etab.libelle_commune && { commune: etab.libelle_commune }),
        },
        ...(typeof r.nombre_etablissements_ouverts === 'number' && { nombreEtablissementsOuverts: r.nombre_etablissements_ouverts }),
    };
}

export function mapSearchResponse(
    json: { results?: ApiResult[]; total_results?: number; page?: number; total_pages?: number },
    q: string,
): EntrepriseSearchResponse {
    const siret = isSiretQuery(q) ? digitsOnly(q) : undefined;
    return {
        results: (json.results ?? []).map(r => mapResult(r, siret)),
        total: json.total_results ?? 0,
        page: json.page ?? 1,
        totalPages: json.total_pages ?? 0,
    };
}

/**
 * Adresse d'un établissement pour la fiche client : l'API rend « 1 PLACE DE LA COMEDIE 69001 LYON » ;
 * on retire le code postal et la commune, saisis à part.
 */
export function streetAddress(e: EntrepriseResult['etablissement']): string {
    let a = (e.adresse ?? '').trim();
    if (e.codePostal && e.commune) {
        const suffix = `${e.codePostal} ${e.commune}`;
        if (a.toUpperCase().endsWith(suffix.toUpperCase())) a = a.slice(0, -suffix.length).trim();
    }
    return a;
}

/** Contrôle du SIRET d'une fiche à partir d'une recherche par ce SIRET. */
export function toSireneCheck(siret: string, response: EntrepriseSearchResponse, now = new Date()): SireneCheck {
    const wanted = digitsOnly(siret);
    const hit = response.results.find(r => r.etablissement.siret === wanted);
    if (!hit) return { checkedAt: now.toISOString(), siret: wanted, found: false };
    return {
        checkedAt: now.toISOString(),
        siret: wanted,
        found: true,
        nom: hit.nom,
        entrepriseActive: hit.entrepriseActive,
        etablissementActif: hit.etablissement.actif,
        ...(hit.etablissement.dateFermeture && { dateFermeture: hit.etablissement.dateFermeture }),
        estPublic: hit.estPublic,
    };
}

/** Anomalies d'un contrôle, à afficher sur la fiche client (et au dépôt Chorus). */
export function sireneCheckIssues(check: SireneCheck | undefined, clientType?: 'private' | 'public'): string[] {
    if (!check) return [];
    if (!check.found) return [`SIRET ${check.siret} introuvable dans le répertoire des entreprises.`];
    const issues: string[] = [];
    if (check.entrepriseActive === false) issues.push('Entreprise cessée selon le répertoire des entreprises.');
    if (check.etablissementActif === false) {
        issues.push(`Établissement fermé${check.dateFermeture ? ` depuis le ${check.dateFermeture}` : ''} selon le répertoire des entreprises.`);
    }
    if (clientType && check.estPublic !== undefined && (clientType === 'public') !== check.estPublic) {
        issues.push(check.estPublic
            ? 'Le répertoire indique une entité publique, la fiche dit « privé » (facturation Chorus Pro ?).'
            : 'Le répertoire indique une entité privée, la fiche dit « public ».');
    }
    return issues;
}

/** Champs de la fiche client remplis à partir d'un résultat du répertoire. */
export function entrepriseToClientFields(r: EntrepriseResult): {
    name: string; address: string; postalCode: string; city: string; siret: string; clientType: 'private' | 'public'; useChorus?: true;
} {
    return {
        name: r.nom,
        address: streetAddress(r.etablissement),
        postalCode: r.etablissement.codePostal ?? '',
        city: r.etablissement.commune ?? '',
        siret: r.etablissement.siret,
        clientType: r.estPublic ? 'public' : 'private',
        // Entité publique : factures déposées sur Chorus Pro.
        ...(r.estPublic && { useChorus: true as const }),
    };
}
