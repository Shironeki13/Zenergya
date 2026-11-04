// Vérifie (et répare avec --apply) la cohérence des liens clients → contrats → sites → compteurs, abîmés par
// d'anciennes versions : site déplacé sans être retiré de son ancien contrat (facturé deux fois), sites
// supprimés puis recréés à la correction d'un contrat (compteurs orphelins), noms recopiés périmés.
//
//   node scripts/verifier-liens.mjs            simulation : liste les anomalies et ce qui serait réparé
//   node scripts/verifier-liens.mjs --apply    répare ce qui peut l'être sans décision humaine
//
// Réparé automatiquement :
//   - contrat qui ne liste pas un site rattaché à lui (site.contractId) : site ajouté à contract.siteIds ;
//   - site listé par un contrat en cours alors qu'il est rattaché à un autre contrat : retiré de la liste ;
//   - site inexistant listé par un contrat : retiré de la liste ;
//   - nom du client recopié périmé sur un contrat, un site ou un compteur.
// Signalé seulement (décision humaine) : site rattaché à un contrat inexistant ou d'un autre client, compteur
// rattaché à un site inexistant. Un contrat terminé garde ses anciens sites (historique).
//
// Identifiants : comme scripts/attribuer-codes.mjs.

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!projectId) {
    console.error('FIREBASE_PROJECT_ID non défini.');
    process.exit(1);
}
const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
initializeApp(key ? { credential: cert(JSON.parse(key)), projectId } : { projectId });
const db = getFirestore();

const charger = async (nom) => new Map((await db.collection(nom).get()).docs.map(d => [d.id, { id: d.id, ref: d.ref, ...d.data() }]));
const [clients, contrats, sites, compteurs] = await Promise.all(['clients', 'contracts', 'sites', 'meters'].map(charger));
const ms = (v) => (v instanceof Timestamp ? v.toMillis() : v ? new Date(v).getTime() : NaN);
const enCours = (c) => !['Résilié', 'Terminé'].includes(c.status) && !(ms(c.endDate) < Date.now() - 86_400_000);
const nomContrat = (c) => c.contractNumber || c.id;
const nomSite = (s) => s.code || s.name || s.id;

const reparations = [];   // [ref, champs, description]
const signalements = [];

for (const s of sites.values()) {
    if (!s.contractId) continue;
    const c = contrats.get(s.contractId);
    if (!c) { signalements.push(`Site ${nomSite(s)} : rattaché à un contrat inexistant (${s.contractId}).`); continue; }
    if (s.clientId && c.clientId !== s.clientId) signalements.push(`Site ${nomSite(s)} : son contrat ${nomContrat(c)} est celui d'un autre client.`);
    if (!(c.siteIds || []).includes(s.id)) reparations.push([c.ref, { siteIds: FieldValue.arrayUnion(s.id) }, `Contrat ${nomContrat(c)} : ajout du site ${nomSite(s)} qui lui est rattaché.`]);
}
for (const c of contrats.values()) {
    for (const id of c.siteIds || []) {
        const s = sites.get(id);
        if (!s) { reparations.push([c.ref, { siteIds: FieldValue.arrayRemove(id) }, `Contrat ${nomContrat(c)} : retrait d'un site inexistant (${id}).`]); continue; }
        if (s.contractId && s.contractId !== c.id && enCours(c)) {
            const autre = contrats.get(s.contractId);
            reparations.push([c.ref, { siteIds: FieldValue.arrayRemove(id) },
                `Contrat ${nomContrat(c)} (en cours) : retrait du site ${nomSite(s)}, rattaché au contrat ${autre ? nomContrat(autre) : s.contractId} (sinon facturé deux fois).`]);
        }
    }
    const client = clients.get(c.clientId);
    if (client && c.clientName !== client.name) reparations.push([c.ref, { clientName: client.name, ...(c.label ? { name: `${client.name} - ${c.label}` } : {}) }, `Contrat ${nomContrat(c)} : nom du client mis à jour.`]);
}
for (const s of sites.values()) {
    const client = clients.get(s.clientId);
    if (client && s.clientName !== client.name) reparations.push([s.ref, { clientName: client.name }, `Site ${nomSite(s)} : nom du client mis à jour.`]);
}
for (const m of compteurs.values()) {
    const s = sites.get(m.siteId);
    if (!s) { signalements.push(`Compteur ${m.code || m.id} : rattaché à un site inexistant (${m.siteId}).`); continue; }
    const client = clients.get(s.clientId);
    const champs = {};
    if (m.siteName !== s.name) champs.siteName = s.name;
    if (client && m.clientName !== client.name) champs.clientName = client.name;
    if (Object.keys(champs).length) reparations.push([m.ref, champs, `Compteur ${m.code || m.id} : noms recopiés mis à jour.`]);
}

console.log(`${clients.size} client(s), ${contrats.size} contrat(s), ${sites.size} site(s), ${compteurs.size} compteur(s).`);
console.log(`\n${reparations.length} réparation(s) :`);
for (const [, , d] of reparations) console.log(`  ${d}`);
console.log(`\n${signalements.length} anomalie(s) à traiter à la main :`);
for (const d of signalements) console.log(`  ${d}`);

if (!APPLY) {
    console.log('\nSimulation : rien n\'a été écrit (ajoutez --apply).');
    process.exit(0);
}
for (let i = 0; i < reparations.length; i += 400) {
    const batch = db.batch();
    for (const [ref, champs] of reparations.slice(i, i + 400)) batch.update(ref, champs);
    await batch.commit();
}
console.log(`\n${reparations.length} réparation(s) appliquée(s).`);
