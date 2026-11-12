import { roundCents } from '@/lib/money';
import type { AnalytiqueLigne } from '@/lib/analytique';
import type { CibleCommande } from '@/lib/commandes';

/**
 * Heures de main-d'œuvre (logique pure). Un technicien saisit ses heures par jour sur une affaire de travaux ou sur un
 * contrat (et une activité) : la saisie porte donc le même code analytique que les ventes et les commandes. Elle est
 * valorisée au coût horaire interne en vigueur à la saisie (celui de l'utilisateur, sinon celui de la société), figé :
 * c'est le **réel de main-d'œuvre** de l'affaire.
 */

export type SourceHeures = 'saisie' | 'import';

export type SaisieHeures = {
    id: string;
    userId: string;
    userName: string;
    companyId: string;
    /** Jour travaillé, AAAA-MM-JJ. */
    date: string;
    hours: number;
    cible: CibleCommande;
    comment?: string;
    /** Coût horaire interne figé à la saisie (€ / h) et coût de la saisie. */
    rate: number;
    cost: number;
    /** Code analytique figé à la saisie. */
    analytique: AnalytiqueLigne;
    source: SourceHeures;
    createdAt: string;
    createdBy: string;
    updatedAt?: string;
    updatedBy?: string;
    /** Validation par le responsable (N+1). Absent : saisie antérieure à la validation, considérée validée. */
    statut?: StatutHeures;
    valideePar?: string; valideeLe?: string;
    /** Motif du refus : le technicien corrige et la saisie repart en validation. */
    motifRefus?: string;
};

// --- Validation par le responsable ---

export const STATUTS_HEURES = ['a_valider', 'validee', 'refusee'] as const;
export type StatutHeures = typeof STATUTS_HEURES[number];
export const LIBELLE_STATUT_HEURES: Record<StatutHeures, string> = { a_valider: 'À valider', validee: 'Validée', refusee: 'Refusée' };

/** Statut d'une saisie (une saisie antérieure à la validation est considérée validée). */
export const statutHeures = (s: Pick<SaisieHeures, 'statut'>): StatutHeures => s.statut ?? 'validee';
export const estValidee = (s: Pick<SaisieHeures, 'statut'>) => statutHeures(s) === 'validee';

export type ActeurHeures = { id: string; isAdmin?: boolean };
/** Technicien dont on saisit les heures : son responsable (N+1). */
export type TechnicienHeures = { id: string; managerId?: string | null };

/**
 * Qui valide les heures de quelqu'un : son responsable (N+1) ; un administrateur pour tous (et pour qui n'a pas de
 * responsable). Personne ne valide ses propres heures.
 */
export const peutValiderHeures = (acteur: ActeurHeures, technicien: TechnicienHeures): boolean =>
    acteur.id !== technicien.id && (technicien.managerId === acteur.id || acteur.isAdmin === true);

/**
 * Statut d'une saisie selon qui l'enregistre : par celui qui pourrait la valider (responsable ou administrateur, pour
 * un autre que lui) → validée d'office ; par l'intéressé → à valider.
 */
export const statutALaSaisie = (acteur: ActeurHeures, technicien: TechnicienHeures): StatutHeures => (peutValiderHeures(acteur, technicien) ? 'validee' : 'a_valider');

/** L'intéressé ne modifie ni ne supprime une saisie déjà validée : c'est à son responsable de le faire. */
export function modifiablePar(s: Pick<SaisieHeures, 'statut' | 'userId'>, acteur: ActeurHeures, technicien: TechnicienHeures): string | null {
    if (peutValiderHeures(acteur, technicien)) return null;
    if (acteur.id !== s.userId) return 'Ces heures ne sont pas les vôtres.';
    return estValidee(s) ? 'Heures déjà validées : demandez à votre responsable de les corriger.' : null;
}

