import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { activiteEnergie } from '@/lib/budgets/budget';
import { SEUILS_DEFAUT, analyserDerive, controleSeuils, tauxBudget, unAnAvant, type AnalyseDerive, type SeuilsDerive } from '@/lib/energie/derives';
import { douzeMois, margeP1, type MargeP1 } from '@/lib/energie/marge';
import { toDay } from '@/lib/services/site-amounts';
import { achatsDuSite, codesP1, sitesAvecAchats, ventesP1 } from './energie-marge-admin';

/**
 * Dérives P1 : marge P1 par site sur douze mois, comparée à l'an dernier et au budget du contrat (collection
 * `derivesP1` : seuils réglés par un administrateur, et sites en dérive au dernier passage des rappels).
 */

const COL = 'derivesP1';

export async function lireSeuils(): Promise<SeuilsDerive> {
    const d = await adminDb.collection(COL).doc('seuils').get();
    return d.exists ? { ...SEUILS_DEFAUT, ...(d.data() as Partial<SeuilsDerive>) } : SEUILS_DEFAUT;
}
export async function enregistrerSeuils(s: Partial<SeuilsDerive>, par: string): Promise<SeuilsDerive> {
    const propres = controleSeuils(s);
    await adminDb.collection(COL).doc('seuils').set({ ...propres, majLe: new Date().toISOString(), majPar: par });
    return propres;
}

export type DeriveSite = {
    siteId: string; siteNom: string; client: string; contractId: string | null; contractNumber: string;
    actuel: MargeP1; precedent: MargeP1; analyse: AnalyseDerive;
};
export type DerivesP1 = { de: string; a: string; seuils: SeuilsDerive; sites: DeriveSite[] };

export async function derivesP1(visibles: Set<string> | null, aujourdhui = toDay(new Date())!): Promise<DerivesP1> {
    const { de, a } = douzeMois(aujourdhui);
    const [seuils, sites, p1, activites] = await Promise.all([lireSeuils(), sitesAvecAchats(visibles), codesP1(), adminDb.collection('activities').get()]);
    const activite = new Map(activites.docs.map(d => [d.id, { code: String(d.get('code') ?? ''), type: d.get('type') as string | undefined }]));
    const annee = Number(aujourdhui.slice(0, 4));
    const budgets = new Map<string, number | null>();
    const out: DeriveSite[] = [];
    for (let i = 0; i < sites.length; i += 8) {
        out.push(...(await Promise.all(sites.slice(i, i + 8).map(async ({ siteId, pdls }) => {
            const site = await adminDb.collection('sites').doc(siteId).get();
            if (!site.exists) return null;
            const contractId = (site.get('contractId') as string | undefined) || null;
            const contrat = contractId ? await adminDb.collection('contracts').doc(contractId).get() : null;
            const [ventes, achats] = await Promise.all([contractId ? ventesP1(siteId, contractId, p1) : Promise.resolve([]), achatsDuSite(siteId, pdls)]);
            const actuel = margeP1(ventes, achats, de, a);
            if (!actuel.mois.length) return null;
            const precedent = margeP1(ventes, achats, unAnAvant(de), unAnAvant(a));
            // Budget de l'année : taux de marge de la ligne P1 (énergie) du contrat.
            if (contractId && !budgets.has(contractId)) {
                const b = await adminDb.collection('budgets').doc(`${contractId}_${annee}`).get();
                const codeP1 = activiteEnergie(((contrat?.get('activityIds') ?? []) as string[]).flatMap(id => { const x = activite.get(id); return x ? [{ code: x.code, ...(x.type && { type: x.type }) }] : []; }));
                const ligne = ((b.get('lignes') ?? []) as { activite: string; ca: number; energie: number }[]).find(l => l.activite === codeP1);
                budgets.set(contractId, ligne ? tauxBudget(ligne.ca, ligne.energie) : null);
            }
            return {
                siteId, siteNom: String(site.get('name') ?? ''), client: String(contrat?.get('clientName') ?? site.get('clientName') ?? ''), contractId, contractNumber: String(contrat?.get('contractNumber') ?? ''),
                actuel, precedent, analyse: analyserDerive(actuel, precedent, contractId ? budgets.get(contractId) ?? null : null, seuils),
            } as DeriveSite;
        }))).filter((x): x is DeriveSite => !!x));
    }
    const rang = (x: DeriveSite) => (x.analyse.gravite === 'forte' ? 0 : x.analyse.gravite === 'attention' ? 1 : 2);
    out.sort((x, y) => rang(x) - rang(y) || (x.analyse.taux ?? Infinity) - (y.analyse.taux ?? Infinity) || x.client.localeCompare(y.client, 'fr'));
    return { de, a, seuils, sites: out };
}

/** Sites en dérive au dernier passage des rappels (pour ne signaler que les nouveaux). */
export async function etatPrecedent(): Promise<string[]> {
    return ((await adminDb.collection(COL).doc('etat').get()).get('sites') ?? []) as string[];
}
export async function memoriserEtat(sites: string[], le: string): Promise<void> {
    await adminDb.collection(COL).doc('etat').set({ sites, le });
}
