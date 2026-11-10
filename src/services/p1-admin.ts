import 'server-only';
import { controleSaison, idSaison, type SaisonChauffe } from '@/lib/p1/saisons';
import { randomUUID } from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import {
    P1_DOC_ID, addVersion, formuleAu, resteAFaire, retireVersion, validateParam, valeurAu,
    type NewVersion, type P1ContractDoc, type P1Formule, type P1MeterDoc, type P1Poste, type P1Scope, type P1SiteDoc, type P1Version, type ResteAFaire,
} from '@/lib/p1/stockage';
import {
    controleM0, prixExercice, prixRevise, validateFormule, type FormuleVersion, type PerimetreFormule, type PrixMois, type SerieValues,
} from '@/lib/p1/formules';
import { ENERGIES } from '@/lib/p1/stockage';
import type { Energie } from '@/lib/p1/parametrage';
import { toDay } from '@/lib/services/site-amounts';

/**
 * Paramétrage P1 côté serveur : lecture d'un site (avec ses compteurs et son contrat) et écritures par version.
 * Chaque écriture est une transaction : la version est contrôlée puis ajoutée (jamais d'écrasement) ; un retrait
 * marque la version sans la supprimer. La collection `p1Parametrage` n'est écrite que par le serveur.
 */

const coll = () => adminDb.collection('p1Parametrage');

export type P1SiteView = {
    site: { id: string; code: string; name: string; contractId?: string };
    siteDoc: P1SiteDoc | null;
    meters: { id: string; code: string; name: string; unit?: string; doc: P1MeterDoc | null }[];
    contract: { id: string; code: string } | null;
    contractDoc: P1ContractDoc | null;
    reste: ResteAFaire;
};

export async function getP1Site(siteId: string, date = toDay(new Date())!): Promise<P1SiteView> {
    const siteSnap = await adminDb.collection('sites').doc(siteId).get();
    if (!siteSnap.exists) throw new Error('Site introuvable.');
    const site = siteSnap.data()!;
    const [meterSnap, contractSnap] = await Promise.all([
        adminDb.collection('meters').where('siteId', '==', siteId).get(),
        site.contractId ? adminDb.collection('contracts').doc(site.contractId).get() : Promise.resolve(null),
    ]);
    const meters = meterSnap.docs.map(d => ({ id: d.id, code: String(d.get('code') ?? d.id), name: String(d.get('name') ?? ''), unit: d.get('unit') as string | undefined }));
    const docIds = [P1_DOC_ID.site(siteId), ...meters.map(m => P1_DOC_ID.meter(m.id)), ...(site.contractId ? [P1_DOC_ID.contract(site.contractId)] : [])];
    const docs = new Map((await adminDb.getAll(...docIds.map(id => coll().doc(id)))).filter(d => d.exists).map(d => [d.id, d.data()]));
    const siteDoc = (docs.get(P1_DOC_ID.site(siteId)) ?? null) as P1SiteDoc | null;
    const contractDoc = (site.contractId ? docs.get(P1_DOC_ID.contract(site.contractId)) ?? null : null) as P1ContractDoc | null;
    const meterViews = meters.map(m => ({ ...m, doc: (docs.get(P1_DOC_ID.meter(m.id)) ?? null) as P1MeterDoc | null }));
    // Formule de révision P1 retenue (la plus précise) et ses contrôles, dont le coefficient à M0 (RG-41).
    const energies = siteEnergies(meterViews.map(m => m.doc), date);
    const retenue = formuleAu(contractDoc, siteId, energies, 'chauffage', date);
    let formuleChauffage: ResteInput['formuleChauffage'] = null;
    if (retenue) {
        const { codes, series } = await loadSeries();
        const check = validateFormule(retenue.version, codes);
        const m0 = check.errors.length ? {} : controleM0(retenue.version, series);
        formuleChauffage = {
            nom: retenue.formule.nom,
            errors: [...check.errors, ...(m0.error ? [m0.error] : [])],
            warnings: [...check.warnings, ...(m0.warning ? [m0.warning] : [])],
        };
    }
    return {
        site: { id: siteId, code: String(site.code ?? siteId), name: String(site.name ?? ''), contractId: site.contractId || undefined },
        siteDoc, meters: meterViews,
        contract: contractSnap?.exists ? { id: contractSnap.id, code: String(contractSnap.get('contractNumber') ?? contractSnap.id) } : null,
        contractDoc,
        reste: resteAFaire({ site: siteDoc, meters: meterViews.map(m => ({ code: m.code, unit: m.unit, doc: m.doc })), contract: contractDoc, formuleChauffage, date }),
    };
}

