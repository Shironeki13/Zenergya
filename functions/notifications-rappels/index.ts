import { lancerRappels } from '@/services/notifications-rappels';

/**
 * Fonction planifiée « notifications-rappels » (Cloud Functions 2ᵉ génération, déclenchée chaque jour par Cloud
 * Scheduler) : compose les rappels dus de la contrathèque — préavis et échéances qui approchent, échéances dépassées,
 * documents en attente de validation — avec les mêmes règles, les mêmes modèles et le même journal que l'application
 * (src/services/notifications-rappels.ts). Elle n'envoie rien elle-même : les mails suivent le mode réglé dans
 * l'application (simulation, messagerie, arrêt).
 *
 * Appel authentifié (compte de service, jeton OIDC) : la fonction n'est pas publique. Voir docs/notifications.md.
 */

type Reponse = { status: (code: number) => Reponse; json: (corps: unknown) => void };
const ligne = (severity: 'INFO' | 'WARNING' | 'ERROR', message: string, plus: Record<string, unknown> = {}) => console.log(JSON.stringify({ severity, message, composant: 'notifications-rappels', ...plus }));

export async function rappelsNotifications(_req: unknown, res: Reponse): Promise<void> {
    try {
        const p = await lancerRappels({ declencheur: 'planifie' });
        for (const e of p.erreurs) ligne('ERROR', `Rappel non composé — ${e}`, { probleme: 'rappel' });
        if (p.sansDestinataire) ligne('WARNING', `${p.sansDestinataire} rappel(s) sans destinataire (contrat sans responsable de facturation, ou adresses hors des domaines internes)`, { probleme: 'destinataire' });
        ligne(p.erreurs.length ? 'WARNING' : 'INFO', `Rappels : ${p.composes} composé(s) sur ${p.dus} dû(s), ${p.contrats} contrat(s) actif(s), ${p.enAttente} document(s) en attente, mode ${p.mode}`, { composes: p.composes, dus: p.dus, mode: p.mode });
        res.status(p.erreurs.length && p.erreurs.length === p.dus ? 502 : 200).json(p);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        ligne('ERROR', `Rappels : passage impossible — ${message}`, { probleme: 'execution' });
        res.status(500).json({ error: message });
    }
}
