/**
 * Propositions de création (contrathèque) : un document déposé est lu par l'IA et donne une **proposition** — client,
 * contrat, sites, prestations — enregistrée sans rien créer. Une personne la revoit dans l'assistant de création,
 * corrige, puis crée (ou refuse). Logique pure : complément du brouillon de l'assistant (prestations, sites déjà
 * connus), contrôles avant revue, justificatifs des champs lus. Module sans dépendance serveur.
 */
import { depuisExtraction, doublonsClient, erreursBrouillon, type Brouillon, type LignePrestation } from './assistant';
import type { Client, ExtractContractInfoOutput } from '@/lib/types';

export type StatutProposition = 'en_lecture' | 'a_revoir' | 'acceptee' | 'refusee' | 'echec';
export const LIBELLE_STATUT: Record<StatutProposition, string> = { en_lecture: 'Lecture en cours', a_revoir: 'À revoir', acceptee: 'Acceptée', refusee: 'Refusée', echec: 'Lecture impossible' };

export type Confiance = 'haute' | 'moyenne' | 'basse';
/** D'où vient une valeur : l'extrait du document, sa page, et la confiance que l'IA y accorde. */
export type Preuve = { champ: string; extrait: string; page?: number; confiance: Confiance };

export type Alerte = { gravite: 'bloquant' | 'attention' | 'info'; texte: string; lien?: string };

export type Proposition = {
    id: string;
    statut: StatutProposition;
    type: 'pdf-prive' | 'pdf-public';
    document: { name: string; url: string };
    deposePar: string; deposeLe: string;
    lecture?: { modele: string; le: string; simulee?: boolean; dureeMs?: number };
    brouillon?: Brouillon;
    preuves?: Preuve[];
    alertes?: Alerte[];
    /** Résumé pour la liste. */
    resume?: { client: string; clientExistant: boolean; contrat: string; sites: number; prestations: number; montant: number };
    erreur?: string;
    decision?: { par: string; le: string; motif?: string; contractId?: string; contractNumber?: string };
};

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const nombre = (s: string) => Number(String(s).replace(/\s/g, '').replace(',', '.')) || 0;

type Ref = { id: string; name: string };
export type RefsProposition = {
    clients: Client[];
    sites: { id: string; name: string; address?: string; postalCode?: string; clientId?: string; contractId?: string | null }[];
    contrats: { id: string; contractNumber?: string; label?: string; clientId?: string; status?: string; startDate?: string; endDate?: string }[];
    activities: { id: string; code: string; label?: string; vatRateId?: string }[];
    typologies: Ref[]; schedules: Ref[]; terms: Ref[];
};

/** Périodicité ou terme lu en clair (« Trimestriel », « échu ») : l'identifiant du référentiel qui lui correspond. */
function parNom(liste: Ref[], lu?: string): string {
    const n = norm(lu);
    if (!n) return '';
    const echu = /\bechu\b/.test(n) && !/echoir/.test(n);
    return liste.find(x => norm(x.name) === n)?.id
        ?? liste.find(x => (echu ? /\bechu\b/.test(norm(x.name)) && !/echoir/.test(norm(x.name)) : norm(x.name).includes(n) || n.includes(norm(x.name))))?.id ?? '';
}

/**
 * Brouillon complet d'une lecture : celui de l'assistant (client, contrat, sites), plus les prestations (montant
 * annuel, périodicité, terme, TVA de l'activité) et les sites déjà connus du client. Renvoie aussi les remarques
 * de construction (montant à répartir entre plusieurs sites, site déjà sous contrat).
 */
export function brouillonProposition(base: Brouillon, x: ExtractContractInfoOutput, refs: RefsProposition): { brouillon: Brouillon; remarques: Alerte[] } {
    const remarques: Alerte[] = [];
    let b = depuisExtraction(base, x, { typologies: refs.typologies, clients: refs.clients });
    const ids = (liste: Ref[], v?: string) => (v && liste.some(r => r.id === v) ? v : '');

    // Sites : un site du document qui existe déjà chez le client (même adresse, ou même nom) est repris tel quel.
    if (b.client.mode === 'existant') {
        const duClient = refs.sites.filter(s => s.clientId === b.client.clientId);
        const nouveaux: typeof b.sites.nouveaux = [];
        const existants = [...b.sites.existants];
        for (const s of b.sites.nouveaux) {
            const connu = duClient.find(c => (norm(c.address) && norm(c.address) === norm(s.address) && (!s.postalCode || !c.postalCode || c.postalCode === s.postalCode)) || (norm(s.name).length >= 4 && norm(c.name) === norm(s.name)));
            if (!connu) { nouveaux.push(s); continue; }
            if (connu.contractId) {
                const k = refs.contrats.find(c => c.id === connu.contractId);
                remarques.push({ gravite: 'attention', texte: `Le site « ${connu.name} » existe déjà et est rattaché au contrat ${k?.contractNumber ?? connu.contractId} : un site ne peut pas être sous deux contrats.`, lien: `/sites/${connu.id}` });
                nouveaux.push(s);
            } else existants.push(connu.id);
        }
        b = { ...b, sites: { existants: [...new Set(existants)], nouveaux } };
    }

    // Prestations : une ligne par site et activité lue, avec le montant annuel du document.
    const details = (x.activitiesDetails ?? []).filter(d => refs.activities.some(a => a.id === d.activityId));
    const premier = details[0];
    const siteLu = (x.sites ?? [])[0];
    b = {
        ...b,
        contrat: {
            ...b.contrat,
            activityIds: [...new Set([...b.contrat.activityIds, ...details.map(d => d.activityId)])],
            scheduleId: b.contrat.scheduleId || ids(refs.schedules, premier?.scheduleId) || parNom(refs.schedules, siteLu?.billingSchedule),
            termId: b.contrat.termId || ids(refs.terms, premier?.termId) || parNom(refs.terms, siteLu?.term),
        },
    };
    const sites = [...b.sites.existants, ...b.sites.nouveaux.map(s => s.cle)];
    const lignes: LignePrestation[] = [];
    for (const d of details) {
        const a = refs.activities.find(r => r.id === d.activityId)!;
        const montant = d.amount && d.amount > 0 ? d.amount : 0;
        // Montant donné pour le contrat entier : porté sur le premier site, à répartir à la revue.
        if (montant && sites.length > 1) remarques.push({ gravite: 'attention', texte: `${a.code} : montant de ${montant.toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ')} € HT lu pour le contrat entier, porté sur le premier site — à répartir entre les ${sites.length} sites.` });
        sites.forEach((site, i) => lignes.push({
            site, activityId: a.id, montant: montant && i === 0 ? String(montant).replace('.', ',') : '',
            scheduleId: ids(refs.schedules, d.scheduleId) || b.contrat.scheduleId, termId: ids(refs.terms, d.termId) || b.contrat.termId,
            vatRateId: a.vatRateId || b.contrat.vatRateId, startDate: b.contrat.startDate,
        }));
    }
    if (lignes.length) b = { ...b, lusDansPdf: [...new Set([...b.lusDansPdf, 'prestations'])], prestations: { saisir: true, lignes } };
    return { brouillon: b, remarques };
}

