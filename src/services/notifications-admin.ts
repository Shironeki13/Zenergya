import 'server-only';
import { createHash } from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import {
    EVENEMENTS, EVENEMENTS_DOCUMENT, REGLAGES_DEFAUT, ROLES_DESTINATAIRE, composer, destinataires, domaineDe, regleDe,
    type Annuaire, type ContexteMail, type Evenement, type Mail, type ModeEnvoi, type ModelesPropres, type Regle, type ReglagesNotifications,
} from '@/lib/notifications/modeles';
import { NATURES, controlerModele, type ModeleMail } from '@/lib/notifications/balises';

/**
 * Notifications par mail, côté serveur. `notifier` compose le mail d'un événement, calcule ses destinataires
 * (règle de l'événement, rôles tenus sur le contrat, domaines internes seulement) et l'écrit au **journal**
 * (collection `notifications`, serveur seulement) :
 * - mode `simulation` (défaut) : le mail est journalisé « simulé », rien ne part ;
 * - mode `messagerie` : il est journalisé « à envoyer » pour le transport de messagerie ;
 * - mode `arret` : rien n'est écrit.
 * Une même clé n'est notifiée qu'une fois. Une notification ne fait jamais échouer l'opération qui la déclenche.
 */

export type StatutNotification = 'simule' | 'a_envoyer' | 'envoye' | 'echec' | 'sans_destinataire';
export type Notification = {
    id: string;
    evenement: Evenement;
    cle: string;
    contractId: string;
    contrat: string;
    destinataires: string[];
    ecartes: { adresse: string; motif: string }[];
    expediteur: string;
    sujet: string;
    texte: string;
    html: string;
    statut: StatutNotification;
    mode: ModeEnvoi;
    erreur?: string;
    creeLe: string;
    envoyeLe?: string;
};

const COLLECTION = 'notifications';
const REGLAGES = adminDb.collection('notificationsReglages').doc('reglages');

/** Réglages en vigueur : ceux enregistrés, complétés par les valeurs d'environnement puis par défaut. */
export async function reglagesNotifications(): Promise<ReglagesNotifications> {
    const enregistres = ((await REGLAGES.get()).data() ?? {}) as Partial<ReglagesNotifications>;
    const env = (k: string) => (process.env[k] ?? '').trim();
    return {
        ...REGLAGES_DEFAUT, ...enregistres,
        mode: (['simulation', 'messagerie', 'arret'] as ModeEnvoi[]).includes(enregistres.mode as ModeEnvoi) ? enregistres.mode as ModeEnvoi : 'simulation',
        expediteur: enregistres.expediteur || env('NOTIFICATIONS_EXPEDITEUR'),
        domaines: enregistres.domaines?.length ? enregistres.domaines : env('NOTIFICATIONS_DOMAINES').split(',').map(d => d.trim().toLowerCase()).filter(Boolean),
        urlApplication: enregistres.urlApplication || env('NOTIFICATIONS_URL_APPLICATION'),
        regles: enregistres.regles ?? {},
        modeles: enregistres.modeles ?? {},
    };
}

const emailDe = async (userId?: string | null) => {
    if (!userId) return null;
    const u = await adminDb.collection('users').doc(String(userId)).get();
    return u.exists ? { email: String(u.get('email') ?? ''), managerId: (u.get('managerId') as string | undefined) ?? null } : null;
};

/** Qui tient quel rôle pour un contrat : déposant, contrathèque, responsable de facturation et son N+1, administrateurs. */
export async function annuaireContrat(contractId: string, deposant?: string | null): Promise<Annuaire> {
    const [contrat, roles] = await Promise.all([adminDb.collection('contracts').doc(contractId).get(), adminDb.collection('roles').get()]);
    const idsRoles = (champ: 'isContratheque' | 'isAdmin') => roles.docs.filter(r => r.get(champ) === true).map(r => r.id);
    const emailsDesRoles = async (ids: string[]) => {
        const out: string[] = [];
        for (let i = 0; i < ids.length; i += 30) for (const u of (await adminDb.collection('users').where('roleId', 'in', ids.slice(i, i + 30)).get()).docs) out.push(String(u.get('email') ?? ''));
        return out.filter(Boolean);
    };
    const responsable = await emailDe(contrat.get('billingManagerId') as string | undefined);
    const n1 = await emailDe(responsable?.managerId);
    const [contratheque, administrateurs] = await Promise.all([emailsDesRoles(idsRoles('isContratheque')), emailsDesRoles(idsRoles('isAdmin'))]);
    return {
        deposant: deposant ? [deposant] : [], contratheque, administrateurs,
        responsable_facturation: responsable?.email ? [responsable.email] : [], n1_responsable: n1?.email ? [n1.email] : [],
    };
}

