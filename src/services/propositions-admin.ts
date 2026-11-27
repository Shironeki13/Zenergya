import 'server-only';
import { randomUUID } from 'crypto';
import { adminBucket, adminDb } from '@/lib/firebase-admin';
import type { GardePerimetre } from '@/lib/auth/perimetre-server';
import type { SessionUser } from '@/lib/auth/server';
import { brouillonVide } from '@/lib/contracts/assistant';
import { PROMPT_MARCHE_PRIVE, PROMPT_MARCHE_PUBLIC } from '@/lib/contracts/prompts-extraction';
import { brouillonProposition, controlesProposition, resumeProposition, type Proposition, type RefsProposition } from '@/lib/contracts/propositions';
import type { Client } from '@/lib/types';
import { lireContrat } from '@/ai/lecture-contrat';

/**
 * Propositions de création (collection `propositions`, serveur seulement) : dépôt du document, lecture par l'IA,
 * proposition à revoir. Rien n'est créé ici : la création passe par l'assistant, au nom de celui qui accepte.
 */

const COL = 'propositions';
const TYPES = ['application/pdf'];
const TAILLE_MAX = 20 * 1024 * 1024;

const jour = (v: unknown) => {
    if (v && typeof v === 'object' && 'toDate' in v) return (v as { toDate: () => Date }).toDate().toISOString().slice(0, 10);
    return typeof v === 'string' ? v.slice(0, 10) : '';
};

async function refs(): Promise<RefsProposition> {
    const [clients, sites, contrats, activities, typologies, schedules, terms] = await Promise.all(['clients', 'sites', 'contracts', 'activities', 'typologies', 'schedules', 'terms'].map(c => adminDb.collection(c).get()));
    return {
        clients: clients.docs.map(d => ({ id: d.id, ...d.data() }) as Client),
        sites: sites.docs.map(d => ({ id: d.id, name: String(d.get('name') ?? ''), address: d.get('address'), postalCode: d.get('postalCode'), clientId: d.get('clientId'), contractId: d.get('contractId') || null })),
        contrats: contrats.docs.map(d => ({ id: d.id, contractNumber: d.get('contractNumber'), label: d.get('label'), clientId: d.get('clientId'), status: d.get('status'), startDate: jour(d.get('startDate')), endDate: jour(d.get('endDate')) })),
        activities: activities.docs.map(d => ({ id: d.id, code: String(d.get('code') ?? ''), label: String(d.get('label') ?? ''), vatRateId: d.get('vatRateId') })),
        typologies: typologies.docs.map(d => ({ id: d.id, name: String(d.get('name') ?? '') })),
        schedules: schedules.docs.map(d => ({ id: d.id, name: String(d.get('name') ?? '') })),
        terms: terms.docs.map(d => ({ id: d.id, name: String(d.get('name') ?? '') })),
    };
}

