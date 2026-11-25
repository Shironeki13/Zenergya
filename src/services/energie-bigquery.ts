import 'server-only';
import { GoogleAuth } from 'google-auth-library';
import { lireLignes, pdlNorme, requeteFactures, vuesDe, type FactureBigQuery } from '@/lib/energie/bigquery';

/**
 * Lecture directe des factures des fournisseurs d'énergie dans BigQuery (lecture seule, compte de service de
 * l'application). Activée par `ENERGIE_BQ_PROJET` (projet où s'exécutent les requêtes) ; sans lui, le logiciel
 * fonctionne avec les seules factures saisies à la main.
 *
 * Les vues sont lentes (une dizaine de secondes, quel que soit le filtre) : elles sont lues en une fois, sur les
 * `ENERGIE_BQ_MOIS` derniers mois (24 par défaut), puis gardées en mémoire. Passé un quart d'heure, la lecture
 * suivante répond avec ce qui est en mémoire et relance la lecture en arrière-plan ; si BigQuery ne répond pas, les
 * dernières données lues servent jusqu'à six heures.
 */

const FRAIS = 15 * 60_000;
const PERIME = 6 * 60 * 60_000;
type Memoire = { le: number; depuis: string; parPdl: Map<string, FactureBigQuery[]>; nombre: number };
let memoire: Memoire | null = null;
let lecture: Promise<Memoire> | null = null;
let auth: GoogleAuth | null = null;

export const bigQueryActif = () => !!process.env.ENERGIE_BQ_PROJET?.trim();

export class BigQueryIndisponible extends Error {
    constructor(cause: string) { super(`Factures des fournisseurs indisponibles (BigQuery) : ${cause}`); this.name = 'BigQueryIndisponible'; }
}

type Reponse = { jobComplete?: boolean; jobReference?: { jobId: string; location?: string }; schema?: { fields: { name: string }[] }; rows?: { f: { v: string | null }[] }[]; pageToken?: string; errors?: { message: string }[] };

async function requete(sql: string, parametres: object[]): Promise<Record<string, string | null>[]> {
    const projet = process.env.ENERGIE_BQ_PROJET!.trim();
    auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/bigquery.readonly'] });
    const client = await auth.getClient();
    const base = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projet)}/queries`;
    let r = (await client.request<Reponse>({ url: base, method: 'POST', data: { query: sql, useLegacySql: false, parameterMode: 'NAMED', queryParameters: parametres, timeoutMs: 50_000, maxResults: 10_000 } })).data;
    const lignes: Record<string, string | null>[] = [];
    for (let tour = 0; tour < 100; tour++) {
        if (r.errors?.length) throw new Error(r.errors[0].message);
        if (r.jobComplete) {
            const noms = (r.schema?.fields ?? []).map(f => f.name);
            for (const row of r.rows ?? []) lignes.push(Object.fromEntries(row.f.map((c, i) => [noms[i], c.v])));
            if (!r.pageToken) return lignes;
        }
        const ref = r.jobReference;
        if (!ref) throw new Error('réponse incomplète');
        r = (await client.request<Reponse>({ url: `${base}/${ref.jobId}`, params: { location: ref.location, pageToken: r.pageToken, timeoutMs: 50_000, maxResults: 10_000 } })).data;
    }
    throw new Error('requête trop longue');
}

/** Premier jour de la fenêtre lue : il y a `ENERGIE_BQ_MOIS` mois (24 par défaut, de 1 à 120). */
function debutFenetre(): string {
    const mois = Math.min(120, Math.max(1, Number(process.env.ENERGIE_BQ_MOIS) || 24));
    const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - mois);
    return d.toISOString().slice(0, 10);
}

async function lire(): Promise<Memoire> {
    const depuis = debutFenetre();
    const factures = lireLignes(await requete(requeteFactures(vuesDe(process.env), { tousLesPoints: true }), [{ name: 'depuis', parameterType: { type: 'DATE' }, parameterValue: { value: depuis } }]));
    const parPdl = new Map<string, FactureBigQuery[]>();
    for (const f of factures) parPdl.set(f.pdl, [...(parPdl.get(f.pdl) ?? []), f]);
    return { le: Date.now(), depuis, parPdl, nombre: factures.length };
}

/** Lecture partagée : une seule à la fois ; son résultat remplace la mémoire. */
function rafraichir(): Promise<Memoire> {
    lecture ??= lire().then(m => { memoire = m; return m; }).finally(() => { lecture = null; });
    return lecture;
}

/**
 * Factures du fournisseur des points de livraison donnés, sur la fenêtre lue. Sans BigQuery configuré ou sans
 * point : aucune. Si BigQuery ne répond pas et que rien de récent n'est en mémoire : `BigQueryIndisponible`.
 */
export async function facturesBigQuery(pdls: string[]): Promise<FactureBigQuery[]> {
    const liste = [...new Set(pdls.map(pdlNorme).filter(Boolean))];
    if (!bigQueryActif() || liste.length === 0) return [];
    const age = memoire ? Date.now() - memoire.le : Infinity;
    let m = memoire;
    if (!m || age > PERIME) {
        try { m = await rafraichir(); } catch (e) { throw new BigQueryIndisponible(e instanceof Error ? e.message.slice(0, 300) : 'erreur inconnue'); }
    } else if (age > FRAIS) {
        // Réponse immédiate avec ce qui est en mémoire ; la relecture se fait en arrière-plan.
        void rafraichir().catch(e => console.error('Relecture BigQuery des factures d\'énergie impossible :', e instanceof Error ? e.message : e));
    }
    return liste.flatMap(p => m!.parPdl.get(p) ?? []);
}

/** État de la lecture, pour l'écran : active ou non, fenêtre, nombre de factures en mémoire, date de lecture. */
export function etatBigQuery(): { actif: boolean; depuis?: string; factures?: number; luLe?: string } {
    return { actif: bigQueryActif(), ...(memoire && { depuis: memoire.depuis, factures: memoire.nombre, luLe: new Date(memoire.le).toISOString() }) };
}
