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

import { adminDb } from '../src/lib/firebase-admin';
import { TYPES_MARCHE } from '../src/lib/p1/parametrage';
import { P1_DOC_ID, type P1MeterDoc, type P1SiteDoc } from '../src/lib/p1/stockage';
import { addP1Poste, addP1Version } from '../src/services/p1-admin';

const APPLY = process.argv.includes('--apply');
const BY = 'reprise';
const MOTIF = 'reprise des données existantes';

async function main() {
    const [sites, services, meters, stations, p1] = await Promise.all([
        adminDb.collection('sites').get(),
        adminDb.collection('services').where('type', '==', 'P1').get(),
        adminDb.collection('meters').get(),
        adminDb.collection('weatherStations').get(),
        adminDb.collection('p1Parametrage').get(),
    ]);
    const meterById = new Map(meters.docs.map(d => [d.id, d.data()]));
    const stationCodes = new Set(stations.docs.map(d => String(d.get('code') ?? '').toUpperCase()));
    const p1Docs = new Map(p1.docs.map(d => [d.id, d.data()]));
    const actions: { label: string; run: () => Promise<unknown> }[] = [];
    const signalements: string[] = [];
    const has = (params: Record<string, unknown[]> | undefined, key: string) => (params?.[key] ?? []).some(v => !(v as { retireLe?: string }).retireLe);

    for (const siteSnap of sites.docs) {
        const site = siteSnap.data();
        const code = site.code ?? siteSnap.id;
        const svc = services.docs.map(d => d.data()).find(s => s.siteId === siteSnap.id && s.contractId === site.contractId && (s.p1Type === 'CHAUFFAGE' || !s.p1Type));
        const siteDoc = p1Docs.get(P1_DOC_ID.site(siteSnap.id)) as P1SiteDoc | undefined;
        const target = { scope: 'site' as const, id: siteSnap.id };

        const station = String(site.heatingWeatherStation || svc?.heatingWeatherStation || '').trim();
        if (station && station !== 'MANUAL' && !has(siteDoc?.params, 'stationMeteo')) {
            if (stationCodes.has(station.toUpperCase())) actions.push({ label: `${code} : station météo ${station}`, run: () => addP1Version(target, 'stationMeteo', { valeur: station, dateEffet: null, motif: MOTIF }, BY) });
            else signalements.push(`${code} : station « ${station} » inconnue, non reprise.`);
        }
        const type = String(svc?.heatingContractType ?? '').trim().toUpperCase();
        if (type && !has(siteDoc?.params, 'typeMarche')) {
            if ((TYPES_MARCHE as readonly string[]).includes(type)) actions.push({ label: `${code} : type de marché ${type}`, run: () => addP1Version(target, 'typeMarche', { valeur: type, dateEffet: null, motif: MOTIF }, BY) });
            else signalements.push(`${code} : type de contrat « ${type} » hors grille (MC, MCI, MT, MTI, CP, CPI, PFI, PF) : à saisir.`);
        }

        const nb = Number(svc?.referenceNb || site.contractualNB || 0);
        const dju = Number(svc?.referenceDju || site.heatingReferenceDju || 0);
        const meter = svc?.meterId ? meterById.get(svc.meterId) : undefined;
        const hasPoste = Object.values(siteDoc?.postes ?? {}).some(p => !p.retireLe);
        if (!hasPoste && (meter || nb || dju)) {
            actions.push({
                label: `${code} : poste « Chauffage »${meter ? ` (NC = + ${meter.code})` : ''}${nb ? `, cible ${nb} MWh` : ''}${dju ? `, DJU ${dju}` : ''}`,
                run: async () => {
                    const posteId = await addP1Poste(siteSnap.id, 'Chauffage', BY);
                    const poste = { scope: 'poste' as const, id: siteSnap.id, posteId };
                    if (meter) await addP1Version(poste, 'formuleNc', { valeur: [{ codeCompteur: meter.code, signe: 1 }], dateEffet: null, motif: MOTIF }, BY);
                    if (nb) {
                        await addP1Version(poste, 'cibleNb', { valeur: nb, dateEffet: null, motif: MOTIF }, BY);
                        await addP1Version(poste, 'cibleNbUnite', { valeur: 'MWh', dateEffet: null, motif: MOTIF }, BY);
                    }
                    if (dju) await addP1Version(poste, 'djuReference', { valeur: dju, dateEffet: null, motif: MOTIF }, BY);
                },
            });
        }
        if (svc?.meterId && meter) {
            const meterDoc = p1Docs.get(P1_DOC_ID.meter(svc.meterId)) as P1MeterDoc | undefined;
            const qe = Number(svc.conversionCoefficient);
            if (!has(meterDoc?.params, 'qe')) {
                if (qe > 0 && qe !== 1) actions.push({ label: `${meter.code} : QE ${qe}`, run: () => addP1Version({ scope: 'meter', id: svc.meterId }, 'qe', { valeur: qe, dateEffet: null, motif: MOTIF }, BY) });
                else if (qe === 1 && String(meter.unit ?? '').toLowerCase() !== 'mwh') signalements.push(`${meter.code} (${meter.unit ?? '?'}) : QE = 1 dans l'ancienne saisie (valeur par défaut ?) : à vérifier et saisir.`);
            }
        }
    }

    console.log(`${sites.size} site(s) ; ${actions.length} reprise(s) :`);
    for (const a of actions) console.log(`  ${a.label}`);
    console.log(`\n${signalements.length} point(s) à traiter à la main :`);
    for (const s of signalements) console.log(`  ${s}`);
    if (!APPLY) { console.log('\nSimulation : rien n\'a été écrit (ajoutez --apply).'); return; }
    for (const a of actions) await a.run();
    console.log(`\n${actions.length} reprise(s) écrite(s).`);
}

main().catch(e => { console.error(e); process.exit(1); });
