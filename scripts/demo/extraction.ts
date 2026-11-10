// Extraction des tables de la démo (émulateurs Firebase uniquement, lecture seule) : chaque collection Firestore et
// les fichiers du stockage, aplatis (une colonne par champ), dans un fichier JSON que scripts/demo/extraction.py met
// en forme dans un classeur Excel (un onglet par composant).
//   npm run demo:extraction   →   demo-extraction.json puis demo-extraction.xlsx
import { writeFileSync } from 'node:fs';
import { Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { adminDb } from '../../src/lib/firebase-admin';
import { P1_DOC_ID, baremeAu, valeurAu, type P1ContractDoc, type P1MeterDoc, type P1SiteDoc } from '../../src/lib/p1/stockage';
import { partage, quantiteRegularisation } from '../../src/lib/p1/bareme';
import { toDay } from '../../src/lib/services/site-amounts';
import type { TermeNc, TrancheBareme, TypeMarche } from '../../src/lib/p1/parametrage';

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

/**
 * Intéressement à vérifier (saison 2025-2026, du 01/10/2025 au 31/05/2026) des prestations P1 chauffage qui ont un
 * compteur et un prix d'intéressement : données d'entrée (paramétrage P1, relevés, DJU) et résultat de la bibliothèque
 * de l'application, que le classeur recalcule par ses propres formules.
 */
async function interessements() {
    const debut = '2025-10-01', fin = '2026-05-31', releveDebut = '2025-09-30', releveFin = '2026-05-31';
    const services = (await adminDb.collection('services').where('p1Type', '==', 'CHAUFFAGE').get()).docs.filter(d => d.get('meterId') && Number(d.get('interestUnitPrice')) > 0);
    const out = [];
    for (const svc of services) {
        const [site, meter, siteP1, meterP1] = await Promise.all([
            adminDb.collection('sites').doc(String(svc.get('siteId'))).get(), adminDb.collection('meters').doc(String(svc.get('meterId'))).get(),
            adminDb.collection('p1Parametrage').doc(P1_DOC_ID.site(String(svc.get('siteId')))).get(), adminDb.collection('p1Parametrage').doc(P1_DOC_ID.meter(String(svc.get('meterId')))).get(),
        ]);
        const contractP1 = await adminDb.collection('p1Parametrage').doc(P1_DOC_ID.contract(String(site.get('contractId')))).get();
        const sd = siteP1.data() as P1SiteDoc | undefined, md = meterP1.data() as P1MeterDoc | undefined, cd = contractP1.data() as P1ContractDoc | undefined;
        const code = String(meter.get('code'));
        const poste = Object.values(sd?.postes ?? {}).find(p => (valeurAu<TermeNc[]>(p.params, 'formuleNc', debut) ?? []).some(t => t.codeCompteur === code));
        const marche = valeurAu<TypeMarche>(sd?.params, 'typeMarche', debut);
        const station = valeurAu<string>(sd?.params, 'stationMeteo', debut);
        const bareme = marche ? baremeAu(sd ?? null, cd ?? null, marche, debut) : null;
        const releves = (await adminDb.collection('meterReadings').where('meterId', '==', meter.id).get()).docs.map(d => ({ date: toDay(d.get('date')) ?? '', value: Number(d.get('value')) }));
        const djus = station ? (await adminDb.collection('djus').where('stationCode', '==', station).where('date', '>=', debut).where('date', '<=', fin).get()).docs.reduce((t, d) => t + Number(d.get('value')), 0) : 0;
        const e = {
            site: String(site.get('name')), codeSite: String(site.get('code')), compteur: code, marche, station, debut, fin, releveDebut, releveFin,
            indexDebut: releves.find(r => r.date === releveDebut)?.value ?? null, indexFin: releves.find(r => r.date === releveFin)?.value ?? null,
            qe: valeurAu<number>(md?.params, 'qe', debut), cibleNb: poste ? valeurAu<number>(poste.params, 'cibleNb', debut) : null,
            djuReference: poste ? valeurAu<number>(poste.params, 'djuReference', debut) : null, djuMesures: Math.round(djus * 10) / 10,
            prixUnitaire: Number(svc.get('interestUnitPrice')), tranches: (bareme?.tranches ?? []) as TrancheBareme[], sourceBareme: bareme?.source ?? null,
            application: null as null | { nc: number; nPrimeB: number; ecart: number; partClient: number; quantite: number; montant: number },
        };
        if (e.indexDebut !== null && e.indexFin !== null && e.qe && e.cibleNb && e.djuReference && marche) {
            const nc = (e.indexFin - e.indexDebut) * e.qe, nPrimeB = e.cibleNb * (e.djuMesures / e.djuReference), ecart = nPrimeB - nc;
            const client = partage(ecart, nPrimeB, e.tranches).client, quantite = quantiteRegularisation(marche, ecart, client);
            e.application = { nc, nPrimeB, ecart, partClient: client, quantite, montant: quantite * e.prixUnitaire };
        }
        out.push(e);
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
    writeFileSync(SORTIE, JSON.stringify({ projet: PROJET, extraitLe: new Date().toISOString(), tables, interessements: await interessements() }, null, 1));
    console.log(`${Object.keys(tables).length} tables extraites → ${SORTIE}`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
