import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { rappelsDuJour, type AttenteRappel, type ContratRappel } from '@/lib/notifications/rappels';
import type { Evenement, NatureDocument } from '@/lib/notifications/modeles';
import type { MontantsPrestation } from '@/lib/notifications/balises';
import { notifier, reglagesNotifications } from '@/services/notifications-admin';

/**
 * Rappels programmés : une fois par jour (fonction planifiée) ou à la demande (administrateur), relit les contrats
 * actifs et les documents en attente, et compose les rappels dus — préavis, échéances, échéances dépassées, documents
 * qui attendent. Chaque rappel passe par `notifier` (règles, domaines internes, journal, une seule fois par palier).
 * Le passage est tracé (collection `notificationsPassages`).
 */

export type PassageRappels = {
    le: string;
    declencheur: 'planifie' | 'manuel';
    mode: string;
    contrats: number;
    enAttente: number;
    /** Rappels dus aujourd'hui, et ceux qui ont réellement été composés (les autres l'avaient déjà été). */
    dus: number;
    composes: number;
    parEvenement: Partial<Record<Evenement, number>>;
    sansDestinataire: number;
    erreurs: string[];
};

const texte = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const jour = (v: unknown): string | null => {
    if (!v) return null;
    const t = typeof (v as { toDate?: () => Date }).toDate === 'function' ? (v as { toDate: () => Date }).toDate() : new Date(String(v));
    return Number.isNaN(t.getTime()) ? null : t.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
};
const nombre = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v !== 0 ? v : null);
const montants = (d: FirebaseFirestore.DocumentData): MontantsPrestation | undefined => {
    const m = { p1: nombre(d.baseAmountP1), p2: nombre(d.baseAmountP2), p3: nombre(d.baseAmountP3), p3r: nombre(d.baseAmountP3R) };
    return Object.values(m).some(x => x !== null) ? m : undefined;
};
const PASSAGES = adminDb.collection('notificationsPassages');

/** `today` et `dernierPassage` (jour du passage précédent) ne se passent que pour rejouer une date (tests). */
export async function lancerRappels(opts: { declencheur: PassageRappels['declencheur']; today?: string; dernierPassage?: string | null }): Promise<PassageRappels> {
    const today = opts.today ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
    const reglages = await reglagesNotifications();
    const passage: PassageRappels = { le: new Date().toISOString(), declencheur: opts.declencheur, mode: reglages.mode, contrats: 0, enAttente: 0, dus: 0, composes: 0, parEvenement: {}, sansDestinataire: 0, erreurs: [] };
    if (reglages.mode !== 'arret') {
        const sources: [string, (d: FirebaseFirestore.DocumentData) => NatureDocument][] = [['amendments', d => (d.nature === 'os' ? 'os' : 'avenant')], ['renewals', () => 'reconduction'], ['terminations', () => 'resiliation'], ['trusteeChanges', () => 'syndic'], ['beChanges', () => 'be']];
        const [contratsSnap, ...docsSnaps] = await Promise.all([
            adminDb.collection('contracts').get(),
            ...sources.map(([coll]) => adminDb.collection(coll).where('validationStatus', '==', 'pending_validation').get()),
        ]);
        const contrats: ContratRappel[] = contratsSnap.docs.map(k => {
            const d = k.data(), m = montants(d);
            return {
                id: k.id, numero: texte(d.contractNumber) || k.id, client: texte(d.clientName), actif: d.status === 'Actif', valide: (d.validationStatus ?? 'validated') === 'validated',
                fin: jour(d.endDate), ...(texte(d.noticePeriod) && { preavis: texte(d.noticePeriod) }), reconductible: d.renewal === true, tacite: d.tacitRenewal === true,
                ...(texte(d.renewalDuration) && { dureeReconduction: texte(d.renewalDuration) }), ...(m && { montants: m }),
            };
        });
        const attentes: AttenteRappel[] = [
            ...contratsSnap.docs.filter(k => k.get('validationStatus') === 'pending_validation').map(k => ({
                collection: 'contracts', id: k.id, contractId: k.id, nature: 'contrat' as NatureDocument, deposeLe: jour(k.get('createdAt')), deposePar: texte(k.get('requesterEmail')) || texte(k.get('createdBy')),
                resume: texte(k.get('label')) || texte(k.get('name')), effet: jour(k.get('startDate')),
            })),
            ...docsSnaps.flatMap((s, i) => s.docs.map(x => {
                const d = x.data();
                return {
                    collection: sources[i][0], id: x.id, contractId: texte(d.contractId), nature: sources[i][1](d), deposeLe: jour(d.createdAt), deposePar: texte(d.createdBy),
                    resume: texte(d.description) || texte(d.reason) || texte(d.newRepresentative) || texte(d.newBe) || texte(d.duration), effet: jour(d.effectiveDate) ?? jour(d.newEndDate),
                };
            })),
        ];
        passage.contrats = contrats.filter(c => c.actif && c.valide).length;
        passage.enAttente = attentes.length;
        const precedent = await dernierPassageRappels();
        const dernierJour = precedent ? new Date(precedent.le).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }) : null;
        const dus = rappelsDuJour(contrats, attentes, today, reglages.rappels, opts.dernierPassage !== undefined ? opts.dernierPassage : dernierJour);
        passage.dus = dus.length;
        for (const r of dus) {
            try {
                const n = await notifier(r);
                if (!n) continue;
                passage.composes++;
                passage.parEvenement[r.evenement] = (passage.parEvenement[r.evenement] ?? 0) + 1;
                if (n.statut === 'sans_destinataire') passage.sansDestinataire++;
            } catch (e) { passage.erreurs.push(`${r.cle} : ${e instanceof Error ? e.message : String(e)}`); }
        }
    }
    await PASSAGES.add(passage);
    return passage;
}

/** Dernier passage des rappels (null : jamais lancés). */
export async function dernierPassageRappels(): Promise<PassageRappels | null> {
    const s = await PASSAGES.orderBy('le', 'desc').limit(1).get();
    return s.empty ? null : s.docs[0].data() as PassageRappels;
}
