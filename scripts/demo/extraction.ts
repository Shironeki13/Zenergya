// Extraction des tables de la démo (émulateurs Firebase uniquement, lecture seule) : chaque collection Firestore et
// les fichiers du stockage, aplatis (une colonne par champ), dans un fichier JSON que scripts/demo/extraction.py met
// en forme dans un classeur Excel (un onglet par composant).
//   npm run demo:extraction   →   demo-extraction.json puis demo-extraction.xlsx
import { writeFileSync } from 'node:fs';
import { Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { adminDb } from '../../src/lib/firebase-admin';

const env = process.env;
const PROJET = env.FIREBASE_PROJECT_ID ?? env.GCLOUD_PROJECT ?? '';
if (!env.FIRESTORE_EMULATOR_HOST || !PROJET.startsWith('demo-')) {
    console.error('Refusé : extraction réservée aux émulateurs de la démo (projet « demo-… »).');
    process.exit(1);
}
const SORTIE = process.argv[2] ?? 'demo-extraction.json';

type Cellule = string | number | boolean | null;

/** Valeur Firestore → cellule : dates en ISO (jour seul à minuit), listes simples jointes, objets en JSON. */
function cellule(v: unknown): Cellule {
    if (v === null || v === undefined) return null;
    if (v instanceof Timestamp) {
        const iso = v.toDate().toISOString();
        return iso.endsWith('T00:00:00.000Z') || iso.endsWith('T23:00:00.000Z') || iso.endsWith('T22:00:00.000Z')
            ? v.toDate().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }) : iso;
    }
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
    if (Array.isArray(v)) return v.every(x => x === null || ['string', 'number', 'boolean'].includes(typeof x)) ? v.join(' ; ') : JSON.stringify(v, (_, x) => (x instanceof Timestamp ? x.toDate().toISOString() : x));
    return JSON.stringify(v, (_, x) => (x instanceof Timestamp ? x.toDate().toISOString() : x));
}

/** Aplatit un document : objets imbriqués en « parent.enfant » (2 niveaux), le reste en cellule. */
function aplatir(d: Record<string, unknown>, prefixe = '', niveau = 0, out: Record<string, Cellule> = {}): Record<string, Cellule> {
    for (const [k, v] of Object.entries(d)) {
        const cle = prefixe ? `${prefixe}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Timestamp) && niveau < 1 && Object.keys(v).length <= 12) aplatir(v as Record<string, unknown>, cle, niveau + 1, out);
        else out[cle] = cellule(v);
    }
    return out;
}

(async () => {
    const collections = (await adminDb.listCollections()).map(c => c.id).sort();
    const tables: Record<string, { colonnes: string[]; lignes: Cellule[][] }> = {};
    for (const nom of collections) {
        const docs = (await adminDb.collection(nom).get()).docs.map(d => ({ id: d.id, ...aplatir(d.data()) }));
        const colonnes = ['id', ...new Set(docs.flatMap(d => Object.keys(d)).filter(k => k !== 'id'))];
        tables[nom] = { colonnes, lignes: docs.map(d => colonnes.map(c => (d as Record<string, Cellule>)[c] ?? null)) };
    }
    const [fichiers] = await getStorage().bucket(`${PROJET}.appspot.com`).getFiles();
    tables['(stockage)'] = {
        colonnes: ['chemin', 'type', 'taille (octets)', 'affichage', 'créé le'],
        lignes: fichiers.map(f => [f.name, f.metadata.contentType ?? null, Number(f.metadata.size ?? 0), f.metadata.contentDisposition ?? null, f.metadata.timeCreated ?? null]),
    };
    writeFileSync(SORTIE, JSON.stringify({ projet: PROJET, extraitLe: new Date().toISOString(), tables }, null, 1));
    console.log(`${Object.keys(tables).length} tables extraites → ${SORTIE}`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