type ResteInput = Parameters<typeof resteAFaire>[0];

/** Paramétrage P1 d'un compteur (écran du compteur). */
export type P1MeterView = { meter: { id: string; code: string; name: string; unit?: string; siteId: string; siteName: string }; doc: P1MeterDoc | null };

export async function getP1Meter(meterId: string): Promise<P1MeterView> {
    const m = await adminDb.collection('meters').doc(String(meterId)).get();
    if (!m.exists) throw new Error('Compteur introuvable.');
    const siteId = String(m.get('siteId') ?? '');
    const [doc, site] = await Promise.all([coll().doc(P1_DOC_ID.meter(m.id)).get(), siteId ? adminDb.collection('sites').doc(siteId).get() : null]);
    return {
        meter: { id: m.id, code: String(m.get('code') ?? m.id), name: String(m.get('name') ?? ''), unit: m.get('unit') ?? undefined, siteId, siteName: String(site?.get('name') ?? '') },
        doc: doc.exists ? doc.data() as P1MeterDoc : null,
    };
}

/** Paramétrage P1 d'un contrat (écran du contrat) : paramètres, barèmes, formules ; ses sites (périmètres, aperçu). */
export type P1ContractView = { contract: { id: string; code: string }; doc: P1ContractDoc | null; sites: { id: string; code: string; name: string }[] };

export async function getP1Contract(contractId: string): Promise<P1ContractView> {
    const c = await adminDb.collection('contracts').doc(String(contractId)).get();
    if (!c.exists) throw new Error('Contrat introuvable.');
    const siteIds: string[] = Array.isArray(c.get('siteIds')) ? c.get('siteIds') : [];
    const [doc, sites] = await Promise.all([
        coll().doc(P1_DOC_ID.contract(c.id)).get(),
        siteIds.length ? adminDb.getAll(...siteIds.map(id => adminDb.collection('sites').doc(id))) : Promise.resolve([]),
    ]);
    return {
        contract: { id: c.id, code: String(c.get('contractNumber') ?? c.id) },
        doc: doc.exists ? doc.data() as P1ContractDoc : null,
        sites: sites.filter(s => s.exists).map(s => ({ id: s.id, code: String(s.get('code') ?? s.id), name: String(s.get('name') ?? '') })),
    };
}

/** Réel P1 du moteur d'un site (import « Réel P1 du moteur »), du plus récent au plus ancien. */
export type P1ReelLigne = { id: string; mois: string; usage: string | null; montantHt: number; importedAt?: string; fileName?: string };

export async function getP1Reel(siteId: string): Promise<P1ReelLigne[]> {
    const snap = await adminDb.collection('p1Reel').where('siteId', '==', String(siteId)).get();
    return snap.docs.map(d => ({
        id: d.id, mois: String(d.get('mois')), usage: d.get('usage') ?? null, montantHt: Number(d.get('montantHt')),
        importedAt: d.get('importedAt') ?? undefined, fileName: d.get('fileName') ?? undefined,
    })).sort((a, b) => b.mois.localeCompare(a.mois) || String(a.usage).localeCompare(String(b.usage)));
}

/** Énergies d'un site : celles de ses compteurs (paramétrage P1) à une date. */
function siteEnergies(meterDocs: (P1MeterDoc | null)[], date: string): Energie[] {
    return [...new Set(meterDocs.map(d => valeurAu<Energie>(d?.params, 'energie', date)).filter((e): e is Energie => !!e))];
}

/** Indices connus (codes) et leurs valeurs mensuelles, par code. */
export async function loadSeries(): Promise<{ codes: string[]; series: SerieValues }> {
    const [indices, values] = await Promise.all([adminDb.collection('indices').get(), adminDb.collection('indexValues').get()]);
    const codeOf = new Map(indices.docs.map(d => [d.id, String(d.get('code') ?? '').toUpperCase()]));
    const series: SerieValues = new Map();
    for (const v of values.docs) {
        const code = codeOf.get(String(v.get('indexId')));
        if (!code) continue;
        if (!series.has(code)) series.set(code, []);
        series.get(code)!.push({ period: String(v.get('period')), value: Number(v.get('value')) });
    }
    return { codes: [...codeOf.values()].filter(Boolean), series };
}

// --- Formules de révision P1 (contrat) ---

const contractRef = (contractId: string) => coll().doc(P1_DOC_ID.contract(contractId));

