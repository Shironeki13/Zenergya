import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import {
    CHAMPS_VALIDATION, COLLECTION_VALIDATION, afficherValeur, controleComplet, detailsElement, normaliserCorrection, typeAvenant,
    valeursDocument, type ElementAValider, type TypeValidation, type ValeurChamp,
} from '@/lib/validations';
import { repriseP1Contrat } from '@/services/p1-reprise-admin';
import type { SessionUser } from '@/lib/auth/server';

/**
 * Validation des documents de contrat, au serveur et par la contrathèque (garante des documents) : file d'attente par
 * type ; validation après contrôle de chaque valeur saisie contre le document (corrections tracées), effets appliqués
 * au contrat ou au client dans la même transaction ; ou refus motivé.
 */

export type DecisionValidation = {
    decision: 'valider' | 'refuser';
    motif?: string;
    /** Champs cochés « conforme au document » (après corrections). */
    controles?: string[];
    /** Valeurs corrigées par la contrathèque, par champ. */
    corrections?: Record<string, unknown>;
    /** Contrat signé joint par la contrathèque (base marché sans document). */
    piece?: { url: string; name: string } | null;
};

/** Adresse d'un fichier déposé dans le stockage de l'application (ou son émulateur). */
const urlStockage = (u: unknown): u is string =>
    typeof u === 'string' && (/^https:\/\//.test(u) || (!!process.env.FIREBASE_STORAGE_EMULATOR_HOST && /^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(u)));

const iso = (v: unknown): string | null => {
    if (!v) return null;
    const t = typeof (v as { toDate?: () => Date }).toDate === 'function' ? (v as { toDate: () => Date }).toDate() : new Date(String(v));
    return Number.isNaN(t.getTime()) ? null : t.toISOString();
};

/** Documents en attente de validation, tous types. */
export async function fileValidation(): Promise<ElementAValider[]> {
    const collections = [...new Set(Object.values(COLLECTION_VALIDATION))];
    const [snaps, contrats] = await Promise.all([
        Promise.all(collections.map(c => adminDb.collection(c).where('validationStatus', '==', 'pending_validation').get().then(s => [c, s] as const))),
        adminDb.collection('contracts').select('contractNumber', 'clientId', 'clientName').get(),
    ]);
    const contrat = new Map(contrats.docs.map(d => [d.id, d.data()]));
    const out: ElementAValider[] = [];
    for (const [coll, snap] of snaps) {
        for (const doc of snap.docs) {
            const d = doc.data();
            const type: TypeValidation = coll === 'contracts' ? 'contrat' : coll === 'amendments' ? typeAvenant(d)
                : (Object.entries(COLLECTION_VALIDATION).find(([, c]) => c === coll)![0] as TypeValidation);
            const contractId = coll === 'contracts' ? doc.id : String(d.contractId ?? '');
            const k = coll === 'contracts' ? d : contrat.get(contractId) ?? {};
            const premierDoc = coll === 'contracts' && Array.isArray(d.documents) ? d.documents[0] : null;
            out.push({
                type, id: doc.id, contractId,
                contractNumber: String(k.contractNumber ?? contractId), clientId: String(k.clientId ?? ''), clientName: String(k.clientName ?? ''),
                demandePar: String(d.requesterEmail ?? d.createdBy ?? ''), demandeLe: iso(d.createdAt),
                effet: coll === 'contracts' ? iso(d.startDate) : iso(d.effectiveDate) ?? iso(d.newEndDate),
                details: detailsElement(type, { ...d, startDate: iso(d.startDate), endDate: iso(d.endDate) }),
                documentUrl: coll === 'contracts' ? (premierDoc?.url ?? null) : (d.documentUrl ?? null),
                documentName: coll === 'contracts' ? (premierDoc?.name ?? null) : (d.documentName ?? null),
                donnees: { ...valeursDocument(type, d), nbDocuments: coll === 'contracts' && Array.isArray(d.documents) ? d.documents.length : null },
                valeurs: valeursDocument(type, d),
            });
        }
    }
    return out.sort((a, b) => String(a.demandeLe).localeCompare(String(b.demandeLe)));
}

/** Valide (contrôle complet, corrections et effets appliqués) ou refuse (motif obligatoire) un document en attente. */
export async function traiterValidation(type: TypeValidation, id: string, choix: DecisionValidation, user: SessionUser): Promise<void> {
    if (!user.isContratheque) throw new Error('Réservé à la contrathèque.');
    const coll = COLLECTION_VALIDATION[type];
    if (!coll) throw new Error('Type de document inconnu.');
    const motif = (choix.motif ?? '').trim();
    if (choix.decision === 'refuser' && !motif) throw new Error('Motif du refus obligatoire.');
    // Corrections vérifiées avant la transaction (erreurs de saisie lisibles).
    const corrections: Record<string, ValeurChamp> = {};
    for (const [cle, v] of Object.entries(choix.corrections ?? {})) corrections[cle] = normaliserCorrection(type, cle, v);
    if (choix.piece && (!urlStockage(choix.piece.url) || !String(choix.piece.name ?? '').trim())) throw new Error('Pièce jointe invalide.');

    const ref = adminDb.collection(coll).doc(String(id));
    const maintenant = new Date().toISOString();
    let contratValide: string | null = null;
    await adminDb.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('Document introuvable.');
        const d = snap.data()!;
        if (d.validationStatus !== 'pending_validation') throw new Error("Document déjà traité : il n'est plus en attente.");
        if ((type === 'os' || type === 'avenant') && typeAvenant(d) !== type) throw new Error('Type de document incohérent.');
        const contractRef = adminDb.collection('contracts').doc(type === 'contrat' ? snap.id : String(d.contractId));
        const contrat = await tx.get(contractRef);
        if (!contrat.exists) throw new Error('Contrat introuvable.');
        const trace = { validatedAt: maintenant, validatedBy: user.email };

        if (choix.decision === 'refuser') {
            tx.update(ref, { validationStatus: 'refused', refusalReason: motif, ...trace });
            return;
        }

        // Valeurs après corrections : toutes doivent avoir été contrôlées contre le document.
        const avant = valeursDocument(type, d);
        const apres = { ...avant, ...corrections };
        const { complet, manquants } = controleComplet(type, apres, choix.controles ?? []);
        if (!complet) throw new Error(`Contrôle incomplet : ${manquants.map(m => m.libelle).join(', ')}.`);

        // La pièce fait foi : sans elle, pas de validation (la contrathèque peut joindre le contrat signé).
        const docs = Array.isArray(d.documents) ? d.documents : [];
        const pieceContrat = type === 'contrat' && choix.piece ? { name: choix.piece.name.trim(), type: 'Contrat signé', url: choix.piece.url } : null;
        if (type === 'contrat' ? !docs.some((x: { url?: string }) => x?.url) && !pieceContrat : !d.documentUrl) {
            throw new Error(type === 'contrat' ? 'Contrat signé absent : joignez-le avant de valider.' : 'Pièce justificative absente : refusez le document.');
        }

        // Corrections : enregistrées sur le document, avec l'ancienne valeur, l'auteur et la date.
        const modifs = CHAMPS_VALIDATION[type].filter(c => c.cle in corrections && corrections[c.cle] !== avant[c.cle]);
        const stocke = (cle: string, v: ValeurChamp) => {
            const def = CHAMPS_VALIDATION[type].find(c => c.cle === cle)!;
            if (v === null) return null;
            return def.type === 'date' && type === 'contrat' ? Timestamp.fromDate(new Date(`${v}T00:00:00Z`)) : v;
        };
        const champs = Object.fromEntries(modifs.map(c => [c.cle, stocke(c.cle, corrections[c.cle])]));
        const journal = modifs.map(c => ({
            champ: c.cle, libelle: c.libelle, avant: afficherValeur(c, avant[c.cle]), apres: afficherValeur(c, corrections[c.cle]), par: user.email, le: maintenant,
        }));
        const commun = {
            ...champs, validationStatus: 'validated', ...trace, controledFields: [...new Set(choix.controles ?? [])],
            ...(journal.length > 0 && { corrections: [...(Array.isArray(d.corrections) ? d.corrections : []), ...journal] }),
        };

        if (type === 'contrat') {
            tx.update(ref, { ...commun, ...(d.status === 'Brouillon' && { status: 'Actif' }), refusalReason: null, ...(pieceContrat && { documents: [...docs, pieceContrat] }) });
            contratValide = snap.id;
            return;
        }
        // Effets du document (valeurs corrigées) sur le contrat ou le client.
        const v = apres;
        if ((type === 'avenant' || type === 'os') && v.impactsDuration && v.newEndDate) tx.update(contractRef, { endDate: Timestamp.fromDate(new Date(String(v.newEndDate))) });
        if (type === 'reconduction' && v.newEndDate) tx.update(contractRef, { endDate: Timestamp.fromDate(new Date(String(v.newEndDate))) });
        if (type === 'resiliation') tx.update(contractRef, { status: 'Résilié', terminationDate: new Date(String(v.effectiveDate)).toISOString() });
        if (type === 'syndic' || type === 'be') {
            const clientRef = adminDb.collection('clients').doc(String(contrat.get('clientId')));
            tx.update(clientRef, type === 'syndic'
                ? { representedBy: String(v.newRepresentative) }
                : { isBe: true, beName: String(v.newBe), ...(v.contactEmail && { beEmail: String(v.contactEmail) }) });
        }
        tx.update(ref, commun);
    });
    // Contrat validé : valeurs P1 de la création reprises dans le paramétrage daté de ses sites.
    if (contratValide) await repriseP1Contrat(contratValide, user.email);
}
