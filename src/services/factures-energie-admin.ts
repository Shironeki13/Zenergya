import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { controlerFactureEnergie, type SaisieFactureEnergie } from '@/lib/billing/factures-energie';
import type { FactureEnergie } from '@/lib/billing/contract-billing';
import { controlerFactureFournisseur, type ControleFacture } from '@/lib/energie/controle-facture';
import type { PeriodeFourniture } from '@/lib/energie/fournitures';

/**
 * Factures des fournisseurs d'énergie d'un site, refacturées à l'euro l'euro par la prestation P1 « €€ ».
 * Une facture déjà refacturée (présente sur une facture client non annulée) ne se modifie ni ne se supprime.
 */

export type FactureEnergieSuivie = FactureEnergie & {
    commentaire?: string; saisiPar?: string; saisiLe?: string;
    /** Point de livraison concerné, quantité (MWh), et contrôle face au contrat de fourniture. */
    pointId?: string | null; pdl?: string; quantite?: number | null; controle?: ControleFacture;
    /** Facture client qui la refacture (absent : à refacturer). */
    refacturee?: { invoiceId: string; numero: string; proforma: boolean };
};

const COLL = 'facturesEnergie';
const lire = (d: FirebaseFirestore.DocumentSnapshot): FactureEnergieSuivie => {
    const x = d.data() ?? {};
    return {
        id: d.id, siteId: String(x.siteId ?? ''), serviceId: x.serviceId ?? null, fournisseur: String(x.fournisseur ?? ''), numero: String(x.numero ?? ''),
        date: String(x.date ?? ''), debut: x.debut ?? null, fin: x.fin ?? null, montantHT: Number(x.montantHT ?? 0),
        pointId: x.pointId ?? null, quantite: typeof x.quantite === 'number' ? x.quantite : null,
        ...(x.commentaire && { commentaire: String(x.commentaire) }), ...(x.saisiPar && { saisiPar: String(x.saisiPar) }), ...(x.saisiLe && { saisiLe: String(x.saisiLe) }),
    };
};

/** Factures à refacturer des sites donnés (entrée de la facturation). */
export async function facturesEnergieDesSites(siteIds: string[]): Promise<FactureEnergie[]> {
    const out: FactureEnergie[] = [];
    for (let i = 0; i < siteIds.length; i += 30) {
        const snap = await adminDb.collection(COLL).where('siteId', 'in', siteIds.slice(i, i + 30)).get();
        out.push(...snap.docs.map(lire));
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.numero.localeCompare(b.numero));
}

/** Factures client (non annulées) qui refacturent chaque facture du fournisseur, pour un site. */
async function refacturations(siteId: string): Promise<Map<string, NonNullable<FactureEnergieSuivie['refacturee']>>> {
    const site = await adminDb.collection('sites').doc(siteId).get();
    const contractId = String(site.get('contractId') ?? '');
    const m = new Map<string, NonNullable<FactureEnergieSuivie['refacturee']>>();
    if (!contractId) return m;
    const snap = await adminDb.collection('invoices').where('contractId', '==', contractId).get();
    for (const d of snap.docs) {
        if (d.get('status') === 'cancelled' || d.get('cancelledByCreditNoteId')) continue;
        for (const l of (d.get('lineItems') ?? []) as { refacturation?: { factureId?: string } }[]) {
            if (l.refacturation?.factureId) m.set(l.refacturation.factureId, { invoiceId: d.id, numero: String(d.get('invoiceNumber') ?? ''), proforma: d.get('status') === 'proforma' });
        }
    }
    return m;
}

export type PointDuSite = { id: string; pdl: string; energie: string; fournisseur: string };

/** Points de livraison rattachés à un site, avec le fournisseur de leur contrat le plus récent (aide à la saisie). */
export async function pointsDuSite(siteId: string): Promise<{ points: PointDuSite[]; periodes: Map<string, PeriodeFourniture[]> }> {
    const snap = await adminDb.collection('pointsLivraison').where('siteId', '==', siteId).get();
    const periodes = new Map<string, PeriodeFourniture[]>();
    const points = snap.docs.map(d => {
        const p = ((d.get('periodes') ?? []) as PeriodeFourniture[]).map(x => ({ ...x, debut: x.debut ?? null, fin: x.fin ?? null, fournisseur: x.fournisseur ?? '', numeroContrat: x.numeroContrat ?? '' }));
        periodes.set(d.id, p);
        const recente = [...p].filter(x => x.debut).sort((a, b) => b.debut!.localeCompare(a.debut!))[0];
        return { id: d.id, pdl: String(d.get('pdl') ?? ''), energie: String(d.get('energie') ?? ''), fournisseur: recente?.fournisseur ?? '' };
    });
    return { points, periodes };
}

