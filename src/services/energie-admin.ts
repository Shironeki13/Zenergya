import 'server-only';
import { createHash, randomUUID } from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import type { SessionUser } from '@/lib/auth/server';
import type { GardePerimetre } from '@/lib/auth/perimetre-server';
import {
    contratsFournisseur, couverture, syntheseAnnuelle, type ContratFournisseur, type Energie, type LigneSynthese, type PeriodeFourniture, type PointImporte, type PointLivraison, type StatutCouverture,
} from '@/lib/energie/fournitures';
import { toDay } from '@/lib/services/site-amounts';

/**
 * Contrats de fourniture d'énergie : points de livraison et leurs périodes (collection `pointsLivraison`, un document
 * par point, ses périodes à l'intérieur). Réservé aux administrateurs et aux utilisateurs du module Achats ; un
 * utilisateur au périmètre restreint ne voit que les points rattachés à un site de son périmètre.
 */

const COLL = 'pointsLivraison';
type PeriodeStockee = PeriodeFourniture & { source?: 'import' | 'saisie' };

export function exigerAchatsEnergie(user: SessionUser): void {
    if (!user.isAdmin && !user.profile.modules?.includes('purchases')) throw new Error('Réservé aux administrateurs et aux utilisateurs du module Achats.');
}

const idDe = (energie: string, pdl: string) => createHash('sha1').update(`${energie}|${pdl}`).digest('hex').slice(0, 24);
const lire = (d: FirebaseFirestore.DocumentSnapshot): PointLivraison => {
    const x = (d.data() ?? {}) as Partial<PointLivraison>;
    // Les champs vides ne sont pas stockés : ils sont rétablis à la lecture (une période peut n'avoir ni fournisseur ni numéro).
    const periodes = (x.periodes ?? []).map(p => ({ ...p, debut: p.debut ?? null, fin: p.fin ?? null, fournisseur: p.fournisseur ?? '', numeroContrat: p.numeroContrat ?? '', titulaire: p.titulaire ?? '', tacite: p.tacite ?? '' as const }));
    return { ...x, id: d.id, pdl: x.pdl ?? '', energie: x.energie ?? 'AUTRE', periodes, siteId: x.siteId ?? null, client: x.client ?? '', site: x.site ?? '' };
};
const propre = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;

async function visibles(garde: GardePerimetre): Promise<PointLivraison[]> {
    const [snap, sites] = await Promise.all([adminDb.collection(COLL).get(), garde.ids('sites')]);
    const points = snap.docs.map(lire);
    return sites ? points.filter(p => p.siteId && sites.has(p.siteId)) : points;
}

export type ResumePoint = {
    id: string; pdl: string; energie: Energie; client: string; site: string; agence: string; ville: string; typeMarche: string; centreCout: string;
    siteId: string | null; siteNom: string | null; contractId: string | null;
    statut: StatutCouverture; fournisseur: string; numeroContrat: string; finCouverture: string | null; jours: number | null; suivant: string | null;
    periodes: number; car: number | null; prixMolecule: number | null; indexationAchat: string;
};
export type BaseEnergie = {
    aujourdhui: string;
    points: ResumePoint[];
    contrats: ContratFournisseur[];
    synthese: { annees: number[]; lignes: LigneSynthese[]; totaux: number[] };
};

