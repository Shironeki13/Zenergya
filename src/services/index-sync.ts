import { adminDb } from '@/lib/firebase-admin';
import { REGLES, controlerValeurs, retardMois, type Rejet } from '@/lib/indices/controles';
import { indexFetchers } from '@/lib/indices/registry';
import type { IndexFetcher } from '@/lib/indices/types';

/**
 * Synchronisation des indices : pour chaque source (INSEE, PEG, CEE…), récupère les valeurs publiées, les contrôle
 * (lib/indices/controles), enregistre les nouvelles et les révisions plausibles, signale les indices en retard, et
 * tient un journal de chaque passage (collection `indicesSyncs`).
 *
 * Appelée par la fonction planifiée (functions/indices-sync) et par le bouton « Synchroniser » de l'application.
 * Une source en échec n'empêche pas les autres.
 */

export type SourceRapport = {
    code: string;
    famille: 'statistique' | 'marche';
    /** ok ; alerte : valeurs rejetées ou indice en retard ; erreur : source injoignable ou illisible. */
    statut: 'ok' | 'alerte' | 'erreur';
    recues: number;
    nouvelles: number;
    /** Valeurs déjà enregistrées, révisées par la source. */
    modifiees: { period: string; avant: number; apres: number }[];
    rejetees: Rejet[];
    dernierePeriode: string | null;
    /** Mois de retard sur la publication attendue (0 : à jour ; null : série arrêtée ou sans valeur). */
    retardMois: number | null;
    erreur?: string;
    dureeMs: number;
};

export type RapportSync = {
    id?: string;
    le: string;
    declencheur: 'planifie' | 'manuel';
    /** Essai : rien n'est enregistré (ni valeurs, ni journal). */
    dryRun: boolean;
    sources: SourceRapport[];
    nouvelles: number; modifiees: number; rejetees: number; erreurs: number; retards: number;
};

export type OptionsSync = { fetchers?: IndexFetcher[]; dryRun?: boolean; declencheur?: 'planifie' | 'manuel'; aujourdhui?: string; delaiMs?: number };

const jourParis = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
const avecDelai = <T,>(p: Promise<T>, ms: number): Promise<T> => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`source sans réponse après ${Math.round(ms / 1000)} s`)), ms))]);

