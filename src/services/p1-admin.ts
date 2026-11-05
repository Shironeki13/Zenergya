import 'server-only';
import { randomUUID } from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import {
    P1_DOC_ID, addVersion, resteAFaire, retireVersion, validateParam,
    type NewVersion, type P1ContractDoc, type P1MeterDoc, type P1Poste, type P1Scope, type P1SiteDoc, type P1Version, type ResteAFaire,
} from '@/lib/p1/stockage';
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
    const [meterSnap, contractSnap, servicesSnap] = await Promise.all([
        adminDb.collection('meters').where('siteId', '==', siteId).get(),
        site.contractId ? adminDb.collection('contracts').doc(site.contractId).get() : Promise.resolve(null),
        adminDb.collection('services').where('siteId', '==', siteId).get(),
    ]);
    const meters = meterSnap.docs.map(d => ({ id: d.id, code: String(d.get('code') ?? d.id), name: String(d.get('name') ?? ''), unit: d.get('unit') as string | undefined }));
    const docIds = [P1_DOC_ID.site(siteId), ...meters.map(m => P1_DOC_ID.meter(m.id)), ...(site.contractId ? [P1_DOC_ID.contract(site.contractId)] : [])];
    const docs = new Map((await adminDb.getAll(...docIds.map(id => coll().doc(id)))).filter(d => d.exists).map(d => [d.id, d.data()]));
    const siteDoc = (docs.get(P1_DOC_ID.site(siteId)) ?? null) as P1SiteDoc | null;
    const contractDoc = (site.contractId ? docs.get(P1_DOC_ID.contract(site.contractId)) ?? null : null) as P1ContractDoc | null;
    const meterViews = meters.map(m => ({ ...m, doc: (docs.get(P1_DOC_ID.meter(m.id)) ?? null) as P1MeterDoc | null }));
    const hasP1Revision = servicesSnap.docs.some(d => d.get('type') === 'P1' && d.get('contractId') === site.contractId && d.get('isActive') !== false && !!d.get('revisionRuleId'));
    return {
        site: { id: siteId, code: String(site.code ?? siteId), name: String(site.name ?? ''), contractId: site.contractId || undefined },
        siteDoc, meters: meterViews,
        contract: contractSnap?.exists ? { id: contractSnap.id, code: String(contractSnap.get('contractNumber') ?? contractSnap.id) } : null,
        contractDoc,
        reste: resteAFaire({ site: siteDoc, meters: meterViews.map(m => ({ code: m.code, unit: m.unit, doc: m.doc })), contract: contractDoc, hasP1Revision, date }),
    };
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