async function contractDocInit(contractId: string): Promise<P1ContractDoc> {
    const c = await adminDb.collection('contracts').doc(contractId).get();
    if (!c.exists) throw new Error('Contrat introuvable.');
    return { kind: 'contract', contractId, codeContrat: String(c.get('contractNumber') ?? contractId), params: {}, formules: {} };
}

function checkPerimetre(p: PerimetreFormule): void {
    if (p.type === 'energies' && (!p.energies.length || p.energies.some(e => !ENERGIES.includes(e)))) throw new Error(`Périmètre : énergies parmi ${ENERGIES.join(', ')}.`);
    if (p.type === 'sites' && !p.siteIds.length) throw new Error('Périmètre : au moins un site.');
}

/** Crée une formule (sans version) sur un contrat. */
export async function addP1Formule(contractId: string, f: { nom: string; usage: 'chauffage' | 'ecs'; perimetre: PerimetreFormule }, by: string): Promise<string> {
    if (!f.nom?.trim()) throw new Error('Nom de la formule obligatoire.');
    if (!['chauffage', 'ecs'].includes(f.usage)) throw new Error('Usage : chauffage ou ECS.');
    checkPerimetre(f.perimetre);
    const init = await contractDocInit(contractId);
    return adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(contractRef(contractId));
        const doc = (snap.exists ? snap.data() : init) as P1ContractDoc;
        doc.formules = doc.formules ?? {};
        if (Object.values(doc.formules).some(x => !x.retireLe && x.nom.toLowerCase() === f.nom.trim().toLowerCase())) throw new Error(`Une formule « ${f.nom.trim()} » existe déjà sur ce contrat.`);
        const id = randomUUID();
        doc.formules[id] = { id, nom: f.nom.trim(), usage: f.usage, perimetre: f.perimetre, versions: [], saisiLe: new Date().toISOString(), saisiPar: by } as P1Formule;
        tx.set(contractRef(contractId), doc);
        return id;
    });
}

/** Ajoute une version datée à une formule (contrôlée : une version fausse ne s'enregistre pas). */
export async function addP1FormuleVersion(contractId: string, formuleId: string, version: FormuleVersion, meta: { dateEffet: string | null; motif: string; document?: string | null }, by: string): Promise<void> {
    const { codes } = await loadSeries();
    const check = validateFormule(version, codes);
    if (check.errors.length) throw new Error(`Formule refusée : ${check.errors.join(' ')}`);
    await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(contractRef(contractId));
        // Un seul exemplaire du document : snap.data() en rend un nouveau à chaque appel.
        const doc = snap.data() as P1ContractDoc | undefined;
        const f = doc?.formules?.[formuleId];
        if (!doc || !f || f.retireLe) throw new Error('Formule introuvable.');
        const next = addVersion(f.versions as P1Version<unknown>[], { valeur: version, ...meta }, by, new Date().toISOString(), randomUUID());
        if ('error' in next) throw new Error(next.error);
        f.versions = next as P1Version<FormuleVersion>[];
        tx.set(contractRef(contractId), doc);
    });
}

export async function retireP1FormuleVersion(contractId: string, formuleId: string, versionId: string, motif: string, by: string): Promise<void> {
    await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(contractRef(contractId));
        const doc = snap.data() as P1ContractDoc | undefined;
        const f = doc?.formules?.[formuleId];
        if (!doc || !f) throw new Error('Formule introuvable.');
        const next = retireVersion(f.versions as P1Version<unknown>[], versionId, motif, by, new Date().toISOString());
        if ('error' in next) throw new Error(next.error);
        f.versions = next as P1Version<FormuleVersion>[];
        tx.set(contractRef(contractId), doc);
    });
}

export async function retireP1Formule(contractId: string, formuleId: string, motif: string, by: string): Promise<void> {
    if (!motif?.trim()) throw new Error('Motif du retrait obligatoire.');
    await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(contractRef(contractId));
        const doc = snap.data() as P1ContractDoc | undefined;
        const f = doc?.formules?.[formuleId];
        if (!doc || !f || f.retireLe) throw new Error('Formule introuvable.');
        Object.assign(f, { retireLe: new Date().toISOString(), retirePar: by, motifRetrait: motif.trim() });
        tx.set(contractRef(contractId), doc);
    });
}

export type PrixP1Preview = {
    formule: string | null;
    periodicite: string | null;
    mois: { mois: string; prixBase: number | null; mensuel: PrixMois; retenu: PrixMois }[];
};