export type DemandeNotification = {
    evenement: Evenement;
    /** Clé d'unicité : le même événement sur le même objet (et le même palier de rappel) n'est notifié qu'une fois. */
    cle: string;
    contexte: Omit<ContexteMail, 'urlApplication'>;
    /** Adresse du déposant du document, s'il y en a un. */
    deposant?: string | null;
};

/** Compose, journalise et remet au transport ; rend la notification, ou null si elle est inactive ou déjà faite. */
export async function notifier(d: DemandeNotification): Promise<Notification | null> {
    const reglages = await reglagesNotifications();
    if (reglages.mode === 'arret') return null;
    const regle = regleDe(reglages, d.evenement);
    if (!regle.actif) return null;
    const id = createHash('sha256').update(`${d.evenement}|${d.cle}`).digest('hex').slice(0, 32);
    const ref = adminDb.collection(COLLECTION).doc(id);
    if ((await ref.get()).exists) return null;
    const annuaire = await annuaireContrat(d.contexte.contrat.id, d.deposant);
    const { retenus, ecartes } = destinataires(regle, annuaire, reglages.domaines);
    const mail: Mail = composer(d.evenement, { ...d.contexte, urlApplication: reglages.urlApplication }, reglages.modeles);
    const n: Notification = {
        id, evenement: d.evenement, cle: d.cle, contractId: d.contexte.contrat.id, contrat: `${d.contexte.contrat.numero} — ${d.contexte.contrat.client}`,
        destinataires: retenus, ecartes, expediteur: reglages.expediteur, ...mail,
        statut: retenus.length === 0 ? 'sans_destinataire' : reglages.mode === 'simulation' ? 'simule' : 'a_envoyer', mode: reglages.mode, creeLe: new Date().toISOString(),
    };
    try { await ref.create(n); } catch { return null; }   // créée entre-temps par un appel concurrent
    return n;
}

/** Comme `notifier`, mais sans jamais lever : une notification ne fait pas échouer un dépôt ou une validation. */
export async function notifierSansBloquer(d: DemandeNotification): Promise<void> {
    try { await notifier(d); } catch (e) { console.error(`Notification ${d.evenement} (${d.cle}) non journalisée :`, e instanceof Error ? e.message : e); }
}

/** Dernières notifications du journal, de la plus récente à la plus ancienne. */
export async function journalNotifications(limite = 100): Promise<Notification[]> {
    const s = await adminDb.collection(COLLECTION).orderBy('creeLe', 'desc').limit(Math.min(500, Math.max(1, limite))).get();
    return s.docs.map(d => d.data() as Notification);
}

// --- Paramétrage par l'administrateur ---

export type ModificationReglages = {
    /** `messagerie` n'est pas proposé tant que l'envoi réel n'est pas branché. */
    mode?: 'simulation' | 'arret';
    expediteur?: string;
    domaines?: string[];
    urlApplication?: string;
    /** Règle d'un événement : remplace la règle enregistrée ; null : retour à la règle d'origine. */
    regle?: { evenement: Evenement; regle: Regle | null };
    /** Modèle d'un événement, pour tous les documents (`nature` absente) ou un type ; null : retour au modèle hérité. */
    modele?: { evenement: Evenement; nature?: (typeof NATURES)[number]; modele: ModeleMail | null };
};

const adresse = (a: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a);