/** Dépôt d'un document : enregistré, puis lu. Renvoie la proposition (à revoir, ou en échec de lecture). */
export async function deposerProposition(p: { nom: string; contentType: string; contenu: Buffer; type: 'pdf-prive' | 'pdf-public'; origine?: string }, user: SessionUser): Promise<Proposition> {
    if (!TYPES.includes(p.contentType)) throw new Error('Document PDF uniquement.');
    if (!p.contenu.length || p.contenu.length > TAILLE_MAX) throw new Error('Document vide ou trop volumineux (20 Mo au plus).');
    const ref = adminDb.collection(COL).doc();
    const nom = p.nom.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120) || 'document.pdf';
    const chemin = `propositions/${ref.id}/${nom}`;
    const jeton = randomUUID();
    const bucket = adminBucket();
    await bucket.file(chemin).save(p.contenu, { contentType: p.contentType, metadata: { contentDisposition: `inline; filename*=utf-8''${encodeURIComponent(p.nom)}`, metadata: { firebaseStorageDownloadTokens: jeton, deposePar: user.email } } });
    // Émulateur : servi par la même origine que l'application (comme les pièces des contrats).
    const base = process.env.FIREBASE_STORAGE_EMULATOR_HOST ? (p.origine ?? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}`) : 'https://firebasestorage.googleapis.com';
    const proposition: Proposition = {
        id: ref.id, statut: 'en_lecture', type: p.type, document: { name: p.nom, url: `${base}/v0/b/${bucket.name}/o/${encodeURIComponent(chemin)}?alt=media&token=${jeton}` },
        deposePar: user.email, deposeLe: new Date().toISOString(),
    };
    const { id: _id, ...doc } = proposition;
    await ref.set({ ...doc, chemin });
    return lireProposition(ref.id, p.contenu);
}

/** Lecture (ou relecture après échec) : la proposition passe « à revoir », ou « lecture impossible » avec le motif. */
export async function lireProposition(id: string, contenu?: Buffer): Promise<Proposition> {
    const ref = adminDb.collection(COL).doc(id);
    const d = await ref.get();
    if (!d.exists) throw new Error('Proposition introuvable.');
    const p = { id, ...d.data() } as Proposition & { chemin: string };
    if (p.statut === 'acceptee' || p.statut === 'refusee') throw new Error('Proposition déjà traitée.');
    await ref.update({ statut: 'en_lecture', erreur: null });
    try {
        const donnees = contenu ?? (await adminBucket().file(p.chemin).download())[0];
        const r = await refs();
        const lecture = await lireContrat({
            dataUri: `data:application/pdf;base64,${donnees.toString('base64')}`, contentType: 'application/pdf', nomFichier: p.document.name,
            consignes: p.type === 'pdf-public' ? PROMPT_MARCHE_PUBLIC : PROMPT_MARCHE_PRIVE,
            refs: { activities: r.activities.map(a => ({ id: a.id, code: a.code, label: a.label ?? '' })), typologies: r.typologies, terms: r.terms, schedules: r.schedules },
        });
        const base = { ...brouillonVide(), source: p.type, contrat: { ...brouillonVide().contrat, marketType: (p.type === 'pdf-public' ? 'Marché Public' : 'Marché Privé') as 'Marché Public' | 'Marché Privé' } };
        const { brouillon, remarques } = brouillonProposition(base, lecture.sortie, r);
        const maj = {
            statut: 'a_revoir', brouillon: { ...brouillon, document: p.document }, preuves: lecture.sortie.preuves ?? [], alertes: controlesProposition(brouillon, r, remarques),
            resume: resumeProposition(brouillon, r), lecture: { modele: lecture.modele, le: new Date().toISOString(), ...(lecture.simulee && { simulee: true }), dureeMs: lecture.dureeMs }, erreur: null,
        };
        await ref.update(JSON.parse(JSON.stringify(maj)));
    } catch (e) {
        await ref.update({ statut: 'echec', erreur: e instanceof Error ? e.message : 'Lecture impossible.' });
    }
    return obtenir(id);
}

async function obtenir(id: string): Promise<Proposition> {
    const d = await adminDb.collection(COL).doc(id).get();
    const { chemin: _c, ...x } = d.data() ?? {};
    return { id, ...x } as Proposition;
}

/**
 * Une proposition est visible par celui qui l'a déposée, par la contrathèque et les administrateurs, et par qui voit
 * le client reconnu.
 */
async function visible(p: Proposition, user: SessionUser, garde: GardePerimetre): Promise<boolean> {
    if (user.isAdmin || user.isContratheque || garde.tout || p.deposePar === user.email) return true;
    const clientId = p.brouillon?.client.mode === 'existant' ? p.brouillon.client.clientId : '';
    return !!clientId && await garde.exiger('client', clientId).then(() => true, () => false);
}

export async function listerPropositions(user: SessionUser, garde: GardePerimetre): Promise<Proposition[]> {
    const docs = (await adminDb.collection(COL).orderBy('deposeLe', 'desc').limit(300).get()).docs.map(d => { const { chemin: _c, brouillon: _b, preuves: _p, ...x } = d.data(); return { id: d.id, ...x } as Proposition; });
    const out: Proposition[] = [];
    for (const p of docs) {
        const complet = p.statut === 'a_revoir' && !(user.isAdmin || user.isContratheque || garde.tout || p.deposePar === user.email) ? await obtenir(p.id) : p;
        if (await visible(complet, user, garde)) out.push(p);
    }
    return out;
}

export async function propositionVisible(id: string, user: SessionUser, garde: GardePerimetre): Promise<Proposition> {
    const p = await obtenir(id);
    if (!p.deposeLe) throw new Error('Proposition introuvable.');
    if (!(await visible(p, user, garde))) throw new Error('Proposition hors de votre périmètre.');
    return p;
}

/** Refus motivé (contrathèque, administrateurs) : rien n'est créé, la trace reste. */
export async function refuserProposition(id: string, motif: string, user: SessionUser): Promise<void> {
    if (!user.isAdmin && !user.isContratheque) throw new Error('Réservé à la contrathèque et aux administrateurs.');
    if (!motif.trim()) throw new Error('Motif du refus requis.');
    const ref = adminDb.collection(COL).doc(id);
    await adminDb.runTransaction(async tx => {
        const d = await tx.get(ref);
        if (!d.exists) throw new Error('Proposition introuvable.');
        if (d.get('statut') === 'acceptee' || d.get('statut') === 'refusee') throw new Error('Proposition déjà traitée.');
        tx.update(ref, { statut: 'refusee', decision: { par: user.email, le: new Date().toISOString(), motif: motif.trim() } });
    });
}

/** Contrôle avant création depuis une proposition : à revoir, et par la contrathèque ou un administrateur. */
export async function exigerAcceptable(id: string, user: SessionUser): Promise<Proposition> {
    if (!user.isAdmin && !user.isContratheque) throw new Error('Seules la contrathèque et les administrateurs acceptent une proposition.');
    const p = await obtenir(id);
    if (p.statut !== 'a_revoir') throw new Error(p.statut === 'acceptee' ? 'Proposition déjà acceptée.' : 'Proposition non disponible pour création.');
    return p;
}

/** Après création : la proposition est acceptée, avec le contrat créé. */
export async function marquerAcceptee(id: string, contrat: { contractId: string; contractNumber: string }, user: SessionUser): Promise<void> {
    await adminDb.collection(COL).doc(id).update({ statut: 'acceptee', decision: { par: user.email, le: new Date().toISOString(), contractId: contrat.contractId, contractNumber: contrat.contractNumber } });
}
