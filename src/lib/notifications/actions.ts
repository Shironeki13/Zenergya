'use server';

import { requireAdmin } from '@/lib/auth/server';
import { EVENEMENTS, MODELES_DEFAUT, regleDe, type Evenement, type ModeleMail, type ModelesPropres, type Regle, type ReglagesNotifications } from '@/lib/notifications/modeles';
import { journalNotifications, modifierReglagesNotifications, reglagesNotifications, type ModificationReglages, type Notification } from '@/services/notifications-admin';
import { dernierPassageRappels, lancerRappels, type PassageRappels } from '@/services/notifications-rappels';

/** Notifications : réglages en vigueur, aperçu des modèles et journal, réservés à l'administrateur. */

type Result<T> = { success: true; data: T } | { success: false; error: string };
const fail = (e: unknown): { success: false; error: string } => ({ success: false, error: e instanceof Error ? e.message : 'Opération impossible.' });

export type EtatNotifications = {
    reglages: Pick<ReglagesNotifications, 'mode' | 'expediteur' | 'domaines' | 'urlApplication' | 'rappels'>;
    /** Dernier passage des rappels programmés (null : jamais lancés). */
    dernierPassage: PassageRappels | null;
    /** Règle en vigueur de chaque événement, et si elle a été modifiée. */
    regles: { evenement: Evenement; regle: Regle; propre: boolean; origine: ModeleMail }[];
    /** Modèles propres enregistrés (les autres sont ceux d'origine). */
    modeles: ModelesPropres;
    journal: Notification[];
};

export async function etatNotificationsAction(): Promise<Result<EtatNotifications>> {
    try {
        await requireAdmin();
        const [r, journal, dernierPassage] = await Promise.all([reglagesNotifications(), journalNotifications(100), dernierPassageRappels()]);
        return {
            success: true,
            data: {
                reglages: { mode: r.mode, expediteur: r.expediteur, domaines: r.domaines, urlApplication: r.urlApplication, rappels: r.rappels },
                dernierPassage,
                regles: EVENEMENTS.map(e => ({ evenement: e, regle: regleDe(r, e), propre: !!r.regles?.[e], origine: MODELES_DEFAUT[e] })),
                modeles: r.modeles ?? {},
                journal,
            },
        };
    } catch (e) { return fail(e); }
}

/** Modifie les réglages (mode, domaines, règle ou modèle d'un événement) : contrôlé par le serveur, tracé. */
export async function modifierNotificationsAction(m: ModificationReglages): Promise<Result<true>> {
    try { const u = await requireAdmin(); await modifierReglagesNotifications(m, u.email); return { success: true, data: true }; } catch (e) { return fail(e); }
}

/** Lance les rappels programmés tout de suite (ce que fait la tâche quotidienne) ; rend le compte rendu du passage. */
export async function lancerRappelsAction(): Promise<Result<PassageRappels>> {
    try { await requireAdmin(); return { success: true, data: await lancerRappels({ declencheur: 'manuel' }) }; } catch (e) { return fail(e); }
}
