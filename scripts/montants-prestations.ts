// Bascule des montants des sites sur leurs prestations (source unique) : à lancer une fois après le déploiement.
// Les sites qui ont des prestations voient leurs montants recalculés à partir des prestations en vigueur ; la
// simulation montre, site par site, l'écart avec les montants saisis à la main (à vérifier avant d'appliquer :
// c'est ce qui sera facturé).
//
//   npm run montants:prestations                 simulation
//   npm run montants:prestations -- --apply      écrit les montants calculés
//
// Identifiants : comme scripts/attribuer-codes.mjs (FIREBASE_PROJECT_ID, GOOGLE_APPLICATION_CREDENTIALS ou
// FIREBASE_SERVICE_ACCOUNT_KEY ; FIRESTORE_EMULATOR_HOST pour l'émulateur).

import { adminDb } from '../src/lib/firebase-admin';
import { recomputeSiteAmounts } from '../src/services/site-amounts-admin';

const APPLY = process.argv.includes('--apply');

async function main() {
    const activities = new Map((await adminDb.collection('activities').get()).docs.map(d => [d.id, String(d.get('code') || d.get('label') || d.id)]));
    const fmt = (a: { activityId: string; amount: number }[]) =>
        a.length ? a.map(x => `${activities.get(x.activityId) ?? x.activityId} ${x.amount.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`).join(', ') : 'aucun';
    const { checked, changes } = await recomputeSiteAmounts(undefined, { dryRun: !APPLY });
    console.log(`${checked} site(s) avec prestations, ${changes.length} montant(s) à changer :`);
    for (const c of changes) {
        console.log(`  ${c.site}${c.firstTime ? ' (bascule)' : ''} : ${fmt(c.before)}  →  ${fmt(c.after)}`);
    }
    console.log(APPLY ? `\n${changes.length} site(s) mis à jour.` : '\nSimulation : rien n\'a été écrit (ajoutez --apply).');
}

main().catch(e => { console.error(e); process.exit(1); });