/** Contrôles affichés à la revue : doublons, contrat déjà en place, informations manquantes. */
export function controlesProposition(b: Brouillon, refs: RefsProposition, remarques: Alerte[] = []): Alerte[] {
    const alertes: Alerte[] = [...remarques];
    if (b.client.mode === 'existant') {
        const c = refs.clients.find(x => x.id === b.client.clientId);
        alertes.push({ gravite: 'info', texte: `Client reconnu : ${c?.name ?? b.client.clientId} (même SIRET ou même nom). Il ne sera pas recréé.`, lien: `/clients/${b.client.clientId}` });
        // Contrat actif du même client sur une période qui se recouvre : doublon possible.
        const d = b.contrat.startDate, f = b.contrat.endDate;
        for (const k of refs.contrats.filter(x => x.clientId === b.client.clientId && x.status === 'Actif')) {
            const recouvre = !d || !f || !k.startDate || !k.endDate || (d <= k.endDate.slice(0, 10) && f >= k.startDate.slice(0, 10));
            if (recouvre) alertes.push({ gravite: 'attention', texte: `Ce client a déjà le contrat actif ${k.contractNumber ?? k.id}${k.label ? ` (« ${k.label} »)` : ''} sur une période qui se recouvre : s'agit-il d'un avenant ou d'un doublon ?`, lien: `/contracts/${k.id}` });
        }
    } else {
        const proches = doublonsClient(b.client.nouveau, refs.clients);
        if (proches.length) alertes.push({ gravite: 'attention', texte: `Client ressemblant déjà connu : ${proches.map(c => c.name).join(', ')}.`, lien: `/clients/${proches[0].id}` });
        alertes.push({ gravite: 'info', texte: `Nouveau client proposé : ${b.client.nouveau.name || '(nom non lu)'} — société, agence et secteur à choisir à la revue.` });
    }
    const manquants = Object.entries(erreursBrouillon(b)).flatMap(([, e]) => e);
    for (const m of [...new Set(manquants)]) alertes.push({ gravite: 'bloquant', texte: m });
    return alertes;
}

/** Résumé d'une proposition pour la liste. */
export function resumeProposition(b: Brouillon, refs: Pick<RefsProposition, 'clients'>): NonNullable<Proposition['resume']> {
    const existant = b.client.mode === 'existant';
    return {
        client: existant ? refs.clients.find(c => c.id === b.client.clientId)?.name ?? '' : b.client.nouveau.name,
        clientExistant: existant, contrat: b.contrat.label, sites: b.sites.existants.length + b.sites.nouveaux.length,
        prestations: b.prestations.lignes.filter(l => nombre(l.montant) > 0).length,
        montant: Math.round(b.prestations.lignes.reduce((s, l) => s + nombre(l.montant), 0) * 100) / 100,
    };
}

/** Justificatifs d'un champ du brouillon (« client.name », « contrat.startDate », « sites »…), du plus sûr au moins sûr. */
export function preuvesDe(preuves: Preuve[] | undefined, champ: string): Preuve[] {
    const rang: Record<Confiance, number> = { haute: 0, moyenne: 1, basse: 2 };
    return (preuves ?? []).filter(p => p.champ === champ || p.champ.startsWith(`${champ}.`) || p.champ.startsWith(`${champ}[`)).sort((a, b) => rang[a.confiance] - rang[b.confiance]);
}

/** Consigne ajoutée à toute lecture : citer, pour chaque information, l'extrait qui la justifie. */
export const CONSIGNE_PREUVES = `
**JUSTIFICATIFS (preuves) :**
Pour chaque information que tu as remplie, ajoute un objet dans le tableau « preuves » :
- champ : le chemin de l'information (ex. « client.name », « client.siret », « contrat.startDate », « contrat.endDate », « sites[0].address », « activitiesDetails[<id de l'activité>].amount ») ;
- extrait : la phrase ou le passage EXACT du document d'où vient l'information (200 caractères au plus, recopié tel quel) ;
- page : le numéro de la page ;
- confiance : « haute » si l'information est écrite telle quelle, « moyenne » si tu l'as déduite, « basse » si tu n'es pas sûr.
N'invente jamais une information : laisse le champ vide plutôt que de deviner.
`;
