import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import {
    COLLECTION_VALIDATION, LIBELLE_UNITAIRE, detailsElement, typeAvenant, type ElementAValider, type TypeValidation,
} from '@/lib/validations';
import { repriseP1Contrat } from '@/services/p1-reprise-admin';
import type { SessionUser } from '@/lib/auth/server';

/**
 * Validation des documents de contrat, au serveur et par un administrateur : file d'attente par type, validation
 * (effets appliqués au contrat ou au client dans la même transaction) ou refus motivé.
 */

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
                donnees: {
                    impactsDuration: d.impactsDuration ?? null, newEndDate: d.newEndDate ?? null, newRepresentative: d.newRepresentative ?? null,
                    newBe: d.newBe ?? null, contactEmail: d.contactEmail ?? null, nbDocuments: coll === 'contracts' && Array.isArray(d.documents) ? d.documents.length : null,
                },
            });
        }
    }
    return out.sort((a, b) => String(a.demandeLe).localeCompare(String(b.demandeLe)));
}

/** Valide (effets appliqués) ou refuse (motif obligatoire) un document en attente. */
export async function traiterValidation(type: TypeValidation, id: string, decision: 'valider' | 'refuser', motif: string, user: SessionUser): Promise<void> {
    const coll = COLLECTION_VALIDATION[type];
    if (!coll) throw new Error('Type de document inconnu.');
    if (decision === 'refuser' && !motif.trim()) throw new Error('Motif du refus obligatoire.');
    const ref = adminDb.collection(coll).doc(String(id));
    const maintenant = new Date().toISOString();
    let contratValide: string | null = null;
    await adminDb.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('Document introuvable.');
        const d = snap.data()!;
        if (d.validationStatus !== 'pending_validation') throw new Error(`Ce ${LIBELLE_UNITAIRE[type]} n'est plus en attente (déjà traité).`);
        const contractRef = adminDb.collection('contracts').doc(type === 'contrat' ? snap.id : String(d.contractId));
        const contrat = await tx.get(contractRef);
        if (!contrat.exists) throw new Error('Contrat introuvable.');
        const trace = { validatedAt: maintenant, validatedBy: user.email };

        if (decision === 'refuser') {
            tx.update(ref, { validationStatus: 'refused', refusalReason: motif.trim(), ...trace });
            return;
        }
        // Valider exige la pièce justificative (elle fait foi) ; refuser reste toujours possible.
        if (type !== 'contrat' && !d.documentUrl) throw new Error('Pièce justificative absente : refusez le document.');
        // Effets du document sur le contrat ou le client.
        if (type === 'contrat') {
            tx.update(ref, { validationStatus: 'validated', ...(d.status === 'Brouillon' && { status: 'Actif' }), refusalReason: null, ...trace });
            contratValide = snap.id;
            return;
        }
        if ((type === 'avenant' || type === 'os') && d.impactsDuration && d.newEndDate) tx.update(contractRef, { endDate: Timestamp.fromDate(new Date(d.newEndDate)) });
        if (type === 'reconduction' && d.newEndDate) tx.update(contractRef, { endDate: Timestamp.fromDate(new Date(d.newEndDate)) });
        if (type === 'resiliation') tx.update(contractRef, { status: 'Résilié', terminationDate: new Date(d.effectiveDate).toISOString() });
        if (type === 'syndic' || type === 'be') {
            const clientRef = adminDb.collection('clients').doc(String(contrat.get('clientId')));
            tx.update(clientRef, type === 'syndic'
                ? { representedBy: String(d.newRepresentative) }
                : { isBe: true, beName: String(d.newBe), ...(d.contactEmail && { beEmail: String(d.contactEmail) }) });
        }
        tx.update(ref, { validationStatus: 'validated', ...trace });
    });
    // Contrat validé : valeurs P1 de la création reprises dans le paramétrage daté de ses sites.
    if (contratValide) await repriseP1Contrat(contratValide, user.email);
}