export async function synchroniserIndices(options: OptionsSync = {}): Promise<RapportSync> {
    const fetchers = options.fetchers ?? indexFetchers;
    const dryRun = options.dryRun === true;
    const aujourdhui = options.aujourdhui ?? jourParis();
    const [indicesSnap, valeursSnap] = await Promise.all([adminDb.collection('indices').get(), adminDb.collection('indexValues').get()]);
    const idParCode = new Map(indicesSnap.docs.map(d => [String(d.get('code')), d.id]));
    const valeurs = new Map<string, Map<string, { id: string; value: number }>>();   // indice → période → valeur
    for (const d of valeursSnap.docs) {
        const indexId = String(d.get('indexId'));
        if (!valeurs.has(indexId)) valeurs.set(indexId, new Map());
        valeurs.get(indexId)!.set(String(d.get('period')), { id: d.id, value: Number(d.get('value')) });
    }

    const sources: SourceRapport[] = [];
    for (const f of fetchers) {
        const debut = Date.now();
        const famille = f.famille ?? 'statistique';
        const regles = REGLES[famille];
        const s: SourceRapport = { code: f.code, famille, statut: 'ok', recues: 0, nouvelles: 0, modifiees: [], rejetees: [], dernierePeriode: null, retardMois: null, dureeMs: 0 };
        let indexId = idParCode.get(f.code);
        const connues = (indexId && valeurs.get(indexId)) || new Map<string, { id: string; value: number }>();
        try {
            const recues = await avecDelai(f.fetch(), options.delaiMs ?? 45000);
            s.recues = recues.length;
            if (recues.length === 0) throw new Error('la source ne renvoie aucune valeur (page ou format modifié ?)');
            const sourceDe = new Map(recues.map(r => [r.period, r.source]));
            const { acceptees, rejetees } = controlerValeurs(recues.map(r => ({ period: r.period, value: r.value })), [...connues].map(([period, v]) => ({ period, value: v.value })), regles, aujourdhui);
            s.rejetees = rejetees;
            const aCreer = acceptees.filter(v => !connues.has(v.period));
            const aModifier = acceptees.filter(v => connues.has(v.period) && connues.get(v.period)!.value !== v.value);
            s.nouvelles = aCreer.length;
            s.modifiees = aModifier.map(v => ({ period: v.period, avant: connues.get(v.period)!.value, apres: v.value }));
            if (!dryRun && (aCreer.length || aModifier.length)) {
                if (!indexId) {
                    const ref = await adminDb.collection('indices').add({ code: f.code, label: `Indice ${f.code} (Auto)`, unit: f.code === 'PEG' ? '€/MWh' : 'Index', active: true, decimals: 2, description: 'Créé par la synchronisation automatique' });
                    indexId = ref.id;
                    idParCode.set(f.code, indexId);
                }
                const maintenant = new Date().toISOString();
                const lot = adminDb.batch();
                for (const v of aCreer) lot.set(adminDb.collection('indexValues').doc(), { indexId, period: v.period, value: v.value, source: sourceDe.get(v.period) ?? f.code, comment: 'Synchronisation automatique', lastUpdated: maintenant });
                for (const v of aModifier) lot.update(adminDb.collection('indexValues').doc(connues.get(v.period)!.id), { value: v.value, source: sourceDe.get(v.period) ?? f.code, lastUpdated: maintenant, comment: `Révisé par la source (${connues.get(v.period)!.value} → ${v.value})` });
                await lot.commit();
            }
            for (const v of acceptees) connues.set(v.period, { id: connues.get(v.period)?.id ?? '', value: v.value });
        } catch (e) {
            s.statut = 'erreur';
            s.erreur = e instanceof Error ? e.message : String(e);
        }
        const periodes = [...connues.keys()].sort();
        s.dernierePeriode = periodes[periodes.length - 1] ?? null;
        s.retardMois = f.arretee ? null : retardMois(periodes, regles, aujourdhui);
        if (s.statut === 'ok' && (s.rejetees.length > 0 || (s.retardMois ?? 0) > 0)) s.statut = 'alerte';
        s.dureeMs = Date.now() - debut;
        sources.push(s);
    }

    const rapport: RapportSync = {
        le: new Date().toISOString(), declencheur: options.declencheur ?? 'manuel', dryRun, sources,
        nouvelles: sources.reduce((n, s) => n + s.nouvelles, 0), modifiees: sources.reduce((n, s) => n + s.modifiees.length, 0),
        rejetees: sources.reduce((n, s) => n + s.rejetees.length, 0), erreurs: sources.filter(s => s.statut === 'erreur').length,
        retards: sources.filter(s => (s.retardMois ?? 0) > 0).length,
    };
    if (!dryRun) rapport.id = (await adminDb.collection('indicesSyncs').add(JSON.parse(JSON.stringify(rapport)))).id;
    return rapport;
}

/** Derniers passages de la synchronisation, du plus récent au plus ancien. */
export async function dernieresSyncs(n = 10): Promise<RapportSync[]> {
    const s = await adminDb.collection('indicesSyncs').orderBy('le', 'desc').limit(n).get();
    return s.docs.map(d => ({ id: d.id, ...d.data() }) as RapportSync);
}

// --- Compatibilité : bouton « Synchroniser » de l'application (/api/indices/sync) ---

export interface SyncStats { totalIndices: number; newIndices: number; newValues: number; errors: string[]; rapport?: RapportSync }

export async function syncAllIndices(): Promise<SyncStats> {
    const avant = (await adminDb.collection('indices').count().get()).data().count;
    const rapport = await synchroniserIndices({ declencheur: 'manuel' });
    const apres = (await adminDb.collection('indices').count().get()).data().count;
    return {
        totalIndices: rapport.sources.length, newIndices: apres - avant, newValues: rapport.nouvelles + rapport.modifiees,
        errors: rapport.sources.filter(s => s.statut === 'erreur').map(s => `${s.code}: ${s.erreur}`), rapport,
    };
}
