// Relevés de compteurs : convertit en horodatage Firestore les dates enregistrées en texte (ISO 8601)
// par les anciennes versions de l'écran de modification. Les relevés déjà horodatés ne sont pas touchés :
// le script est rejouable. Sans cette conversion, ces relevés n'apparaissent pas dans les filtres par
// période de l'API (from / to).
//
//   node scripts/normaliser-releves.mjs            simulation : affiche ce qui serait converti
//   node scripts/normaliser-releves.mjs --apply    écrit les dates
//
// Identifiants : comme scripts/attribuer-codes.mjs (FIREBASE_PROJECT_ID, et GOOGLE_APPLICATION_CREDENTIALS,
// FIREBASE_SERVICE_ACCOUNT_KEY ou les identifiants par défaut ; FIRESTORE_EMULATOR_HOST pour l'émulateur).

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!projectId) {
    console.error('FIREBASE_PROJECT_ID non défini.');
    process.exit(1);
}
const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
initializeApp(key ? { credential: cert(JSON.parse(key)), projectId } : { projectId });
const db = getFirestore();

const snap = await db.collection('meterReadings').get();
const aConvertir = [];
const invalides = [];
for (const doc of snap.docs) {
    const date = doc.get('date');
    if (date instanceof Timestamp) continue;
    const ms = new Date(String(date ?? '')).getTime();
    if (Number.isNaN(ms)) invalides.push(`${doc.id} : « ${date} »`);
    else aConvertir.push({ ref: doc.ref, ms, texte: String(date) });
}

console.log(`${snap.size} relevé(s), ${aConvertir.length} date(s) texte à convertir, ${invalides.length} illisible(s).`);
for (const r of aConvertir.slice(0, 20)) console.log(`  ${r.ref.id} : ${r.texte} → ${new Date(r.ms).toISOString()}`);
if (aConvertir.length > 20) console.log(`  … et ${aConvertir.length - 20} autre(s)`);
for (const i of invalides) console.log(`  illisible, à corriger à la main : ${i}`);

if (!APPLY) {
    console.log('Simulation : rien n\'a été écrit (ajoutez --apply).');
    process.exit(0);
}
for (let i = 0; i < aConvertir.length; i += 400) {
    const batch = db.batch();
    for (const r of aConvertir.slice(i, i + 400)) batch.update(r.ref, { date: Timestamp.fromMillis(r.ms) });
    await batch.commit();
}
console.log(`${aConvertir.length} date(s) converties.`);