/** Enregistre une modification des réglages après contrôle ; trace son auteur. Lève une erreur lisible si elle est refusée. */
export async function modifierReglagesNotifications(m: ModificationReglages, par: string): Promise<void> {
    const actuels = await reglagesNotifications();
    const maj: Record<string, unknown> = { modifiePar: par, modifieLe: new Date().toISOString() };
    if (m.mode !== undefined) {
        if (m.mode !== 'simulation' && m.mode !== 'arret') throw new Error('Mode d\'envoi : simulation ou arrêt (l\'envoi réel n\'est pas encore branché).');
        maj.mode = m.mode;
    }
    const domaines = m.domaines !== undefined ? [...new Set(m.domaines.map(d => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))] : actuels.domaines;
    if (m.domaines !== undefined) {
        const faux = domaines.filter(d => !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d));
        if (faux.length) throw new Error(`Domaine(s) invalide(s) : ${faux.join(', ')} (écrire par exemple « veolia.com »).`);
        maj.domaines = domaines;
    }
    if (m.expediteur !== undefined) {
        const e = m.expediteur.trim().toLowerCase();
        if (e && !adresse(e)) throw new Error('Boîte d\'envoi : adresse invalide.');
        if (e && domaines.length && !domaines.includes(domaineDe(e))) throw new Error('Boîte d\'envoi : elle doit appartenir à un domaine interne.');
        maj.expediteur = e;
    }
    if (m.urlApplication !== undefined) {
        const u = m.urlApplication.trim().replace(/\/+$/, '');
        if (u && !/^https?:\/\/[^\s]+$/.test(u)) throw new Error('Adresse de l\'application : elle commence par https://');
        maj.urlApplication = u;
    }
    if (m.regle) {
        const { evenement, regle } = m.regle;
        if (!EVENEMENTS.includes(evenement)) throw new Error('Événement inconnu.');
        const regles = { ...actuels.regles };
        if (regle === null) delete regles[evenement];
        else {
            const roles = [...new Set(regle.roles)];
            if (roles.some(r => !ROLES_DESTINATAIRE.includes(r))) throw new Error('Rôle de destinataire inconnu.');
            const adresses = [...new Set((regle.adresses ?? []).map(a => a.trim().toLowerCase()).filter(Boolean))];
            const invalides = adresses.filter(a => !adresse(a));
            if (invalides.length) throw new Error(`Adresse(s) invalide(s) : ${invalides.join(', ')}.`);
            const externes = adresses.filter(a => !domaines.includes(domaineDe(a)));
            if (externes.length) throw new Error(`Adresse(s) hors des domaines internes (${domaines.join(', ') || 'aucun domaine paramétré'}) : ${externes.join(', ')}. Les mails restent internes.`);
            if (adresses.length > 30) throw new Error('Trente adresses fixes au plus par événement.');
            regles[evenement] = { actif: regle.actif !== false, roles, adresses };
        }
        maj.regles = regles;
    }
    if (m.modele) {
        const { evenement, nature, modele } = m.modele;
        if (!EVENEMENTS.includes(evenement)) throw new Error('Événement inconnu.');
        if (nature !== undefined && (!NATURES.includes(nature) || !EVENEMENTS_DOCUMENT.includes(evenement))) throw new Error('Cet événement n\'a pas de modèle par type de document.');
        if (modele) { const erreurs = controlerModele(modele); if (erreurs.length) throw new Error(erreurs.join(' ')); }
        const modeles: ModelesPropres = JSON.parse(JSON.stringify(actuels.modeles ?? {}));
        const entree = modeles[evenement] ?? {};
        const propre = modele ? { objet: modele.objet.trim(), corps: modele.corps.replace(/\r\n?/g, '\n').trim() } : null;
        if (nature === undefined) { if (propre) entree.defaut = propre; else delete entree.defaut; }
        else { entree.parNature = { ...(entree.parNature ?? {}) }; if (propre) entree.parNature[nature] = propre; else delete entree.parNature[nature]; if (!Object.keys(entree.parNature).length) delete entree.parNature; }
        if (Object.keys(entree).length) modeles[evenement] = entree; else delete modeles[evenement];
        maj.modeles = modeles;
    }
    await REGLAGES.set(maj, { mergeFields: Object.keys(maj) });
}