/** Vue d'ensemble : un résumé par point de livraison, les contrats fournisseur et la synthèse annuelle. */
export async function baseEnergie(garde: GardePerimetre): Promise<BaseEnergie> {
    const aujourdhui = toDay(new Date())!;
    const points = await visibles(garde);
    const ids = [...new Set(points.map(p => p.siteId).filter((x): x is string => !!x))];
    const sites = new Map<string, { name: string; contractId: string | null }>();
    for (let i = 0; i < ids.length; i += 300) {
        const docs = await adminDb.getAll(...ids.slice(i, i + 300).map(id => adminDb.collection('sites').doc(id)));
        for (const d of docs) if (d.exists) sites.set(d.id, { name: String(d.get('name') ?? ''), contractId: d.get('contractId') ?? null });
    }
    const an = Number(aujourdhui.slice(0, 4));
    const annees = Array.from({ length: 6 }, (_, i) => an - 3 + i);
    return {
        aujourdhui,
        points: points.map(p => {
            const c = couverture(p, aujourdhui);
            const ref = c.courante ?? c.suivante ?? [...p.periodes].sort((a, b) => (b.fin ?? '').localeCompare(a.fin ?? ''))[0];
            return {
                id: p.id, pdl: p.pdl, energie: p.energie, client: p.client, site: p.site, agence: p.agence ?? '', ville: p.ville ?? '', typeMarche: p.typeMarche ?? '', centreCout: p.centreCout ?? '',
                siteId: p.siteId, siteNom: p.siteId ? sites.get(p.siteId)?.name ?? null : null, contractId: p.siteId ? sites.get(p.siteId)?.contractId ?? null : null,
                statut: c.statut, fournisseur: ref?.fournisseur ?? '', numeroContrat: ref?.numeroContrat ?? '', finCouverture: c.finCouverture, jours: c.jours,
                suivant: c.suivante ? `${c.suivante.fournisseur} dès le ${c.suivante.debut!.split('-').reverse().join('/')}` : null,
                periodes: p.periodes.length, car: p.car ?? null, prixMolecule: ref?.prixMolecule ?? null, indexationAchat: ref?.indexationAchat ?? '',
            };
        }).sort((a, b) => a.client.localeCompare(b.client, 'fr') || a.site.localeCompare(b.site, 'fr') || a.pdl.localeCompare(b.pdl)),
        contrats: contratsFournisseur(points, aujourdhui),
        synthese: { annees, ...syntheseAnnuelle(points, annees) },
    };
}

export async function pointLivraison(id: string, garde: GardePerimetre): Promise<PointLivraison> {
    const d = await adminDb.collection(COLL).doc(id).get();
    if (!d.exists) throw new Error('Point de livraison introuvable.');
    const p = lire(d);
    const sites = await garde.ids('sites');
    if (sites && !(p.siteId && sites.has(p.siteId))) throw new Error('Point de livraison hors de votre périmètre.');
    return { ...p, periodes: [...p.periodes].sort((a, b) => (b.debut ?? '').localeCompare(a.debut ?? '')) };
}

export type RapportImportEnergie = { points: number; crees: number; misAJour: number; periodes: number; rattaches: number };

/**
 * Importe des points lus dans la feuille (par paquets) : le point est créé ou mis à jour, ses périodes venues d'un
 * import précédent sont remplacées, celles saisies dans le logiciel sont conservées. Un point pas encore rattaché
 * l'est au site du compteur qui porte son PDL / PCE.
 */
export async function importerPoints(points: PointImporte[], par: string): Promise<RapportImportEnergie> {
    const r: RapportImportEnergie = { points: 0, crees: 0, misAJour: 0, periodes: 0, rattaches: 0 };
    const maintenant = new Date().toISOString();
    for (let i = 0; i < points.length; i += 200) {
        const lot = points.slice(i, i + 200);
        const refs = lot.map(p => adminDb.collection(COLL).doc(idDe(p.energie, p.pdl)));
        const existants = await adminDb.getAll(...refs);
        // Rapprochement : compteurs dont la référence est le PDL / PCE.
        const parPdl = new Map<string, string>();
        const pdls = [...new Set(lot.map(p => p.pdl))];
        for (let k = 0; k < pdls.length; k += 30) {
            const m = await adminDb.collection('meters').where('reference', 'in', pdls.slice(k, k + 30)).get();
            for (const d of m.docs) if (d.get('siteId')) parPdl.set(String(d.get('reference')), String(d.get('siteId')));
        }
        const batch = adminDb.batch();
        lot.forEach((p, k) => {
            const avant = existants[k].exists ? lire(existants[k]) : null;
            const gardees = ((avant?.periodes ?? []) as PeriodeStockee[]).filter(x => x.source === 'saisie');
            const periodes: PeriodeStockee[] = [...p.periodes.map(x => ({ ...propre(x), id: randomUUID().slice(0, 12), source: 'import' as const })), ...gardees];
            const siteId = avant?.siteId ?? parPdl.get(p.pdl) ?? null;
            if (!avant?.siteId && siteId) r.rattaches++;
            const { periodes: _p, ...ident } = p;
            batch.set(refs[k], { ...propre(ident), siteId, periodes, importeLe: maintenant, importePar: par, ...(avant ? {} : { creeLe: maintenant }) });
            r.points++; r.periodes += p.periodes.length; if (avant) r.misAJour++; else r.crees++;
        });
        await batch.commit();
    }
    return r;
}

