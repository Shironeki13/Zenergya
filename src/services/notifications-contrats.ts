import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import type { ContexteMail, Evenement, NatureDocument } from '@/lib/notifications/modeles';
import type { MontantsPrestation } from '@/lib/notifications/balises';
import { notifierSansBloquer } from '@/services/notifications-admin';

/**
 * Notifications de la vie d'un contrat : lit le document et son contrat, en tire les valeurs des balises (objet,
 * déposant, décision, date d'effet, impacts et montants par prestation) et demande la notification. Jamais bloquant :
 * une notification qui échoue ne fait pas échouer le dépôt ou la validation.
 */

export const COLLECTION_DOCUMENT: Record<NatureDocument, string> = {
    contrat: 'contracts', avenant: 'amendments', os: 'amendments', reconduction: 'renewals', resiliation: 'terminations', syndic: 'trusteeChanges', be: 'beChanges',
};

const texte = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const jour = (v: unknown): string | null => {
    if (!v) return null;
    const t = typeof (v as { toDate?: () => Date }).toDate === 'function' ? (v as { toDate: () => Date }).toDate() : new Date(String(v));
    return Number.isNaN(t.getTime()) ? null : t.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
};
const nombre = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v !== 0 ? v : null);
const montants = (d: FirebaseFirestore.DocumentData, prefixe: 'baseAmount' | 'impact'): MontantsPrestation | undefined => {
    const m = { p1: nombre(d[`${prefixe}P1`]), p2: nombre(d[`${prefixe}P2`]), p3: nombre(d[`${prefixe}P3`]), p3r: nombre(d[`${prefixe}P3R`]) };
    return Object.values(m).some(x => x !== null) ? m : undefined;
};

/** Contrat tel que les mails le citent. */
export function contratPourMail(id: string, k: FirebaseFirestore.DocumentData): ContexteMail['contrat'] {
    const m = montants(k, 'baseAmount');
    return { id, numero: texte(k.contractNumber) || id, client: texte(k.clientName), ...(m && { montants: m }) };
}

/**
 * Notifie un événement portant sur un document de contrat (dépôt, validation, refus, résiliation validée).
 * La clé d'unicité tient compte de la dernière décision : un document refusé puis redéposé est notifié de nouveau.
 */
export async function notifierDocument(evenement: Extract<Evenement, 'document_depose' | 'document_valide' | 'document_refuse' | 'resiliation_validee'>, nature: NatureDocument, id: string): Promise<void> {
    try {
        const coll = COLLECTION_DOCUMENT[nature];
        const snap = await adminDb.collection(coll).doc(String(id)).get();
        if (!snap.exists) return;
        const d = snap.data()!;
        const contractId = nature === 'contrat' ? snap.id : texte(d.contractId);
        const k = nature === 'contrat' ? d : (await adminDb.collection('contracts').doc(contractId || '-').get()).data();
        if (!k) return;
        const deposant = texte(d.requesterEmail) || texte(d.createdBy);
        const impacts = nature === 'avenant' || nature === 'os' ? montants(d, 'impact') : undefined;
        const resume = nature === 'contrat' ? texte(d.label) || texte(d.name) : texte(d.description) || texte(d.reason) || texte(d.newRepresentative) || texte(d.newBe) || texte(d.duration);
        const effet = nature === 'contrat' ? jour(d.startDate) : jour(d.effectiveDate) ?? jour(d.newEndDate);
        const decision = evenement !== 'document_depose';
        await notifierSansBloquer({
            evenement,
            // Dépôt : une fois par tour de validation (le refus précédent, s'il y en a un, distingue le nouveau dépôt).
            cle: `${coll}/${snap.id}#${texte(d.validatedAt) || 'initial'}`,
            deposant: deposant.includes('@') ? deposant : null,
            contexte: {
                contrat: contratPourMail(contractId, k),
                document: {
                    nature, ...(resume && { resume }), ...(deposant && { deposePar: deposant }), deposeLe: jour(d.createdAt), effet,
                    ...(decision && texte(d.validatedBy) && { decidePar: texte(d.validatedBy) }), ...(evenement === 'document_refuse' && texte(d.refusalReason) && { motifRefus: texte(d.refusalReason) }),
                    ...(impacts && { impacts }),
                },
            },
        });
    } catch (e) { console.error(`Notification ${evenement} (${nature} ${id}) impossible :`, e instanceof Error ? e.message : e); }
}