/** Prix révisés d'un site sur 12 mois à partir de `debut` (AAAA-MM) : prix mensuels et prix retenu selon la périodicité. */
export async function previewPrixP1(siteId: string, usage: 'chauffage' | 'ecs', debut: string): Promise<PrixP1Preview> {
    const view = await getP1Site(siteId, `${debut}-01`);
    const mois = Array.from({ length: 12 }, (_, i) => { const t = new Date(Date.UTC(+debut.slice(0, 4), +debut.slice(5, 7) - 1 + i, 1)); return t.toISOString().slice(0, 7); });
    const { series } = await loadSeries();
    const energies = siteEnergies(view.meters.map(m => m.doc), `${debut}-01`);
    const prixKey = usage === 'chauffage' ? 'prixBase' : 'prixBaseEcs';
    const mensuels: Record<string, PrixMois> = {};
    let periodicite: FormuleVersion['periodicite'] | null = null;
    let nom: string | null = null;
    const bases: Record<string, number | null> = {};
    for (const m of mois) {
        const jour = `${m}-01`;
        const f = formuleAu(view.contractDoc, siteId, energies, usage, jour);
        bases[m] = valeurAu<number>(view.siteDoc?.params, prixKey, jour);
        if (!f) { mensuels[m] = { causes: [`aucune formule de révision ${usage === 'chauffage' ? 'chauffage' : 'ECS'} en vigueur`] }; continue; }
        nom = nom ?? f.formule.nom;
        periodicite = periodicite ?? f.version.periodicite;
        mensuels[m] = prixRevise(f.version, bases[m], m, series);
    }
    let dju: Record<string, number> = {};
    const station = valeurAu<string>(view.siteDoc?.params, 'stationMeteo', `${debut}-01`);
    if (periodicite === 'annuel_dju' && station) {
        const snap = await adminDb.collection('djuMonthly').where('stationCode', '==', station).get();
        dju = Object.fromEntries(snap.docs.map(d => [String(d.get('period')), Number(d.get('value'))]));
    }
    const retenus = periodicite ? prixExercice(mensuels, mois, periodicite, dju) : mensuels;
    return { formule: nom, periodicite, mois: mois.map(m => ({ mois: m, prixBase: bases[m], mensuel: mensuels[m], retenu: retenus[m] })) };
}

export type P1Target = { scope: P1Scope; id: string; posteId?: string };

/** Document à écrire pour une cible (site pour un poste) et son squelette s'il n'existe pas encore. */
async function skeleton(target: P1Target): Promise<{ ref: FirebaseFirestore.DocumentReference; init: P1SiteDoc | P1MeterDoc | P1ContractDoc; siteId?: string }> {
    if (target.scope === 'site' || target.scope === 'poste') {
        const s = await adminDb.collection('sites').doc(target.id).get();
        if (!s.exists) throw new Error('Site introuvable.');
        return { ref: coll().doc(P1_DOC_ID.site(target.id)), init: { kind: 'site', siteId: target.id, codeSite: String(s.get('code') ?? target.id), params: {}, postes: {} }, siteId: target.id };
    }
    if (target.scope === 'meter') {
        const m = await adminDb.collection('meters').doc(target.id).get();
        if (!m.exists) throw new Error('Compteur introuvable.');
        return {
            ref: coll().doc(P1_DOC_ID.meter(target.id)),
            init: { kind: 'meter', meterId: target.id, codeCompteur: String(m.get('code') ?? target.id), siteId: String(m.get('siteId') ?? ''), params: {} },
        };
    }
    const c = await adminDb.collection('contracts').doc(target.id).get();
    if (!c.exists) throw new Error('Contrat introuvable.');
    return { ref: coll().doc(P1_DOC_ID.contract(target.id)), init: { kind: 'contract', contractId: target.id, codeContrat: String(c.get('contractNumber') ?? target.id), params: {} } };
}

async function validationContext(siteId?: string) {
    const [meters, stations] = await Promise.all([
        siteId ? adminDb.collection('meters').where('siteId', '==', siteId).get() : Promise.resolve(null),
        adminDb.collection('weatherStations').select('code').get(),
    ]);
    return {
        siteMeterCodes: meters?.docs.map(d => String(d.get('code') ?? '')).filter(Boolean),
        stationCodes: stations.docs.map(d => String(d.get('code') ?? '')).filter(Boolean),
    };
}

type Doc = P1SiteDoc | P1MeterDoc | P1ContractDoc;
const paramsOf = (doc: Doc, target: P1Target): Record<string, P1Version<unknown>[]> => {
    if (target.scope !== 'poste') return doc.params;
    const poste = (doc as P1SiteDoc).postes?.[target.posteId ?? ''];
    if (!poste || poste.retireLe) throw new Error('Poste de consommation introuvable.');
    return poste.params;
};

