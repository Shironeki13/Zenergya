/**
 * Analytique (logique pure) : un code par niveau de la pyramide client → contrat → prestation, qui se lit de gauche à
 * droite : société - agence - secteur - client - contrat - activité (ex. « ZEN-LYO-LN-CLI00012-CTN00034-P2 »).
 *
 * - Code **généré** par Zenergya à partir des codes du référentiel, **figé** (enregistré) sur le client, le contrat et
 *   la prestation : un changement d'agence ou de secteur ne le modifie pas tout seul (réaffectation explicite).
 * - Code **externe** (outil comptable) saisi à n'importe quel niveau : il devient le code effectif du niveau, et les
 *   niveaux en dessous en héritent en y ajoutant leur segment, sauf s'ils ont leur propre code externe.
 * - Chaque ligne de facture, d'avoir (puis de commande) garde le code effectif et les axes : ventes et achats se
 *   totalisent par code ou par axe, et l'historique ne bouge pas.
 * Le site n'est pas dans le code (une prestation a un code pour tous ses sites) : c'est un axe de la ligne.
 */

/** Segment d'un code : majuscules, sans accent ni séparateur (« CLI-00012 » → « CLI00012 », « Lyon Nord » → « LYONNORD »). */
export const segment = (v: unknown): string => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Code court d'un référentiel (agence, secteur) : 2 à 8 lettres ou chiffres. */
export function controleCodeCourt(code: string): string | null {
    const c = segment(code);
    if (c !== code.trim().toUpperCase()) return 'Lettres et chiffres seulement, sans espace ni accent.';
    return c.length >= 2 && c.length <= 8 ? null : 'De 2 à 8 caractères.';
}
/** Proposition de code court à partir d'un nom (« Lyon Nord » → « LN », « Lyon » → « LYO »). */
export function proposerCodeCourt(nom: string): string {
    const mots = nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    if (mots.length >= 2) return mots.map(m => (/^\d/.test(m) ? m : m[0])).join('').slice(0, 8);
    return (mots[0] ?? '').slice(0, 3);
}

export type NiveauAnalytique = 'client' | 'contrat' | 'prestation';
export const LIBELLE_NIVEAU: Record<NiveauAnalytique, string> = { client: 'client', contrat: 'contrat', prestation: 'prestation' };

/** Codes du référentiel d'où se génère le code ; vide ou absent : segment manquant. */
export type SegmentsAnalytiques = { societe?: string | null; agence?: string | null; secteur?: string | null; client?: string | null; contrat?: string | null; activite?: string | null };
const ORDRE: (keyof SegmentsAnalytiques)[] = ['societe', 'agence', 'secteur', 'client', 'contrat', 'activite'];
const LIBELLE_SEGMENT: Record<keyof SegmentsAnalytiques, string> = {
    societe: 'code de la société', agence: 'code de l\'agence', secteur: 'code du secteur', client: 'code du client', contrat: 'numéro du contrat', activite: 'code de l\'activité',
};
const JUSQUA: Record<NiveauAnalytique, number> = { client: 4, contrat: 5, prestation: 6 };

/** Code généré d'un niveau, ou ce qui manque pour le générer. */
export function codeGenere(s: SegmentsAnalytiques, niveau: NiveauAnalytique): { code: string } | { manque: string[] } {
    const cles = ORDRE.slice(0, JUSQUA[niveau]);
    const manque = cles.filter(k => !segment(s[k])).map(k => LIBELLE_SEGMENT[k]);
    return manque.length ? { manque } : { code: cles.map(k => segment(s[k])).join('-') };
}

/** Ce qui est enregistré à un niveau : code généré figé, code externe saisi. */
export type AnalytiqueNiveau = { analyticCode?: string | null; analyticExternal?: string | null };

export type OrigineAnalytique = 'externe' | 'externe-herite' | 'genere' | 'aucun';
export type AnalytiqueEffective = {
    /** Code effectif : externe (propre ou hérité) s'il existe, sinon généré. */
    code: string | null;
    origine: OrigineAnalytique;
    /** Code généré par Zenergya (figé s'il est enregistré, sinon calculé). */
    genere: string | null;
    /** Code externe effectif (propre, ou hérité du niveau au-dessus + segment). */
    externe: string | null;
    /** Le code généré est-il figé (enregistré) ? */
    fige: boolean;
    manque: string[];
};

