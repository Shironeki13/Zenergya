// Reprise : inscrit sur chaque compteur son dernier relevé (date, index, type), désormais tenu à jour par le serveur à
// chaque saisie, suppression ou import. À lancer une fois sur les données existantes.
//   npm run releves:reprise              simulation : ne modifie rien
//   npm run releves:reprise -- --apply   applique
import { adminDb } from '../src/lib/firebase-admin';
import { dernierReleve } from '../src/services/readings-admin';

const appliquer = process.argv.includes('--apply');

(async () => {
    const compteurs = await adminDb.collection('meters').get();
    console.log(`${compteurs.size} compteur(s) — ${appliquer ? 'APPLICATION' : 'simulation (ajoutez -- --apply pour appliquer)'}`);
    let aJour = 0, modifies = 0, sansReleve = 0;
    for (const c of compteurs.docs) {
        const releves = await adminDb.collection('meterReadings').where('meterId', '==', c.id).get();
        const d = dernierReleve(releves.docs.map(x => ({ date: x.get('date'), value: x.get('value'), type: x.get('type') })));
        if (!d.lastReadingDate) sansReleve++;
        if (c.get('lastReadingDate') === d.lastReadingDate && c.get('lastReadingValue') === d.lastReadingValue && c.get('lastReadingType') === d.lastReadingType) { aJour++; continue; }
        modifies++;
        if (modifies <= 20) console.log(`  ${c.get('code') ?? c.id} : ${c.get('lastReadingDate') ?? '—'} → ${d.lastReadingDate ?? 'aucun relevé'}${d.lastReadingDate ? ` (index ${d.lastReadingValue}, ${releves.size} relevé(s))` : ''}`);
        if (appliquer) await c.ref.update(d);
    }
    if (modifies > 20) console.log(`  … et ${modifies - 20} autre(s)`);
    console.log(`${modifies} compteur(s) ${appliquer ? 'mis à jour' : 'à mettre à jour'}, ${aJour} déjà à jour, ${sansReleve} sans relevé.`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