/** Totaux par statut : validées (comptées dans l'affaire), à valider (à part), refusées (hors compte). */
export function heuresParStatut(saisies: Pick<SaisieHeures, 'hours' | 'cost' | 'statut'>[]): Record<StatutHeures, TotalHeures> {
    return Object.fromEntries(STATUTS_HEURES.map(st => [st, totalHeures(saisies.filter(s => statutHeures(s) === st))])) as Record<StatutHeures, TotalHeures>;
}

/** Plus petite unité de saisie : le quart d'heure. */
export const PAS_HEURES = 0.25;
export const MAX_HEURES_JOUR = 24;

export const estJour = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Contrôle d'une saisie ; null si elle est correcte. `aujourdhui` : pas d'heures dans le futur. */
export function controleHeures(s: { date: unknown; hours: unknown }, aujourdhui: string): string | null {
    if (!estJour(s.date)) return 'Date invalide (AAAA-MM-JJ).';
    if (s.date > aujourdhui) return 'Les heures ne se saisissent pas à l\'avance.';
    const h = Number(s.hours);
    if (!Number.isFinite(h) || h <= 0) return 'Nombre d\'heures strictement positif.';
    if (h > MAX_HEURES_JOUR) return `Pas plus de ${MAX_HEURES_JOUR} h sur une journée.`;
    if (Math.abs(h / PAS_HEURES - Math.round(h / PAS_HEURES)) > 1e-9) return 'Heures au quart d\'heure (0,25 ; 0,5 ; 0,75…).';
    return null;
}

export const coutHeures = (hours: number, rate: number) => roundCents(hours * rate);

/** Coût horaire applicable : celui de l'utilisateur, sinon celui de la société ; null si aucun n'est renseigné. */
export function tauxHoraire(utilisateur?: number | null, societe?: number | null): number | null {
    for (const t of [utilisateur, societe]) if (typeof t === 'number' && Number.isFinite(t) && t > 0) return t;
    return null;
}

export const cleCible = (c: CibleCommande) => (c.type === 'affaire' ? `a|${c.projectId}` : `c|${c.contractId}|${c.activityCode ?? ''}`);

export type TotalHeures = { heures: number; cout: number };
const plus = (t: TotalHeures, s: Pick<SaisieHeures, 'hours' | 'cost'>): TotalHeures => ({ heures: Math.round((t.heures + s.hours) * 100) / 100, cout: roundCents(t.cout + s.cost) });

export function totalHeures(saisies: Pick<SaisieHeures, 'hours' | 'cost'>[]): TotalHeures {
    return saisies.reduce(plus, { heures: 0, cout: 0 });
}

/** Totaux par clé (affaire, technicien, mois…). */
export function heuresPar<T extends Pick<SaisieHeures, 'hours' | 'cost'>>(saisies: T[], cle: (s: T) => string): Map<string, TotalHeures> {
    const out = new Map<string, TotalHeures>();
    for (const s of saisies) out.set(cle(s), plus(out.get(cle(s)) ?? { heures: 0, cout: 0 }, s));
    return out;
}