/**
 * Code effectif d'un niveau. `parent` : résultat du niveau au-dessus (client pour un contrat, contrat pour une
 * prestation) ; `segmentPropre` : segment que le niveau ajoute (numéro de contrat, code d'activité).
 */
export function analytiqueEffective(niveau: NiveauAnalytique, propre: AnalytiqueNiveau, s: SegmentsAnalytiques, parent?: AnalytiqueEffective | null): AnalytiqueEffective {
    const calcule = codeGenere(s, niveau);
    const fige = !!propre.analyticCode;
    const genere = propre.analyticCode || ('code' in calcule ? calcule.code : null);
    const segmentPropre = niveau === 'contrat' ? segment(s.contrat) : niveau === 'prestation' ? segment(s.activite) : '';
    const saisi = propre.analyticExternal?.trim() || null;
    const herite = !saisi && parent?.externe && segmentPropre ? `${parent.externe}-${segmentPropre}` : null;
    const externe = saisi ?? herite;
    return {
        code: externe ?? genere, origine: saisi ? 'externe' : herite ? 'externe-herite' : genere ? 'genere' : 'aucun',
        genere, externe, fige, manque: genere || !('manque' in calcule) ? [] : calcule.manque,
    };
}

/** Analytique figée sur une ligne de facture, d'avoir ou de commande. */
export type AnalytiqueLigne = {
    /** Code effectif à la date de la ligne. */
    code: string;
    /** Code généré par Zenergya et code externe, quand ils existent (les deux lectures restent possibles). */
    genere?: string;
    externe?: string;
    /** Axes : codes du référentiel (et identifiants, les codes pouvant être renommés). */
    axes: {
        societe?: string; agence?: string; secteur?: string; client?: string; contrat?: string; activite?: string;
        companyId?: string; agencyId?: string; sectorId?: string; clientId?: string; contractId?: string; siteId?: string;
    };
};

export const LIBELLE_ORIGINE: Record<OrigineAnalytique, string> = {
    externe: 'code externe', 'externe-herite': 'hérité du code externe du niveau au-dessus', genere: 'généré par Zenergya', aucun: 'non affecté',
};

/** Contrôle d'un code externe saisi : libre, mais court et sans retour à la ligne. */
export function controleCodeExterne(v: string): string | null {
    const t = v.trim();
    if (t.length > 60) return '60 caractères au plus.';
    return /[\n\r\t]/.test(t) ? 'Sans retour à la ligne ni tabulation.' : null;
}

// --- Suivi : totaux par axe ---

export type LigneSuivi = { analytique?: AnalytiqueLigne | null; montant: number; site?: string };
export const AXES_SUIVI = ['societe', 'agence', 'secteur', 'client', 'contrat', 'activite', 'site'] as const;
export type AxeSuivi = typeof AXES_SUIVI[number];
export const LIBELLE_AXE: Record<AxeSuivi, string> = { societe: 'Société', agence: 'Agence', secteur: 'Secteur', client: 'Client', contrat: 'Contrat', activite: 'Activité', site: 'Site' };
export const NON_AFFECTE = '(non affecté)';

/** Totaux des lignes regroupées jusqu'à l'axe choisi (société › agence › … › axe), triés. */
export function totauxParAxe(lignes: LigneSuivi[], jusqua: AxeSuivi): { cle: string; axes: Partial<Record<AxeSuivi, string>>; code: string; montant: number; lignes: number }[] {
    const niveaux = AXES_SUIVI.slice(0, AXES_SUIVI.indexOf(jusqua) + 1);
    const out = new Map<string, { cle: string; axes: Partial<Record<AxeSuivi, string>>; code: string; montant: number; lignes: number }>();
    for (const l of lignes) {
        const a = l.analytique;
        const axes = Object.fromEntries(niveaux.map(n => [n, n === 'site' ? (l.site || NON_AFFECTE) : (a?.axes[n] || NON_AFFECTE)])) as Partial<Record<AxeSuivi, string>>;
        const cle = niveaux.map(n => axes[n]).join(' › ');
        if (!out.has(cle)) out.set(cle, { cle, axes, code: a ? niveaux.filter(n => n !== 'site').map(n => a.axes[n] ?? '?').join('-') : NON_AFFECTE, montant: 0, lignes: 0 });
        const t = out.get(cle)!;
        t.montant = Math.round((t.montant + l.montant) * 100) / 100;
        t.lignes++;
    }
    return [...out.values()].sort((x, y) => x.cle.localeCompare(y.cle, 'fr'));
}