/** Rattache un point de livraison à un site du logiciel (ou le détache). */
export async function rattacherPoint(id: string, siteId: string | null, par: string): Promise<void> {
    const ref = adminDb.collection(COLL).doc(id);
    if (!(await ref.get()).exists) throw new Error('Point de livraison introuvable.');
    if (siteId && !(await adminDb.collection('sites').doc(siteId).get()).exists) throw new Error('Site introuvable.');
    await ref.update({ siteId: siteId || null, rattachePar: par, rattacheLe: new Date().toISOString() });
}

/** Ajoute ou modifie une période de fourniture saisie dans le logiciel. */
export async function enregistrerPeriode(id: string, saisie: Partial<PeriodeFourniture>, par: string): Promise<void> {
    const ref = adminDb.collection(COLL).doc(id);
    const d = await ref.get();
    if (!d.exists) throw new Error('Point de livraison introuvable.');
    const [debut, fin] = [String(saisie.debut ?? ''), String(saisie.fin ?? '')];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(debut) || !/^\d{4}-\d{2}-\d{2}$/.test(fin)) throw new Error('Début et fin de la fourniture obligatoires.');
    if (debut > fin) throw new Error('La fin de la fourniture précède son début.');
    const fournisseur = String(saisie.fournisseur ?? '').trim();
    if (!fournisseur) throw new Error('Fournisseur obligatoire.');
    const nombre = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));
    const periode: PeriodeStockee = propre({
        id: saisie.id || randomUUID().slice(0, 12), debut, fin, fournisseur, numeroContrat: String(saisie.numeroContrat ?? '').trim(), titulaire: String(saisie.titulaire ?? '').trim(),
        tacite: saisie.tacite === 'oui' || saisie.tacite === 'non' ? saisie.tacite : '' as const, taciteDetail: String(saisie.taciteDetail ?? '').trim(), conditions: String(saisie.conditions ?? '').trim(),
        accesDonnees: String(saisie.accesDonnees ?? '').trim(), contratDisponible: String(saisie.contratDisponible ?? '').trim(),
        indexationAchat: String(saisie.indexationAchat ?? '').trim(), indexationVente: String(saisie.indexationVente ?? '').trim(), dateValeur: saisie.dateValeur || undefined,
        prixMolecule: nombre(saisie.prixMolecule), totalAbonnement: nombre(saisie.totalAbonnement), cta: nombre(saisie.cta), p0AchatPeg: nombre(saisie.p0AchatPeg),
        source: 'saisie' as const,
    }) as PeriodeStockee;
    periode.tacite = periode.tacite ?? '';
    periode.numeroContrat = periode.numeroContrat ?? '';
    periode.titulaire = periode.titulaire ?? '';
    const periodes = ((d.get('periodes') ?? []) as PeriodeStockee[]).filter(x => x.id !== periode.id);
    await ref.update({ periodes: [...periodes, periode], modifiePar: par, modifieLe: new Date().toISOString() });
}

export async function supprimerPeriode(id: string, periodeId: string, par: string): Promise<void> {
    const ref = adminDb.collection(COLL).doc(id);
    const d = await ref.get();
    if (!d.exists) throw new Error('Point de livraison introuvable.');
    await ref.update({ periodes: ((d.get('periodes') ?? []) as PeriodeStockee[]).filter(x => x.id !== periodeId), modifiePar: par, modifieLe: new Date().toISOString() });
}