/** Lundi de la semaine d'un jour (AAAA-MM-JJ). */
export function lundiDe(jour: string): string {
    const d = new Date(`${jour}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
}

// --- Import (heures saisies dans un autre outil) ---

export const COLONNES_IMPORT = [
    { cle: 'date', libelle: 'Date', obligatoire: true, aide: 'AAAA-MM-JJ ou JJ/MM/AAAA', alias: ['jour'] },
    { cle: 'email', libelle: 'Technicien (email)', obligatoire: true, aide: 'email de l\'utilisateur Zenergya', alias: ['technicien', 'email', 'salarie', 'utilisateur'] },
    { cle: 'affaire', libelle: 'Affaire', obligatoire: false, aide: 'code de l\'affaire (ex. ZEN-AFF2026-0003) ; sinon contrat et activité', alias: ['code affaire'] },
    { cle: 'contrat', libelle: 'Contrat', obligatoire: false, aide: 'numéro du contrat (ex. CTN-00001), si pas d\'affaire', alias: ['numero de contrat', 'n contrat'] },
    { cle: 'activite', libelle: 'Activité', obligatoire: false, aide: 'code de l\'activité du contrat (ex. P2)', alias: ['code activite'] },
    { cle: 'heures', libelle: 'Heures', obligatoire: true, aide: 'au quart d\'heure, ex. 7,5', alias: ['nb heures', 'nombre d heures', 'duree'] },
    { cle: 'commentaire', libelle: 'Commentaire', obligatoire: false, aide: 'facultatif', alias: ['libelle', 'description'] },
] as const;
type CleImport = typeof COLONNES_IMPORT[number]['cle'];

export type LigneImportHeures = { ligne: number; date: string; email: string; affaire: string; contrat: string; activite: string; hours: number; comment: string; erreurs: string[] };

export const norme = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\*/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Date d'une cellule : AAAA-MM-JJ, JJ/MM/AAAA (ou JJ-MM-AAAA, JJ.MM.AAAA) ; '' si illisible. */
export function jourImport(v: unknown): string {
    const s = String(v ?? '').trim().slice(0, 10);
    if (estJour(s)) return s;
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(String(v ?? '').trim());
    const iso = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
    return estJour(iso) ? iso : '';
}

/** Lit un tableau (première ligne : en-têtes) ; contrôle la forme de chaque ligne (les références sont résolues côté serveur). */
export function lireImportHeures(table: unknown[][], aujourdhui: string): { lignes: LigneImportHeures[]; erreur?: string } {
    const entetes = (table[0] ?? []).map(norme);
    const index = {} as Record<CleImport, number>;
    for (const c of COLONNES_IMPORT) index[c.cle] = entetes.findIndex(e => e === norme(c.libelle) || e === c.cle || (c.alias as readonly string[]).includes(e));
    const manquantes = COLONNES_IMPORT.filter(c => c.obligatoire && index[c.cle] < 0).map(c => c.libelle);
    if (manquantes.length) return { lignes: [], erreur: `Colonne(s) manquante(s) : ${manquantes.join(', ')}.` };
    if (index.affaire < 0 && index.contrat < 0) return { lignes: [], erreur: 'Colonne « Affaire » ou « Contrat » attendue.' };
    const cellule = (r: unknown[], c: CleImport) => (index[c] < 0 ? '' : String(r[index[c]] ?? '').trim());
    const lignes: LigneImportHeures[] = [];
    table.slice(1).forEach((r, i) => {
        if (!r || r.every(x => String(x ?? '').trim() === '')) return;
        const erreurs: string[] = [];
        const date = jourImport(cellule(r, 'date'));
        const hours = Number(cellule(r, 'heures').replace(/\s/g, '').replace(',', '.').replace(/h$/i, ''));
        const email = cellule(r, 'email').toLowerCase();
        const [affaire, contrat, activite] = [cellule(r, 'affaire'), cellule(r, 'contrat'), cellule(r, 'activite')];
        if (!date) erreurs.push('date illisible');
        const e = date ? controleHeures({ date, hours }, aujourdhui) : controleHeures({ date: aujourdhui, hours }, aujourdhui);
        if (e) erreurs.push(e);
        if (!email) erreurs.push('technicien (email) manquant');
        if (!affaire && !contrat) erreurs.push('affaire ou contrat à renseigner');
        if (affaire && contrat) erreurs.push('affaire OU contrat, pas les deux');
        if (contrat && !activite) erreurs.push('activité du contrat à renseigner');
        lignes.push({ ligne: i + 2, date, email, affaire, contrat, activite, hours, comment: cellule(r, 'commentaire'), erreurs });
    });
    if (!lignes.length) return { lignes, erreur: 'Aucune ligne à importer.' };
    return { lignes };
}

/** Clé de doublon d'une saisie : même technicien, même jour, même affectation, même durée. */
export const cleDoublon = (s: { userId: string; date: string; cible: CibleCommande; hours: number }) => `${s.userId}|${s.date}|${cleCible(s.cible)}|${s.hours}`;