/** Ajoute une version à un paramètre (contrôlée ; jamais d'écrasement). */
export async function addP1Version(target: P1Target, key: string, v: NewVersion, by: string): Promise<P1Version<unknown>> {
    const checked = validateParam(target.scope, key, v.valeur, await validationContext(target.scope === 'poste' || target.scope === 'site' ? target.id : undefined));
    if ('error' in checked) throw new Error(checked.error);
    const { ref, init } = await skeleton(target);
    return adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const doc = (snap.exists ? snap.data() : init) as Doc;
        const params = paramsOf(doc, target);
        const id = randomUUID();
        const next = addVersion(params[key], { ...v, valeur: checked.value }, by, new Date().toISOString(), id);
        if ('error' in next) throw new Error(next.error);
        params[key] = next;
        tx.set(ref, doc);
        return next.find(x => x.id === id)!;
    });
}

/** Retire une version (elle reste dans l'historique, avec la date, l'auteur et le motif du retrait). */
export async function retireP1Version(target: P1Target, key: string, versionId: string, motif: string, by: string): Promise<void> {
    const { ref } = await skeleton(target);
    await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('Paramétrage introuvable.');
        const doc = snap.data() as Doc;
        const params = paramsOf(doc, target);
        const next = retireVersion(params[key], versionId, motif, by, new Date().toISOString());
        if ('error' in next) throw new Error(next.error);
        params[key] = next;
        tx.set(ref, doc);
    });
}

/** Crée un poste de consommation sur un site (désignation unique parmi les postes actifs). */
export async function addP1Poste(siteId: string, designation: string, by: string): Promise<string> {
    const name = designation.trim();
    if (!name) throw new Error('Désignation du poste obligatoire (ex. « Chaufferie gaz »).');
    const { ref, init } = await skeleton({ scope: 'site', id: siteId });
    return adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const doc = (snap.exists ? snap.data() : init) as P1SiteDoc;
        doc.postes = doc.postes ?? {};
        if (Object.values(doc.postes).some(p => !p.retireLe && p.designation.toLowerCase() === name.toLowerCase())) throw new Error(`Un poste « ${name} » existe déjà sur ce site.`);
        const id = randomUUID();
        doc.postes[id] = { id, designation: name, params: {}, saisiLe: new Date().toISOString(), saisiPar: by } as P1Poste;
        tx.set(ref, doc);
        return id;
    });
}

export async function retireP1Poste(siteId: string, posteId: string, motif: string, by: string): Promise<void> {
    if (!motif?.trim()) throw new Error('Motif du retrait obligatoire.');
    const ref = coll().doc(P1_DOC_ID.site(siteId));
    await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const doc = snap.data() as P1SiteDoc | undefined;
        const poste = doc?.postes?.[posteId];
        if (!doc || !poste || poste.retireLe) throw new Error('Poste de consommation introuvable.');
        Object.assign(poste, { retireLe: new Date().toISOString(), retirePar: by, motifRetrait: motif.trim() });
        tx.set(ref, doc);
    });
}

// --- Saisons de chauffe (allumage, arrêt) ---

/** Saisons de chauffe d'un site, de la plus récente à la plus ancienne. */
export async function listSaisonsChauffe(siteId: string): Promise<SaisonChauffe[]> {
    const snap = await adminDb.collection('saisonsChauffe').where('siteId', '==', siteId).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as SaisonChauffe).sort((a, b) => b.saison.localeCompare(a.saison));
}

/** Enregistre (ou corrige) les dates d'une saison ; une saison déjà facturée au-delà de ses dates n'est pas contrôlée ici. */
export async function setSaisonChauffe(siteId: string, s: { saison: string; allumage: string; arret: string | null }, by: string): Promise<void> {
    const erreur = controleSaison(s);
    if (erreur) throw new Error(erreur);
    const site = await adminDb.collection('sites').doc(siteId).get();
    if (!site.exists) throw new Error('Site introuvable.');
    await adminDb.collection('saisonsChauffe').doc(idSaison(siteId, s.saison)).set({ siteId, saison: s.saison, allumage: s.allumage, arret: s.arret, saisiPar: by, saisiLe: new Date().toISOString() });
}

export async function deleteSaisonChauffe(siteId: string, saison: string): Promise<void> {
    await adminDb.collection('saisonsChauffe').doc(idSaison(siteId, saison)).delete();
}
