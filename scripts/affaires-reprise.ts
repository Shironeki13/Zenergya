// Reprise des affaires de travaux : crée l'affaire des devis P5 acceptés qui n'en ont pas, complète les affaires
// antérieures (devis, budget, analytique) et pose l'analytique sur leurs factures. Simulation par défaut.
//   npm run affaires:reprise            (simulation)
//   npm run affaires:reprise -- --apply
import { repriseAffaires } from '../src/services/projects-admin';

(async () => {
    const apply = process.argv.includes('--apply');
    const r = await repriseAffaires(apply);
    console.log(apply ? 'Reprise appliquée.' : 'Simulation (rien n\'est écrit ; ajoutez « -- --apply » pour appliquer).');
    console.log(`Affaires ${apply ? 'créées' : 'à créer'} (devis P5 acceptés) : ${r.affairesCreees} ; affaires ${apply ? 'complétées' : 'à compléter'} : ${r.affairesCompletees}`);
    console.log(`Factures de travaux ${apply ? 'complétées' : 'à compléter'} : ${r.factures} (${r.lignes} lignes)`);
    if (r.nonGenerables.length) console.log(`Affaires sans code générable (code d'agence ou de secteur manquant) : ${r.nonGenerables.join(', ')}`);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