const suivre = (f: FactureEnergieSuivie, faites: Map<string, NonNullable<FactureEnergieSuivie['refacturee']>>, pts: Awaited<ReturnType<typeof pointsDuSite>>): FactureEnergieSuivie => ({
    ...f, ...(faites.has(f.id) && { refacturee: faites.get(f.id)! }),
    ...(f.pointId && pts.points.find(p => p.id === f.pointId) && { pdl: pts.points.find(p => p.id === f.pointId)!.pdl }),
    // Contrôle seulement quand le site a des points de livraison suivis.
    ...(pts.points.length > 0 && { controle: controlerFactureFournisseur(f, f.pointId ? pts.periodes.get(f.pointId) ?? null : null) }),
});

export async function facturesEnergieDuSite(siteId: string): Promise<FactureEnergieSuivie[]> {
    const [snap, faites, pts] = await Promise.all([adminDb.collection(COLL).where('siteId', '==', siteId).get(), refacturations(siteId), pointsDuSite(siteId)]);
    return snap.docs.map(lire).map(f => suivre(f, faites, pts)).sort((a, b) => b.date.localeCompare(a.date) || b.numero.localeCompare(a.numero));
}

/** Factures du fournisseur rattachées à un point de livraison (fiche du point), avec leur refacturation au client. */
export async function facturesEnergieDuPoint(pointId: string): Promise<FactureEnergieSuivie[]> {
    const snap = await adminDb.collection(COLL).where('pointId', '==', pointId).get();
    const factures = snap.docs.map(lire);
    const sites = [...new Set(factures.map(f => f.siteId).filter(Boolean))];
    const parSite = new Map(await Promise.all(sites.map(async s => [s, { faites: await refacturations(s), pts: await pointsDuSite(s) }] as const)));
    return factures.map(f => (parSite.has(f.siteId) ? suivre(f, parSite.get(f.siteId)!.faites, parSite.get(f.siteId)!.pts) : f)).sort((a, b) => b.date.localeCompare(a.date));
}

async function controler(siteId: string, saisie: unknown, saufId?: string): Promise<SaisieFactureEnergie> {
    const c = controlerFactureEnergie((saisie ?? {}) as Record<string, unknown>);
    if (!c.ok) throw new Error(c.erreurs.join(' '));
    if (!(await adminDb.collection('sites').doc(siteId).get()).exists) throw new Error('Site introuvable.');
    // Même fournisseur et même numéro sur le site : doublon de saisie.
    const memes = await adminDb.collection(COLL).where('siteId', '==', siteId).where('numero', '==', c.valeur.numero).get();
    if (memes.docs.some(d => d.id !== saufId && String(d.get('fournisseur')).toLowerCase() === c.valeur.fournisseur.toLowerCase())) throw new Error(`La facture ${c.valeur.numero} de ${c.valeur.fournisseur} est déjà saisie sur ce site.`);
    // Le point de livraison doit être rattaché à ce site.
    if (c.valeur.pointId && (await adminDb.collection('pointsLivraison').doc(c.valeur.pointId).get()).get('siteId') !== siteId) throw new Error("Ce point de livraison n'est pas rattaché à ce site.");
    return c.valeur;
}

export async function creerFactureEnergie(siteId: string, saisie: unknown, par: string): Promise<string> {
    const v = await controler(siteId, saisie);
    const ref = adminDb.collection(COLL).doc();
    await ref.set({ ...v, siteId, saisiPar: par, saisiLe: new Date().toISOString() });
    return ref.id;
}

async function modifiable(id: string): Promise<FirebaseFirestore.DocumentSnapshot> {
    const d = await adminDb.collection(COLL).doc(id).get();
    if (!d.exists) throw new Error('Facture du fournisseur introuvable.');
    const faite = (await refacturations(String(d.get('siteId')))).get(id);
    if (faite) throw new Error(`Cette facture est refacturée sur ${faite.proforma ? 'un proforma' : `la facture ${faite.numero}`} : annulez d'abord cette facture client pour la modifier ou la supprimer.`);
    return d;
}

export async function modifierFactureEnergie(id: string, saisie: unknown, par: string): Promise<void> {
    const d = await modifiable(id);
    const v = await controler(String(d.get('siteId')), saisie, id);
    await d.ref.update({ ...v, modifiePar: par, modifieLe: new Date().toISOString() });
}

export async function supprimerFactureEnergie(id: string): Promise<void> {
    await (await modifiable(id)).ref.delete();
}

/** Site d'une facture du fournisseur (contrôle du périmètre). */
export async function siteDeFactureEnergie(id: string): Promise<string> {
    return String((await adminDb.collection(COLL).doc(id).get()).get('siteId') ?? '');
}
