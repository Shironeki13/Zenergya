import { decaler, lireDuree } from '@/lib/contrats/frise';
import type { ContexteMail, DocumentEnAttente, MontantsPrestation, NatureDocument } from './balises';
import type { Evenement } from './modeles';

/**
 * Rappels programmés (logique pure) : à partir des contrats actifs et des documents en attente, ce qu'il faut
 * rappeler aujourd'hui — préavis et échéances qui approchent (par paliers), échéances dépassées (à intervalle
 * régulier), et **un seul mail récapitulatif** des documents qui attendent leur validation.
 *
 * Chaque rappel porte une **clé** : le même palier de la même échéance n'est rappelé qu'une fois, même si la tâche
 * tourne plusieurs fois par jour. Si la tâche a manqué des jours, seul le palier courant est rappelé (pas de rafale).
 */

export type ReglagesRappels = {
    /** Jours avant la date limite de préavis (ex. 90, 60, 30). */
    preavis: number[];
    /** Jours avant l'échéance (ex. 180, 90, 30). */
    echeance: number[];
    /** Documents en attente : récapitulatif quand un document atteint N, 2N, 3N… jours d'attente (un mail par jour au plus). */
    attenteJours: number;
    /** Échéance dépassée : rappel dès le dépassement, puis tous les N jours. */
    depasseeJours: number;
};
export const RAPPELS_DEFAUT: ReglagesRappels = { preavis: [90, 60, 30], echeance: [180, 90, 30], attenteJours: 7, depasseeJours: 30 };

/** Contrôle des réglages de rappel ; message d'erreur ou null. */
export function controleRappels(r: ReglagesRappels): string | null {
    const paliers = (l: number[], nom: string) => (!Array.isArray(l) || l.length > 6 || l.some(x => !Number.isInteger(x) || x < 1 || x > 730) ? `${nom} : jusqu'à six nombres de jours entiers, de 1 à 730.` : null);
    const pas = (x: number, nom: string) => (!Number.isInteger(x) || x < 1 || x > 365 ? `${nom} : un nombre de jours entier, de 1 à 365.` : null);
    return paliers(r.preavis, 'Rappels de préavis') ?? paliers(r.echeance, 'Rappels d\'échéance') ?? pas(r.attenteJours, 'Rappel des documents en attente') ?? pas(r.depasseeJours, 'Rappel des échéances dépassées');
}

/** Palier courant : le plus petit palier que le nombre de jours restants a atteint ; null avant le premier palier. */
export function palierAtteint(jours: number, paliers: number[]): number | null {
    const atteints = paliers.filter(p => jours <= p);
    return jours < 0 || atteints.length === 0 ? null : Math.min(...atteints);
}

/** Contrat vu par les rappels (jours AAAA-MM-JJ). */
export type ContratRappel = {
    id: string; numero: string; client: string; actif: boolean; valide: boolean;
    fin: string | null; preavis?: string; reconductible: boolean; tacite: boolean; dureeReconduction?: string; montants?: MontantsPrestation;
};
/** Document (ou contrat) en attente de validation. */
export type AttenteRappel = { collection: string; id: string; contractId: string; nature: NatureDocument; deposeLe: string | null; deposePar?: string; resume?: string; effet?: string | null };

export type Rappel = { evenement: Evenement; cle: string; deposant?: string | null; contexte: Omit<ContexteMail, 'urlApplication'> };

const ecart = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** `dernierPassage` : jour du précédent passage des rappels (null : jamais), pour ne récapituler les attentes qu'à un nouveau seuil. */
export function rappelsDuJour(contrats: ContratRappel[], attentes: AttenteRappel[], today: string, r: ReglagesRappels = RAPPELS_DEFAUT, dernierPassage: string | null = null): Rappel[] {
    const rappels: Rappel[] = [];
    const parId = new Map(contrats.map(c => [c.id, c]));
    const citation = (c: ContratRappel): ContexteMail['contrat'] => ({ id: c.id, numero: c.numero, client: c.client, ...(c.montants && { montants: c.montants }) });

    for (const c of contrats) {
        if (!c.actif || !c.valide || !c.fin) continue;
        const reconduction = c.reconductible && c.tacite ? `reconduction tacite${c.dureeReconduction ? ` de ${c.dureeReconduction}` : ''}` : c.reconductible ? 'reconduction possible' : 'sans reconduction';
        const reste = ecart(today, c.fin);
        if (reste < 0) {
            // Dès le dépassement, puis à intervalle régulier.
            const depasse = -reste;
            rappels.push({ evenement: 'echeance_depassee', cle: `contracts/${c.id}/depassee/${c.fin}/${Math.floor(depasse / r.depasseeJours)}`, contexte: { contrat: citation(c), jours: depasse, date: c.fin, echeance: c.fin, reconduction, aujourdhui: today } });
            continue;
        }
        const duree = lireDuree(c.preavis);
        if (duree) {
            const limite = decaler(c.fin, duree, -1);
            const palier = palierAtteint(ecart(today, limite), r.preavis);
            if (palier !== null) {
                rappels.push({
                    evenement: 'preavis', cle: `contracts/${c.id}/preavis/${limite}/${palier}`,
                    contexte: { contrat: citation(c), jours: ecart(today, limite), date: limite, echeance: c.fin, preavis: c.preavis, reconduction: c.reconductible && c.tacite ? `sans dénonciation, ${reconduction}` : reconduction, aujourdhui: today },
                });
            }
        }
        const palier = palierAtteint(reste, r.echeance);
        if (palier !== null) rappels.push({ evenement: 'echeance', cle: `contracts/${c.id}/echeance/${c.fin}/${palier}`, contexte: { contrat: citation(c), jours: reste, date: c.fin, echeance: c.fin, ...(c.preavis && { preavis: c.preavis }), reconduction, aujourdhui: today } });
    }

    // Documents en attente : un seul mail récapitulatif, le jour où au moins un document franchit un nouveau seuil
    // d'attente (N, 2N, 3N… jours) depuis le dernier passage ; il liste tous ceux qui attendent depuis N jours ou plus.
    const depuis = dernierPassage && dernierPassage < today ? ecart(dernierPassage, today) : dernierPassage === today ? 0 : null;
    const liste: DocumentEnAttente[] = [];
    let nouveauSeuil = false;
    for (const a of attentes) {
        const c = parId.get(a.contractId);
        if (!c || !a.deposeLe) continue;
        const attente = ecart(a.deposeLe, today);
        const rang = Math.floor(attente / r.attenteJours);
        if (rang < 1) continue;
        liste.push({ numero: c.numero, client: c.client, nature: a.nature, jours: attente, deposeLe: a.deposeLe, ...(a.deposePar && { deposePar: a.deposePar }), ...(a.resume && { resume: a.resume }) });
        // Seuil franchi depuis le dernier passage (jamais passé : tout document au-delà du premier seuil compte).
        if (depuis === null || rang > Math.floor((attente - depuis) / r.attenteJours)) nouveauSeuil = true;
    }
    if (nouveauSeuil) {
        liste.sort((x, y) => y.jours - x.jours || x.numero.localeCompare(y.numero));
        rappels.push({ evenement: 'document_en_attente', cle: `attente/${today}`, contexte: { contrat: { id: '', numero: '', client: '' }, jours: liste[0].jours, liste, aujourdhui: today } });
    }
    return rappels;
}
