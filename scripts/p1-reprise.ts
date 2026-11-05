// Reprise des données P1 existantes dans le paramétrage P1 daté (source unique) : à lancer une fois.
// Pour chaque site, à partir des anciennes saisies (site et prestation P1 chauffage) :
//   - station météo, type de marché (seulement MC, MCI, MT, MTI, CP, CPI, PFI, PF : « MF », « AUTRE » sont signalés) ;
//   - un poste « Chauffage » : formule de NC (+ compteur de la prestation), cible NB (MWh), DJU de référence ;
//   - le coefficient de conversion (QE) du compteur, sauf s'il vaut 1 (valeur par défaut de l'ancien formulaire :
//     signalé « à vérifier », jamais repris tel quel).
// Chaque valeur reprise devient une version d'origine (motif « reprise des données existantes »). Un paramètre qui a
// déjà une version n'est pas touché : le script est rejouable.
//
//   npm run p1:reprise                 simulation
//   npm run p1:reprise -- --apply      écrit les versions
//
// Identifiants : comme scripts/attribuer-codes.mjs.

import { planRepriseP1 } from '../src/services/p1-reprise-admin';

const APPLY = process.argv.includes('--apply');

async function main() {
    const { actions, signalements, sites } = await planRepriseP1();
    console.log(`${sites} site(s) ; ${actions.length} reprise(s) :`);
    for (const a of actions) console.log(`  ${a.label}`);
    console.log(`\n${signalements.length} point(s) à traiter à la main :`);
    for (const s of signalements) console.log(`  ${s}`);
    if (!APPLY) { console.log('\nSimulation : rien n\'a été écrit (ajoutez --apply).'); return; }
    for (const a of actions) await a.run();
    console.log(`\n${actions.length} reprise(s) écrite(s).`);
}

main().catch(e => { console.error(e); process.exit(1); });
