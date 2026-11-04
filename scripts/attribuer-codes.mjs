// Attribue leur code Zenergya aux sites (SIT-00001) et aux compteurs (CPT-00001) créés avant
// la génération automatique. Les documents qui ont déjà un code valide ne sont pas touchés :
// le script est rejouable.
//
//   node scripts/attribuer-codes.mjs            simulation : affiche ce qui serait attribué
//   node scripts/attribuer-codes.mjs --apply    écrit les codes
//
// Identifiants (Admin SDK, les règles Firestore ne s'appliquent pas) :
//   FIREBASE_PROJECT_ID, et GOOGLE_APPLICATION_CREDENTIALS (chemin d'une clé)
//   ou FIREBASE_SERVICE_ACCOUNT_KEY (contenu JSON), ou les identifiants par défaut (gcloud).
//   Avec FIRESTORE_EMULATOR_HOST, le script travaille sur l'émulateur.

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!projectId) {
    console.error('FIREBASE_PROJECT_ID non défini.');
    process.exit(1);
}
const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
initializeApp(key ? { credential: cert(JSON.parse(key)), projectId } : { projectId });
const db = getFirestore();

const SEQUENCES = db.doc('config/sequences');
const TAILLE_LOT = 400;

const formatId = (prefix, n) => `${prefix}-${String(n).padStart(5, '0')}`;
const numero = (code, prefix) => {
    const m = new RegExp(`^${prefix}-(\\d{5,})$`).exec(code || '');
    return m ? Number(m[1]) : null;
};
const comparer = (...cles) => (a, b) => {
    for (const cle of cles) {
        const x = String(cle(a) ?? ''), y = String(cle(b) ?? '');
        const c = x.localeCompare(y, 'fr');
        if (c) return c;
    }
    return 0;
};

/**
 * Réserve `n` numéros dans la séquence, au-delà du plus grand code déjà attribué
 * (une création faite pendant le rattrapage ne peut pas produire de doublon).
 * Rend le premier numéro réservé.
 */
async function reserver(compteur, n, plusGrandExistant) {
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(SEQUENCES);
        const actuel = Math.max(snap.exists ? snap.get(compteur) || 0 : 0, plusGrandExistant);
        tx.set(SEQUENCES, { [compteur]: actuel + n }, { merge: true });
        return actuel + 1;
    });
}

async function ecrire(collection, attributions) {
    for (let i = 0; i < attributions.length; i += TAILLE_LOT) {
        const lot = db.batch();
        for (const { id, code } of attributions.slice(i, i + TAILLE_LOT)) {
            lot.update(db.collection(collection).doc(id), { code });
        }
        await lot.commit();
    }
}

async function traiter({ collection, compteur, prefix, ordre, libelle }) {
    const docs = (await db.collection(collection).get()).docs.map(d => ({ id: d.id, ...d.data() }));
    const avecCode = docs.filter(d => numero(d.code, prefix) !== null);
    const sansCode = docs.filter(d => numero(d.code, prefix) === null).sort(ordre);
    const plusGrand = Math.max(0, ...avecCode.map(d => numero(d.code, prefix)));

    console.log(`\n${collection} : ${docs.length} documents, ${avecCode.length} déjà codés, ${sansCode.length} à coder`);
    if (sansCode.length === 0) return new Map(avecCode.map(d => [d.id, d.code]));

    const premier = APPLY
        ? await reserver(compteur, sansCode.length, plusGrand)
        : Math.max((await SEQUENCES.get()).get(compteur) || 0, plusGrand) + 1;
    const attributions = sansCode.map((d, i) => ({ id: d.id, code: formatId(prefix, premier + i), ancien: d.code, d }));
    for (const a of attributions.slice(0, 20)) {
        console.log(`  ${a.code}  ${libelle(a.d)}${a.ancien ? `  (ancien code : ${a.ancien})` : ''}`);
    }
    if (attributions.length > 20) console.log(`  … et ${attributions.length - 20} autres`);

    if (APPLY) {
        await ecrire(collection, attributions);
        console.log(`  ${attributions.length} codes écrits (${attributions[0].code} à ${attributions.at(-1).code}).`);
    }
    return new Map([...avecCode.map(d => [d.id, d.code]), ...attributions.map(a => [a.id, a.code])]);
}

console.log(`Projet ${projectId}${process.env.FIRESTORE_EMULATOR_HOST ? ' (émulateur)' : ''} — ${APPLY ? 'ÉCRITURE' : 'simulation (ajouter --apply pour écrire)'}`);

// Sites : par client puis par nom, pour des codes voisins au sein d'un même client.
const codesSites = await traiter({
    collection: 'sites', compteur: 'site', prefix: 'SIT',
    ordre: comparer(d => d.clientName, d => d.name, d => d.id),
    libelle: d => `${d.clientName || '?'} / ${d.name || d.id}`,
});

// Compteurs : par site (dans l'ordre des codes de site), puis par nom.
await traiter({
    collection: 'meters', compteur: 'meter', prefix: 'CPT',
    ordre: comparer(d => codesSites.get(d.siteId) || '~', d => d.name, d => d.id),
    libelle: d => `${codesSites.get(d.siteId) || d.siteId || '?'} / ${d.name || d.id}`,
});

if (!APPLY) console.log('\nSimulation terminée : rien n\'a été écrit.');
