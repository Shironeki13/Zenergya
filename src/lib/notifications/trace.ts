import type { Evenement } from './modeles';

/**
 * Trace des mails sur la vie d'un contrat (logique pure) : à quelle étape de la frise un mail se rattache, d'après
 * son événement et sa clé. Les mails récapitulatifs (tous contrats) ne se rattachent à aucun contrat.
 */

/** Mail du journal, tel que la fiche du contrat le montre (sans le corps). */
export type MailContrat = { id: string; evenement: Evenement; cle: string; creeLe: string; destinataires: string[]; nbEcartes: number; statut: string; sujet: string };

export const LIBELLE_STATUT_MAIL: Record<string, string> = { simule: 'simulé (non envoyé)', a_envoyer: 'à envoyer', envoye: 'envoyé', echec: 'échec', sans_destinataire: 'sans destinataire' };

const DOCUMENT: Record<string, string> = { amendments: 'avenant', renewals: 'reconduction', terminations: 'resiliation', trusteeChanges: 'syndic', beChanges: 'be' };

/**
 * Identifiant de l'étape de la frise concernée par un mail (voir `vieContrat`) : le document déposé, validé ou refusé,
 * la date limite de préavis ou l'échéance ; null si le mail ne correspond à aucune étape.
 * `decide` : le mail suit une décision (validation, refus) — pour un contrat, il va sur l'étape de validation.
 */
export function etapeDuMail(m: Pick<MailContrat, 'evenement' | 'cle'>): string | null {
    const [coll, reste = ''] = [m.cle.slice(0, m.cle.indexOf('/')), m.cle.slice(m.cle.indexOf('/') + 1)];
    if (m.evenement === 'preavis') return 'preavis';
    if (m.evenement === 'echeance' || m.evenement === 'echeance_depassee') return 'echeance';
    const id = reste.split('#')[0].split('/')[0];
    if (!id) return null;
    if (coll === 'contracts') return m.evenement === 'document_depose' ? 'depot' : 'validation';
    return DOCUMENT[coll] ? `${DOCUMENT[coll]}:${id}` : null;
}

/** Mails regroupés par étape de la frise, du plus ancien au plus récent ; `autres` : ceux qu'aucune étape ne porte. */
export function mailsParEtape(mails: MailContrat[], etapes: { id: string }[]): { parEtape: Map<string, MailContrat[]>; autres: MailContrat[] } {
    const connues = new Set(etapes.map(e => e.id));
    const parEtape = new Map<string, MailContrat[]>();
    const autres: MailContrat[] = [];
    for (const m of [...mails].sort((a, b) => a.creeLe.localeCompare(b.creeLe))) {
        const e = etapeDuMail(m);
        if (e && connues.has(e)) parEtape.set(e, [...(parEtape.get(e) ?? []), m]); else autres.push(m);
    }
    return { parEtape, autres };
}
