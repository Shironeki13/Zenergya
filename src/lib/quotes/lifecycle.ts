import type { Quote, QuoteStatus } from '@/lib/quotes/types';

/**
 * Cycle de vie d'un devis (sans dépendance) :
 *
 *   brouillon ──envoyer──▶ envoyé ──▶ accepté
 *       ▲                    │  ├──▶ refusé
 *       └─nouvelle version───┘  └──▶ (expiré : envoyé dont la validité est dépassée)
 *   brouillon / envoyé ──annuler──▶ annulé
 *
 * L'expiration n'est pas enregistrée : elle se déduit de la date de fin de validité.
 */

const today = () => new Date().toISOString().slice(0, 10);

/** Statut affiché : un devis envoyé dont la validité est dépassée est « expiré ». */
export function effectiveStatus(q: Pick<Quote, 'status' | 'validUntil'>, day = today()): QuoteStatus {
    return q.status === 'envoye' && q.validUntil < day ? 'expire' : q.status;
}

export type QuoteAction = 'send' | 'accept' | 'refuse' | 'newVersion' | 'cancel';

export function availableActions(q: Pick<Quote, 'status' | 'validUntil'>, day = today()): QuoteAction[] {
    switch (effectiveStatus(q, day)) {
        case 'brouillon': return ['send', 'cancel'];
        case 'envoye': return ['accept', 'refuse', 'newVersion', 'cancel'];
        // Expiré : accepter reste possible en connaissance de cause (confirmation demandée).
        case 'expire': return ['accept', 'newVersion', 'cancel'];
        case 'refuse': return ['newVersion'];
        default: return [];
    }
}

export const isFinal = (status: QuoteStatus) => status === 'accepte' || status === 'annule';
