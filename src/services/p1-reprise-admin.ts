import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { TYPES_MARCHE } from '@/lib/p1/parametrage';
import { P1_DOC_ID, type P1MeterDoc, type P1SiteDoc } from '@/lib/p1/stockage';
import { addP1Poste, addP1Version } from '@/services/p1-admin';

export type RepriseP1 = { actions: { label: string; run: () => Promise<unknown> }[]; signalements: string[]; sites: number };

/**
 * Reprise des saisies P1 historiques (fiche site, prestation P1 chauffage, assistants de création de contrat) dans le
 * paramétrage P1 daté : chaque valeur devient une version d'origine. Un paramètre qui a déjà une version n'est pas
 * touché (rejouable). `siteIds` : limiter à ces sites (validation d'un contrat) ; absent : tous.
 */
export async function planRepriseP1(siteIds?: string[], by = 'reprise', motif = 'reprise des données existantes'): Promise<RepriseP1> {
    const BY = by;
    const MOTIF = motif;
    const [sites, services, meters, stations, p1, contracts] = await Promise.all([
        siteIds ? (siteIds.length ? adminDb.getAll(...siteIds.map(id => adminDb.collection('sites').doc(id))).then(d => ({ docs: d.filter(x => x.exists), size: d.filter(x => x.exists).length })) : Promise.resolve({ docs: [], size: 0 })) : adminDb.collection('sites').get(),
        adminDb.collection('services').where('type', '==', 'P1').get(),
        adminDb.collection('meters').get(),
        adminDb.collection('weatherStations').get(),
        adminDb.collection('p1Parametrage').get(),
        adminDb.collection('contracts').get(),
    ]);
    const meterById = new Map(meters.docs.map(d => [d.id, d.data()]));
    const contrats = new Map(contracts.docs.map(d => [d.id, d.data()]));
    const stationCodes = new Set(stations.docs.map(d => String(d.get('code') ?? '').toUpperCase()));
    const p1Docs = new Map(p1.docs.map(d => [d.id, d.data()]));
    const actions: { label: string; run: () => Promise<unknown> }[] = [];
    const signalements: string[] = [];
    const has = (params: Record<string, unknown[]> | undefined, key: string) => (params?.[key] ?? []).some(v => !(v as { retireLe?: string }).retireLe);

    for (const siteSnap of sites.docs) {
        const site = siteSnap.data()!;
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

        // Assistants de création depuis un PDF : DJU et NB saisis sur le contrat (détail des activités) ; repris
        // seulement pour un contrat mono-site (sinon, impossible de savoir à quel site ils s'appliquent).
        const contrat = site.contractId ? contrats.get(String(site.contractId)) : undefined;
        const details = contrat && (contrat.siteIds ?? []).length === 1 ? (contrat.activitiesDetails ?? []).find((d: { contractualNB?: number; contractualDJU?: number }) => d.contractualNB || d.contractualDJU) : undefined;
        const nb = Number(svc?.referenceNb || site.contractualNB || details?.contractualNB || 0);
        const dju = Number(svc?.referenceDju || site.heatingReferenceDju || details?.contractualDJU || 0);
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

    return { actions, signalements, sites: sites.size };
}

/** Reprise P1 des sites d'un contrat (à sa validation) : versions écrites, points à traiter à la main. */
export async function repriseP1Contrat(contractId: string, by: string): Promise<{ reprises: string[]; signalements: string[] }> {
    const c = await adminDb.collection('contracts').doc(String(contractId)).get();
    if (!c.exists) throw new Error('Contrat introuvable.');
    const siteIds: string[] = Array.isArray(c.get('siteIds')) ? c.get('siteIds') : [];
    const plan = await planRepriseP1(siteIds, by, `création du contrat ${c.get('contractNumber') ?? c.id}`);
    for (const a of plan.actions) await a.run();
    return { reprises: plan.actions.map(a => a.label), signalements: plan.signalements };
}
