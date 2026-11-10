// Reprise de l'analytique : fige les codes des contrats et pose l'analytique sur les lignes des factures et avoirs déjà
// émis. Simulation par défaut ; « -- --apply » écrit.
//   npm run analytique:reprise            (simulation : ce qui serait fait)
//   npm run analytique:reprise -- --apply
import { repriseAnalytique } from '../src/services/analytique-admin';

(async () => {
    const apply = process.argv.includes('--apply');
    const r = await repriseAnalytique(apply);
    console.log(apply ? 'Reprise appliquée.' : 'Simulation (rien n\'est écrit ; ajoutez « -- --apply » pour appliquer).');
    console.log(`Contrats : ${r.contrats} ; codes ${apply ? 'figés' : 'à figer'} : ${r.codesFiges}`);
    console.log(`Factures et avoirs ${apply ? 'complétés' : 'à compléter'} : ${r.documents} (${r.lignes} lignes) ; sans contrat (devis, travaux) : ${r.sansContrat}`);
    if (r.nonGenerables.length) {
        console.log(`Contrats sans code générable (${r.nonGenerables.length}) : complétez le référentiel puis relancez.`);
        for (const x of r.nonGenerables.slice(0, 50)) console.log(`  ${x.contrat} : ${x.manque.join(', ')}`);
    }
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
